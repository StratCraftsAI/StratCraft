/**
 * Unit tests for BaoStockProvider
 *
 * @see ../baostock-provider.ts
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

describe('BaoStockProvider', () => {
  let BaoStockProvider: typeof import('../baostock-provider').BaoStockProvider;
  let provider: InstanceType<typeof BaoStockProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../baostock-provider');
    BaoStockProvider = mod.BaoStockProvider;
    provider = new BaoStockProvider();
  });

  describe('static properties', () => {
    it('has correct id and name', () => {
      expect(provider.id).toBe('baostock');
      expect(provider.name).toBe('BaoStock A-Share (Free)');
    });

    it('has correct capabilities', () => {
      expect(provider.capabilities.requiresAuth).toBe(false);
      expect(provider.capabilities.supportsSearch).toBe(true);
      expect(provider.capabilities.assetTypes).toContain('stock');
      expect(provider.capabilities.intervals).toContain('5m');
      expect(provider.capabilities.intervals).toContain('1d');
      expect(provider.capabilities.intervals).toContain('1M');
    });
  });

  describe('queryOHLCV()', () => {
    it('converts 600000.SH to sh.600000 format', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('600000.SH', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('sh.600000');
    });

    it('converts 000001.SZ to sz.000001 format', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('sz.000001');
    });

    it('passes through already-formatted baostock symbols', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('sh.600000', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('sh.600000');
    });

    it('maps intervals correctly (5m->5, 15m->15, 1d->d, 1w->w, 1M->m)', async () => {
      const intervalTests: [string, string][] = [
        ['5m', '5'],
        ['15m', '15'],
        ['30m', '30'],
        ['1h', '60'],
        ['1d', 'd'],
        ['1w', 'w'],
        ['1M', 'm'],
      ];

      for (const [input, expected] of intervalTests) {
        mockExecFile.mockClear();
        setupExecFileSuccess('[]');
        await provider.queryOHLCV('sh.600000', input, '2024-01-01', '2024-06-30');

        const args = mockExecFile.mock.calls[0][1] as string[];
        expect(args).toContain(expected);
      }
    });

    it('throws for unsupported interval', async () => {
      await expect(provider.queryOHLCV('sh.600000', '1m', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unsupportedInterval/);
    });

    it('parses JSON output correctly', async () => {
      const rows = [{ timestamp: 1704153600, open: 10, high: 11, low: 9, close: 10.5, volume: 100000 }];
      setupExecFileSuccess(JSON.stringify(rows));

      const result = await provider.queryOHLCV('600000.SH', '1d', '2024-01-01', '2024-01-31');
      expect(result).toEqual(rows);
    });

    it('throws when script returns error object', async () => {
      setupExecFileSuccess(JSON.stringify({ error: 'Login failed' }));
      await expect(provider.queryOHLCV('sh.600000', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.queryFailed/);
    });

    it('throws when script returns non-array', async () => {
      setupExecFileSuccess(JSON.stringify({ data: 'wrong' }));
      await expect(provider.queryOHLCV('sh.600000', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unexpectedDataFormat/);
    });
  });

  describe('searchSymbols()', () => {
    it('calls script with search command', async () => {
      const symbols = [{ symbol: 'sh.600000', name: 'Test Corp', type: 'stock' }];
      setupExecFileSuccess(JSON.stringify(symbols));

      const response = await provider.searchSymbols('600000', 10);

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('search');
      expect(args).toContain('600000');
      expect(args).toContain('10');
      // TICKET_641_10: Response is wrapped { results, totalCount, truncated }
      expect(response.results).toEqual(symbols);
      expect(response.totalCount).toBe(1);
      expect(response.truncated).toBe(false);
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
  });

  describe('getSymbolDateRange()', () => {
    it('calls script with daterange command and converts symbol', async () => {
      setupExecFileSuccess(JSON.stringify({ startTime: '2015-01-01', endTime: '2024-12-31' }));

      const range = await provider.getSymbolDateRange('600000.SH');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('daterange');
      expect(args).toContain('sh.600000');
      expect(range.startTime).toBe('2015-01-01');
      expect(range.endTime).toBe('2024-12-31');
    });
  });

  describe('error handling', () => {
    it('throws when script execution fails', async () => {
      setupExecFileError('timeout exceeded');
      await expect(provider.queryOHLCV('sh.600000', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptFailed/);
    });

    it('throws when script returns empty output', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, callback: Function) => {
          callback(null, '  ', '');
        },
      );
      await expect(provider.queryOHLCV('sh.600000', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptEmptyOutput/);
    });
  });
});
