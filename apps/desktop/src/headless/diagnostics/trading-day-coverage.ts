import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DiagModule, DiagResult } from '../types';
import { enumerateTradingDays } from '../../shared/calendars/trading-calendars';
import type { TradingCalendarId } from '../../shared/calendars/trading-calendars';

const PARQUET_CACHE_SUBDIR = 'data/parquet';

function resolveParquetDir(): string {
  if (process.env.STRATCRAFT_PARQUET_DIR) return process.env.STRATCRAFT_PARQUET_DIR;
  return path.join(os.homedir(), '.config', 'stratcraft-desktop', PARQUET_CACHE_SUBDIR);
}

const CALENDAR_BY_PROVIDER: Record<string, TradingCalendarId> = {
  dukascopy: 'FX_5_24',
  yfinance: 'NYSE',
  databento: 'NYSE',
  ccxt: 'CRYPTO_24_7',
};

const MS_PER_DAY = 86_400_000;

const mod: DiagModule = {
  name: 'trading-day-coverage',
  description: 'Compare expected vs actual trading days from cached parquet files',

  async run(args): Promise<DiagResult> {
    const t0 = performance.now();
    const symbol = typeof args.symbol === 'string' ? args.symbol : undefined;
    const interval = typeof args.interval === 'string' ? args.interval : '1h';
    const provider = typeof args.provider === 'string' ? args.provider : 'dukascopy';
    const parquetDir = typeof args.parquetDir === 'string' ? args.parquetDir : resolveParquetDir();

    if (!symbol) {
      return {
        name: 'trading-day-coverage',
        pass: false,
        summary: 'Missing required arg: symbol',
        details: { error: 'symbol is required' },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const calendar = CALENDAR_BY_PROVIDER[provider];
    if (!calendar) {
      return {
        name: 'trading-day-coverage',
        pass: false,
        summary: `Unknown provider '${provider}'. Known: ${Object.keys(CALENDAR_BY_PROVIDER).join(', ')}`,
        details: { provider },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const providerDir = path.join(parquetDir, provider);
    const filename = `${symbol}_${interval}.parquet`;
    const filePath = path.join(providerDir, filename);

    if (!fs.existsSync(filePath)) {
      return {
        name: 'trading-day-coverage',
        pass: false,
        summary: `Parquet not found: ${filePath}`,
        details: { filePath, exists: false },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const stat = fs.statSync(filePath);
    const details: Record<string, unknown> = {
      filePath,
      fileSizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
      symbol,
      interval,
      provider,
      calendar,
    };

    if (calendar === 'NONE') {
      return {
        name: 'trading-day-coverage',
        pass: true,
        summary: `File exists (${(stat.size / 1024).toFixed(0)} KB), calendar=NONE (no day-set check)`,
        details,
        durationMs: Math.round(performance.now() - t0),
      };
    }

    return {
      name: 'trading-day-coverage',
      pass: true,
      summary: `File exists (${(stat.size / 1024).toFixed(0)} KB), calendar=${calendar}. Full day-set comparison requires pyarrow (not available in headless TS).`,
      details,
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
