/**
 * Standalone MCP database bootstrap + migration (TICKET_1289_1 F1).
 *
 * On a machine where the Electron app has never run, the webui (MCP server +
 * dashboard) must be able to create and migrate the SQLite database itself --
 * Electron is NOT a hidden installer dependency. This module makes the
 * standalone a first-class migration host by driving the SAME shared engine +
 * EMBEDDED_MIGRATIONS array Electron uses (@StratCraft/db-migrations), so the
 * two hosts can never diverge on schema version.
 *
 * Seam pieces:
 *  - `StandaloneMigrationDb`: adapts a raw better-sqlite3 connection to the
 *    shared `MigrationDb` handle interface (exec/prepare/transaction/
 *    transactionImmediate/pragma). Electron passes its `DatabaseManager`; the
 *    standalone has only a raw connection, so it wraps it here.
 *  - `installStandaloneMigrationHost()`: supplies the app-specific helpers the
 *    migration bodies reference (console logger, eval-parquet root derived from
 *    the standalone's data root, calendar-ratio fn + data-quality DDL from the
 *    shared package).
 *  - `bootstrapDatabase()`: creates the file if missing and applies pending
 *    migrations (fresh bootstrap or `schemaBehind` upgrade). `schemaAhead`
 *    stays the caller's fail-fast (an older binary must never touch a newer DB).
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  MigrationManager,
  MIGRATION_LOCK_BUSY_TIMEOUT_MS,
  withDatabaseStartupLock,
  setMigrationHost,
  evalParquetRootFor,
  computePackageCalendarRatios,
  DATA_QUALITY_EVENT_TABLE_DDL,
  type MigrationDb,
  type MigrationStatement,
  type CalendarRatioFileRow,
} from '@StratCraft/db-migrations';
import { resolveUserDataDir } from './db';

/**
 * Adapter: a raw better-sqlite3 connection presented as the shared `MigrationDb`
 * handle. The engine + migration bodies only ever call these five members.
 */
export class StandaloneMigrationDb implements MigrationDb {
  constructor(private readonly db: Database.Database) {}

  exec(sql: string): unknown {
    return this.db.exec(sql);
  }

  prepare(sql: string): MigrationStatement {
    // better-sqlite3's Statement already satisfies MigrationStatement
    // (run/get/all) structurally.
    return this.db.prepare(sql) as unknown as MigrationStatement;
  }

  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  transactionImmediate<T>(fn: () => T): () => T {
    return this.db.transaction(fn).immediate;
  }

  pragma(source: string): unknown {
    return this.db.pragma(source);
  }
}

/**
 * Resolve the standalone's data root -- the same value Electron's
 * `getDataRoot()` yields: STRATCRAFT_DATA_ROOT when set, else the platform
 * user-data dir. Used only to derive the eval-parquet root for the v96
 * preflight; the standalone never writes parquet itself.
 */
function resolveStandaloneDataRoot(): string {
  const envRoot = process.env.STRATCRAFT_DATA_ROOT;
  if (envRoot && envRoot.length > 0) return envRoot;
  return resolveUserDataDir();
}

let hostInstalled = false;

/** Install the standalone MigrationHost exactly once (idempotent). */
export function installStandaloneMigrationHost(): void {
  if (hostInstalled) return;
  setMigrationHost({
    log: {
      // The MCP server logs to stderr (stdout is the MCP stdio transport).
      info: (...args: unknown[]) => console.error('[db-migrations]', ...args),
      warn: (...args: unknown[]) => console.error('[db-migrations][warn]', ...args),
      error: (...args: unknown[]) => console.error('[db-migrations][error]', ...args),
    },
    getEvalParquetRoot: () => evalParquetRootFor(resolveStandaloneDataRoot()),
    computePackageCalendarRatios: (files: CalendarRatioFileRow[]) =>
      computePackageCalendarRatios(files),
    dataQualityEventTableDdl: DATA_QUALITY_EVENT_TABLE_DDL,
  });
  hostInstalled = true;
}

/**
 * Create (if missing) and migrate the SQLite database at `dbPath` to
 * EXPECTED_SCHEMA_VERSION using the shared engine.
 *
 * Opens a dedicated RW connection with WAL + foreign_keys, installs the host,
 * and runs all pending migrations under the shared engine's AC7 write-lock (the
 * engine's getCurrentVersion() creates the `schema_version` journal table on
 * first read). Safe to call when the DB is already current (no-op) and safe to
 * race against Electron on the same file (the immediate-transaction lock
 * serializes the two: the loser waits, re-reads, and no-ops).
 *
 * The caller is responsible for the `schemaAhead` fail-fast (an older MCP binary
 * must never migrate a newer DB) BEFORE calling this -- see server.main().
 *
 * @returns the schema version after migration.
 */
export async function bootstrapDatabase(dbPath: string): Promise<number> {
  installStandaloneMigrationHost();

  // Ensure the parent directory exists (fresh no-Electron machine).
  const parentDir = path.dirname(dbPath);
  if (!fs.existsSync(parentDir)) {
    const dirMode =
      process.platform !== 'win32'
        ? { recursive: true as const, mode: 0o700 }
        : { recursive: true as const };
    fs.mkdirSync(parentDir, dirMode);
  }

  const rawDb = withDatabaseStartupLock(dbPath, () => {
    const db = new Database(dbPath, { readonly: false });
    try {
      // AC7: WAL activation itself can acquire a SQLite lock, so both hosts run
      // this connection setup under the shared cross-process startup lock.
      db.pragma(`busy_timeout = ${MIGRATION_LOCK_BUSY_TIMEOUT_MS}`);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });
  try {
    // TICKET_580_1 parity: owner-only perms on the freshly created file (Unix).
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(dbPath, 0o600);
      } catch {
        /* best-effort; %APPDATA% ACL covers Windows */
      }
    }

    const handle = new StandaloneMigrationDb(rawDb);
    const manager = new MigrationManager(handle);
    await manager.migrate();

    const row = rawDb
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } finally {
    rawDb.close();
  }
}
