/**
 * YFinance Data Provider
 *
 * TICKET_292: Local Python yfinance execution via child_process.
 * No authentication required. No external server dependency.
 *
 * Execution model:
 *   execFile(<resolved python3>, [scriptPath, command, ...args])
 *   Script outputs JSON to stdout -> parse as OHLCVRow[]
 *
 * Limitations (yfinance API):
 *   - 1m interval: max 7 days lookback
 *   - 5m/15m/30m interval: max 60 days lookback
 *   - 1h interval: max 730 days lookback
 *   - 1d/1w/1M interval: full history available
 *
 * @see TICKET_292_MULTI_SOURCE_DATA_PROVIDER_INTERFACE.md
 */

import { execFile } from 'child_process';
import { resolveProviderPythonPath, resolveProviderScriptPath } from './provider-script-path';
import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import { PROVIDER_YFINANCE } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
} from '../../../shared/constants/intervals';
import { appLog } from '../../utils/logger';
import { PYTHON_SCRIPT_EXEC_TIMEOUT_MS, PYTHON_SCRIPT_MAX_BUFFER } from '../../../shared/constants/data-providers';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';

// Interval mapping: UI notation keys -> yfinance notation values
const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_1m]:  INTERVAL_1m,
  [INTERVAL_5m]:  INTERVAL_5m,
  [INTERVAL_15m]: INTERVAL_15m,
  [INTERVAL_30m]: INTERVAL_30m,
  [INTERVAL_1h]:  INTERVAL_1h,
  [INTERVAL_1d]:  INTERVAL_1d,
  [INTERVAL_1w]:  '1wk',   // UI '1w' -> yfinance '1wk'
  [INTERVAL_1M]:  '1mo',   // UI '1M' -> yfinance '1mo'
};

/**
 * Resolve path to the bundled yfinance_query.py script.
 *
 * TICKET_1334 P3: delegates to the shared resolver. The previous
 * `__dirname`-anchored dev branch assumed a `dist/main/` layout and produced
 * `apps/desktop/src/main/src/main/...` whenever the host was loaded from source
 * (ts-node drivers, headless actions, the headless `serve` runtime) -- which is
 * why a headless sweep died with `YFinance script failed` and zero arms.
 */
function getScriptPath(): string {
  return resolveProviderScriptPath('yfinance_query.py');
}

/**
 * Execute the yfinance Python script and parse JSON output.
 */
function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = getScriptPath();
    appLog.debug(`[YFinanceProvider] Executing: python3 ${scriptPath} ${args.join(' ')}`);

    execFile(resolveProviderPythonPath('YFinanceProvider'), [scriptPath, ...args], {
      timeout: PYTHON_SCRIPT_EXEC_TIMEOUT_MS,
      maxBuffer: PYTHON_SCRIPT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        appLog.error(`[YFinanceProvider] Script error: ${error.message}`);
        if (stderr) {
          appLog.error(`[YFinanceProvider] stderr: ${stderr}`);
        }
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptFailed', { provider: 'YFinance', error: error.message })));
        return;
      }

      if (!stdout.trim()) {
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptEmptyOutput', { provider: 'YFinance' })));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

export class YFinanceProvider implements IDataProvider {
  readonly id = PROVIDER_YFINANCE;
  readonly name = 'Yahoo Finance';
  // TICKET_927_2_2: MarketIds yfinance serves. Narrower than `assetTypes`:
  // 'crypto'/'etf'/'index' in assetTypes are subsumed by these three markets
  // (US equity + ETFs + indexes routed via `yfinance_us_equity`; synthetic
  // crypto via `yfinance_synthetic_crypto`; synthetic =X tickers via
  // `yfinance_forex`).
  readonly supportedMarkets: ReadonlyArray<MarketId> = [
    'yfinance_us_equity',
    'yfinance_forex',
    'yfinance_synthetic_crypto',
  ];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['stock', 'etf', 'crypto', 'forex', 'index'],
    // TICKET_196_12 Step 1: the timeframes Yahoo Finance serves NATIVELY
    // (mirrors INTERVAL_MAP keys). 2h/4h are NOT native -- they are produced by
    // aggregating 1h via the aggregation service; `resolveFetchPlan` derives
    // that. A drift test pins nativeIntervals === Object.keys(INTERVAL_MAP).
    nativeIntervals: [INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M],
    // TICKET_196_12 Step 3: derived (native union aggregatable) -- not hand-written
    intervals: deriveSupportedIntervals([INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M]),
    maxLookback: { [INTERVAL_1m]: '7d', [INTERVAL_5m]: '60d', [INTERVAL_15m]: '60d', [INTERVAL_30m]: '60d', [INTERVAL_1h]: '730d' },
    requiresAuth: false,
    supportsSearch: true,
    // TICKET_849 Phase D3: yfinance feeds US equity by default; crypto / forex
    // tickers go through the same Yahoo endpoint but at a different cadence.
    // We size for the conservative (equity RTH) case so any pull also covers
    // the crypto / forex path -- matches the pre-Phase-D3 behaviour of
    // `inferAssetClass('yfinance') === 'equity'`.
    // Intraday ratio = (24h / 6.5h RTH) * (365 / 252 trading days)
    //               = (24 * 365) / (6.5 * 252) = 8760 / 1638 ~= 5.35.
    calendarPaddingRatio: {
      [INTERVAL_1m]: 5.35, [INTERVAL_5m]: 5.35, [INTERVAL_15m]: 5.35, [INTERVAL_30m]: 5.35, [INTERVAL_1h]: 5.35, [INTERVAL_4h]: 5.35,
      [INTERVAL_1d]: 1.45, [INTERVAL_1w]: 1.0,
    },
    // TICKET_958_4: yfinance serves five MarketIds across three calendars
    // (NYSE for *_us_equity, CRYPTO_24_7 for *_synthetic_crypto, FX_5_24
    // for *_forex). The current ProviderCapabilities shape is per-provider,
    // not per-(provider, MarketId), so declaring a single calendar would be
    // wrong for two-thirds of yfinance's symbols. Setting `NONE` here
    // short-circuits the invariant and leaves yfinance caches without
    // day-set protection until a per-MarketId tradingCalendar map lands
    // (follow-up ticket scope: thread MarketId resolution into the cache
    // write boundary). This is NOT a TICKET_851 workaround -- the observed
    // 958-series failure mode is on Databento US equity, which is fully
    // covered by `tradingCalendar: 'NYSE'` on databento-provider. yfinance
    // protection is a real-but-separate scope.
    tradingCalendar: 'NONE',
    // TICKET_958_5 AC #1: yfinance_query.py converts the Yahoo `Datetime`
    // pandas index to canonical `timestamp` (Unix seconds) before stdout.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const yfInterval = INTERVAL_MAP[interval];
    if (!yfInterval) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'YFinance', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    appLog.info(`[YFinanceProvider] Querying ${symbol} ${yfInterval} ${startDate} - ${endDate}`);

    const output = await runPythonScript(['query', symbol, yfInterval, startDate, endDate]);
    const parsed = JSON.parse(output);

    // Check for error response
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.queryFailed', { provider: 'YFinance', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedDataFormat', { provider: 'YFinance' }));
    }

    appLog.info(`[YFinanceProvider] Received ${parsed.length} rows for ${symbol}`);
    return parsed as OHLCVRow[];
  }

  async searchSymbols(query: string, limit: number = 20): Promise<SymbolSearchResponse> {
    appLog.info(`[YFinanceProvider] Searching symbols: "${query}"`);

    const output = await runPythonScript(['search', query, String(limit)]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.searchFailed', { provider: 'YFinance', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedSearchFormat', { provider: 'YFinance' }));
    }

    // TICKET_641_10: Wrap -- Python script applies limit server-side.
    // When results.length >= limit, truncation is likely (script cut off at limit).
    const results = parsed as ProviderSymbolInfo[];
    const likelyTruncated = results.length >= limit;
    return {
      results,
      totalCount: results.length,
      truncated: likelyTruncated,
    };
  }

  async getSymbolDateRange(symbol: string): Promise<{ startTime: string | null; endTime: string | null }> {
    appLog.info(`[YFinanceProvider] Getting date range for: ${symbol}`);

    const output = await runPythonScript(['info', symbol]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.infoFailed', { provider: 'YFinance', error: parsed.error }));
    }

    return {
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
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
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection check failed',
      };
    }
  }
}
