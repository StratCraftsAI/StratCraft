/**
 * Database resolution and initialization for MCP Server.
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { EXPECTED_SCHEMA_VERSION } from '@StratCraft/types';
import { resolveStandaloneUserDataRoot } from '@StratCraft/managed-tools-core';
import {
  MIGRATION_LOCK_BUSY_TIMEOUT_MS,
  withDatabaseStartupLock,
} from '@StratCraft/db-migrations';

/**
 * Resolve the dev-mode data directory (apps/desktop/data).
 *
 * TICKET_1265_2 RC1: the dev-path probe must NOT rely on a fixed `__dirname`
 * depth -- the standalone package is compiled to `dist/src/db.js` but authored
 * at `src/db.ts`, so a hard-coded `..` count resolves to a nonexistent
 * directory in one of the two layouts and the discovery bridge silently
 * degrades to the static provider catalog.
 *
 * Anchor instead on the `standalone` package directory (stable across src and
 * dist): walk up from __dirname until the directory named `standalone` is
 * found, then `../../../..` from `apps/desktop/src/mcp/standalone` is
 * `apps/desktop`. This is the same directory `getDiscoveryDir()` (dev branch)
 * in http-server.ts writes to (`app.getAppPath()/data`), satisfying the
 * TICKET_425_1 discovery-path contract.
 */
export function resolveDevDataDir(): string {
  let dir = __dirname;
  // Walk up to the `standalone` package root.
  while (path.basename(dir) !== 'standalone') {
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root without finding `standalone`; fall back to the
      // legacy relative computation so behavior is at least deterministic.
      return path.join(__dirname, '..', '..', '..', 'data');
    }
    dir = parent;
  }
  // standalone -> mcp -> src -> desktop == apps/desktop
  const desktopDir = path.join(dir, '..', '..', '..');
  return path.join(desktopDir, 'data');
}

/**
 * Resolve the Electron userData directory as seen from the MCP process.
 *
 * TICKET_1276 P2 Batch C2: single owning-layer resolver for the app-data dir
 * that hosts `plugins/` (and the credential/config files). `plugins/{id}` is a
 * FILE-based store, so the plugin read core needs this dir to enumerate
 * manifests and read user-config -- the same contract mcp-secure-credentials
 * uses for the plugin config.json. `STRATCRAFT_MCP_USERDATA_DIR` overrides for
 * tests / non-default installs.
 */
export function resolveUserDataDir(): string {
  return resolveStandaloneUserDataRoot({
    platform: os.platform(),
    homeDirectory: os.homedir(),
    environment: process.env,
  });
}

/**
 * Resolve the bundled + user plugin directories the plugin read core scans.
 *
 * TICKET_1276 P2 Batch C2. Mirrors the Electron `getPluginPaths()` contract
 * (plugin-lifecycle-api.ts): bundled plugins ship inside the app (dev = the
 * source-tree `<repo>/plugins`, prod = `<resourcesPath>/bundled_plugins`); user
 * installs live under `<userData>/plugins`. Dev is detected the same way as
 * `resolveDbPath` -- the source-tree dev data dir exists.
 */
export function resolvePluginDirs(): { bundled: string; user: string } {
  // Dev: the source-tree data dir exists. `resolveDevDataDir()` is
  // `<repo>/apps/desktop/data`; the bundled plugins are `<repo>/plugins`.
  const devDataDir = resolveDevDataDir();
  const isDev = fs.existsSync(path.join(devDataDir, 'StratCraft.db'));
  // `process.resourcesPath` is an Electron-injected global (not in @types/node);
  // when the MCP runs under plain Node it is undefined -> empty base.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
  const bundled = isDev
    ? path.join(devDataDir, '..', '..', '..', 'plugins')
    : path.join(resourcesPath, 'bundled_plugins');
  const user = path.join(resolveUserDataDir(), 'plugins');
  return { bundled, user };
}

export function resolveDbPath(): string {
  // CLI arg: --db-path /path/to/StratCraft.db
  const argIndex = process.argv.indexOf('--db-path');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }

  // Environment variable
  if (process.env.StratCraft_DB_PATH) {
    return process.env.StratCraft_DB_PATH;
  }

  // Development default -- anchored on the standalone package root so it is
  // correct in both the TS-source and compiled-dist layouts (TICKET_1265_2).
  const devPath = path.join(resolveDevDataDir(), 'StratCraft.db');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Production default -- the shared Electron userData dir.
  const platformPath = os.platform() === 'win32' ? path.win32 : path;
  const prodPath = platformPath.join(resolveUserDataDir(), 'data', 'StratCraft.db');
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }

  // TICKET_1289_1 F1.3: no DB exists anywhere. On a machine where Electron has
  // never run (the no-Electron webui scenario), the standalone bootstraps the
  // DB at the SHARED user-data path -- the exact location Electron would use --
  // so a later desktop install adopts the same file (no fork). The bootstrap
  // (migrate.ts) creates the parent dir + file here. (Previously this returned
  // the dev path, which "will fail if not found" -- correct only when Electron
  // is the sole migration owner, fatal for the standalone-first scenario.)
  return prodPath;
}

/**
 * Resolve the Service API discovery directory (where api-port/api-token live).
 *
 * TICKET_1265_2: same directory as the resolved DB. Extracted so the writer
 * contract (getDiscoveryDir dev branch == apps/desktop/data) can be pinned by
 * a unit test against the reader's dev-dir computation.
 */
export function resolveDiscoveryDir(): string {
  return path.dirname(resolveDbPath());
}

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true });
  db.pragma('foreign_keys = ON');
  return db;
}

export function openDatabaseRW(dbPath: string): Database.Database {
  return withDatabaseStartupLock(dbPath, () => {
    const db = new Database(dbPath, { readonly: false });
    try {
      db.pragma(`busy_timeout = ${MIGRATION_LOCK_BUSY_TIMEOUT_MS}`);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// TICKET_1276 P2 gate 2 -- schema-version-skew contract.
//
// The Electron main process is the SOLE migration writer. The MCP process opens
// the SAME SQLite file but NEVER migrates. When the two processes are built
// against different schema versions we must fail loud (TICKET_858) instead of
// reading columns that may not exist / may have moved.
//
// The app tracks the applied schema version in the `schema_version` TABLE
// (MAX(version)), NOT SQLite's `PRAGMA user_version` -- see
// apps/desktop/src/main/database/migrations/migration-manager.ts. This guard
// reads that table, matching the real mechanism.
// ---------------------------------------------------------------------------

/** How the on-disk schema relates to the version this MCP build expects. */
export type SchemaSkewKind = 'schemaAhead' | 'schemaBehind';

/**
 * Explicit, actionable error raised when the on-disk schema version does not
 * match the version this MCP build was compiled against. Never swallowed --
 * a wrong-version read would silently return malformed data (TICKET_858).
 */
export class SchemaSkewError extends Error {
  readonly kind: SchemaSkewKind;
  readonly dbVersion: number;
  readonly expectedVersion: number;

  constructor(kind: SchemaSkewKind, dbVersion: number, expectedVersion: number) {
    const gap = Math.abs(dbVersion - expectedVersion);
    const message =
      kind === 'schemaAhead'
        ? `[MCP schema skew] Database schema version ${dbVersion} is AHEAD of ` +
          `this MCP build's expected version ${expectedVersion} (gap ${gap}). ` +
          `The desktop app migrated the database further than this MCP binary ` +
          `understands; reading it could return malformed data. Update / restart ` +
          `the MCP server so it is rebuilt against schema version ${dbVersion}.`
        : `[MCP schema skew] Database schema version ${dbVersion} is BEHIND ` +
          `this MCP build's expected version ${expectedVersion} (gap ${gap}). ` +
          `The database has not been migrated to the schema this MCP build ` +
          `requires. Launch the StratCraft desktop app once so it runs the ` +
          `pending migrations, then restart the MCP server. The MCP process ` +
          `never migrates the database itself.`;
    super(message);
    this.name = 'SchemaSkewError';
    this.kind = kind;
    this.dbVersion = dbVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Read the current applied schema version from the `schema_version` table.
 *
 * Returns 0 when the table does not exist yet (a fresh, never-migrated DB) --
 * matching MigrationManager.getCurrentVersion()'s own semantics. Read-only: it
 * never creates the table (that is the Electron migration writer's job).
 */
export function readSchemaVersion(db: Database.Database): number {
  const tableExists = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version' LIMIT 1`,
    )
    .get() as { 1: number } | undefined;
  if (!tableExists) {
    return 0;
  }
  const row = db
    .prepare('SELECT MAX(version) AS version FROM schema_version')
    .get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

/**
 * Assert the on-disk schema is compatible with this MCP build.
 *
 *  - dbVersion === EXPECTED_SCHEMA_VERSION -> normal, no throw.
 *  - dbVersion  >  EXPECTED_SCHEMA_VERSION -> throw SchemaSkewError('schemaAhead').
 *  - dbVersion  <  EXPECTED_SCHEMA_VERSION -> throw SchemaSkewError('schemaBehind').
 *
 * A fresh DB (version 0, table absent) reports `schemaBehind`, which is correct:
 * an unmigrated file must not be read -- the user is told to launch the desktop
 * app once so Electron migrates it. This is the single explicit error shape all
 * callers get, rather than each handler discovering a missing column at query
 * time.
 *
 * @param db an open better-sqlite3 handle (readonly or RW).
 * @param expected override the expected version (tests only); defaults to the
 *        shared EXPECTED_SCHEMA_VERSION from @StratCraft/types.
 */
export function assertSchemaCompatible(
  db: Database.Database,
  expected: number = EXPECTED_SCHEMA_VERSION,
): void {
  const dbVersion = readSchemaVersion(db);
  if (dbVersion === expected) {
    return;
  }
  if (dbVersion > expected) {
    throw new SchemaSkewError('schemaAhead', dbVersion, expected);
  }
  throw new SchemaSkewError('schemaBehind', dbVersion, expected);
}
