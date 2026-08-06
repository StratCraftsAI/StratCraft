/**
 * Unit tests for AKShareProvider
 *
 * TICKET_904_1: AKShare China A-Share data provider
 * @see ../akshare-provider.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// TICKET_1334 P3: `getAppPath` is now REQUIRED. The provider resolves its
// bundled script through the shared `resolveProviderScriptPath`, which anchors
// on `app.getAppPath()` instead of `__dirname` -- the old `__dirname` branch
// produced `.../src/main/src/main/...` on every source-loaded host (ts-node
// drivers, headless actions, the headless `serve` runtime) and broke sweeps.
// Mirrors what databento-provider.test.ts already mocked.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
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
      callback(new Error(message), '', 'stderr output');
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AKShareProvider', () => {
  let AKShareProvider: typeof import('../akshare-provider').AKShareProvider;
  let provider: InstanceType<typeof AKShareProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../akshare-provider');
    AKShareProvider = mod.AKShareProvider;
    provider = new AKShareProvider();
  });

  describe('static properties', () => {
    it('has correct id and name', () => {
      expect(provider.id).toBe('akshare');
      expect(provider.name).toBe('AKShare A-Share (Free)');
    });

    it('has correct capabilities', () => {
      expect(provider.capabilities.requiresAuth).toBe(false);
      expect(provider.capabilities.supportsSearch).toBe(true);
      expect(provider.capabilities.assetTypes).toContain('stock');
      expect(provider.capabilities.nativeIntervals).toContain('1m');
      expect(provider.capabilities.nativeIntervals).toContain('5m');
      expect(provider.capabilities.nativeIntervals).toContain('1d');
      expect(provider.capabilities.nativeIntervals).toContain('1M');
      expect(provider.capabilities.intervals).toContain('1m');
      expect(provider.capabilities.intervals).toContain('1d');
    });

    it('nativeIntervals keys match INTERVAL_MAP keys', () => {
      const expectedNative = ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'];
      expect([...provider.capabilities.nativeIntervals]).toEqual(expectedNative);
    });
  });

  describe('queryOHLCV()', () => {
    it('strips .SH suffix from symbol', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('600000.SH', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('600000');
      expect(args).not.toContain('600000.SH');
    });

    it('strips .SZ suffix from symbol', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('000001');
      expect(args).not.toContain('000001.SZ');
    });

    it('passes through bare code if no suffix', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('000001', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('000001');
    });

    it('maps intervals correctly', async () => {
      const intervalTests: [string, string][] = [
        ['1m', '1'],
        ['5m', '5'],
        ['15m', '15'],
        ['30m', '30'],
        ['1h', '60'],
        ['1d', 'daily'],
        ['1w', 'weekly'],
        ['1M', 'monthly'],
      ];

      for (const [input, expected] of intervalTests) {
        mockExecFile.mockClear();
        setupExecFileSuccess('[]');
        await provider.queryOHLCV('000001', input, '2024-01-01', '2024-06-30');

        const args = mockExecFile.mock.calls[0][1] as string[];
        expect(args).toContain(expected);
      }
    });

    it('throws for unsupported interval', async () => {
      await expect(provider.queryOHLCV('000001', '2m', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unsupportedInterval/);
    });

    it('parses JSON output correctly', async () => {
      const rows = [{ timestamp: 1704153600, open: 10, high: 11, low: 9, close: 10.5, volume: 100000 }];
      setupExecFileSuccess(JSON.stringify(rows));

      const result = await provider.queryOHLCV('600000.SH', '1d', '2024-01-01', '2024-01-31');
      expect(result).toEqual(rows);
    });

    it('throws when script returns error object', async () => {
      setupExecFileSuccess(JSON.stringify({ error: 'Connection refused' }));
      await expect(provider.queryOHLCV('000001', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.queryFailed/);
    });

    it('throws when script returns non-array', async () => {
      setupExecFileSuccess(JSON.stringify({ data: 'wrong' }));
      await expect(provider.queryOHLCV('000001', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unexpectedDataFormat/);
    });
  });

  describe('searchSymbols()', () => {
    it('calls script with search command and wraps response', async () => {
      const symbols = [{ symbol: '600000.SH', name: 'SPDB', type: 'stock', exchange: 'SSE' }];
      setupExecFileSuccess(JSON.stringify(symbols));

      const response = await provider.searchSymbols('600000', 10);

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('search');
      expect(args).toContain('600000');
      expect(args).toContain('10');
      expect(response.results).toEqual(symbols);
      expect(response.totalCount).toBe(1);
      expect(response.truncated).toBe(false);
    });

    it('reports truncated when results.length >= limit', async () => {
      const symbols = Array.from({ length: 5 }, (_, i) => ({
        symbol: `60000${i}.SH`, name: `Stock ${i}`, type: 'stock', exchange: 'SSE',
      }));
      setupExecFileSuccess(JSON.stringify(symbols));

      const response = await provider.searchSymbols('600', 5);
      expect(response.truncated).toBe(true);
    });
  });

  describe('checkConnection()', () => {
    it('returns connected status on success', async () => {
      setupExecFileSuccess(JSON.stringify({ connected: true }));

      const status = await provider.checkConnection();

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('check');
      expect(status.connected).toBe(true);
      expect(status.latencyMs).toBeDefined();
    });

    it('returns disconnected on script failure', async () => {
      setupExecFileError('python3 not found');

      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.error).toContain('providers.scriptFailed');
    });

    it('returns disconnected when API reports failure', async () => {
      setupExecFileSuccess(JSON.stringify({ connected: false, error: 'upstream down' }));

      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.error).toBe('upstream down');
    });
  });

  describe('getSymbolDateRange()', () => {
    it('calls script with daterange command and strips suffix', async () => {
      setupExecFileSuccess(JSON.stringify({ startTime: '2015-01-01', endTime: '2024-12-31' }));

      const range = await provider.getSymbolDateRange('600000.SH');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('daterange');
      expect(args).toContain('600000');
      expect(range.startTime).toBe('2015-01-01');
      expect(range.endTime).toBe('2024-12-31');
    });

    it('returns nulls when no data', async () => {
      setupExecFileSuccess(JSON.stringify({ startTime: null, endTime: null }));

      const range = await provider.getSymbolDateRange('999999.SZ');
      expect(range.startTime).toBeNull();
      expect(range.endTime).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws when script execution fails', async () => {
      setupExecFileError('timeout exceeded');
      await expect(provider.queryOHLCV('000001', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptFailed/);
    });

    it('throws when script returns empty output', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, callback: Function) => {
          callback(null, '  ', '');
        },
      );
      await expect(provider.queryOHLCV('000001', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptEmptyOutput/);
    });
  });
});
