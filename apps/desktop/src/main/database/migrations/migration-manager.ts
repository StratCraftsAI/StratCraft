/**
 * MigrationManager (Electron main) -- thin consumer of the shared migration
 * engine (TICKET_1289_1 F1, TICKET_854 single source of truth).
 *
 * The migration array (`EMBEDDED_MIGRATIONS`) and the apply loop
 * (`MigrationManager`) used to live here as ~5800 embedded lines. They now live
 * in `@StratCraft/db-migrations` so BOTH Electron main and the standalone MCP
 * server drive the identical array through the identical engine -- version skew
 * between the two hosts is structurally impossible.
 *
 * This module now only:
 *  1. installs Electron's MigrationHost (dbLog / getEvalParquetRoot /
 *     computePackageCalendarRatios / data-quality DDL) so the shared migration
 *     bodies resolve their app-specific helpers, and
 *  2. re-exports `MigrationManager` + `EMBEDDED_MIGRATIONS_FOR_TEST` so the many
 *     existing importers (`db-manager.ts`, migration tests, services) keep their
 *     current import path with no churn.
 *
 * Historical note: the previous class-header comment claimed "auto-discovery of
 * migration files from scripts/ directory". That was always stale -- the engine
 * never read `scripts/*.sql`; it returned the embedded array directly. The dead
 * `migrations/scripts/*.sql` files are removed in the same change set.
 */
export { installElectronMigrationHost } from './electron-migration-host';
export { MigrationManager, EMBEDDED_MIGRATIONS_FOR_TEST } from '@StratCraft/db-migrations';
export type { Migration, MigrationDb } from '@StratCraft/db-migrations';
