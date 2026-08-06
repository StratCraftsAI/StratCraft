/**
 * TICKET_634_2: Preload Security Boundary Tests
 *
 * Tests the preload layer (Electron context isolation boundary).
 * Validates: API surface, IPC channel safety, security invariants, event cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Mock electron module BEFORE importing preload
// =============================================================================

const mockInvoke = vi.fn().mockResolvedValue(undefined);
const mockSend = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();

let exposedApiName: string | undefined;
let exposedApi: Record<string, unknown> | undefined;

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mockInvoke,
    send: mockSend,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
  contextBridge: {
    exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
      exposedApiName = name;
      exposedApi = api;
    },
  },
}));

// Import preload to trigger contextBridge.exposeInMainWorld
beforeEach(() => {
  vi.resetModules();
  exposedApiName = undefined;
  exposedApi = undefined;
  mockInvoke.mockReset().mockResolvedValue(undefined);
  mockSend.mockReset();
  mockOn.mockReset();
  mockRemoveListener.mockReset();
});

async function loadPreload(): Promise<Record<string, unknown>> {
  await import('../index');
  if (!exposedApi) {
    throw new Error('contextBridge.exposeInMainWorld was not called');
  }
  return exposedApi;
}

// =============================================================================
// 1. API Surface Verification
// =============================================================================

describe('Preload API Surface', () => {
  it('should expose API under "electronAPI" name', async () => {
    await loadPreload();
    expect(exposedApiName).toBe('electronAPI');
  });

  it('should expose all required top-level namespaces', async () => {
    const api = await loadPreload();

    const requiredNamespaces = [
      'extensionBridge',
      'version',
      'platform',
      'versions',
      'window',
      'app',
      'server',
      'strategy',
      'data',
      'file',
      'plugin',
      'pluginProcess',
      'credential',
      'ui',
      'config',
      'marketplace',
      'entitlement',
      'locale',
      'auth',
      'inlineAuth',
      'hub',
      'kronos',
      'kronosPrice',
      'conversation',
      'message',
      'database',
      'executor',
      'factor',
      'persona',
      'credit',
      'algorithm',
      'batchGeneration',
      'workspaceSync',
      'audit',
      'diagnostics',
      'consent',
      'databaseBackup',
      'recycleBin',
      'onboarding',
      'cppToolchain',
      'distribution',
      'startupAudit',
    ];

    for (const ns of requiredNamespaces) {
      expect(api).toHaveProperty(ns);
    }
  });

  it('exposes no named commercial command inventory', async () => {
    const api = await loadPreload();
    const commercialNamespaces = [
      'researchWorker',
      'factorCatalog',
      'factorFormula',
      'factorEngine',
      'signalDiscovery',
      'signalSource',
      'alphaFactory',
      'scoreboard',
      'roster',
      'lstmModel',
      'lstmTraining',
      'promotion',
    ];
    for (const namespace of commercialNamespaces) {
      expect(api).not.toHaveProperty(namespace);
    }
  });

  it('should expose API version string', async () => {
    const api = await loadPreload();
    expect(typeof api.version).toBe('string');
    expect(api.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should expose platform as string', async () => {
    const api = await loadPreload();
    expect(typeof api.platform).toBe('string');
  });

  it('should expose versions object with electron, node, chrome', async () => {
    const api = await loadPreload();
    const versions = api.versions as Record<string, unknown>;
    expect(versions).toHaveProperty('electron');
    expect(versions).toHaveProperty('node');
    expect(versions).toHaveProperty('chrome');
  });

  it('window namespace should have minimize, maximize, close, isMaximized', async () => {
    const api = await loadPreload();
    const win = api.window as Record<string, unknown>;
    expect(typeof win.minimize).toBe('function');
    expect(typeof win.maximize).toBe('function');
    expect(typeof win.close).toBe('function');
    expect(typeof win.isMaximized).toBe('function');
  });

  it('strategy namespace should have CRUD + generation methods', async () => {
    const api = await loadPreload();
    const strategy = api.strategy as Record<string, unknown>;
    expect(typeof strategy.list).toBe('function');
    expect(typeof strategy.get).toBe('function');
    expect(typeof strategy.save).toBe('function');
    expect(typeof strategy.delete).toBe('function');
    expect(typeof strategy.generate).toBe('function');
    expect(typeof strategy.cancel).toBe('function');
    expect(typeof strategy.onProgress).toBe('function');
    expect(typeof strategy.onComplete).toBe('function');
    expect(typeof strategy.onError).toBe('function');
  });

  it('data namespace should have ensure, search, provider methods', async () => {
    const api = await loadPreload();
    const data = api.data as Record<string, unknown>;
    expect(typeof data.ensure).toBe('function');
    expect(typeof data.ensureMultiTimeframe).toBe('function');
    expect(typeof data.checkCoverage).toBe('function');
    expect(typeof data.searchSymbols).toBe('function');
    expect(typeof data.checkConnection).toBe('function');
    expect(typeof data.getProviderList).toBe('function');
    expect(typeof data.listProviders).toBe('function');
    expect(typeof data.cancelDownload).toBe('function');
  });

  it('credential namespace should have CRUD + security methods', async () => {
    const api = await loadPreload();
    const cred = api.credential as Record<string, unknown>;
    expect(typeof cred.get).toBe('function');
    expect(typeof cred.set).toBe('function');
    expect(typeof cred.delete).toBe('function');
    expect(typeof cred.has).toBe('function');
    expect(typeof cred.list).toBe('function');
    expect(typeof cred.validateUser).toBe('function');
    expect(typeof cred.setMasterPassword).toBe('function');
    expect(typeof cred.executeWith).toBe('function');
    expect(typeof cred.getAuditLog).toBe('function');
    expect(typeof cred.validateApiKey).toBe('function');
  });

  it('executor namespace should have runBacktest, cancelBacktest, getQueueStatus methods', async () => {
    const api = await loadPreload();
    const exec = api.executor as Record<string, unknown>;
    expect(typeof exec.runBacktest).toBe('function');
    expect(typeof exec.cancelBacktest).toBe('function');
    expect(typeof exec.getQueueStatus).toBe('function');
    expect(typeof exec.registerTask).toBe('function');
  });

  it('auth namespace should have login, logout, getState methods', async () => {
    const api = await loadPreload();
    const auth = api.auth as Record<string, unknown>;
    expect(typeof auth.login).toBe('function');
    expect(typeof auth.logout).toBe('function');
    expect(typeof auth.getState).toBe('function');
    expect(typeof auth.refresh).toBe('function');
  });

  it('distribution namespace should have getDistribution, isPublicRelease', async () => {
    const api = await loadPreload();
    const distribution = api.distribution as Record<string, unknown>;
    expect(typeof distribution.getDistribution).toBe('function');
    expect(typeof distribution.isPublicRelease).toBe('function');
  });
});

// =============================================================================
// 2. IPC Channel Safety
// =============================================================================

describe('Preload IPC Channel Safety', () => {
  it('should not expose raw ipcRenderer object', async () => {
    const api = await loadPreload();
    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api).not.toHaveProperty('_ipcRenderer');

    // Deep check: no nested property should be the ipcRenderer itself
    const checkNoIpcRenderer = (obj: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const nested = value as Record<string, unknown>;
          // ipcRenderer would have invoke, send, on, removeListener
          const hasAll =
            typeof nested.invoke === 'function' &&
            typeof nested.send === 'function' &&
            typeof nested.on === 'function' &&
            typeof nested.removeListener === 'function';
          expect(hasAll).toBe(false);
          checkNoIpcRenderer(nested, `${path}.${key}`);
        }
      }
    };
    checkNoIpcRenderer(api, 'api');
  });

  it('all invoke calls should use colon-namespaced channel format', async () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );

    // Extract all ipcRenderer.invoke channel names
    const invokeChannels = [
      ...preloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g),
    ].map((m) => m[1]);

    expect(invokeChannels.length).toBeGreaterThan(0);

    for (const channel of invokeChannels) {
      // All channels should use colon-separated namespacing (namespace:action or namespace:sub:action)
      expect(channel).toMatch(
        /^[a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z][a-zA-Z0-9-]*/
      );
    }
  });

  it('all send calls should use colon-namespaced channel format', async () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );

    const sendChannels = [
      ...preloadSource.matchAll(/ipcRenderer\.send\('([^']+)'/g),
    ].map((m) => m[1]);

    expect(sendChannels.length).toBeGreaterThan(0);

    // Known exceptions: 'log' is a legacy channel without namespace
    const exceptions = ['log'];
    for (const channel of sendChannels) {
      if (exceptions.includes(channel)) continue;
      expect(channel).toMatch(
        /^[a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z][a-zA-Z0-9-]*/
      );
    }
  });

  it('window.minimize should invoke correct IPC channel', async () => {
    const api = await loadPreload();
    const win = api.window as Record<string, (...args: unknown[]) => unknown>;
    await win.minimize();
    expect(mockInvoke).toHaveBeenCalledWith('window:minimize');
  });

  it('strategy.list should invoke correct IPC channel', async () => {
    const api = await loadPreload();
    const strategy = api.strategy as Record<string, (...args: unknown[]) => unknown>;
    await strategy.list();
    expect(mockInvoke).toHaveBeenCalledWith('strategy:list');
  });

  it('strategy.get should pass id parameter', async () => {
    const api = await loadPreload();
    const strategy = api.strategy as Record<string, (...args: unknown[]) => unknown>;
    await strategy.get('test-id');
    expect(mockInvoke).toHaveBeenCalledWith('strategy:get', 'test-id');
  });

  it('credential.get should pass pluginId and key', async () => {
    const api = await loadPreload();
    const cred = api.credential as Record<string, (...args: unknown[]) => unknown>;
    await cred.get('plugin-1', 'api-key');
    expect(mockInvoke).toHaveBeenCalledWith('credential:get', 'plugin-1', 'api-key');
  });

  it('data.cancelDownload should use send (fire-and-forget)', async () => {
    const api = await loadPreload();
    const data = api.data as Record<string, (...args: unknown[]) => unknown>;
    data.cancelDownload();
    expect(mockSend).toHaveBeenCalledWith('data:cancelDownload');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. Security Invariants
// =============================================================================

describe('Preload Security Invariants', () => {
  it('should not expose Node.js require function', async () => {
    const api = await loadPreload();
    expect(api).not.toHaveProperty('require');
    expect(api).not.toHaveProperty('__require');
  });

  it('should not expose Node.js process object (only safe properties)', async () => {
    const api = await loadPreload();
    // process should not be exposed directly
    expect(api).not.toHaveProperty('process');

    // platform is exposed as a string (safe), not the process object
    expect(typeof api.platform).toBe('string');
  });

  it('should not expose Node.js module system', async () => {
    const api = await loadPreload();
    expect(api).not.toHaveProperty('module');
    expect(api).not.toHaveProperty('exports');
    expect(api).not.toHaveProperty('__dirname');
    expect(api).not.toHaveProperty('__filename');
  });

  it('should not expose dangerous Node.js APIs', async () => {
    const api = await loadPreload();
    const dangerousApis = [
      'fs',
      'child_process',
      'net',
      'http',
      'https',
      'os',
      'crypto',
      'cluster',
      'dgram',
      'dns',
      'tls',
      'vm',
      'worker_threads',
    ];

    for (const dangerous of dangerousApis) {
      expect(api).not.toHaveProperty(dangerous);
    }
  });

  it('should not expose eval or Function constructor', async () => {
    const api = await loadPreload();
    expect(api).not.toHaveProperty('eval');
    expect(api).not.toHaveProperty('Function');
  });

  it('source code should not contain eval() calls', async () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );

    // Check for eval() usage (but allow 'eval' in comments/strings)
    const evalCalls = preloadSource.match(/[^a-zA-Z]eval\s*\(/g);
    expect(evalCalls).toBeNull();
  });

  it('source code should not use new Function()', async () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );

    const funcCalls = preloadSource.match(/new\s+Function\s*\(/g);
    expect(funcCalls).toBeNull();
  });

  it('should not expose contextBridge directly', async () => {
    const api = await loadPreload();
    expect(api).not.toHaveProperty('contextBridge');
  });

  it('file.read should only accept path parameter (no arbitrary code execution)', async () => {
    const api = await loadPreload();
    const file = api.file as Record<string, (...args: unknown[]) => unknown>;
    await file.read('/test/path.txt');
    expect(mockInvoke).toHaveBeenCalledWith('file:read', '/test/path.txt');
  });
});

// =============================================================================
// 4. Event Subscription Cleanup
// =============================================================================

describe('Preload Event Subscription Cleanup', () => {
  it('server.onStatusChange should return cleanup function', async () => {
    const api = await loadPreload();
    const server = api.server as Record<string, (...args: unknown[]) => unknown>;
    const callback = vi.fn();
    const cleanup = server.onStatusChange(callback);

    expect(typeof cleanup).toBe('function');
    expect(mockOn).toHaveBeenCalledWith('server:status', expect.any(Function));

    // Call cleanup
    (cleanup as () => void)();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      'server:status',
      expect.any(Function)
    );
  });

  it('strategy.onProgress should return cleanup function', async () => {
    const api = await loadPreload();
    const strategy = api.strategy as Record<string, (...args: unknown[]) => unknown>;
    const callback = vi.fn();
    const cleanup = strategy.onProgress(callback);

    expect(typeof cleanup).toBe('function');
    expect(mockOn).toHaveBeenCalledWith('strategy:progress', expect.any(Function));

    (cleanup as () => void)();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      'strategy:progress',
      expect.any(Function)
    );
  });

  it('data.onProviderStatus should return cleanup function', async () => {
    const api = await loadPreload();
    const data = api.data as Record<string, (...args: unknown[]) => unknown>;
    const callback = vi.fn();
    const cleanup = data.onProviderStatus(callback);

    expect(typeof cleanup).toBe('function');
    expect(mockOn).toHaveBeenCalledWith('data:providerStatus', expect.any(Function));

    (cleanup as () => void)();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      'data:providerStatus',
      expect.any(Function)
    );
  });

  it('credential.onKeychainUnavailable should return cleanup function', async () => {
    const api = await loadPreload();
    const cred = api.credential as Record<string, (...args: unknown[]) => unknown>;
    const callback = vi.fn();
    const cleanup = cred.onKeychainUnavailable(callback);

    expect(typeof cleanup).toBe('function');
    expect(mockOn).toHaveBeenCalledWith(
      'security:keychain-unavailable',
      expect.any(Function)
    );

    (cleanup as () => void)();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      'security:keychain-unavailable',
      expect.any(Function)
    );
  });

  it('all on* methods should return cleanup functions', async () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );

    // Every ipcRenderer.on() should have a corresponding removeListener
    const onCalls = [
      ...preloadSource.matchAll(/ipcRenderer\.on\('([^']+)'/g),
    ].map((m) => m[1]);

    const removeListenerCalls = [
      ...preloadSource.matchAll(/ipcRenderer\.removeListener\('([^']+)'/g),
    ].map((m) => m[1]);

    // Every channel subscribed should have a matching unsubscribe
    for (const channel of onCalls) {
      expect(removeListenerCalls).toContain(channel);
    }
  });

  it('cleanup function should remove the exact same handler reference', async () => {
    const api = await loadPreload();
    const server = api.server as Record<string, (...args: unknown[]) => unknown>;
    const callback = vi.fn();
    server.onStatusChange(callback);

    const registeredHandler = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === 'server:status'
    )?.[1];

    const cleanup = server.onStatusChange(callback) as () => void;
    const registeredHandler2 = mockOn.mock.calls.find(
      (_c: unknown[], i: number) =>
        i > 0 && mockOn.mock.calls[i][0] === 'server:status'
    )?.[1];

    cleanup();

    // The removeListener should be called with the same handler reference
    const removedHandler = mockRemoveListener.mock.calls.find(
      (c: unknown[]) => c[0] === 'server:status'
    )?.[1];

    expect(removedHandler).toBe(registeredHandler2 || registeredHandler);
  });
});

// =============================================================================
// 5. Source Code Static Analysis
// =============================================================================

describe('Preload Source Code Analysis', () => {
  let preloadSource: string;

  beforeEach(() => {
    preloadSource = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8'
    );
  });

  it('should only import from electron module', () => {
    const imports = [...preloadSource.matchAll(/^import\s+.*from\s+'([^']+)'/gm)].map(
      (m) => m[1]
    );

    const allowedImports = ['electron', '../shared/constants/channels'];
    // Type-only imports are safe (compile-time only)
    const runtimeImports = imports.filter((imp) => {
      const line = preloadSource
        .split('\n')
        .find((l) => l.includes(`from '${imp}'`));
      return line && !line.includes('import type');
    });

    for (const imp of runtimeImports) {
      expect(allowedImports).toContain(imp);
    }
  });

  it('should call contextBridge.exposeInMainWorld exactly once', () => {
    const exposeCalls = preloadSource.match(
      /contextBridge\.exposeInMainWorld/g
    );
    expect(exposeCalls).toHaveLength(1);
  });

  it('should not use ipcRenderer.sendSync (blocks renderer)', () => {
    const syncCalls = preloadSource.match(/ipcRenderer\.sendSync/g);
    expect(syncCalls).toBeNull();
  });

  it('should not expose nodeIntegration or remote module', () => {
    expect(preloadSource).not.toContain('nodeIntegration');
    expect(preloadSource).not.toContain('@electron/remote');
    expect(preloadSource).not.toContain('enableRemoteModule');
  });

  it('should have consistent on/removeListener pairs', () => {
    // Count on() and removeListener() calls - they should match
    const onCount = (preloadSource.match(/ipcRenderer\.on\(/g) || []).length;
    const removeCount = (
      preloadSource.match(/ipcRenderer\.removeListener\(/g) || []
    ).length;

    // pluginPort.listen owns one process-lifetime listener; every subscription
    // exposed to renderer callers must return a matching removal path.
    expect(removeCount).toBe(onCount - 1);
  });

  it('should not contain console.log calls (use IPC logging)', () => {
    // Remove comments before checking
    const codeOnly = preloadSource
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const consoleLogs = codeOnly.match(/console\.(log|warn|error|debug)\s*\(/g);
    expect(consoleLogs).toBeNull();
  });
});

// =============================================================================
// 6. Namespace Method Completeness (Smoke Tests)
// =============================================================================

describe('Preload Namespace Smoke Tests', () => {
  it('file namespace should have openDialog, saveDialog, read, write', async () => {
    const api = await loadPreload();
    const file = api.file as Record<string, unknown>;
    expect(typeof file.openDialog).toBe('function');
    expect(typeof file.saveDialog).toBe('function');
    expect(typeof file.read).toBe('function');
    expect(typeof file.write).toBe('function');
  });

  it('plugin namespace should have getPaths, scanAll, getManifest, getConfig, setConfig', async () => {
    const api = await loadPreload();
    const plugin = api.plugin as Record<string, unknown>;
    expect(typeof plugin.getPaths).toBe('function');
    expect(typeof plugin.scanAll).toBe('function');
    expect(typeof plugin.getManifest).toBe('function');
    expect(typeof plugin.getConfig).toBe('function');
    expect(typeof plugin.setConfig).toBe('function');
    expect(typeof plugin.isInstalled).toBe('function');
    // TICKET_1004: new registry-backed status queries
    expect(typeof plugin.getStatus).toBe('function');
    expect(typeof plugin.getAllStatus).toBe('function');
  });

  it('pluginProcess namespace should have activate, deactivate, getStatus, onPort', async () => {
    const api = await loadPreload();
    const pp = api.pluginProcess as Record<string, unknown>;
    expect(typeof pp.activate).toBe('function');
    expect(typeof pp.deactivate).toBe('function');
    expect(typeof pp.getStatus).toBe('function');
    expect(typeof pp.onPort).toBe('function');
  });

  it('marketplace namespace should have expected methods', async () => {
    const api = await loadPreload();
    const mp = api.marketplace as Record<string, unknown>;
    expect(typeof mp.getRegistry).toBe('function');
    expect(typeof mp.install).toBe('function');
    expect(typeof mp.uninstall).toBe('function');
    expect(typeof mp.getPluginDetails).toBe('function');
    expect(typeof mp.checkUpdates).toBe('function');
  });

  it('conversation namespace should have CRUD methods', async () => {
    const api = await loadPreload();
    const conv = api.conversation as Record<string, unknown>;
    expect(typeof conv.list).toBe('function');
    expect(typeof conv.get).toBe('function');
    expect(typeof conv.create).toBe('function');
    expect(typeof conv.delete).toBe('function');
  });

  it('database namespace should have getAlgorithms method', async () => {
    const api = await loadPreload();
    const db = api.database as Record<string, unknown>;
    expect(typeof db.getAlgorithms).toBe('function');
  });

  it('databaseBackup namespace should have backup, restore, listBackups methods', async () => {
    const api = await loadPreload();
    const backup = api.databaseBackup as Record<string, unknown>;
    expect(typeof backup.backup).toBe('function');
    expect(typeof backup.restore).toBe('function');
    expect(typeof backup.listBackups).toBe('function');
  });

  it('recycleBin namespace should have listDeleted, restore, purge methods', async () => {
    const api = await loadPreload();
    const rb = api.recycleBin as Record<string, unknown>;
    expect(typeof rb.listDeleted).toBe('function');
    expect(typeof rb.restore).toBe('function');
    expect(typeof rb.purge).toBe('function');
  });

  it('consent namespace should have get and set methods', async () => {
    const api = await loadPreload();
    const consent = api.consent as Record<string, unknown>;
    expect(typeof consent.getStatus).toBe('function');
    expect(typeof consent.setConsent).toBe('function');
  });
});
