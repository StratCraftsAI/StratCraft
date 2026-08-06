/**
 * Migration host binding (TICKET_1289_1 F1).
 *
 * A handful of migration bodies reference app-specific helpers as FREE
 * identifiers: `dbLog`, `getEvalParquetRoot`, `computePackageCalendarRatios`,
 * `DATA_QUALITY_EVENT_TABLE_DDL`. To move those bodies into this shared package
 * VERBATIM (no per-body edits across 127 migrations), this module defines those
 * same identifiers as thin delegators over a process-level `activeHost` that the
 * consuming host sets exactly once before running migrations.
 *
 * This is a deliberate module-level singleton: there is one SQLite schema per
 * process and one host driving it. `setMigrationHost()` is idempotent-friendly
 * (last writer wins) so a host that re-inits (e.g. tests) is safe.
 */
import type {
  CalendarRatioFileRow,
  MigrationHost,
  MigrationLogger,
} from './types';

let activeHost: MigrationHost | null = null;

/**
 * Install the host bindings the migration bodies delegate to. MUST be called
 * before `MigrationManager.migrate()` / `.rollback()`. Fail-fast (TICKET_857):
 * a migration body that touches a host binding before this is set would
 * otherwise dereference null deep inside a transaction.
 */
export function setMigrationHost(host: MigrationHost): void {
  activeHost = host;
}

/** Clear the host (tests only). */
export function resetMigrationHost(): void {
  activeHost = null;
}

/** Whether a host has been installed. */
export function hasMigrationHost(): boolean {
  return activeHost !== null;
}

function requireHost(): MigrationHost {
  if (!activeHost) {
    throw new Error(
      '[db-migrations] Migration host not configured. Call setMigrationHost() ' +
        'with { log, getEvalParquetRoot, computePackageCalendarRatios, ' +
        'dataQualityEventTableDdl } before running migrations.',
    );
  }
  return activeHost;
}

/**
 * Logger the migration bodies call as `dbLog.info/warn/error`. Delegates to the
 * host logger; each call re-reads the host so a late `setMigrationHost()` is
 * honored. Kept as a stable object identity so `import { dbLog }` in the
 * migrations module binds once.
 */
export const dbLog: MigrationLogger = {
  info: (...args: unknown[]) => requireHost().log.info(...args),
  warn: (...args: unknown[]) => requireHost().log.warn(...args),
  error: (...args: unknown[]) => requireHost().log.error(...args),
};

/** Delegator: resolve the eval-parquet root (see MigrationHost). */
export function getEvalParquetRoot(): string {
  return requireHost().getEvalParquetRoot();
}

/** Delegator: compute calendar-padding ratios (see MigrationHost). */
export function computePackageCalendarRatios(files: CalendarRatioFileRow[]): unknown {
  return requireHost().computePackageCalendarRatios(files);
}

/**
 * Delegator constant: the `data_quality_event` DDL. Exposed as a getter-backed
 * export so it resolves lazily against the installed host (the string is not
 * known at module-load time -- the host supplies it). Migration bodies use it
 * as `DATA_QUALITY_EVENT_TABLE_DDL` verbatim; this getter makes that a value
 * read at call time.
 */
export function getDataQualityEventTableDdl(): string {
  return requireHost().dataQualityEventTableDdl;
}
