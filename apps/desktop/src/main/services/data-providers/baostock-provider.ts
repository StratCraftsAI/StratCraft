/**
 * BaoStock China A-Share Data Provider
 *
 * TICKET_337: Local Python baostock execution via child_process.
 * Free data source for Shanghai (SSE) and Shenzhen (SZSE) exchanges.
 * No authentication required. No external server dependency.
 *
 * Execution model:
 *   execFile(<resolved python3>, [scriptPath, command, ...args])
 *   Script outputs JSON to stdout -> parse as OHLCVRow[]
 *
 * Symbol format:
 *   User-facing: 600000.SH, 000001.SZ (standard Chinese market convention)
 *   BaoStock API: sh.600000, sz.000001 (internal translation)
 *
 * Native-mode provider: BaoStock natively supports d/w/m and intraday timeframes.
 *
 * @see TICKET_337_BAOSTOCK_CHINA_A_SHARE_DATA_PROVIDER.md
 */

import { execFile } from 'child_process';
import { resolveProviderPythonPath, resolveProviderScriptPath } from './provider-script-path';
import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import { PROVIDER_BAOSTOCK } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import {
  INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
} from '../../../shared/constants/intervals';
import { appLog } from '../../utils/logger';
import { PYTHON_SCRIPT_EXEC_TIMEOUT_MS, PYTHON_SCRIPT_MAX_BUFFER } from '../../../shared/constants/data-providers';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';

// Interval mapping: UI notation keys -> BaoStock frequency values
const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_5m]:  '5',
  [INTERVAL_15m]: '15',
  [INTERVAL_30m]: '30',
  [INTERVAL_1h]:  '60',
  [INTERVAL_1d]:  'd',
  [INTERVAL_1w]:  'w',
  [INTERVAL_1M]:  'm',
};

/**
 * Convert user-facing symbol (600000.SH) to BaoStock format (sh.600000).
 */
function toBaoStockSymbol(symbol: string): string {
  // Already in BaoStock format
  if (symbol.startsWith('sh.') || symbol.startsWith('sz.')) {
    return symbol;
  }

  // 600000.SH -> sh.600000
  const match = symbol.match(/^(\d+)\.(SH|SZ)$/i);
  if (match) {
    const code = match[1];
    const exchange = match[2].toLowerCase();
    return `${exchange}.${code}`;
  }

  // Fallback: pass through as-is
  return symbol;
}

/**
 * Resolve path to the bundled baostock_query.py script.
 *
 * Dev: __dirname is dist/main/ -> go up to apps/desktop/ -> src path
 * Prod: app.getAppPath() -> resources/app/ -> dist path
 */
/** TICKET_1334 P3: shared resolver -- see `provider-script-path.ts` for why the
 *  previous `__dirname` dev branch broke every source-loaded host. */
function getScriptPath(): string {
  return resolveProviderScriptPath('baostock_query.py');
}

/**
 * Execute the baostock Python script and parse JSON output.
 */
function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = getScriptPath();
    appLog.debug(`[BaoStockProvider] Executing: python3 ${scriptPath} ${args.join(' ')}`);

    execFile(resolveProviderPythonPath('BaoStockProvider'), [scriptPath, ...args], {
      timeout: PYTHON_SCRIPT_EXEC_TIMEOUT_MS,
      maxBuffer: PYTHON_SCRIPT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        appLog.error(`[BaoStockProvider] Script error: ${error.message}`);
        if (stderr) {
          appLog.error(`[BaoStockProvider] stderr: ${stderr}`);
        }
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptFailed', { provider: 'BaoStock', error: error.message })));
        return;
      }

      if (!stdout.trim()) {
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptEmptyOutput', { provider: 'BaoStock' })));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

export class BaoStockProvider implements IDataProvider {
  readonly id = PROVIDER_BAOSTOCK;
  readonly name = 'BaoStock A-Share (Free)';
  // TICKET_927_2_2: BaoStock routes CN A-share.
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['baostock_cn_a_share'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['stock'],
    // TICKET_196_12 Step 1: BaoStock serves these China A-share timeframes
    // natively (mirrors INTERVAL_MAP keys). No 1m native bar, so no finer bar
    // to aggregate finer targets from. A drift test pins
    // nativeIntervals === Object.keys(INTERVAL_MAP).
    nativeIntervals: [INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M],
    // TICKET_196_12 Step 3: derived (native union aggregatable) -- not hand-written
    intervals: deriveSupportedIntervals([INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M]),
    requiresAuth: false,
    supportsSearch: true,
    // TICKET_849 Phase D3: A-share equity. SSE/SZSE RTH is 4h/day
    // (9:30-11:30 + 13:00-15:00) of 24h calendar -> ~6x intraday padding;
    // ~244 trading days / 365 calendar -> ~1.5x daily padding.
    // Bias slightly conservative to absorb half-day holidays.
    calendarPaddingRatio: {
      [INTERVAL_5m]: 6.0, [INTERVAL_15m]: 6.0, [INTERVAL_30m]: 6.0, [INTERVAL_1h]: 6.0, [INTERVAL_4h]: 6.0,
      [INTERVAL_1d]: 1.5, [INTERVAL_1w]: 1.0,
    },
    // TICKET_958_4: BaoStock serves Shanghai/Shenzhen A-shares; SSE + SZSE
    // share a single calendar. Drives the write-boundary day-set invariant.
    tradingCalendar: 'XSHG_XSHE',
    // TICKET_958_5 AC #1: baostock_query.py renames the BaoStock `date`/`time`
    // columns to canonical `timestamp` (Unix seconds) before stdout emit.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const bsInterval = INTERVAL_MAP[interval];
    if (!bsInterval) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'BaoStock', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    const bsSymbol = toBaoStockSymbol(symbol);
    appLog.info(`[BaoStockProvider] Querying ${bsSymbol} ${bsInterval} ${startDate} - ${endDate}`);

    const output = await runPythonScript(['query', bsSymbol, bsInterval, startDate, endDate]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.queryFailed', { provider: 'BaoStock', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedDataFormat', { provider: 'BaoStock' }));
    }

    appLog.info(`[BaoStockProvider] Received ${parsed.length} rows for ${bsSymbol}`);
    return parsed as OHLCVRow[];
  }

  async searchSymbols(query: string, limit: number = 20): Promise<SymbolSearchResponse> {
    appLog.info(`[BaoStockProvider] Searching symbols: "${query}"`);

    const output = await runPythonScript(['search', query, String(limit)]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.searchFailed', { provider: 'BaoStock', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedSearchFormat', { provider: 'BaoStock' }));
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
    const bsSymbol = toBaoStockSymbol(symbol);
    appLog.info(`[BaoStockProvider] Getting date range for: ${bsSymbol}`);

    const output = await runPythonScript(['daterange', bsSymbol]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.dateRangeFailed', { provider: 'BaoStock', error: parsed.error }));
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
