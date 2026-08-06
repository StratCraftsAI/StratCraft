import { describe, it, expect } from 'vitest';
import { DATA_PROVIDER_IDS, isDataProviderId } from './data-provider-id';

describe('TICKET_927_2_2 DataProviderId', () => {
  describe('DATA_PROVIDER_IDS', () => {
    it('contains no duplicates', () => {
      const set = new Set(DATA_PROVIDER_IDS);
      expect(set.size).toBe(DATA_PROVIDER_IDS.length);
    });

    it('contains every currently-registered provider', () => {
      // Mirrors the registration table at provider-manager.ts:259-263 + Pro
      // providers + the TICKET_927_2_3 reserved id.
      expect(DATA_PROVIDER_IDS).toContain('yfinance');
      expect(DATA_PROVIDER_IDS).toContain('dukascopy');
      expect(DATA_PROVIDER_IDS).toContain('akshare');
      expect(DATA_PROVIDER_IDS).toContain('tushare');
      expect(DATA_PROVIDER_IDS).toContain('baostock');
      expect(DATA_PROVIDER_IDS).toContain('alpaca');
      expect(DATA_PROVIDER_IDS).toContain('ccxt');
      expect(DATA_PROVIDER_IDS).toContain('clickhouse');
      expect(DATA_PROVIDER_IDS).not.toContain('forex_duckdb_import');
    });
  });

  describe('isDataProviderId', () => {
    it('accepts every value in DATA_PROVIDER_IDS', () => {
      for (const id of DATA_PROVIDER_IDS) {
        expect(isDataProviderId(id)).toBe(true);
      }
    });

    it('rejects unknown strings', () => {
      expect(isDataProviderId('')).toBe(false);
      expect(isDataProviderId('binance')).toBe(false);
      expect(isDataProviderId('Alpaca')).toBe(false); // case-sensitive
    });

    it('rejects non-string values', () => {
      expect(isDataProviderId(undefined)).toBe(false);
      expect(isDataProviderId(null)).toBe(false);
      expect(isDataProviderId(0)).toBe(false);
      expect(isDataProviderId({})).toBe(false);
      expect(isDataProviderId([])).toBe(false);
      expect(isDataProviderId(true)).toBe(false);
    });
  });
});
