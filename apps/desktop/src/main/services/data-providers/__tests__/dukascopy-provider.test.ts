/**
 * DukascopyProvider Unit Tests
 *
 * TICKET_424_1E: Tests for INTERVAL_MAP translation, symbol classification,
 * relevance-ranked search, error handling, timestamp conversion.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetHistoricalRates = vi.fn();
const mockInstrumentMetaData: Record<string, {
  name: string;
  description: string;
  startDayForMinuteCandles: string;
}> = {
  eurusd: {
    name: 'EUR/USD',
    description: 'Euro vs US Dollar',
    startDayForMinuteCandles: '2003-05-04T00:00:00',
  },
  btcusd: {
    name: 'BTC/USD',
    description: 'Bitcoin vs US Dollar',
    startDayForMinuteCandles: '2017-01-01T00:00:00',
  },
  'a.us/usd': {
    name: 'A.US/USD',
    description: 'Agilent Technologies',
    startDayForMinuteCandles: '2019-01-01T00:00:00',
  },
  'spxusd.idx': {
    name: 'SPX/USD',
    description: 'S&P 500 Index',
    startDayForMinuteCandles: '2010-01-01T00:00:00',
  },
  etfspy: {
    name: 'SPY',
    description: 'SPDR S&P 500 ETF Trust',
    startDayForMinuteCandles: '2015-01-01T00:00:00',
  },
  gbpusd: {
    name: 'GBP/USD',
    description: 'Great Britain Pound vs US Dollar',
    startDayForMinuteCandles: '2003-05-04T00:00:00',
  },
};

vi.mock('dukascopy-node', () => ({
  getHistoricalRates: mockGetHistoricalRates,
  instrumentMetaData: mockInstrumentMetaData,
}));

vi.mock('../../../utils/logger', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../i18n/main-strings', () => ({
  mainT: vi.fn((_locale: string, _ns: string, key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return `${key}: ${JSON.stringify(params)}`;
  }),
}));

vi.mock('../../locale-service', () => ({
  getCurrentMainLocale: vi.fn().mockReturnValue('en_US'),
}));

// Must import AFTER mocks
import { DukascopyProvider } from '../dukascopy-provider';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DukascopyProvider', () => {
  let provider: DukascopyProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DukascopyProvider();
  });

  // =========================================================================
  // Capabilities
  // =========================================================================

  describe('capabilities', () => {
    it('should not require auth', () => {
      expect(provider.capabilities.requiresAuth).toBe(false);
    });

    it('should support search', () => {
      expect(provider.capabilities.supportsSearch).toBe(true);
    });

    it('should have no baseInterval (native mode)', () => {
      expect(provider.capabilities.baseInterval).toBeUndefined();
    });
  });

  // =========================================================================
  // queryOHLCV
  // =========================================================================

  describe('queryOHLCV', () => {
    it('should call getHistoricalRates with correct dukascopy timeframe', async () => {
      mockGetHistoricalRates.mockResolvedValue([]);
      await provider.queryOHLCV('eurusd', '1h', '2024-01-01', '2024-01-31');

      expect(mockGetHistoricalRates).toHaveBeenCalledWith(
        expect.objectContaining({
          instrument: 'eurusd',
          timeframe: 'h1',
        })
      );
    });

    it('should bump to-date by +1 day for dukascopy-node exclusive upper bound', async () => {
      mockGetHistoricalRates.mockResolvedValue([]);
      await provider.queryOHLCV('eurusd', '1h', '2024-01-01', '2024-01-31');

      const call = mockGetHistoricalRates.mock.calls[0][0];
      const toDate: Date = call.dates.to;
      expect(toDate.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    });

    it('should map all supported intervals correctly', async () => {
      mockGetHistoricalRates.mockResolvedValue([]);

      const intervalMappings: Record<string, string> = {
        '1m': 'm1',
        '5m': 'm5',
        '15m': 'm15',
        '30m': 'm30',
        '1h': 'h1',
        '4h': 'h4',
        '1d': 'd1',
      };

      for (const [uiInterval, dukasInterval] of Object.entries(intervalMappings)) {
        await provider.queryOHLCV('eurusd', uiInterval, '2024-01-01', '2024-01-31');
        expect(mockGetHistoricalRates).toHaveBeenLastCalledWith(
          expect.objectContaining({ timeframe: dukasInterval })
        );
      }
    });

    it('should throw for unsupported interval', async () => {
      await expect(
        provider.queryOHLCV('eurusd', '3m', '2024-01-01', '2024-01-31')
      ).rejects.toThrow(/providers\.unsupportedInterval/);
    });

    it('should convert millisecond timestamps to seconds', async () => {
      const msTimestamp = 1704067200000; // 2024-01-01 00:00:00 UTC in ms
      mockGetHistoricalRates.mockResolvedValue([
        { timestamp: msTimestamp, open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: 100 },
      ]);

      const rows = await provider.queryOHLCV('eurusd', '1d', '2024-01-01', '2024-01-02');
      expect(rows[0].timestamp).toBe(Math.floor(msTimestamp / 1000));
    });

    it('should lowercase the symbol for dukascopy-node', async () => {
      mockGetHistoricalRates.mockResolvedValue([]);
      await provider.queryOHLCV('EURUSD', '1d', '2024-01-01', '2024-01-31');

      expect(mockGetHistoricalRates).toHaveBeenCalledWith(
        expect.objectContaining({ instrument: 'eurusd' })
      );
    });

    it('should handle validationErrors array (not Error instance)', async () => {
      mockGetHistoricalRates.mockRejectedValue({
        validationErrors: [
          { message: 'Invalid instrument' },
          { message: 'Invalid date range' },
        ],
      });

      await expect(
        provider.queryOHLCV('invalid', '1d', '2024-01-01', '2024-01-31')
      ).rejects.toThrow(/providers\.validationFailed/);
    });

    it('should re-throw non-network Error instances directly', async () => {
      mockGetHistoricalRates.mockRejectedValue(new Error('Some specific library error'));

      await expect(
        provider.queryOHLCV('eurusd', '1d', '2024-01-01', '2024-01-31')
      ).rejects.toThrow('Some specific library error');
    });

    // TICKET_1074: opaque error enrichment with symbol + date context
    it('should enrich "Unknown error" with symbol and date context', async () => {
      mockGetHistoricalRates.mockRejectedValue(new Error('Unknown error'));

      await expect(
        provider.queryOHLCV('USDCHF', '1h', '2024-01-01', '2024-06-30')
      ).rejects.toThrow(/providers\.dataFetchFailed/);
    });

    it('should enrich "fetch failed" with symbol and date context', async () => {
      mockGetHistoricalRates.mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        provider.queryOHLCV('AUDUSD', '1d', '2024-01-01', '2024-01-31')
      ).rejects.toThrow(/providers\.dataFetchFailed/);
    });

    it('should enrich ECONNRESET errors with context', async () => {
      mockGetHistoricalRates.mockRejectedValue(new Error('read ECONNRESET'));

      await expect(
        provider.queryOHLCV('EURUSD', '1h', '2024-01-01', '2024-01-31')
      ).rejects.toThrow(/providers\.dataFetchFailed/);
    });

    it('should enrich ETIMEDOUT errors with context', async () => {
      mockGetHistoricalRates.mockRejectedValue(new Error('connect ETIMEDOUT 185.57.164.2:443'));

      await expect(
        provider.queryOHLCV('GBPUSD', '4h', '2024-01-01', '2024-01-31')
      ).rejects.toThrow(/providers\.dataFetchFailed/);
    });
  });

  // =========================================================================
  // searchSymbols
  // =========================================================================

  describe('searchSymbols', () => {
    it('should return matching instruments in wrapped response', async () => {
      const response = await provider.searchSymbols('EUR');
      // TICKET_641_10: Response is wrapped { results, totalCount, truncated }
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('totalCount');
      expect(response).toHaveProperty('truncated');
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results.some(r => r.symbol === 'EURUSD')).toBe(true);
    });

    it('should be case-insensitive', async () => {
      const upper = await provider.searchSymbols('EUR');
      const lower = await provider.searchSymbols('eur');
      expect(upper).toEqual(lower);
    });

    it('should rank exact matches first', async () => {
      const response = await provider.searchSymbols('EUR/USD');
      expect(response.results[0].symbol).toBe('EURUSD');
    });

    it('should respect limit parameter', async () => {
      const response = await provider.searchSymbols('USD', 2);
      expect(response.results.length).toBeLessThanOrEqual(2);
    });

    it('should classify forex correctly', async () => {
      const response = await provider.searchSymbols('EUR/USD');
      const eurusd = response.results.find(r => r.symbol === 'EURUSD');
      expect(eurusd!.type).toBe('forex');
    });

    it('should classify crypto correctly', async () => {
      const response = await provider.searchSymbols('BTC');
      const btc = response.results.find(r => r.symbol === 'BTCUSD');
      expect(btc!.type).toBe('crypto');
    });

    it('should classify stock correctly (dot in name)', async () => {
      const response = await provider.searchSymbols('Agilent');
      const stock = response.results.find(r => r.symbol === 'A.US/USD');
      expect(stock!.type).toBe('stock');
    });

    it('should classify index correctly (idx in id)', async () => {
      const response = await provider.searchSymbols('SPX');
      const index = response.results.find(r => r.symbol === 'SPXUSD.IDX');
      expect(index!.type).toBe('index');
    });

    it('should classify ETF correctly (ETF in description)', async () => {
      const response = await provider.searchSymbols('ETF');
      const etf = response.results.find(r => r.symbol === 'ETFSPY');
      expect(etf!.type).toBe('etf');
    });

    it('returns truncated: true when matches exceed limit', async () => {
      // USD matches many instruments; limit=1 should truncate
      const response = await provider.searchSymbols('USD', 1);
      expect(response.results.length).toBe(1);
      expect(response.totalCount).toBeGreaterThan(1);
      expect(response.truncated).toBe(true);
    });

    it('returns truncated: false when matches fit within limit', async () => {
      const response = await provider.searchSymbols('EUR/USD', 100);
      expect(response.truncated).toBe(false);
      expect(response.totalCount).toBe(response.results.length);
    });
  });

  // =========================================================================
  // getSymbolDateRange
  // =========================================================================

  describe('getSymbolDateRange', () => {
    it('should return start date from instrument metadata', async () => {
      const range = await provider.getSymbolDateRange('eurusd');
      expect(range.startTime).toBe('2003-05-04');
    });

    it('should return endTime as yesterday', async () => {
      const range = await provider.getSymbolDateRange('eurusd');
      expect(range.endTime).toBeTruthy();
      // endTime should be a date string
      expect(range.endTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should throw for unknown symbol', async () => {
      await expect(provider.getSymbolDateRange('nonexistent')).rejects.toThrow(
        /providers\.instrumentNotFound/
      );
    });
  });

  // =========================================================================
  // checkConnection
  // =========================================================================

  describe('checkConnection', () => {
    it('should return connected=true on successful fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      const status = await provider.checkConnection();
      expect(status.connected).toBe(true);
      vi.unstubAllGlobals();
    });

    it('should treat 403 as connected (directory listing denied)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
      const status = await provider.checkConnection();
      expect(status.connected).toBe(true);
      vi.unstubAllGlobals();
    });

    it('should return connected=false on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unreachable')));
      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.error).toBe('Network unreachable');
      vi.unstubAllGlobals();
    });
  });

  // =========================================================================
  // listSymbols - TICKET_880_4_5 (relevance-sorted)
  // =========================================================================

  describe('listSymbols', () => {
    it('should return symbols sorted by relevance, not alphabetically', async () => {
      const result = await provider.listSymbols();
      // With mock data: eurusd, gbpusd are G10 majors -> first
      // btcusd is crypto -> after forex
      // a.us/usd is stock -> last
      // spxusd.idx is index -> before stocks
      // etfspy is ETF -> with stocks
      expect(result.symbols[0]).toBe('EURUSD'); // G10 major #1
      expect(result.symbols[1]).toBe('GBPUSD'); // G10 major #3
    });

    it('should put G10 forex majors before other asset types', async () => {
      const result = await provider.listSymbols();
      const eurusdIdx = result.symbols.indexOf('EURUSD');
      const btcusdIdx = result.symbols.indexOf('BTCUSD');
      const stockIdx = result.symbols.indexOf('A.US/USD');

      // G10 major < crypto < stock
      expect(eurusdIdx).toBeLessThan(btcusdIdx);
      expect(btcusdIdx).toBeLessThan(stockIdx);
    });

    it('should respect limit parameter', async () => {
      const result = await provider.listSymbols(2);
      expect(result.symbols).toHaveLength(2);
      expect(result.total).toBe(6); // All mock instruments
    });
  });
});
