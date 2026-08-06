import { existsSync } from 'fs';
import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';

const mod: ActionModule = {
  name: 'data-manager/import-package',
  description: 'Import a BYOD data package (parquet/csv/duckdb directory or file) into the Parquet cache',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();

    const sourcePath = args.path as string | undefined;
    const packageName = args.package_name as string | undefined;
    const adjustMode = (args.adjust_mode as string | undefined) ?? 'none';

    if (!sourcePath) {
      return {
        name: mod.name,
        ok: false,
        summary: 'Missing required arg: path',
        details: { provided: { path: sourcePath, package_name: packageName, adjust_mode: adjustMode } },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    if (!existsSync(sourcePath)) {
      return {
        name: mod.name,
        ok: false,
        summary: `Source path does not exist: ${sourcePath}`,
        details: { path: sourcePath },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    await HeadlessBootstrap.init();

    const { getDataImportService } = await import('../../../main/services/data-import-service');
    const service = getDataImportService();

    // Phase 1: scan to preview what will be imported
    const resolvedName = packageName?.trim() || sourcePath.split('/').pop()?.replace(/\.\w+$/, '') || 'imported-package';
    const scan = service.scanDataPackage({ sourcePath, packageName: resolvedName });

    if (scan.validationErrors.length > 0) {
      return {
        name: mod.name,
        ok: false,
        summary: `Validation failed: ${scan.validationErrors.map(e => e.message).join('; ')}`,
        details: {
          packageName: scan.packageName,
          sourceDialect: scan.sourceDialect,
          validationErrors: scan.validationErrors,
        },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    // Phase 2: import
    const result = await service.importDataPackage({
      sourcePath,
      packageName: resolvedName,
      adjustMode: adjustMode as 'none' | 'qfq' | 'hfq',
    });

    const totalRows = result.series.reduce((sum, s) => sum + s.rowCount, 0);
    const symbols = Array.from(new Set(result.series.map(s => s.symbol))).sort();
    const intervals = Array.from(new Set(result.series.map(s => s.interval))).sort();

    return {
      name: mod.name,
      ok: true,
      summary:
        `Imported package "${result.packageName}" (${result.sourceDialect}): ` +
        `${result.series.length} series, ${totalRows} total rows, ` +
        `${symbols.length} symbols, ${intervals.length} intervals` +
        (result.skippedFiles.length > 0 ? `, ${result.skippedFiles.length} skipped` : ''),
      details: {
        packageName: result.packageName,
        sourceDialect: result.sourceDialect,
        seriesCount: result.series.length,
        totalRows,
        symbols,
        intervals,
        skippedFiles: result.skippedFiles,
        series: result.series.map(s => ({
          symbol: s.symbol,
          interval: s.interval,
          rowCount: s.rowCount,
          firstTimestamp: s.firstTimestamp,
          lastTimestamp: s.lastTimestamp,
        })),
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
