/**
 * TICKET_1334 P3 -- the single resolver for bundled data-provider Python scripts.
 *
 * THE DEFECT THIS CLOSES:
 * five providers each carried their own copy of "where is my query script",
 * and four of those copies anchored the DEV branch on `__dirname`:
 *
 *   path.resolve(__dirname, '../../src/main/services/data-providers/scripts/x.py')
 *
 * That assumes `__dirname` is `apps/desktop/dist/main/`. It is, under
 * electron-vite. It is NOT when the host is loaded from source -- ts-node driver
 * scripts, the headless actions, and the TICKET_1334 headless `serve` runtime all
 * load `src/main/...` directly, making `__dirname`
 * `apps/desktop/src/main/services/data-providers/` and the resolved path
 * `apps/desktop/src/main/src/main/services/data-providers/scripts/x.py` -- a
 * doubled prefix that exists nowhere on disk. The observed symptom was
 * `python3: can't open file ...: [Errno 2] No such file or directory`, which on
 * the headless sweep path surfaced as
 * `Discovery failed: YFinance script failed` and a session that ended `failed`
 * with zero arms.
 *
 * `databento-provider.ts` already diagnosed and fixed exactly this (its comment
 * names the same `src/main/src/main/...` double-prefix), but the fix was applied
 * to that one provider only. Per TICKET_854 the proven resolution is EXTRACTED
 * here rather than copied a fifth time, so a future provider gets it by default
 * and the four stale copies cannot drift back.
 *
 * WHY `app.getAppPath()` AND NOT `__dirname`:
 * the app path is the same anchor in every context -- electron-vite dev, a
 * packaged build, a ts-node driver, and the headless runtime (where
 * `HeadlessBootstrap`'s electron shim returns the real app directory from
 * `getAppPath()`). Only the SUBDIRECTORY differs between a source layout
 * (`src/main/...`) and a built one (`dist/main/...`), and `app.isPackaged` is the
 * existing, correct discriminator for that.
 */

import path from 'path';
import { app } from 'electron';

import { findPython3Path } from '../../utils/process-utils';

/** Directory holding the provider query scripts, relative to the app path.
 *  Declared once so the source/built split is the ONLY thing that varies
 *  (TICKET_179: the segment is not restated per provider). */
const SCRIPTS_SUBDIR = 'services/data-providers/scripts';

/** Root segment for a source (ts-node / headless) layout. */
const SOURCE_ROOT = 'src/main';

/** Root segment for a built (electron-vite dev, packaged) layout. */
const BUILT_ROOT = 'dist/main';

/**
 * Absolute path to a bundled provider script.
 *
 * @param scriptFileName file name only, e.g. `yfinance_query.py`.
 */
export function resolveProviderScriptPath(scriptFileName: string): string {
  const root = app.isPackaged ? BUILT_ROOT : SOURCE_ROOT;
  return path.resolve(app.getAppPath(), root, SCRIPTS_SUBDIR, scriptFileName);
}

/**
 * TICKET_1334 P3 -- the Python interpreter the provider scripts must run under.
 *
 * THE DEFECT THIS CLOSES:
 * all five providers spawned the bare string `'python3'`, i.e. whatever `PATH`
 * happened to resolve. In an interactive shell that is the miniconda
 * interpreter, which HAS `yfinance` / `akshare` / `baostock` / `tushare`
 * installed. Under `systemd-run --user` -- how the TICKET_1334 headless runtime
 * and every background sweep actually start -- `PATH` is the systemd default,
 * `python3` is `/usr/bin/python3`, and the import fails instantly with
 * `ModuleNotFoundError`. `execFile` surfaced that as a bare
 * "Command failed: python3 ..." with EMPTY stderr, which is what made the
 * headless sweep die with zero arms and no usable diagnosis.
 *
 * The repo already owns the correct resolution: `findPython3Path()`
 * (`utils/process-utils.ts`) probes miniconda / anaconda / pyenv before the
 * system interpreter, and ten other modules -- the discovery orchestrator, the
 * sweep launch gate, the LSTM trainer, the Optuna bridge -- already call it.
 * These five providers were the outliers. Routing them through the same owner is
 * TICKET_854, and it makes provider downloads behave identically whether the
 * host is an interactive Electron window or a systemd-managed daemon.
 *
 * FAILS FAST (TICKET_857) rather than falling back to the literal `'python3'`:
 * a fallback would reproduce exactly the silent, misattributed failure above.
 */
export function resolveProviderPythonPath(providerName: string): string {
  const python = findPython3Path();
  if (!python) {
    throw new Error(
      `[${providerName}] python3 not found. Install Python 3 (miniconda, ` +
      `anaconda, pyenv or the system package) so the bundled provider scripts ` +
      `can run.`,
    );
  }
  return python;
}
