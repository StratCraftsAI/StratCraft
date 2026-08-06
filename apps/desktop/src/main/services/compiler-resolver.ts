/**
 * Compiler Resolver Service
 *
 * NONABT_TICKET_010_3 Phase 4A: Resolve toolchain paths (compiler, linker,
 * runner, includes) with platform-aware fallback chain.
 *
 * Resolution order:
 *   1. User override (STRATCRAFT_CXX setting or QNX_CPP_TOOLCHAIN env var)
 *   2. Bundled toolchain (<resourcesPath>/toolchain/<platform>/)
 *   3. System fallback (dev only, detects clang++ from PATH)
 *   4. Not available (setupRequired: true)
 *
 * Two-phase singleton (same pattern as executor-queue-service.ts).
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import { CLI_PROBE_TIMEOUT_MS } from '../../shared/constants/timing';

const log = createLogger('CppToolchain');

// =============================================================================
// Types
// =============================================================================

export interface ToolchainInfo {
  compiler: string;       // Absolute path to clang++
  linker: string;         // Absolute path to lld
  sysroot?: string;       // Linux sysroot if bundled
  stdlib: string;         // Absolute path to libc++ dir
  includes: string[];     // [nonabt_headers, sdk_headers]
  type: 'bundled' | 'system';
  version: string;        // e.g. "18.1.0"
}

export interface RunnerInfo {
  path: string;           // Absolute path to stratforge-runner or StratCraft-executor
  type: 'bundled' | 'system';
}

export interface ToolchainStatus {
  available: boolean;
  info?: ToolchainInfo;
  runner?: RunnerInfo;          // Strategy runner: nonabackTrader/stratforge-runner (--strategy=...)
  pluginExecutor?: RunnerInfo;  // Plugin executor: packages/executor/StratCraft-executor (--config=...)
  researchWorker?: RunnerInfo;  // Research worker: packages/research-kernels/stratcraft-research-worker (commercial CLI)
  error?: string;
  setupRequired: boolean; // True if bundled archive exists but not extracted
}

// =============================================================================
// Service
// =============================================================================

export class CompilerResolverService {
  private cached: ToolchainStatus | null = null;

  /**
   * Full toolchain resolution (cached). Call invalidateCache() to force re-resolve.
   */
  resolve(): ToolchainStatus {
    if (this.cached) return this.cached;

    log.info('Resolving C++ toolchain...');
    const status = this.doResolve();
    this.cached = status;

    if (status.available) {
      log.info(`Toolchain resolved: type=${status.info!.type}, compiler=${status.info!.compiler}, version=${status.info!.version}`);
      if (status.runner) {
        log.info(`Runner resolved: type=${status.runner.type}, path=${status.runner.path}`);
      }
      if (status.pluginExecutor) {
        log.info(`Plugin executor resolved: type=${status.pluginExecutor.type}, path=${status.pluginExecutor.path}`);
      }
      if (status.researchWorker) {
        log.info(`Research worker resolved: type=${status.researchWorker.type}, path=${status.researchWorker.path}`);
      }
    } else {
      log.warn(`Toolchain not available: ${status.error || 'unknown'}`);
    }

    return status;
  }

  /**
   * Strategy-runner resolution (uses cached toolchain status if available).
   * Returns nonabackTrader's `stratforge-runner` -- the binary that loads
   * a strategy `.so` and runs a backtest. Callers MUST pass `--strategy=`
   * or `--strategy-source=` in the spawn argv.
   */
  resolveRunner(): RunnerInfo | undefined {
    const status = this.resolve();
    return status.runner;
  }

  /**
   * Plugin-executor resolution (uses cached toolchain status if available).
   * Returns `StratCraft-executor` (from `packages/executor`) -- the binary
   * that dispatches to a plugin by `pluginName` field in the config JSON
   * (factor_eval / cpp_backtest / live). Callers spawn with
   * `--config=<path> --output=<dir>` only -- no `--strategy=`.
   *
   * Distinct from `resolveRunner()` because `stratforge-runner` and
   * `StratCraft-executor` are two physically separate binaries with
   * incompatible CLIs (TICKET_196_7_5_3_3). Do NOT collapse them.
   */
  resolvePluginExecutor(): RunnerInfo | undefined {
    const status = this.resolve();
    return status.pluginExecutor;
  }

  /**
   * Research-worker resolution (uses cached toolchain status if available).
   * Returns `stratcraft-research-worker` (from `packages/research-kernels`)
   * -- the binary that owns the 14 commercial research CLI commands carved
   * out of `StratCraft-executor` in TICKET_1304_5B. Callers spawn with
   * `--stationarity=`, `--portfolio-replay=`, `--combinator=`, etc.
   *
   * TICKET_1304_5B_1: introduced to fix the binary-resolution regression
   * where commercial runners still pointed at StratCraft-executor after the
   * 5B carve-out.
   */
  resolveResearchWorker(): RunnerInfo | undefined {
    const status = this.resolve();
    return status.researchWorker;
  }

  /**
   * Force re-resolution on next resolve() call.
   */
  invalidateCache(): void {
    this.cached = null;
    log.info('Toolchain cache invalidated');
  }

  /**
   * Current platform identifier string.
   */
  getPlatformId(): string {
    const os = process.platform === 'win32' ? 'windows'
      : process.platform === 'darwin' ? 'macos'
      : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return `${os}-${arch}`;
  }

  // ===========================================================================
  // Private resolution logic
  // ===========================================================================

  private doResolve(): ToolchainStatus {
    const platformId = this.getPlatformId();

    // Step 1: User override
    const userOverride = this.resolveUserOverride();
    if (userOverride) {
      const runner = this.doResolveRunner(platformId);
      const pluginExecutor = this.doResolvePluginExecutor(platformId);
      const researchWorker = this.doResolveResearchWorker(platformId);
      const includes = this.resolveIncludes(undefined, platformId);
      return {
        available: true,
        info: userOverride,
        runner,
        pluginExecutor,
        researchWorker,
        setupRequired: false,
      };
    }

    // Step 2: Bundled toolchain
    const bundled = this.resolveBundled(platformId);
    if (bundled) {
      const runner = this.doResolveRunner(platformId);
      const pluginExecutor = this.doResolvePluginExecutor(platformId);
      const researchWorker = this.doResolveResearchWorker(platformId);
      return {
        available: true,
        info: bundled,
        runner,
        pluginExecutor,
        researchWorker,
        setupRequired: false,
      };
    }

    // Step 3: System fallback (dev only)
    if (!app.isPackaged) {
      const system = this.resolveSystem(platformId);
      if (system) {
        const runner = this.doResolveRunner(platformId);
        const pluginExecutor = this.doResolvePluginExecutor(platformId);
        const researchWorker = this.doResolveResearchWorker(platformId);
        return {
          available: true,
          info: system,
          runner,
          pluginExecutor,
          researchWorker,
          setupRequired: false,
        };
      }
    }

    // Step 4: Check if archive exists but not extracted (setupRequired)
    const archivePath = this.getBundledArchivePath(platformId);
    if (archivePath && existsSync(archivePath)) {
      return {
        available: false,
        setupRequired: true,
        error: 'Bundled toolchain archive exists but not yet extracted',
      };
    }

    // Not available
    const errorMsg = app.isPackaged
      ? 'No bundled C++ toolchain found'
      : 'No C++ toolchain found (no bundled toolchain, no system clang++)';
    return {
      available: false,
      setupRequired: false,
      error: errorMsg,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 1: User override
  // ---------------------------------------------------------------------------

  private resolveUserOverride(): ToolchainInfo | null {
    // Check STRATCRAFT_CXX app setting first, then QNX_CPP_TOOLCHAIN env var
    const overridePath = process.env.STRATCRAFT_CXX || process.env.QNX_CPP_TOOLCHAIN;
    if (!overridePath) return null;

    const compilerPath = overridePath;
    if (!existsSync(compilerPath)) {
      log.warn(`User override compiler not found: ${compilerPath}`);
      return null;
    }

    const version = this.detectVersion(compilerPath);
    const compilerDir = join(compilerPath, '..');

    return {
      compiler: compilerPath,
      linker: join(compilerDir, 'lld'),
      stdlib: join(compilerDir, '..', 'lib'),
      includes: this.resolveIncludes(undefined, this.getPlatformId()),
      type: 'system',
      version,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 2: Bundled toolchain
  // ---------------------------------------------------------------------------

  private resolveBundled(platformId: string): ToolchainInfo | null {
    const toolchainRoot = this.getBundledToolchainRoot(platformId);
    if (!toolchainRoot) return null;

    const binSuffix = process.platform === 'win32' ? '.exe' : '';
    const compiler = join(toolchainRoot, 'bin', `clang++${binSuffix}`);
    const linker = join(toolchainRoot, 'bin', `lld${binSuffix}`);

    if (!existsSync(compiler)) {
      log.warn(`Bundled compiler not found: ${compiler}`);
      return null;
    }

    const version = this.detectVersion(compiler);
    const includes = this.resolveIncludes(toolchainRoot, platformId);

    return {
      compiler,
      linker,
      stdlib: join(toolchainRoot, 'lib'),
      sysroot: process.platform === 'linux' ? join(toolchainRoot, 'sysroot') : undefined,
      includes,
      type: 'bundled',
      version,
    };
  }

  private getBundledToolchainRoot(platformId: string): string | null {
    // Production: <resourcesPath>/toolchain/<platform>/
    if (app.isPackaged) {
      const root = join(process.resourcesPath, 'toolchain', platformId);
      return existsSync(root) ? root : null;
    }

    // Dev: <appPath>/../../resources/toolchain/<platform>/
    const devRoot = join(app.getAppPath(), '..', '..', 'resources', 'toolchain', platformId);
    return existsSync(devRoot) ? devRoot : null;
  }

  private getBundledArchivePath(platformId: string): string | null {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'toolchain', `${platformId}.tar.gz`);
    }
    return join(app.getAppPath(), '..', '..', 'resources', 'toolchain', `${platformId}.tar.gz`);
  }

  // ---------------------------------------------------------------------------
  // Step 3: System fallback (dev only)
  // ---------------------------------------------------------------------------

  private resolveSystem(platformId: string): ToolchainInfo | null {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const compilerPath = execSync(`${whichCmd} clang++`, {
        encoding: 'utf-8',
        timeout: CLI_PROBE_TIMEOUT_MS,
      }).trim().split('\n')[0];

      if (!compilerPath || !existsSync(compilerPath)) return null;

      const version = this.detectVersion(compilerPath);
      const compilerDir = join(compilerPath, '..');
      const includes = this.resolveIncludes(undefined, platformId);

      log.info(`System clang++ detected: ${compilerPath} (${version})`);

      return {
        compiler: compilerPath,
        linker: join(compilerDir, 'lld'),
        stdlib: join(compilerDir, '..', 'lib'),
        includes,
        type: 'system',
        version,
      };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Runner resolution
  // ---------------------------------------------------------------------------

  private doResolveRunner(platformId: string): RunnerInfo | undefined {
    const binSuffix = process.platform === 'win32' ? '.exe' : '';
    const runnerName = `stratforge-runner${binSuffix}`;

    // 1. Bundled: <resourcesPath>/runner/<platform>/stratforge-runner
    if (app.isPackaged) {
      const bundledPath = join(process.resourcesPath, 'runner', platformId, runnerName);
      if (existsSync(bundledPath)) {
        return { path: bundledPath, type: 'bundled' };
      }
    } else {
      // Dev bundled path
      const devBundledPath = join(app.getAppPath(), '..', '..', 'resources', 'runner', platformId, runnerName);
      if (existsSync(devBundledPath)) {
        return { path: devBundledPath, type: 'bundled' };
      }
    }

    // 2. QNX_NONABT_RUNNER env var
    const envRunner = process.env.QNX_NONABT_RUNNER;
    if (envRunner && existsSync(envRunner)) {
      return { path: envRunner, type: 'system' };
    }

    // 3. Dev fallback: nonabackTrader build-parquet first (Parquet-enabled, production format)
    if (!app.isPackaged) {
      const devParquet = join(app.getAppPath(), '..', '..', '..', 'nonabackTrader', 'build-parquet', 'runner', runnerName);
      if (existsSync(devParquet)) {
        log.info(`Dev runner (parquet): ${devParquet}`);
        return { path: devParquet, type: 'system' };
      }
    }

    // 4. Dev fallback: nonabackTrader build dir (CSV-only)
    if (!app.isPackaged) {
      const devFallback = join(app.getAppPath(), '..', '..', '..', 'nonabackTrader', 'build', 'runner', runnerName);
      if (existsSync(devFallback)) {
        log.info(`Dev runner fallback: ${devFallback}`);
        return { path: devFallback, type: 'system' };
      }
    }

    return undefined;
  }

  /**
   * Resolve `StratCraft-executor` (the plugin executor, distinct from the
   * strategy runner above). Search order mirrors {@link doResolveRunner}:
   * bundled -> env override -> dev fallback under `packages/executor/build/`.
   *
   * TICKET_196_7_5_3_3: introduced so factor universe-mode (`factor_eval`
   * plugin) spawns the right binary. nonabackTrader's `stratforge-runner`
   * is a strategy runner and rejects argv without `--strategy=`; the
   * factor_eval plugin lives only in `StratCraft-executor`.
   */
  private doResolvePluginExecutor(platformId: string): RunnerInfo | undefined {
    const binSuffix = process.platform === 'win32' ? '.exe' : '';
    const executorName = `StratCraft-executor${binSuffix}`;

    // 1. Bundled: <resourcesPath>/executor/<platform>/StratCraft-executor
    if (app.isPackaged) {
      const bundledPath = join(process.resourcesPath, 'executor', platformId, executorName);
      if (existsSync(bundledPath)) {
        return { path: bundledPath, type: 'bundled' };
      }
    } else {
      // Dev bundled path
      const devBundledPath = join(app.getAppPath(), '..', '..', 'resources', 'executor', platformId, executorName);
      if (existsSync(devBundledPath)) {
        return { path: devBundledPath, type: 'bundled' };
      }
    }

    // 2. STRATCRAFT_EXECUTOR env var
    const envExecutor = process.env.STRATCRAFT_EXECUTOR;
    if (envExecutor && existsSync(envExecutor)) {
      return { path: envExecutor, type: 'system' };
    }

    // 3. Dev fallback: packages/executor/build/StratCraft-executor
    //    (CMake target StratCraft-executor in packages/executor/CMakeLists.txt:325)
    if (!app.isPackaged) {
      const devBuild = join(app.getAppPath(), '..', '..', 'packages', 'executor', 'build', executorName);
      if (existsSync(devBuild)) {
        log.info(`Dev plugin executor: ${devBuild}`);
        return { path: devBuild, type: 'system' };
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Research worker resolution (TICKET_1304_5B_1)
  // ---------------------------------------------------------------------------

  /**
   * Resolve `stratcraft-research-worker` (commercial research CLI, distinct
   * from both `stratforge-runner` and `StratCraft-executor`). Search order
   * mirrors {@link doResolvePluginExecutor}: bundled -> env override -> dev
   * fallback under `packages/research-kernels/build/`.
   *
   * TICKET_1304_5B carved 16 commercial CLI handlers into this binary.
   * TICKET_1304_5B_1 adds this resolver so the 14 affected TS runners
   * spawn the correct process.
   */
  private doResolveResearchWorker(platformId: string): RunnerInfo | undefined {
    const binSuffix = process.platform === 'win32' ? '.exe' : '';
    const workerName = `stratcraft-research-worker${binSuffix}`;

    // 1. Bundled: <resourcesPath>/research-worker/<platform>/stratcraft-research-worker
    if (app.isPackaged) {
      const bundledPath = join(process.resourcesPath, 'research-worker', platformId, workerName);
      if (existsSync(bundledPath)) {
        return { path: bundledPath, type: 'bundled' };
      }
    } else {
      const devBundledPath = join(app.getAppPath(), '..', '..', 'resources', 'research-worker', platformId, workerName);
      if (existsSync(devBundledPath)) {
        return { path: devBundledPath, type: 'bundled' };
      }
    }

    // 2. STRATCRAFT_RESEARCH_WORKER env var
    const envWorker = process.env.STRATCRAFT_RESEARCH_WORKER;
    if (envWorker && existsSync(envWorker)) {
      return { path: envWorker, type: 'system' };
    }

    // 3. Dev fallback: packages/research-kernels/build/stratcraft-research-worker
    if (!app.isPackaged) {
      const devBuild = join(app.getAppPath(), '..', '..', 'packages', 'research-kernels', 'build', workerName);
      if (existsSync(devBuild)) {
        log.info(`Dev research worker: ${devBuild}`);
        return { path: devBuild, type: 'system' };
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Include paths resolution
  // ---------------------------------------------------------------------------

  private resolveIncludes(toolchainRoot: string | undefined, platformId: string): string[] {
    const includes: string[] = [];

    if (toolchainRoot) {
      // Bundled includes: -I <root>/include resolves both
      // #include <stratforge/...> and #include <qnx_strategy_sdk/...>
      const includeRoot = join(toolchainRoot, 'include');
      if (existsSync(includeRoot)) includes.push(includeRoot);
    }

    // Dev fallback: sibling nonabackTrader repo
    if (includes.length === 0 && !app.isPackaged) {
      const devNonabt = join(app.getAppPath(), '..', '..', '..', 'nonabackTrader', 'include');
      if (existsSync(devNonabt)) {
        log.info(`Dev include fallback: ${devNonabt}`);
        includes.push(devNonabt);
      }
    }

    return includes;
  }

  // ---------------------------------------------------------------------------
  // Version detection
  // ---------------------------------------------------------------------------

  private detectVersion(compilerPath: string): string {
    try {
      const output = execSync(`"${compilerPath}" --version`, {
        encoding: 'utf-8',
        timeout: CLI_PROBE_TIMEOUT_MS,
      });
      // Parse "clang version X.Y.Z" or similar
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

// =============================================================================
// Two-phase singleton
// =============================================================================

let instance: CompilerResolverService | null = null;

export function initializeCompilerResolver(): void {
  if (instance) {
    log.warn('CompilerResolverService already initialized');
    return;
  }
  instance = new CompilerResolverService();
  log.info('Initialized');
}

export function getCompilerResolver(): CompilerResolverService {
  if (!instance) {
    throw new Error('CompilerResolverService not initialized. Call initializeCompilerResolver() first.');
  }
  return instance;
}
