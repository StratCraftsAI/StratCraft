import type { DiagModule, DiagResult } from '../types';
import type { InstrumentType } from 'dukascopy-node';

const INTERVAL_MAP: Record<string, string> = {
  '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30',
  '1h': 'h1', '4h': 'h4', '1d': 'd1', '1M': 'mn1',
};

function isInstrument(
  value: string,
  metadata: Record<InstrumentType, unknown>,
): value is InstrumentType {
  return Object.hasOwn(metadata, value);
}

const mod: DiagModule = {
  name: 'dukascopy-fetch-probe',
  description: 'Fetch N bars from Dukascopy and report success/error',

  async run(args): Promise<DiagResult> {
    const t0 = performance.now();

    const symbol = typeof args.symbol === 'string' ? args.symbol : 'EURUSD';
    const interval = typeof args.interval === 'string' ? args.interval : '1h';
    const days = typeof args.days === 'number' ? args.days : 5;

    const dukasInterval = INTERVAL_MAP[interval];
    if (!dukasInterval) {
      return {
        name: 'dukascopy-fetch-probe',
        pass: false,
        summary: `Unknown interval '${interval}'. Known: ${Object.keys(INTERVAL_MAP).join(', ')}`,
        details: { symbol, interval },
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 86_400_000);

    try {
      const { getHistoricalRates, instrumentMetaData } = await import('dukascopy-node');
      const instrument = symbol.toLowerCase();
      if (!isInstrument(instrument, instrumentMetaData)) {
        return {
          name: 'dukascopy-fetch-probe',
          pass: false,
          summary: `Unknown Dukascopy instrument '${symbol}'`,
          details: { symbol, interval },
          durationMs: Math.round(performance.now() - t0),
        };
      }
      const data = await getHistoricalRates({
        instrument,
        dates: { from: startDate, to: endDate },
        timeframe: dukasInterval as 'm1',
        format: 'json',
      });

      const rows = Array.isArray(data) ? data : [];
      const pass = rows.length > 0;

      return {
        name: 'dukascopy-fetch-probe',
        pass,
        summary: pass
          ? `${rows.length} bars fetched for ${symbol}/${interval} over ${days}d`
          : `0 bars returned for ${symbol}/${interval} over ${days}d`,
        details: {
          symbol,
          interval,
          dukasInterval,
          days,
          rowCount: rows.length,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          firstBar: rows[0] ?? null,
          lastBar: rows[rows.length - 1] ?? null,
        },
        durationMs: Math.round(performance.now() - t0),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name: 'dukascopy-fetch-probe',
        pass: false,
        summary: `Dukascopy fetch failed: ${msg}`,
        details: { symbol, interval, days, error: msg },
        durationMs: Math.round(performance.now() - t0),
      };
    }
  },
};

export default mod;
