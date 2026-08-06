/**
 * HeadlessBootstrap -- initializes StratCraft services without Electron.
 *
 * Before any service module is imported, this module installs shims for
 * `electron` and `electron-log/main` into Node's require cache so that
 * transitive `import { app } from 'electron'` resolves to a headless
 * stub that returns the correct filesystem paths.
 *
 * Usage:
 *   import { HeadlessBootstrap } from '../headless/bootstrap';
 *   await HeadlessBootstrap.init();
 *   // now safe to import getDatabaseManager, etc.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Module from 'module';

let initialized = false;

function resolveUserData(): string {
  if (process.env.STRATCRAFT_USER_DATA) return process.env.STRATCRAFT_USER_DATA;

  const platform = os.platform();
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', '@StratCraft', 'desktop');
  } else if (platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      '@StratCraft', 'desktop',
    );
  }
  return path.join(os.homedir(), '.config', '@StratCraft', 'desktop');
}

function resolveAppPath(): string {
  if (process.env.STRATCRAFT_APP_PATH) return process.env.STRATCRAFT_APP_PATH;
  return path.resolve(__dirname, '..', '..');
}

function resolveResourcesPath(): string {
  return path.join(resolveAppPath(), 'resources');
}

function initializeProcessResourcesPath(): string {
  const resourcesPath = resolveResourcesPath();
  Object.defineProperty(process, 'resourcesPath', {
    value: resourcesPath,
    writable: false,
    configurable: true,
  });
  return resourcesPath;
}

function resolveDbPath(): string {
  if (process.env.STRATCRAFT_DB_PATH) return process.env.STRATCRAFT_DB_PATH;
  const devPath = path.join(resolveAppPath(), 'data', 'StratCraft.db');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(resolveUserData(), 'data', 'StratCraft.db');
}

/**
 * TICKET_1334 P3 -- log levels the headless electron-log shim understands,
 * ordered least to most severe. Index in this array IS the severity, so the
 * threshold comparison is an index compare and no second severity table exists
 * (TICKET_179: the order is declared once).
 *
 * These are electron-log's own level names; the shim must accept every one of
 * them because `createLogger()` (`main/utils/logger.ts`) and the ~40 modules
 * that call `log.verbose` / `log.silly` directly expect them to exist. A missing
 * method here is a TypeError at the call site, not a dropped line.
 */
const HEADLESS_LOG_LEVELS = ['silly', 'debug', 'verbose', 'info', 'warn', 'error'] as const;

type HeadlessLogLevel = (typeof HEADLESS_LOG_LEVELS)[number];

/**
 * Default minimum level emitted by the headless logger.
 *
 * `info`, matching what `main/utils/logger.ts` gives the PACKAGED desktop app
 * (`log.transports.file.level = app.isPackaged ? 'info' : 'debug'`). The headless
 * runtime is a service, not a developer's dev-mode window, so it gets the
 * service-grade level; `STRATCRAFT_HEADLESS_LOG_LEVEL` raises or lowers it
 * without a code change.
 */
const DEFAULT_HEADLESS_LOG_LEVEL: HeadlessLogLevel = 'info';

/** Env var that overrides {@link DEFAULT_HEADLESS_LOG_LEVEL}. */
const HEADLESS_LOG_LEVEL_ENV = 'STRATCRAFT_HEADLESS_LOG_LEVEL';

/** Levels routed to stderr rather than stdout, so a supervisor (systemd,
 *  Docker, CI) can separate faults from progress without parsing text. */
const HEADLESS_STDERR_LEVELS: ReadonlySet<string> = new Set<HeadlessLogLevel>(['warn', 'error']);

/**
 * TICKET_1334 P3 -- an electron-log shim that actually EMITS.
 *
 * WHY THIS REPLACED A NO-OP:
 * every main-process module logs through `main/utils/logger.ts`, which is a thin
 * wrapper over `electron-log/main`. Under headless, `installElectronShim()`
 * redirects that module specifier to this object, so whatever it does IS the
 * observability of the whole business layer on this path. It used to be
 * `() => {}`. The consequence was not "slightly quieter logs": a headless sweep
 * that failed reported `failed` with zero arms and left NO record anywhere of
 * why -- `appLog.error(...)` from the orchestrator went to a no-op function. That
 * is precisely the silent failure TICKET_858 forbids, and it is why the P2
 * live run could not be diagnosed from its own journal.
 *
 * WHY STDOUT/STDERR AND NOT A FILE:
 * the headless runtime is started under `systemd-run --user`, whose journal
 * already captures both streams -- so stdout IS the log destination an operator
 * reaches for (`journalctl --user -u stratcraft-serve`). Writing a second file
 * would create a second source of truth about the same run, and would need its
 * own rotation, its own path resolution and its own failure mode. The desktop
 * host keeps `electron-log`'s file transport because it has no journal; each host
 * logs to the sink its supervisor actually reads.
 *
 * NEVER THROWS: a logger that can throw turns an unrelated failure into a
 * different, more confusing one. A write failure (closed pipe, EPIPE from a
 * killed `journalctl`) is swallowed here and only here.
 */
export function buildElectronLogShim(): Record<string, unknown> & ((...args: unknown[]) => void) {
  const noop = () => {};

  const configuredLevel = (process.env[HEADLESS_LOG_LEVEL_ENV] ?? '').trim().toLowerCase();
  const thresholdIndex = HEADLESS_LOG_LEVELS.indexOf(configuredLevel as HeadlessLogLevel);
  const minLevelIndex =
    thresholdIndex >= 0
      ? thresholdIndex
      : HEADLESS_LOG_LEVELS.indexOf(DEFAULT_HEADLESS_LOG_LEVEL);

  /** Render one log argument. Errors keep their STACK -- the single most
   *  valuable line in a failure report, and the thing a plain `String(error)`
   *  throws away. */
  const render = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const emit = (level: HeadlessLogLevel, args: unknown[]): void => {
    if (HEADLESS_LOG_LEVELS.indexOf(level) < minLevelIndex) return;
    try {
      const line =
        `[${new Date().toISOString()}] [${level}] ` +
        `${args.map(render).join(' ')}\n`;
      // `write` on the raw stream, not `console.*`: console goes through the
      // same streams but adds its own formatting/inspection of objects, and the
      // rendering above is already the format this runtime documents.
      if (HEADLESS_STDERR_LEVELS.has(level)) process.stderr.write(line);
      else process.stdout.write(line);
    } catch {
      // A logger must never be the reason a request fails. See the header.
    }
  };

  /** Build the set of level methods, plus `scope()` which prefixes them.
   *  `scope` must return a FULL logger, not a bare function: electron-log's
   *  scoped logger supports the same level methods and callers use them. */
  const buildLevelMethods = (prefix: string): Record<string, unknown> => {
    const methods: Record<string, unknown> = {};
    for (const level of HEADLESS_LOG_LEVELS) {
      methods[level] = (...args: unknown[]): void =>
        emit(level, prefix ? [prefix, ...args] : args);
    }
    // electron-log aliases `log()` to info.
    methods.log = methods.info;
    methods.scope = (name: string) => makeLogger(prefix ? `${prefix}[${name}]` : `[${name}]`);
    return methods;
  };

  const makeTransports = () => ({
    // Reported but inert: nothing in the headless shim writes a file, and
    // pretending otherwise would let a caller believe it configured a sink that
    // does not exist. The fields exist because `main/utils/logger.ts` ASSIGNS to
    // them at import time (`resolvePathFn`, `format`, `level`, `maxSize`,
    // `archiveLogFn`) and a missing property would throw before any logging
    // could happen.
    file: { level: 'info' as unknown, resolvePathFn: noop, maxSize: 0, format: '', archiveLogFn: noop },
    console: { level: DEFAULT_HEADLESS_LOG_LEVEL as unknown, format: '' },
  });

  function makeLogger(prefix: string): Record<string, unknown> & ((...args: unknown[]) => void) {
    const base = (...args: unknown[]): void => emit('info', prefix ? [prefix, ...args] : args);
    return Object.assign(base, buildLevelMethods(prefix), {
      transports: makeTransports(),
      hooks: [] as unknown[],
      initialize: noop,
      // `create()` returns an INDEPENDENT logger in electron-log; the error-log
      // instance in `main/utils/logger.ts` relies on that. Here every instance
      // shares the same two streams, which is correct for a journal-captured
      // service: `error.log` exists to separate errors from a shared FILE, and
      // stderr already provides that separation.
      create: () => makeLogger(prefix),
    });
  }

  const shim = makeLogger('');
  shim.default = shim;
  return shim;
}

export function installElectronShim(): void {
  const userData = resolveUserData();
  const appPath = resolveAppPath();
  const noop = () => {};

  initializeProcessResourcesPath();

  const electronShim = {
    app: {
      getPath(name: string): string {
        if (name === 'userData') return userData;
        if (name === 'temp') return os.tmpdir();
        if (name === 'home') return os.homedir();
        if (name === 'appData') {
          if (os.platform() === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
          if (os.platform() === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
          return path.join(os.homedir(), '.config');
        }
        return os.tmpdir();
      },
      getAppPath: () => appPath,
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      setAppPath: noop,
      exit: (code?: number) => process.exit(code),
      on: () => electronShim.app,
      once: () => electronShim.app,
      removeListener: () => electronShim.app,
      getName: () => 'StratCraft',
      getVersion: () => '0.0.0-headless',
      isReady: () => true,
      requestSingleInstanceLock: () => true,
    },
    shell: {
      openExternal: () => Promise.resolve(),
    },
    BrowserWindow: {
      getAllWindows: () => [],
    },
    ipcMain: {
      on: noop,
      handle: noop,
      removeHandler: noop,
    },
    default: undefined as unknown,
  };
  electronShim.default = electronShim;

  const electronLogShim = buildElectronLogShim();

  const srcDir = path.resolve(__dirname, '..');
  const origResolve = (Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename;
  (Module as unknown as { _resolveFilename: (...args: unknown[]) => string })._resolveFilename = function (
    ...resolveArgs: unknown[]
  ) {
    const [request, ...rest] = resolveArgs;
    if (typeof request !== 'string') {
      return origResolve.apply(this, resolveArgs);
    }
    if (request === 'electron') return '__electron_headless_shim__';
    if (request === 'electron-log/main' || request === 'electron-log') return '__electron_log_headless_shim__';
    if (request.startsWith('@shared/')) {
      return origResolve.call(this, path.join(srcDir, 'shared', request.slice('@shared/'.length)), ...rest);
    }
    return origResolve.call(this, request, ...rest);
  };

  require.cache['__electron_headless_shim__'] = {
    id: '__electron_headless_shim__',
    filename: '__electron_headless_shim__',
    loaded: true,
    exports: electronShim,
    path: '',
    paths: [],
    children: [],
    parent: null,
    require: require,
    isPreloading: false,
  } as unknown as NodeModule;

  require.cache['__electron_log_headless_shim__'] = {
    id: '__electron_log_headless_shim__',
    filename: '__electron_log_headless_shim__',
    loaded: true,
    exports: electronLogShim,
    path: '',
    paths: [],
    children: [],
    parent: null,
    require: require,
    isPreloading: false,
  } as unknown as NodeModule;
}

function resolveSystemNativeBinding(
  existsSync: (candidate: fs.PathLike) => boolean = fs.existsSync,
): string | undefined {
  const betterSqlite3Dir = path.dirname(require.resolve('better-sqlite3/package.json'));
  const systemBinary = path.join(betterSqlite3Dir, 'better_sqlite3.system.node');
  return existsSync(systemBinary) ? systemBinary : undefined;
}

export const HeadlessBootstrap = {
  async init(): Promise<void> {
    if (initialized) return;

    installElectronShim();

    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`HeadlessBootstrap: database not found at ${dbPath}. Set STRATCRAFT_DB_PATH or STRATCRAFT_USER_DATA.`);
    }

    const { getDatabaseManager } = await import('../main/database/db-manager');
    const dbManager = getDatabaseManager({
      filename: dbPath,
      nativeBinding: resolveSystemNativeBinding(),
    });
    await dbManager.initialize();

    const { initializeDataProviderManager } = await import('../main/services/data-providers/provider-manager');
    initializeDataProviderManager();

    const { initializeDataCacheManager } = await import('../main/services/data-cache-manager');
    await initializeDataCacheManager();

    const { initializeDataStorageService } = await import('../main/services/data-storage-service');
    initializeDataStorageService();

    const { initializeAuthService } = await import('../main/services/auth-service');
    await initializeAuthService();

    // TICKET_1304_15: the headless Service API executes the same signed
    // commercial operation owner as Electron. Initialize the same centralized
    // tier resolver and entitlement-cache projection before that owner can be
    // activated; otherwise the headless role would silently resolve every
    // package at the unauthenticated fallback tier.
    const { initializeEntitlementEnforcer } = await import(
      '../main/services/entitlement-enforcer'
    );
    await initializeEntitlementEnforcer();
    const { initializeEntitlementSyncService } = await import(
      '../main/services/entitlement-sync-service'
    );
    initializeEntitlementSyncService();

    initialized = true;
  },

  isInitialized(): boolean {
    return initialized;
  },

  resolveDbPath,
  resolveUserData,
  resolveAppPath,
  resolveResourcesPath,
  initializeProcessResourcesPath,
  resolveSystemNativeBinding,
};
