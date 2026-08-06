/**
 * Electron main's MigrationHost binding for the shared @StratCraft/db-migrations
 * engine (TICKET_1289_1 F1).
 *
 * The migration bodies live in the shared package now, but a handful reference
 * app-specific helpers (`dbLog`, `getEvalParquetRoot`,
 * `computePackageCalendarRatios`). This module wires the REAL Electron
 * implementations to the shared host seam. It is installed once, before any
 * migration runs (see migration-manager.ts / db-manager.ts).
 *
 * TICKET_1308 7D: COMMERCIAL helpers are loaded via dynamic import so the public
 * release tree compiles without the commercial service modules. Only
 * `computePackageCalendarRatios` qualifies. TICKET_1378: the data-quality DDL
 * does NOT -- it is owned by @StratCraft/db-migrations, which is present in both
 * trees, so it is imported statically rather than guarded by a fallback that
 * could silently install an empty DDL.
 */
import {
  DATA_QUALITY_EVENT_TABLE_DDL,
  evalParquetRootFor,
  setMigrationHost,
} from '@StratCraft/db-migrations';
import type { CalendarRatioFileRow } from '@StratCraft/db-migrations';
import { dbLog } from '../../utils/logger';
import { getDataRoot } from '../../utils/data-root';

let installed = false;

/**
 * Install the Electron MigrationHost exactly once. Idempotent: repeated calls
 * (e.g. across DatabaseManager re-inits in tests) are no-ops after the first.
 */
export async function installElectronMigrationHost(): Promise<void> {
  if (installed) return;

  let computePackageCalendarRatios: ((files: CalendarRatioFileRow[]) => unknown) | undefined;

  try {
    const ipr = await import('../../services/data-providers/imported-package-ratio');
    computePackageCalendarRatios = ipr.computePackageCalendarRatios;
  } catch { /* commercial module absent in public tree */ }

  setMigrationHost({
    log: dbLog,
    getEvalParquetRoot: () => evalParquetRootFor(getDataRoot()),
    computePackageCalendarRatios: computePackageCalendarRatios ?? (() => ({})),
    // Owned by @StratCraft/db-migrations (a hard dependency of this module), so
    // it is imported statically -- present in both the private and public tree.
    // The previous dynamic-import + `?? ''` fallback would have installed an
    // empty DDL on any load failure, silently skipping the v112 ledger table
    // (TICKET_858: no silent failures).
    dataQualityEventTableDdl: DATA_QUALITY_EVENT_TABLE_DDL,
  });
  installed = true;
}
