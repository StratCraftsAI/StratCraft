/**
 * Databento Local-Parquet Data Provider
 *
 * TICKET_958 Step 1: Registers the Databento research store as a first-class
 * IDataProvider so production-grade sweeps (signal-discovery:start) can run
 * against Databento bars through the same Electron code path as yfinance /
 * alpaca / ccxt.
 *
 * READ PATH (TICKET_958_5 AC #5 -- single path, no two-path footgun):
 *
 *   DatabentoProvider.queryOHLCV()
 *     -> runPythonScript()
 *     -> scripts/databento_query.py (pyarrow `filters=` pushdown)
 *     -> upstream source (provider-internal, location not part of the
 *        provider's public contract)
 *
 *   Result rows are canonical OHLCV_V1_CANONICAL (see
 *   `capabilities.cacheSchema` and `ohlcv-parquet-schema.ts`):
 *   `{timestamp:int-seconds, open, high, low, close, volume}` -- the
 *   Python script renames the upstream `__index_level_0__:timestamp[ns]`
 *   index column and drops the non-canonical `bar_count` / `vwap`
 *   columns before stdout emit. The rows are committed to the Electron
 *   cache through the canonical writer
 *   (`parquet-cache-service.ts`); ALL downstream readers -- including
 *   the universe min-bars gate
 *   (`discovery-orchestrator.ts:countOhlcvParquetRowsInWindow`) -- read
 *   the cache file via `data_cache_files.file_path`, NOT the upstream
 *   source. Pulls only the requested `[start, end]` window; the full
 *   parquet is never materialised (CLAUDE.md "no full-history read" /
 *   TICKET_919).
 *
 * Boundary (per TICKET_958 "What this is NOT" + ticket section
 * "Boundary: Databento data is local research"):
 *   - NOT BYOK. There is no upstream API; data is local-only.
 *   - NOT network-backed. No Databento HTTP/WebSocket client.
 *   - Research-only. Registered by provider-manager.ts ONLY when
 *     STRATCRAFT_RESEARCH_MODE=1 is set so packaged builds for end users
 *     never surface the provider in any UI flow.
 *
 * @see TICKET_958_DATABENTO_SELECTION_TO_YFINANCE_PRODUCTION_SWEEP.md
 * @see TICKET_958_3_DATABENTO_5M_CACHE_DEAD_PATH_AND_HYDRATION_LEFT_EDGE_SHORTFALL.md
 * @see TICKET_292_MULTI_SOURCE_DATA_PROVIDER_INTERFACE.md
 */

import { execFile } from 'child_process';
import { resolveProviderPythonPath, resolveProviderScriptPath } from './provider-script-path';
import {
  IDataProvider,
  ProviderCapabilities,
  ProviderConnectionStatus,
  ProviderSymbolInfo,
  SymbolSearchResponse,
  OHLCVRow,
} from './types';
import type { MarketId } from '@StratCraft/types';
import { PROVIDER_DATABENTO } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import { appLog } from '../../utils/logger';
import {
  PYTHON_SCRIPT_EXEC_TIMEOUT_MS,
  PYTHON_SCRIPT_MAX_BUFFER,
} from '../../../shared/constants/data-providers';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h,
} from '../../../shared/constants/intervals';

// TICKET_958 A1 (2026-06-14d): Databento research store ships both 1m and
// 5m bars. The 5m parquet is produced by aggregate_to_bars.py --timeframe 5m
// over the same 90-day trades window as 1m. Upstream schema is identical
// across timeframes; the rename / column-drop to canonical OHLCV_V1_CANONICAL
// happens inside `databento_query.py` before stdout emit (see file-level
// docstring). Adding 1h here is a one-line change once the aggregator
// has produced 1h parquet.
const NATIVE_INTERVALS = [INTERVAL_1m, INTERVAL_5m] as const;

function getScriptPath(): string {
  // TICKET_958 A1 (2026-06-14e) established the `app.getAppPath()` anchor here,
  // after the prior `__dirname` dev branch produced the
  // `apps/desktop/src/main/src/main/...` double-prefix on every source-loaded
  // host. TICKET_1334 P3 EXTRACTED that resolution into
  // `provider-script-path.ts` and applied it to the four providers that still
  // carried the broken copy, so this now delegates to the shared owner instead
  // of being the one provider that happened to be right (TICKET_854).
  return resolveProviderScriptPath('databento_query.py');
}

function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = getScriptPath();
    appLog.debug(
      `[DatabentoProvider] Executing: python3 ${scriptPath} ${args.join(' ')}`,
    );

    execFile(
      resolveProviderPythonPath('DatabentoProvider'),
      [scriptPath, ...args],
      {
        timeout: PYTHON_SCRIPT_EXEC_TIMEOUT_MS,
        maxBuffer: PYTHON_SCRIPT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          appLog.error(`[DatabentoProvider] Script error: ${error.message}`);
          if (stderr) {
            appLog.error(`[DatabentoProvider] stderr: ${stderr}`);
          }
          reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptFailed', { provider: 'Databento', error: error.message })));
          return;
        }

        if (!stdout.trim()) {
          reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptEmptyOutput', { provider: 'Databento' })));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

export class DatabentoProvider implements IDataProvider {
  readonly id = PROVIDER_DATABENTO;
  readonly name = 'Databento (local research)';
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['databento_us_equity'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['stock'],
    nativeIntervals: NATIVE_INTERVALS,
    intervals: deriveSupportedIntervals(NATIVE_INTERVALS),
    // No upstream lookback gate -- the file IS the lookback. The orchestrator
    // discovers the actual availability window via getSymbolDateRange()
    // (TICKET_305 Phase 2) when it needs to fold-plan.
    requiresAuth: false,
    // Symbol search would require enumerating the parquet root directory; the
    // Databento research universe is curated by the ingestion job (the same
    // 50-symbol list TICKET_939_2 used), not free-form searchable.
    supportsSearch: false,
    // TICKET_849 Phase D3: Databento bars are US-equity RTH-only, so the
    // calendar-padding ratio matches yfinance equity-tier (24h/6.5h *
    // 365/252 ~= 5.35). Aggregated 4h is included because deriveSupportedIntervals
    // promotes 1m -> {1m, 5m, 15m, 30m, 1h, 4h} via the aggregation pipeline.
    calendarPaddingRatio: {
      [INTERVAL_1m]: 5.35, [INTERVAL_5m]: 5.35, [INTERVAL_15m]: 5.35, [INTERVAL_30m]: 5.35, [INTERVAL_1h]: 5.35, [INTERVAL_4h]: 5.35,
    },
    // TICKET_958_2: Databento parquet on disk is a one-shot historical dump
    // produced by an external ingestion job; the provider does not append new
    // bars at runtime. The window-end anchor MUST be the cohort's parquet
    // tail, not wall-clock -- otherwise the orchestrator's sweep window
    // overshoots the parquet's physical end by the publisher-lag delta
    // (~8.5 calendar days at the time of writing), the universe min-bars
    // preflight refuses the sweep with a structurally unsatisfiable
    // `actualBars < requiredBars` gap, and no value of `TRAINING_BARS` can
    // clear it. `'snapshot'` routes through `resolveArchivalCadenceEndMs`
    // (`archival-cadence-end.ts:132-136`) which returns the cohort upper-
    // quantile unfloored -- the exact semantic Databento needs.
    archivalCadence: 'snapshot',
    // TICKET_958_4: Databento research store ships XNAS.ITCH trades aggregated
    // to RTH OHLCV bars on NYSE-equivalent sessions (NYSE + Nasdaq trading
    // sessions are calendar-identical). Drives the write-boundary day-set
    // invariant and the read-path lazy-heal probe -- a 958_3 Finding-4-style
    // 3/20-4/20-5/20 hole now fails the next ensureData call instead of
    // surviving until the universe gate refuses the sweep.
    tradingCalendar: 'NYSE',
    // TICKET_958_5 AC #1: databento_query.py renames the equities-hist
    // `__index_level_0__:timestamp[ns]` index column to canonical `timestamp`
    // (Unix seconds) and drops the non-canonical `bar_count` / `vwap`
    // columns before stdout emit. The Electron cache parquet on disk is the
    // canonical OHLCV_SCHEMA (`apps/desktop/src/main/services/
    // ohlcv-parquet-schema.ts`) that the gate SQL counts.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string,
  ): Promise<OHLCVRow[]> {
    if (!(NATIVE_INTERVALS as readonly string[]).includes(interval)) {
      // Aggregated intervals (5m/15m/30m/1h/4h) are produced upstream of the
      // provider by the aggregation pipeline -- the resolver only ever calls
      // us with a native interval. Anything else is a misroute and must fail
      // fast (TICKET_857).
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.nativeIntervalOnly', { provider: 'Databento', supported: NATIVE_INTERVALS.join(', '), interval }));
    }

    appLog.info(
      `[DatabentoProvider] Querying ${symbol} ${interval} ${startDate} - ${endDate}`,
    );

    const output = await runPythonScript([
      'query',
      symbol,
      interval,
      startDate,
      endDate,
    ]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.queryFailed', { provider: 'Databento', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedDataFormat', { provider: 'Databento' }));
    }

    appLog.info(`[DatabentoProvider] Received ${parsed.length} rows for ${symbol}`);
    return parsed as OHLCVRow[];
  }

  async searchSymbols(_query: string, _limit?: number): Promise<SymbolSearchResponse> {
    // See `capabilities.supportsSearch = false`. The IDataProvider contract
    // requires the method to exist; returning an empty, non-truncated response
    // is the documented "search not supported" shape (types.ts comment on
    // SymbolSearchResponse).
    return { results: [] as ProviderSymbolInfo[], totalCount: 0, truncated: false };
  }

  async getSymbolDateRange(
    symbol: string,
  ): Promise<{ startTime: string | null; endTime: string | null }> {
    // Default to the only native interval; the orchestrator only calls this
    // when fold-planning, and the planner deals in calendar dates -- which
    // are interval-agnostic for a contiguous local parquet.
    const interval = NATIVE_INTERVALS[0];
    appLog.info(`[DatabentoProvider] Getting date range for: ${symbol} (${interval})`);
    const output = await runPythonScript(['info', symbol, interval]);
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.infoFailed', { provider: 'Databento', error: parsed.error }));
    }
    return {
      startTime: parsed.startTime ?? null,
      endTime: parsed.endTime ?? null,
    };
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    try {
      const probeStart = Date.now();
      const output = await runPythonScript(['check']);
      const latencyMs = Date.now() - probeStart;
      const parsed = JSON.parse(output);
      return {
        connected: parsed.connected === true,
        latencyMs,
        error: parsed.error,
        reason: parsed.reason,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection check failed',
      };
    }
  }
}
