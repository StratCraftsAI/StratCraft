/**
 * Unit tests for YFinanceProvider
 *
 * @see ../yfinance-provider.ts
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

/**
 * Configure mockExecFile to invoke the callback with given stdout.
 */
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

describe('YFinanceProvider', () => {
  let YFinanceProvider: typeof import('../yfinance-provider').YFinanceProvider;
  let provider: InstanceType<typeof YFinanceProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../yfinance-provider');
    YFinanceProvider = mod.YFinanceProvider;
    provider = new YFinanceProvider();
  });

  describe('static properties', () => {
    it('has correct id and name', () => {
      expect(provider.id).toBe('yfinance');
      expect(provider.name).toBe('Yahoo Finance');
    });

    it('has correct capabilities', () => {
      expect(provider.capabilities.requiresAuth).toBe(false);
      expect(provider.capabilities.supportsSearch).toBe(true);
      expect(provider.capabilities.intervals).toContain('1m');
      expect(provider.capabilities.intervals).toContain('1d');
      expect(provider.capabilities.intervals).toContain('1w');
      expect(provider.capabilities.intervals).toContain('1M');
    });
  });

  describe('queryOHLCV()', () => {
    it('calls Python script with correct args and parses JSON output', async () => {
      const rows = [
        { timestamp: 1704153600, open: 100, high: 105, low: 99, close: 103, volume: 5000 },
      ];
      setupExecFileSuccess(JSON.stringify(rows));

      const result = await provider.queryOHLCV('AAPL', '1d', '2024-01-01', '2024-01-31');

      expect(mockExecFile).toHaveBeenCalledTimes(1);
      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('query');
      expect(args).toContain('AAPL');
      expect(args).toContain('1d');
      expect(args).toContain('2024-01-01');
      expect(args).toContain('2024-01-31');
      expect(result).toEqual(rows);
    });

    it('maps 1w to 1wk for yfinance', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('AAPL', '1w', '2024-01-01', '2024-01-31');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('1wk');
    });

    it('maps 1M to 1mo for yfinance', async () => {
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('AAPL', '1M', '2024-01-01', '2024-01-31');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('1mo');
    });

    it('throws for unsupported interval', async () => {
      await expect(provider.queryOHLCV('AAPL', '3m', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unsupportedInterval/);
    });

    it('throws when script returns error object', async () => {
      setupExecFileSuccess(JSON.stringify({ error: 'No data found' }));
      await expect(provider.queryOHLCV('AAPL', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.queryFailed/);
    });

    it('throws when script returns non-array', async () => {
      setupExecFileSuccess(JSON.stringify({ some: 'object' }));
      await expect(provider.queryOHLCV('AAPL', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unexpectedDataFormat/);
    });
  });

  describe('searchSymbols()', () => {
    it('calls script with search command', async () => {
      const symbols = [{ symbol: 'AAPL', name: 'Apple', type: 'stock' }];
      setupExecFileSuccess(JSON.stringify(symbols));

      const response = await provider.searchSymbols('AAPL', 10);

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('search');
      expect(args).toContain('AAPL');
      expect(args).toContain('10');
      // TICKET_641_10: Response is wrapped { results, totalCount, truncated }
      expect(response.results).toEqual(symbols);
      expect(response.totalCount).toBe(1);
      expect(response.truncated).toBe(false);
    });
  });

  describe('checkConnection()', () => {
    it('calls script with check command and returns status', async () => {
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
    it('calls script with info command', async () => {
      setupExecFileSuccess(JSON.stringify({ startTime: '2010-01-01', endTime: '2024-12-31' }));

      const range = await provider.getSymbolDateRange('MSFT');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('info');
      expect(args).toContain('MSFT');
      expect(range.startTime).toBe('2010-01-01');
      expect(range.endTime).toBe('2024-12-31');
    });
  });

  describe('error handling', () => {
    it('throws when script execution fails', async () => {
      setupExecFileError('timeout exceeded');
      await expect(provider.queryOHLCV('AAPL', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptFailed/);
    });

    it('throws when script returns empty output', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, callback: Function) => {
          callback(null, '   ', '');
        },
      );
      await expect(provider.queryOHLCV('AAPL', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptEmptyOutput/);
    });

    it('throws on invalid JSON output', async () => {
      setupExecFileSuccess('not-json{{{');
      await expect(provider.queryOHLCV('AAPL', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow();
    });
  });
});
