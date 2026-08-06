/**
 * Unit tests for TushareProvider
 *
 * TICKET_904_2: Tushare Pro China A-Share data provider
 * @see ../tushare-provider.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();
const mockGetSecret = vi.fn();

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

vi.mock('../../../services/secure-credential-service', () => ({
  getSecureCredentialService: () => ({
    getSecret: mockGetSecret,
  }),
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

function setupToken(token: string): void {
  mockGetSecret.mockResolvedValue({ value: token });
}

function setupNoToken(): void {
  mockGetSecret.mockResolvedValue({ value: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TushareProvider', () => {
  let TushareProvider: typeof import('../tushare-provider').TushareProvider;
  let provider: InstanceType<typeof TushareProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../tushare-provider');
    TushareProvider = mod.TushareProvider;
    provider = new TushareProvider();
  });

  describe('static properties', () => {
    it('has correct id and name', () => {
      expect(provider.id).toBe('tushare');
      expect(provider.name).toBe('Tushare Pro A-Share');
    });

    it('has correct capabilities', () => {
      expect(provider.capabilities.requiresAuth).toBe(true);
      expect(provider.capabilities.supportsSearch).toBe(true);
      expect(provider.capabilities.assetTypes).toContain('stock');
      expect(provider.capabilities.nativeIntervals).toContain('1d');
      expect(provider.capabilities.nativeIntervals).toContain('1w');
      expect(provider.capabilities.nativeIntervals).toContain('1M');
      expect(provider.capabilities.intervals).toContain('1d');
    });

    it('does not support intraday intervals (free tier)', () => {
      expect(provider.capabilities.nativeIntervals).not.toContain('1m');
      expect(provider.capabilities.nativeIntervals).not.toContain('5m');
      expect(provider.capabilities.nativeIntervals).not.toContain('1h');
    });

    it('nativeIntervals keys match INTERVAL_MAP keys', () => {
      const expectedNative = ['1d', '1w', '1M'];
      expect([...provider.capabilities.nativeIntervals]).toEqual(expectedNative);
    });
  });

  describe('queryOHLCV()', () => {
    it('passes symbol through unchanged (Tushare uses same format)', async () => {
      setupToken('test-token');
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('000001.SZ');
    });

    it('maps intervals correctly', async () => {
      const intervalTests: [string, string][] = [
        ['1d', 'daily'],
        ['1w', 'weekly'],
        ['1M', 'monthly'],
      ];

      for (const [input, expected] of intervalTests) {
        mockExecFile.mockClear();
        setupToken('test-token');
        setupExecFileSuccess('[]');
        await provider.queryOHLCV('000001.SZ', input, '2024-01-01', '2024-06-30');

        const args = mockExecFile.mock.calls[0][1] as string[];
        expect(args).toContain(expected);
      }
    });

    it('throws for unsupported interval', async () => {
      setupToken('test-token');
      await expect(provider.queryOHLCV('000001.SZ', '1m', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unsupportedInterval/);
    });

    it('throws when token not configured', async () => {
      setupNoToken();
      await expect(provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.tokenNotConfigured/);
    });

    it('passes token via --token flag', async () => {
      setupToken('my-secret-token');
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('600000.SH', '1d', '2024-01-01', '2024-06-30');

      const args = mockExecFile.mock.calls[0][1] as string[];
      const tokenIdx = args.indexOf('--token');
      expect(tokenIdx).toBeGreaterThan(-1);
      expect(args[tokenIdx + 1]).toBe('my-secret-token');
    });

    it('parses JSON output correctly', async () => {
      setupToken('test-token');
      const rows = [{ timestamp: 1704153600, open: 10, high: 11, low: 9, close: 10.5, volume: 100000 }];
      setupExecFileSuccess(JSON.stringify(rows));

      const result = await provider.queryOHLCV('600000.SH', '1d', '2024-01-01', '2024-01-31');
      expect(result).toEqual(rows);
    });

    it('throws when script returns error object', async () => {
      setupToken('test-token');
      setupExecFileSuccess(JSON.stringify({ error: 'Rate limit exceeded' }));
      await expect(provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.queryFailed/);
    });

    it('throws when script returns non-array', async () => {
      setupToken('test-token');
      setupExecFileSuccess(JSON.stringify({ data: 'wrong' }));
      await expect(provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.unexpectedDataFormat/);
    });
  });

  describe('searchSymbols()', () => {
    it('returns empty results when no token configured', async () => {
      setupNoToken();

      const response = await provider.searchSymbols('600000', 10);
      expect(response.results).toEqual([]);
      expect(response.totalCount).toBe(0);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('calls script with search command and wraps response', async () => {
      setupToken('test-token');
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
      setupToken('test-token');
      const symbols = Array.from({ length: 5 }, (_, i) => ({
        symbol: `60000${i}.SH`, name: `Stock ${i}`, type: 'stock', exchange: 'SSE',
      }));
      setupExecFileSuccess(JSON.stringify(symbols));

      const response = await provider.searchSymbols('600', 5);
      expect(response.truncated).toBe(true);
    });
  });

  describe('checkConnection()', () => {
    it('returns not-configured when no token', async () => {
      setupNoToken();

      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.reason).toBe('not-configured');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('returns connected status on success', async () => {
      setupToken('test-token');
      setupExecFileSuccess(JSON.stringify({ connected: true }));

      const status = await provider.checkConnection();

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('check');
      expect(args).toContain('--token');
      expect(status.connected).toBe(true);
      expect(status.latencyMs).toBeDefined();
    });

    it('returns disconnected on script failure', async () => {
      setupToken('test-token');
      setupExecFileError('python3 not found');

      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.error).toContain('providers.scriptFailed');
    });

    it('returns auth-failed reason from script', async () => {
      setupToken('bad-token');
      setupExecFileSuccess(JSON.stringify({
        connected: false,
        reason: 'auth-failed',
        error: 'Invalid token',
      }));

      const status = await provider.checkConnection();
      expect(status.connected).toBe(false);
      expect(status.reason).toBe('auth-failed');
      expect(status.error).toBe('Invalid token');
    });
  });

  describe('getSymbolDateRange()', () => {
    it('calls script with daterange command', async () => {
      setupToken('test-token');
      setupExecFileSuccess(JSON.stringify({ startTime: '2015-01-01', endTime: '2024-12-31' }));

      const range = await provider.getSymbolDateRange('600000.SH');

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain('daterange');
      expect(args).toContain('600000.SH');
      expect(range.startTime).toBe('2015-01-01');
      expect(range.endTime).toBe('2024-12-31');
    });

    it('throws when no token configured', async () => {
      setupNoToken();
      await expect(provider.getSymbolDateRange('600000.SH'))
        .rejects.toThrow(/providers\.tokenNotConfigured/);
    });

    it('returns nulls when no data', async () => {
      setupToken('test-token');
      setupExecFileSuccess(JSON.stringify({ startTime: null, endTime: null }));

      const range = await provider.getSymbolDateRange('999999.SZ');
      expect(range.startTime).toBeNull();
      expect(range.endTime).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws when script execution fails', async () => {
      setupToken('test-token');
      setupExecFileError('timeout exceeded');
      await expect(provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptFailed/);
    });

    it('throws when script returns empty output', async () => {
      setupToken('test-token');
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, callback: Function) => {
          callback(null, '  ', '');
        },
      );
      await expect(provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-01-02'))
        .rejects.toThrow(/providers\.scriptEmptyOutput/);
    });
  });

  describe('token masking in logs', () => {
    it('does not log the actual token value', async () => {
      setupToken('super-secret-token-123');
      setupExecFileSuccess('[]');
      await provider.queryOHLCV('000001.SZ', '1d', '2024-01-01', '2024-06-30');

      const { appLog } = await import('../../../utils/logger');
      const debugCalls = (appLog.debug as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of debugCalls) {
        const msg = String(call[0]);
        expect(msg).not.toContain('super-secret-token-123');
      }
    });
  });
});
