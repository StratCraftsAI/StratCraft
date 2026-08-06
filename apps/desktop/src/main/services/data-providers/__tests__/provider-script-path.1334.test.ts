/**
 * TICKET_1334 P3 -- the shared provider script/interpreter resolver.
 *
 * WHAT THESE PIN AND WHY:
 * both halves of this module were defects that produced the SAME user-visible
 * symptom -- a headless sweep ending `failed` with zero arms and, before the
 * observability fix, no record of why:
 *
 *   1. `resolveProviderScriptPath` -- four providers anchored their dev branch on
 *      `__dirname`, which is `dist/main/` under electron-vite but
 *      `src/main/services/data-providers/` when the host is loaded from source
 *      (ts-node drivers, headless actions, the headless `serve` runtime). The
 *      resolved path became `.../src/main/src/main/...` -- a doubled prefix that
 *      exists nowhere -- and `python3` failed with ENOENT.
 *   2. `resolveProviderPythonPath` -- all five spawned the bare string
 *      `'python3'`. Under `systemd-run --user` that is `/usr/bin/python3`, which
 *      does NOT have yfinance/akshare/baostock/tushare installed (they live in
 *      miniconda), so every provider call died with an empty-stderr
 *      "Command failed".
 *
 * Neither is reproducible by reading the code in an interactive shell, because
 * an interactive shell happens to satisfy both. That is exactly why they are
 * pinned by tests rather than by comments.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApp = { isPackaged: false, getAppPath: vi.fn(() => '/repo/apps/desktop') };
vi.mock('electron', () => ({ app: mockApp }));

const mockFindPython3Path = vi.fn<[], string | null>(() => '/home/u/miniconda3/bin/python3');
vi.mock('../../../utils/process-utils', () => ({
  findPython3Path: mockFindPython3Path,
}));

const { resolveProviderPythonPath, resolveProviderScriptPath } =
  await import('../provider-script-path');

beforeEach(() => {
  vi.clearAllMocks();
  mockApp.isPackaged = false;
  mockApp.getAppPath.mockReturnValue('/repo/apps/desktop');
  mockFindPython3Path.mockReturnValue('/home/u/miniconda3/bin/python3');
});

describe('resolveProviderScriptPath (TICKET_1334 P3)', () => {
  it('resolves under src/main when the host is loaded from source', () => {
    expect(resolveProviderScriptPath('yfinance_query.py')).toBe(
      '/repo/apps/desktop/src/main/services/data-providers/scripts/yfinance_query.py',
    );
  });

  it('resolves under dist/main when packaged', () => {
    mockApp.isPackaged = true;
    expect(resolveProviderScriptPath('yfinance_query.py')).toBe(
      '/repo/apps/desktop/dist/main/services/data-providers/scripts/yfinance_query.py',
    );
  });

  it('NEVER produces the src/main/src/main double prefix', () => {
    // The literal regression. The old `__dirname`-anchored branch emitted this
    // whenever the host was loaded from source, which is every headless run.
    for (const packaged of [false, true]) {
      mockApp.isPackaged = packaged;
      expect(resolveProviderScriptPath('akshare_query.py')).not.toContain(
        'src/main/src/main',
      );
    }
  });

  it('anchors on app.getAppPath(), so it is independent of the module location', () => {
    // `getAppPath()` is the one anchor that is correct in electron-vite dev, a
    // packaged build, a ts-node driver AND the headless runtime (where the
    // bootstrap electron shim returns the real app directory).
    mockApp.getAppPath.mockReturnValue('/somewhere/else');
    expect(resolveProviderScriptPath('tushare_query.py')).toBe(
      '/somewhere/else/src/main/services/data-providers/scripts/tushare_query.py',
    );
  });

  it('resolves each provider script into the one shared scripts directory', () => {
    for (const name of [
      'yfinance_query.py', 'akshare_query.py', 'tushare_query.py',
      'baostock_query.py', 'databento_query.py',
    ]) {
      expect(resolveProviderScriptPath(name)).toBe(
        `/repo/apps/desktop/src/main/services/data-providers/scripts/${name}`,
      );
    }
  });
});

describe('resolveProviderPythonPath (TICKET_1334 P3)', () => {
  it('returns the interpreter chosen by the shared findPython3Path owner', () => {
    // NOT the bare string 'python3'. Under systemd that resolved to
    // /usr/bin/python3, which lacks the provider packages.
    expect(resolveProviderPythonPath('YFinanceProvider')).toBe(
      '/home/u/miniconda3/bin/python3',
    );
    expect(mockFindPython3Path).toHaveBeenCalledOnce();
  });

  it('does not re-implement interpreter discovery', () => {
    mockFindPython3Path.mockReturnValue('/opt/pyenv/shims/python3');
    expect(resolveProviderPythonPath('DatabentoProvider')).toBe(
      '/opt/pyenv/shims/python3',
    );
  });

  it('throws naming the provider when no interpreter exists (TICKET_857)', () => {
    mockFindPython3Path.mockReturnValue(null);

    // Fails fast rather than falling back to the literal 'python3' -- a fallback
    // would reproduce the silent, misattributed failure this closes.
    expect(() => resolveProviderPythonPath('BaoStockProvider')).toThrow(
      /BaoStockProvider.*python3 not found/,
    );
  });

  it('never silently returns the bare python3 string', () => {
    mockFindPython3Path.mockReturnValue(null);
    let returned: string | undefined;
    try { returned = resolveProviderPythonPath('AKShareProvider'); } catch { /* expected */ }
    expect(returned).toBeUndefined();
  });
});
