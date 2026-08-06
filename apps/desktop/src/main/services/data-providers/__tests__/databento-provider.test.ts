/**
 * Unit tests for DatabentoProvider
 *
 * TICKET_958 Step 1 -- mirrors yfinance-provider.test.ts (same execFile
 * mocking pattern). The pyarrow `filters=` pushdown invariant itself is
 * pinned by the Python-side test in
 *   scripts/__tests__/test_databento_query.py
 * which is the only layer that can actually observe the pushdown call.
 * This TS suite verifies the provider's argument plumbing, error surfacing,
 * capability declaration, and research-only registration boundary.
 *
 * @see ../databento-provider.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
}));

vi.mock('../../../utils/logger', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../shared/constants/data-providers', () => ({
  PYTHON_SCRIPT_EXEC_TIMEOUT_MS: 60000,
  PYTHON_SCRIPT_MAX_BUFFER: 50 * 1024 * 1024,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupExecFileSuccess(stdout: string): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: any, callback: Function) => {
      callback(null, stdout, '');
    },
  );
}

function setupExecFileError(message: string): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: any, callback: Function) => {
      callback(new Error(message), '', 'some stderr');
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DatabentoProvider', () => {
  let DatabentoProvider: typeof import('../databento-provider').DatabentoProvider;
  let provider: InstanceType<typeof DatabentoProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../databento-provider');
    DatabentoProvider = mod.DatabentoProvider;
    provider = new DatabentoProvider();
  });

  describe('static properties', () => {
    it('has correct id and human-readable name', () => {
      expect(provider.id).toBe('databento');
      expect(provider.name).toContain('Databento');
    });

    it('declares databento_us_equity as its only MarketId', () => {
      expect(provider.supportedMarkets).toEqual(['databento_us_equity']);
    });

    it('declares 1m and 5m as native intervals (matches parquet snapshot)', () => {
      // TICKET_958 A1 (2026-06-14d): Databento ingestion now writes both 1m
      // and 5m bars (aggregator --timeframe flag). The 5m parquet was added
      // to clear the bar-floor for the TICKET_939_2 "Strong"-verdict templates
      // under a 90-day window. Promoting 1h to native requires running the
      // aggregator with --timeframe 1h AND adding it to NATIVE_INTERVALS --
      // the test pins the current snapshot so a silent capability widening
      // fails loudly here.
      expect(provider.capabilities.nativeIntervals).toEqual(['1m', '5m']);
    });

    it('exposes aggregated intervals via deriveSupportedIntervals', () => {
      // 1m -> {1m, 5m, 15m, 30m, 1h, 4h} via the aggregation pipeline.
      expect(provider.capabilities.intervals).toContain('1m');
      expect(provider.capabilities.intervals).toContain('5m');
      expect(provider.capabilities.intervals).toContain('1h');
    });

    it('does not require auth (local parquet, no upstream API)', () => {
      expect(provider.capabilities.requiresAuth).toBe(false);
    });

    it('does not support symbol search (curated research universe)', () => {
      expect(provider.capabilities.supportsSearch).toBe(false);
    });

    it('declares US-equity calendar padding ratio (RTH-only bars)', () => {
      // TICKET_849 Phase D3: must match yfinance/alpaca equity-tier ratio so
      // bar-sufficiency math is identical across US-equity providers.
      expect(provider.capabilities.calendarPaddingRatio?.['1m']).toBeCloseTo(5.35);
      expect(provider.capabilities.calendarPaddingRatio?.['1d']).toBeUndefined();
    });
  });

  describe('queryOHLCV()', () => {
    it('passes query command with symbol/interval/start/end through to the script', async () => {
      const rows = [
        { timestamp: 1769608620, open: 100, high: 105, low: 99, close: 103, volume: 5000 },
      ];
      setupExecFileSuccess(JSON.stringify(rows));

      const result = await provider.queryOHLCV('IBM', '1m', '2026-01-28', '2026-01-29');

      expect(mockExecFile).toHaveBeenCalledTimes(1);
      const args = mockExecFile.mock.calls[0][1] as string[];
      // First arg is the script path; verify command + 4 query positionals follow.
      expect(args).toContain('query');
      expect(args).toContain('IBM');
      expect(args).toContain('1m');
      expect(args).toContain('2026-01-28');
      expect(args).toContain('2026-01-29');
      expect(result).toEqual(rows);
    });

    it('accepts 5m as a native interval (TICKET_958 A1 capability widening)', async () => {
      // TICKET_958 A1: 5m is now a native parquet, not aggregated upstream.
      const rows = [
        { timestamp: 1780320600, open: 100, high: 105, low: 99, close: 103, volume: 5000 },
      ];
      setupExecFileSuccess(JSON.stringify(rows));
      const result = await provider.queryOHLCV('AAPL', '5m', '2026-06-01', '2026-06-05');
      expect(result).toEqual(rows);
      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('5m');
    });

    it('rejects intervals outside the native parquet set (aggregation happens upstream)', async () => {
      // Per IDataProvider contract -- only the resolver-chosen native interval
      // ever reaches the provider; an aggregated request would mean misroute.
      // 15m / 30m / 1h / 4h are all derived intervals (deriveSupportedIntervals).
      await expect(provider.queryOHLCV('IBM', '15m', '2026-01-28', '2026-01-29'))
        .rejects.toThrow(/providers\.nativeIntervalOnly/);
      await expect(provider.queryOHLCV('IBM', '1h', '2026-01-28', '2026-01-29'))
        .rejects.toThrow(/providers\.nativeIntervalOnly/);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('surfaces script-reported errors as exceptions', async () => {
      setupExecFileSuccess(JSON.stringify({ error: 'parquet file missing' }));
      await expect(provider.queryOHLCV('NOPE', '1m', '2026-01-28', '2026-01-29'))
        .rejects.toThrow(/providers\.queryFailed/);
    });

    it('throws when script returns a non-array payload', async () => {
      setupExecFileSuccess(JSON.stringify({ unexpected: 'object' }));
      await expect(provider.queryOHLCV('IBM', '1m', '2026-01-28', '2026-01-29'))
        .rejects.toThrow(/providers\.unexpectedDataFormat/);
    });

    it('accepts empty result (missing parquet is exclusion, not error)', async () => {
      setupExecFileSuccess('[]');
      const result = await provider.queryOHLCV('IBM', '1m', '2026-01-28', '2026-01-29');
      expect(result).toEqual([]);
    });
  });

  describe('searchSymbols()', () => {
    it('returns empty non-truncated response (search disabled)', async () => {
      const response = await provider.searchSymbols('IBM', 10);
      expect(response.results).toEqual([]);
      expect(response.totalCount).toBe(0);
      expect(response.truncated).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('getSymbolDateRange()', () => {
    it('invokes info command with the default native interval', async () => {
      setupExecFileSuccess(JSON.stringify({ startTime: '2026-01-28', endTime: '2026-06-13' }));

      const range = await provider.getSymbolDateRange('IBM');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('info');
      expect(args).toContain('IBM');
      expect(args).toContain('1m');
      expect(range.startTime).toBe('2026-01-28');
      expect(range.endTime).toBe('2026-06-13');
    });
  });

  describe('checkConnection()', () => {
    it('reports connected when script succeeds and parquet root exists', async () => {
      setupExecFileSuccess(JSON.stringify({ connected: true }));
      const status = await provider.checkConnection();
      expect(status.connected).toBe(true);
      expect(status.latencyMs).toBeDefined();
    });

    it('propagates not-configured reason when parquet root is absent', async () => {
      setupExecFileSuccess(JSON.stringify({
        connected: false,
        reason: 'not-configured',
        error: 'Databento parquet root not found',
      }));
      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.reason).toBe('not-configured');
      expect(status.error).toContain('parquet root not found');
    });

    it('returns disconnected on script failure', async () => {
      setupExecFileError('python3 not found');
      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.error).toContain('providers.scriptFailed');
    });
  });

  // TICKET_958_5 AC #5: single-path docstring guard. The provider docstring
  // describes ONE read path (provider-side hydration via the Python helper;
  // the canonical writer commits rows to the Electron cache; all readers go
  // through the cache). The prior TICKET_958_3 AC #6 guard required the
  // docstring to name BOTH a provider path AND a gate path; that two-path
  // contract is retired by 958_5 (the gate has no business reading the
  // upstream source -- it is a provider-internal detail). This guard fails
  // CI when (a) the canonical hydration path is no longer named, or (b) the
  // retired two-path wording reappears.
  describe('AC #5 single-path docstring guard', () => {
    it('docstring names the single hydration path and the canonical-schema commitment', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const providerPath = path.resolve(
        __dirname,
        '..',
        'databento-provider.ts',
      );
      const providerSrc = fs.readFileSync(providerPath, 'utf8');
      const docstringEnd = providerSrc.indexOf(' */');
      expect(docstringEnd).toBeGreaterThan(0);
      const docstring = providerSrc.slice(0, docstringEnd);

      // The single hydration path MUST be named.
      expect(docstring).toMatch(/databento_query\.py/);
      expect(docstring).toMatch(/queryOHLCV/);

      // The canonical schema commitment MUST be named -- this is what
      // makes the downstream gate's SQL resolvable without the docstring
      // naming the gate at all.
      expect(docstring).toMatch(/OHLCV_V1_CANONICAL/);
      expect(docstring).toMatch(/canonical writer/i);

      // The retired two-path wording MUST be gone. Future patches that
      // re-introduce a second read path MUST update this guard too.
      // (Mentioning the gate function as a CONSUMER of the cache is
      // allowed; what is retired is the framing of two independent read
      // paths in the docstring's path enumeration.)
      expect(docstring).not.toMatch(/GATE-SIDE COUNTING PATH/i);
      expect(docstring).not.toMatch(/two paths/i);
      expect(docstring).not.toMatch(/READ PATHS \(/);
      expect(docstring).not.toMatch(/Path 1[\s\S]*Path 2/);

      // The Python helper file must still exist where the docstring
      // claims (anchored at the provider's getScriptPath dev branch).
      const helperPath = path.resolve(
        __dirname,
        '..',
        'scripts',
        'databento_query.py',
      );
      expect(fs.existsSync(helperPath)).toBe(true);

      // The provider MUST declare canonical cacheSchema in capabilities.
      expect(providerSrc).toMatch(
        /cacheSchema:\s*'OHLCV_V1_CANONICAL'/,
      );
    });
  });
});
