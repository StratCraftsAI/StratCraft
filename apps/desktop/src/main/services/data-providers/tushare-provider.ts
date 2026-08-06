/**
 * Tushare Pro China A-Share Data Provider
 *
 * TICKET_904_2: Local Python tushare execution via child_process.
 * Requires user-configured API token (BYOK).
 * HTTP-based (works from overseas).
 *
 * Execution model:
 *   execFile(<resolved python3>, [scriptPath, command, ...args, '--token', token])
 *   Script outputs JSON to stdout -> parse as OHLCVRow[]
 *
 * Symbol format:
 *   User-facing AND Tushare Pro API: 000001.SZ, 600000.SH (no conversion needed)
 *
 * Free-tier interval support: daily/weekly/monthly only.
 * Paid tiers add intraday via stk_mins -- not wired yet.
 *
 * @see TICKET_904_CN_ASHARE_DATA_SOURCE_INVESTIGATION.md
 */

import { execFile } from 'child_process';
import { resolveProviderPythonPath, resolveProviderScriptPath } from './provider-script-path';
import { IDataProvider, ProviderCapabilities, ProviderConnectionStatus, ProviderSymbolInfo, SymbolSearchResponse, OHLCVRow } from './types';
import type { MarketId } from '@StratCraft/types';
import { DATA_CREDENTIAL_KEYS, PROVIDER_TUSHARE } from '@StratCraft/types';
import { deriveSupportedIntervals } from './interval-resolution';
import { INTERVAL_1d, INTERVAL_1w, INTERVAL_1M } from '../../../shared/constants/intervals';
import { getSecureCredentialService } from '../secure-credential-service';
import { appLog } from '../../utils/logger';
import { PYTHON_SCRIPT_EXEC_TIMEOUT_MS, PYTHON_SCRIPT_MAX_BUFFER } from '../../../shared/constants/data-providers';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';

const PLUGIN_ID = 'com.stratcraft.back-test-nexus';
const TOKEN_KEY = DATA_CREDENTIAL_KEYS.TUSHARE_API_TOKEN;

const INTERVAL_MAP: Record<string, string> = {
  [INTERVAL_1d]:  'daily',
  [INTERVAL_1w]:  'weekly',
  [INTERVAL_1M]:  'monthly',
};

/** TICKET_1334 P3: shared resolver -- see `provider-script-path.ts` for why the
 *  previous `__dirname` dev branch broke every source-loaded host. */
function getScriptPath(): string {
  return resolveProviderScriptPath('tushare_query.py');
}

function runPythonScript(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = getScriptPath();
    const safeArgs = args.map((a, i) => (args[i - 1] === '--token' ? '***' : a));
    appLog.debug(`[TushareProvider] Executing: python3 ${scriptPath} ${safeArgs.join(' ')}`);

    execFile(resolveProviderPythonPath('TushareProvider'), [scriptPath, ...args], {
      timeout: PYTHON_SCRIPT_EXEC_TIMEOUT_MS,
      maxBuffer: PYTHON_SCRIPT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      if (error) {
        appLog.error(`[TushareProvider] Script error: ${error.message}`);
        if (stderr) {
          appLog.error(`[TushareProvider] stderr: ${stderr}`);
        }
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptFailed', { provider: 'Tushare', error: error.message })));
        return;
      }

      if (!stdout.trim()) {
        reject(new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.scriptEmptyOutput', { provider: 'Tushare' })));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

async function getToken(): Promise<string> {
  const credService = getSecureCredentialService();
  const result = await credService.getSecret(PLUGIN_ID, TOKEN_KEY);
  return result.value ?? '';
}

const NATIVE_INTERVALS = [INTERVAL_1d, INTERVAL_1w, INTERVAL_1M] as const;

export class TushareProvider implements IDataProvider {
  readonly id = PROVIDER_TUSHARE;
  readonly name = 'Tushare Pro A-Share';
  // TICKET_927_2_2: Tushare routes CN A-share.
  readonly supportedMarkets: ReadonlyArray<MarketId> = ['tushare_cn_a_share'];
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['stock'],
    nativeIntervals: NATIVE_INTERVALS,
    intervals: deriveSupportedIntervals(NATIVE_INTERVALS),
    requiresAuth: true,
    supportsSearch: true,
    // SSE/SZSE RTH 4h/day, ~244 trading days/year (same calendar as AKShare/BaoStock)
    calendarPaddingRatio: {
      [INTERVAL_1d]: 1.5, [INTERVAL_1w]: 1.0,
    },
    // TICKET_958_4: Tushare Pro serves CN A-shares (SSE + SZSE share a single
    // calendar). Drives the write-boundary day-set invariant.
    tradingCalendar: 'XSHG_XSHE',
    // TICKET_958_5 AC #1: tushare-provider's queryOHLCV normalises the
    // Tushare `trade_date`/`trade_time` fields to canonical `timestamp`
    // (Unix seconds) before returning.
    cacheSchema: 'OHLCV_V1_CANONICAL',
  };

  async queryOHLCV(
    symbol: string,
    interval: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCVRow[]> {
    const tsInterval = INTERVAL_MAP[interval];
    if (!tsInterval) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unsupportedInterval', { provider: 'Tushare Pro', interval, supported: Object.keys(INTERVAL_MAP).join(', ') }));
    }

    const token = await getToken();
    if (!token) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.tokenNotConfigured', { provider: 'Tushare Pro' }));
    }

    appLog.info(`[TushareProvider] Querying ${symbol} ${tsInterval} ${startDate} - ${endDate}`);

    const output = await runPythonScript(['query', symbol, tsInterval, startDate, endDate, '--token', token]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.queryFailed', { provider: 'Tushare', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedDataFormat', { provider: 'Tushare' }));
    }

    appLog.info(`[TushareProvider] Received ${parsed.length} rows for ${symbol}`);
    return parsed as OHLCVRow[];
  }

  async searchSymbols(query: string, limit: number = 20): Promise<SymbolSearchResponse> {
    const token = await getToken();
    if (!token) {
      return { results: [], totalCount: 0, truncated: false };
    }

    appLog.info(`[TushareProvider] Searching symbols: "${query}"`);

    const output = await runPythonScript(['search', query, String(limit), '--token', token]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.searchFailed', { provider: 'Tushare', error: parsed.error }));
    }

    if (!Array.isArray(parsed)) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.unexpectedSearchFormat', { provider: 'Tushare' }));
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
    const token = await getToken();
    if (!token) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.tokenNotConfiguredShort', { provider: 'Tushare Pro' }));
    }

    appLog.info(`[TushareProvider] Getting date range for: ${symbol}`);

    const output = await runPythonScript(['daterange', symbol, '--token', token]);
    const parsed = JSON.parse(output);

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'providers.dateRangeFailed', { provider: 'Tushare', error: parsed.error }));
    }

    return {
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
    };
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    const token = await getToken();
    if (!token) {
      return {
        connected: false,
        reason: 'not-configured',
        error: mainT(getCurrentMainLocale(), 'errors', 'providers.tokenNotConfiguredShort', { provider: 'Tushare Pro' }),
      };
    }

    try {
      const probeStart = Date.now();
      const output = await runPythonScript(['check', '--token', token]);
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
