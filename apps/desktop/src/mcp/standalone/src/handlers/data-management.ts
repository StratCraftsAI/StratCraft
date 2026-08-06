/**
 * Data Management MCP tool handlers.
 *
 * TICKET_1235_2: 17 typed tools covering the Data Management page surface.
 *
 * TICKET_1276 P2 Batch C1: the three STORAGE-OWNED (Class-S) reads --
 * list_data_segments / get_cache_stats / list_imported_packages -- are served
 * directly from the `data_cache_files` / `imported_packages` SQLite tables via
 * the shared, Electron-free `@StratCraft/data-cache-store` read core (the SAME
 * core the Electron `DataCacheManager` now delegates to). The Desktop bridge
 * was DELETED for these three; the direct read is the SOLE path, so the answer
 * is identical whether or not Electron is alive (TICKET_1276 AC4). A DB error
 * surfaces explicitly (TICKET_858) -- never a silently smaller answer.
 *
 * Schema-skew (P2 gate 2): the handle passed here is the same readonly handle
 * `server.ts` opens and validates with `assertSchemaCompatible(db)` at startup;
 * the process refuses to serve on any version mismatch (SchemaSkewError). Every
 * column the core reads (`data_cache_files.*`, `imported_packages.*`, incl. the
 * newest nullable `content_revision`) is part of the v125 baseline this MCP
 * build targets, so no read touches a column added after that baseline.
 *
 * The remaining 14 tools are Class-R (live provider pool, in-memory download
 * queue, destructive/app-coordinated IO) and stay on the runtime bridge; those
 * genuinely require the desktop app (Batch D hardens their error shape).
 */
import type Database from 'better-sqlite3';
import {
  listCacheFiles,
  getCacheStats,
  listImportedPackages,
  listImportedPackageSummaries,
} from '@StratCraft/data-cache-store';
import type { McpToolResult } from './tool-result';
import { discoverServiceApi } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';
import { electronNotRunning } from './electron-guard';
// TICKET_1327 F1/F3: configured-ness comes from the shared owner over the
// shared credential rows -- the same source the Electron surface reads.
import { readConfiguredDataProviders } from '../mcp-secure-credentials';
import {
  buildAvailabilityWithoutReachability,
  type ProviderReachabilityEntry,
} from '@StratCraft/types';

function bridgeResult(response: apiClient.ApiResponse): McpToolResult {
  if (response.success && response.data) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }] };
  }
  if (response.success) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: response.error ?? 'Unknown error' }) }],
    isError: true,
  };
}

// =============================================================================
// F2: Read/Query Tools (T0)
// =============================================================================

/**
 * TICKET_1327 F3/F4 -- split Class-S configured-ness from Class-R reachability.
 *
 * Previously this returned `electronNotRunning` outright, so "which data
 * providers can I use?" had NO answer on this surface whenever Electron was
 * down -- while the Electron surface answered it from the credential store,
 * which needs no live pool at all. Those were two different questions
 * (TICKET_1327 sec.3), and only one of them is genuinely Class-R.
 *
 * Now:
 *   - `configured` (identity + configured-ness) is ALWAYS served, read
 *     directly from the shared credential rows via the same shared owner the
 *     Electron surface uses. Class-S parity per TICKET_1276 AC4.
 *   - `reachability` (the live probe: status/latency) is served only when
 *     Electron answers. When it does not, the field is ABSENT and
 *     `reachabilityAbsentReason` says why -- never reported as `false` or as
 *     "not configured", which would be a TICKET_858 silent failure and would
 *     make a configured provider look unconfigured merely because the probe
 *     was unreachable (F3/AC4).
 *
 * A picker needs `configured`; only a health indicator needs `reachability`.
 */
export async function handleListDataProviders(): Promise<McpToolResult> {
  // Class-S half first, and unconditionally -- it must not depend on the
  // bridge. A failure to read credentials surfaces explicitly (TICKET_858).
  let configured;
  try {
    configured = await readConfiguredDataProviders();
  } catch (e) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        error: `Could not read credential store: ${e instanceof Error ? e.message : String(e)}`,
      }) }],
      isError: true,
    };
  }

  const config = discoverServiceApi();
  if (!config) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(
        buildAvailabilityWithoutReachability(
          configured,
          'The desktop app is not running, so live provider reachability could not be probed. '
          + 'Credential configuration above is authoritative and unaffected.',
        ),
        null, 2,
      ) }],
    };
  }

  try {
    const response = await apiClient.dataListProviders(config);
    if (!response.success) {
      // The bridge failed, but the Class-S half is still a real answer --
      // degrade the Class-R half only, and say so.
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(
          buildAvailabilityWithoutReachability(
            configured,
            `Live provider reachability unavailable: ${response.error ?? 'Unknown error'}`,
          ),
          null, 2,
        ) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(
        { configured, reachability: extractReachability(response.data) },
        null, 2,
      ) }],
    };
  } catch (e) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(
        buildAvailabilityWithoutReachability(
          configured,
          `Live provider reachability unavailable: ${e instanceof Error ? e.message : String(e)}`,
        ),
        null, 2,
      ) }],
    };
  }
}

/**
 * Project the bridge's `ProviderStatusEntry[]` onto the Class-R half.
 *
 * TICKET_1327 AC7: a cold `statusCache` yields `status: 'checking'` for every
 * provider. That is preserved verbatim and NEVER remapped to a
 * configured/unconfigured claim -- "the probe has not finished" is not
 * evidence about credentials.
 */
function extractReachability(data: unknown): ProviderReachabilityEntry[] {
  const rows = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { providers?: unknown }).providers)
        ? (data as { providers: unknown[] }).providers
        : []);
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string') return [];
    return [{
      id: r.id,
      status: (r.status as ProviderReachabilityEntry['status']) ?? 'checking',
      ...(typeof r.latencyMs === 'number' ? { latencyMs: r.latencyMs } : {}),
      ...(typeof r.error === 'string' ? { error: r.error } : {}),
    }];
  });
}

export async function handleSearchSymbols(params: { query: string; provider?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Search symbols');
  try { return bridgeResult(await apiClient.dataSearchSymbols(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleGetSymbolDateRange(params: { symbol: string; provider?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Get symbol date range');
  try { return bridgeResult(await apiClient.dataGetSymbolDateRange(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleCheckDataCoverage(params: { symbol: string; interval: string; start_date: string; end_date: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Check data coverage');
  try { return bridgeResult(await apiClient.dataCheckCoverage(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

/**
 * TICKET_1276 P2 Batch C1 -- Class-S direct read. Returns the paginated segment
 * list plus the unpaginated total (the shape the Data Management page expects),
 * matching the historical `DataCacheManager.listFiles` bridge payload.
 */
export async function handleListDataSegments(db: Database.Database, params: { provider?: string; symbol?: string; interval?: string; limit?: number; offset?: number }): Promise<McpToolResult> {
  const result = listCacheFiles(db, params);
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

/**
 * TICKET_1276 P2 Batch C1 -- Class-S direct read. Aggregate cache statistics
 * over `data_cache_files`; on-disk size is summed from each cached file's
 * absolute `file_path` (no parquet contents read).
 */
export async function handleGetCacheStats(db: Database.Database): Promise<McpToolResult> {
  const stats = getCacheStats(db);
  return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
}

/**
 * TICKET_1276 P2 Batch C1 -- Class-S direct read. Enumerate the BYOD
 * imported-package catalog (`imported_packages`), newest first.
 */
export async function handleListImportedPackages(db: Database.Database): Promise<McpToolResult> {
  const packages = listImportedPackages(db);
  return { content: [{ type: 'text' as const, text: JSON.stringify(packages, null, 2) }] };
}

export async function handleListImportedPackageSummaries(db: Database.Database): Promise<McpToolResult> {
  const summaries = listImportedPackageSummaries(db);
  return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] };
}

export async function handleCheckImportedPackageIntegrity(params: { package_name: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Check imported package integrity');
  try { return bridgeResult(await apiClient.dataCheckIntegrity(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleAuditImportedPackageOrphans(params: { package_name: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Audit imported package orphans');
  try { return bridgeResult(await apiClient.dataAuditOrphans(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleBuildCoverageReport(params: { package_name: string; format?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Build coverage report');
  try { return bridgeResult(await apiClient.dataBuildCoverageReport(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleAppendToPackage(params: { package_name: string; source_path: string; symbol_filter?: string[]; force?: boolean }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Append to package');
  try { return bridgeResult(await apiClient.dataAppendToPackage(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

// =============================================================================
// F1: Promote Existing Actions (T0/T1)
// =============================================================================

export async function handleReviewDataDownload(params: Record<string, unknown>): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Review data download');
  try { return bridgeResult(await apiClient.dataReviewDownload(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleConfirmDataDownload(params: Record<string, unknown>): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Confirm data download');
  const mapped = { ...params };
  if ('timestamp_utc' in mapped) {
    mapped.confirmed_at_utc = mapped.timestamp_utc;
    delete mapped.timestamp_utc;
  }
  try { return bridgeResult(await apiClient.dataConfirmDownload(config, mapped)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleQueueDataDownload(params: { symbol: string; interval: string; provider?: string; start_date?: string; end_date?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Queue data download');
  try { return bridgeResult(await apiClient.dataQueueDownload(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleGetDownloadStatus(): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Get download status');
  try { return bridgeResult(await apiClient.dataGetDownloadStatus(config)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleRetryFailedDownloads(params: { symbol?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Retry failed downloads');
  try { return bridgeResult(await apiClient.dataRetryFailed(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleImportDataPackage(params: { path: string; package_name?: string; adjust_mode?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Import data package');
  try { return bridgeResult(await apiClient.dataImportPackage(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleRegisterParquetDirectory(params: { package_name: string; adjust_mode?: string; source_dialect?: string; archival_cadence?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Register parquet directory');
  try { return bridgeResult(await apiClient.dataRegisterParquetDir(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

// =============================================================================
// F3: Queue Lifecycle (T1)
// =============================================================================

export async function handleCancelDownload(params: { task_id?: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Cancel download');
  try { return bridgeResult(await apiClient.dataCancelDownload(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleGetQueueStatus(): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Get queue status');
  try { return bridgeResult(await apiClient.dataGetQueueStatus(config)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

// =============================================================================
// F4: Destructive Operations (T2, explicit confirm required)
// =============================================================================

export async function handleDeleteDataSegments(params: { segment_ids: number[]; confirm: boolean }): Promise<McpToolResult> {
  if (!params.confirm) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'delete_data_segments requires confirm=true. This is a destructive operation that removes cached data segments and their parquet files.' }) }],
      isError: true,
    };
  }
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Delete data segments');
  try { return bridgeResult(await apiClient.dataDeleteSegments(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleRemoveImportedPackage(params: { package_name: string; confirm: boolean }): Promise<McpToolResult> {
  if (!params.confirm) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'remove_imported_package requires confirm=true. This is a destructive operation that deletes all cache files and DB records for the package.' }) }],
      isError: true,
    };
  }
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Remove imported package');
  try { return bridgeResult(await apiClient.dataRemovePackage(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleClearDataCache(params: { confirm: boolean }): Promise<McpToolResult> {
  if (!params.confirm) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'clear_data_cache requires confirm=true. This is a destructive operation that clears ALL data cache including parquet files, DB tables, and download queue.' }) }],
      isError: true,
    };
  }
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Clear data cache');
  try { return bridgeResult(await apiClient.dataClearCache(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}
