/**
 * Electron main's MigrationHost binding for the shared @StratCraft/db-migrations
 * engine (TICKET_1289_1 F1).
 *
 * The migration bodies live in the shared package now, but a handful reference
 * app-specific helpers (`dbLog`, `getEvalParquetRoot`,
 * `computePackageCalendarRatios`, the data-quality DDL). This module wires the
 * REAL Electron implementations to the shared host seam. It is installed once,
 * before any migration runs (see migration-manager.ts / db-manager.ts).
 *
 * TICKET_1308 7D: commercial helpers loaded via dynamic import so the public
 * release tree compiles without the commercial service modules.
 */
import { evalParquetRootFor, setMigrationHost } from '@StratCraft/db-migrations';
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
  let dataQualityEventTableDdl: string | undefined;

  try {
    const ipr = await import('../../services/data-providers/imported-package-ratio');
    computePackageCalendarRatios = ipr.computePackageCalendarRatios;
  } catch { /* commercial module absent in public tree */ }

  try {
    const dq = await import('../../../shared/constants/data-quality');
    dataQualityEventTableDdl = dq.DATA_QUALITY_EVENT_TABLE_DDL;
  } catch { /* commercial module absent in public tree */ }

  setMigrationHost({
    log: dbLog,
    getEvalParquetRoot: () => evalParquetRootFor(getDataRoot()),
    computePackageCalendarRatios: computePackageCalendarRatios ?? (() => ({})),
    dataQualityEventTableDdl: dataQualityEventTableDdl ?? '',
  });
  installed = true;
}
