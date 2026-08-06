/**
 * AKShare China A-Share Data Provider
 *
 * TICKET_904_1: Local Python akshare execution via child_process.
 * Free data source for Shanghai (SSE) and Shenzhen (SZSE) exchanges.
 * No authentication required. HTTP-based (works from overseas).
 *
 * Execution model:
 *   execFile(<resolved python3>, [scriptPath, command, ...args])
 *   Script outputs JSON to stdout -> parse as OHLCVRow[]
 *
 * Symbol format:
 *   User-facing: 600000.SH, 000001.SZ (standard Chinese market convention)
 *   AKShare API: bare 6-digit code 600000, 000001 (TS layer strips suffix)
 *
 * Native-mode provider: AKShare natively supports 1m/5m/15m/30m/1h via
 * stock_zh_a_minute (Sina) and daily via stock_zh_a_daily (Sina).
 * Weekly/monthly use stock_zh_a_hist (East Money, may be geo-blocked overseas).
 *
 * @see TICKET_904_CN_ASHARE_DATA_SOURCE_INVESTIGATION.md
 */

import { execFile } from 'child_process';
import { resolveProviderPythonPath, resolveProviderScriptPath } from './provider-script-path';
import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import { PROVIDER_AKSHARE } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
} from '../../../shared/constants/intervals';
import { appLog } from '../../utils/logger';
import { PYTHON_SCRIPT_EXEC_TIMEOUT_MS, PYTHON_SCRIPT_MAX_BUFFER } from '../../../shared/constants/data-providers';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';

const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_1m]:  '1',
  [INTERVAL_5m]:  '5',
  [INTERVAL_15m]: '15',
  [INTERVAL_30m]: '30',
  [INTERVAL_1h]:  '60',
  [INTERVAL_1d]:  'daily',
  [INTERVAL_1w]:  'weekly',
  [INTERVAL_1M]:  'monthly',
};

/**
 * Strip exchange suffix from user-facing symbol to get bare AKShare code.
 * 600000.SH -> 600000, 000001.SZ -> 000001
 */
function toAKShareSymbol(symbol: string): string {
  const match = symbol.match(/^(\d{6})\.(SH|SZ)$/i);
  if (match) {
    return match[1];
  }
  return symbol;
}

/** TICKET_1334 P3: shared resolver -- see `provider-script-path.ts` for why the
 *  previous `__dirname` dev branch broke every source-loaded host. */
function getScriptPath(): string {
  return resolveProviderScriptPath('akshare_query.py');
}

function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = getScriptPath();
    appLog.debug(`[AKShareProvider] Executing: python3 ${scriptPath} ${args.join(' ')}`);

    execFile(resolveProviderPythonPath('AKShareProvider'), [scriptPath, ...args], {
      timeout: PYTHON_SCRIPT_EXEC_TIMEOUT_MS,
      maxBuffer: PYTHON_SCRIPT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        appLog.error(`[AKShareProvider] Script error: ${error.message}`);
        if (stderr) {
          appLog.error(`[AKShareProvider] stderr: ${stderr}`);
        }
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptFailed', { provider: 'AKShare', error: error.message })));
        return;
      }

      if (!stdout.trim()) {
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptEmptyOutput', { provider: 'AKShare' })));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

const NATIVE_INTERVALS = [INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m, INTERVAL_1h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M] as const;

export class AKShareProvider implements IDataProvider {
  readonly id = PROVIDER_AKSHARE;
  readonly name = 'AKShare A-Share (Free)';
  // TICKET_927_2_2: AKShare routes CN A-share.
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['akshare_cn_a_share'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['stock'],
    nativeIntervals: NATIVE_INTERVALS,
    intervals: deriveSupportedIntervals(NATIVE_INTERVALS),
    requiresAuth: false,
    supportsSearch: true,
    // SSE/SZSE RTH 4h/day (9:30-11:30 + 13:00-15:00), ~244 trading days/year
    calendarPaddingRatio: {
      [INTERVAL_1m]: 6.0, [INTERVAL_5m]: 6.0, [INTERVAL_15m]: 6.0, [INTERVAL_30m]: 6.0, [INTERVAL_1h]: 6.0, [INTERVAL_4h]: 6.0,
      [INTERVAL_1d]: 1.5, [INTERVAL_1w]: 1.0,
    },
    // TICKET_958_4: AKShare serves CN A-shares (SSE + SZSE share a single
    // calendar). Drives the write-boundary day-set invariant.
    tradingCalendar: 'XSHG_XSHE',
    // TICKET_958_5 AC #1: akshare-provider's queryOHLCV normalises the
    // AKShare DataFrame to canonical rows (`timestamp` Unix seconds + OHLCV)
    // before returning.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const akInterval = INTERVAL_MAP[interval];
    if (!akInterval) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'AKShare', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    const akSymbol = toAKShareSymbol(symbol);
    appLog.info(`[AKShareProvider] Querying ${akSymbol} ${akInterval} ${startDate} - ${endDate}`);

    const output = await runPythonScript(['query', akSymbol, akInterval, startDate, endDate]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.queryFailed', { provider: 'AKShare', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedDataFormat', { provider: 'AKShare' }));
    }

    appLog.info(`[AKShareProvider] Received ${parsed.length} rows for ${akSymbol}`);
    return parsed as OHLCVRow[];
  }

  async searchSymbols(query: string, limit: number = 20): Promise<SymbolSearchResponse> {
    appLog.info(`[AKShareProvider] Searching symbols: "${query}"`);

    const output = await runPythonScript(['search', query, String(limit)]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.searchFailed', { provider: 'AKShare', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedSearchFormat', { provider: 'AKShare' }));
    }

    const results = parsed as ProviderSymbolInfo[];
    const likelyTruncated = results.length >= limit;
    return {
      results,
      totalCount: results.length,
      truncated: likelyTruncated,
    };
  }

  async getSymbolDateRange(symbol: string): Promise<{ startTime: string | null; endTime: string | null }> {
    const akSymbol = toAKShareSymbol(symbol);
    appLog.info(`[AKShareProvider] Getting date range for: ${akSymbol}`);

    const output = await runPythonScript(['daterange', akSymbol]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.dateRangeFailed', { provider: 'AKShare', error: parsed.error }));
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
