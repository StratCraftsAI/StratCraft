/**
 * @StratCraft/db-migrations -- shared SQLite migration engine + the single
 * source of truth for the schema (EMBEDDED_MIGRATIONS). TICKET_1289_1 F1.
 *
 * Consumers:
 *  - Electron main (`db-manager.ts` / `migration-manager.ts` re-export from here);
 *  - the standalone MCP server (bootstraps + migrates its own connection).
 *
 * Usage:
 *   import { MigrationManager, setMigrationHost } from '@StratCraft/db-migrations';
 *   setMigrationHost({ log, getEvalParquetRoot, computePackageCalendarRatios, dataQualityEventTableDdl });
 *   await new MigrationManager(dbHandle).migrate();
 */
export {
  MigrationManager,
  EMBEDDED_MIGRATIONS_FOR_TEST,
  MIGRATION_LOCK_BUSY_TIMEOUT_MS,
} from './migrations';

export {
  setMigrationHost,
  resetMigrationHost,
  hasMigrationHost,
} from './host';

export type {
  Migration,
  MigrationDb,
  MigrationStatement,
  MigrationHost,
  MigrationLogger,
  CalendarRatioFileRow,
} from './types';

// Shared migration-body helpers (TICKET_854 single source; both hosts consume).
export {
  computePackageCalendarRatios,
  type PackageRatioInputRow,
} from './calendar-ratios';
export { evalParquetRootFor, PARQUET_CACHE_DIR } from './eval-parquet-path';
export { DATA_QUALITY_EVENT_TABLE_DDL } from './data-quality-ddl';
export { withDatabaseStartupLock } from './startup-lock';
