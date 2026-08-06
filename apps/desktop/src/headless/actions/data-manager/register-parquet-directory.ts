import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

const mod: ActionModule = {
  name: 'data-manager/register-parquet-directory',
  description: 'Bulk-register pre-existing parquet files in L1 cache (no copy, in-place)',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();

    const packageName = args.package_name as string | undefined;
    const adjustMode = (args.adjust_mode as string | undefined) ?? 'none';
    const sourceDialect = (args.source_dialect as string | undefined) ?? 'parquet';
    const archivalCadence = args.archival_cadence as string | undefined;

    if (!packageName) {
      return {
        name: mod.name,
        ok: false,
        summary: 'Missing required arg: package_name',
        details: { provided: args },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    await HeadlessBootstrap.init();

    const { getDataImportService } = await import('../../../main/services/data-import-service');
    const service = getDataImportService();

    const result = await service.registerParquetDirectory({
      packageName,
      adjustMode: adjustMode as 'none' | 'qfq' | 'hfq',
      sourceDialect: sourceDialect as import('../../../shared/constants/data-import').ImportSourceDialect,
      archivalCadence: archivalCadence as import('../../../shared/constants/data-import').ArchivalCadence | undefined,
    });

    return {
      name: mod.name,
      ok: true,
      summary:
        `Registered package "${packageName}": ` +
        `${result.registered} files registered, ${result.skipped} skipped`,
      details: {
        packageName,
        adjustMode,
        sourceDialect,
        archivalCadence: archivalCadence ?? '(dialect default)',
        registered: result.registered,
        skipped: result.skipped,
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
