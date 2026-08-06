/**
 * TICKET_634 Phase 3: Preload API Function Coverage Tests
 *
 * Invokes every function exposed via contextBridge to achieve function coverage.
 * Each function is called to verify it correctly delegates to ipcRenderer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock electron module BEFORE importing preload
// =============================================================================

const mockInvoke = vi.fn().mockResolvedValue(undefined);
const mockSend = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();

let exposedApi: Record<string, any> | undefined;

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mockInvoke,
    send: mockSend,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, any>) => {
      exposedApi = api;
    },
  },
}));

// Helper to load preload fresh
async function loadPreload(): Promise<Record<string, any>> {
  await import('../index');
  if (!exposedApi) {
    throw new Error('contextBridge.exposeInMainWorld was not called');
  }
  return exposedApi;
}

// Helper to get nested namespace
function ns(api: Record<string, any>, path: string): any {
  return path.split('.').reduce((obj, key) => obj[key], api);
}

beforeEach(() => {
  vi.resetModules();
  exposedApi = undefined;
  mockInvoke.mockReset().mockResolvedValue(undefined);
  mockSend.mockReset();
  mockOn.mockReset();
  mockRemoveListener.mockReset();
});

describe('extensionBridge namespace', () => {
  it('invokes only the generic capability and command channels', async () => {
    const api = await loadPreload();
    const capability = { contractVersion: '1.0.0', extensionId: 'example.extension', command: 'status' };
    const invocation = {
      contractVersion: '1.0.0',
      extensionId: 'example.extension',
      requestId: 'request-1',
      command: 'execute',
      input: {},
    };
    await api.extensionBridge.getCapability(capability);
    await api.extensionBridge.invoke(invocation);
    expect(mockInvoke).toHaveBeenCalledWith('extension-bridge:capability', capability);
    expect(mockInvoke).toHaveBeenCalledWith('extension-bridge:invoke', invocation);
  });

  it('subscribes and removes the generic event listener', async () => {
    const api = await loadPreload();
    const callback = vi.fn();
    const unsubscribe = api.extensionBridge.onEvent(callback);
    const handler = mockOn.mock.calls.find((call) => call[0] === 'extension-bridge:event')?.[1];
    const event = {
      contractVersion: '1.0.0',
      extensionId: 'example.extension',
      event: 'progress',
      payload: {},
    };
    handler({}, event);
    expect(callback).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalledWith('extension-bridge:event', handler);
  });
});

describe('dataProviderDefaults namespace', () => {
  it('gets, sets, subscribes, forwards changes, and unsubscribes', async () => {
    const api = await loadPreload();
    await api.dataProviderDefaults.get();
    await api.dataProviderDefaults.set('us_equity', 'alpaca');
    const callback = vi.fn();
    const unsubscribe = api.dataProviderDefaults.onChanged(callback);
    expect(mockInvoke).toHaveBeenCalledWith('dataProviderDefaults:get');
    expect(mockInvoke).toHaveBeenCalledWith(
      'dataProviderDefaults:set',
      'us_equity',
      'alpaca',
    );
    const handler = mockOn.mock.calls.find(
      call => call[0] === 'dataProviderDefaults:changed',
    )?.[1];
    handler({}, { us_equity: 'polygon' });
    expect(callback).toHaveBeenCalledWith({ us_equity: 'polygon' });
    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      'dataProviderDefaults:changed',
      handler,
    );
  });
});

// =============================================================================
// Window namespace
// =============================================================================
describe('window namespace', () => {
  it('minimize calls invoke', async () => {
    const api = await loadPreload();
    await api.window.minimize();
    expect(mockInvoke).toHaveBeenCalledWith('window:minimize');
  });

  it('maximize calls invoke', async () => {
    const api = await loadPreload();
    await api.window.maximize();
    expect(mockInvoke).toHaveBeenCalledWith('window:maximize');
  });

  it('close calls send', async () => {
    const api = await loadPreload();
    api.window.close();
    expect(mockSend).toHaveBeenCalledWith('window:close');
  });

  it('isMaximized calls invoke', async () => {
    const api = await loadPreload();
    await api.window.isMaximized();
    expect(mockInvoke).toHaveBeenCalledWith('window:isMaximized');
  });
});

// =============================================================================
// App namespace
// =============================================================================
describe('app namespace', () => {
  it('getVersion calls invoke', async () => {
    const api = await loadPreload();
    await api.app.getVersion();
    expect(mockInvoke).toHaveBeenCalledWith('app:version');
  });

  it('getPath calls invoke', async () => {
    const api = await loadPreload();
    await api.app.getPath();
    expect(mockInvoke).toHaveBeenCalledWith('app:path');
  });
});

describe('server namespace', () => {
  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.server.getStatus();
    expect(mockInvoke).toHaveBeenCalledWith('server:status');
  });

  it('onStatusChange subscribes and returns unsubscribe', async () => {
    const api = await loadPreload();
    const cb = vi.fn();
    const unsub = api.server.onStatusChange(cb);
    expect(mockOn).toHaveBeenCalledWith('server:status', expect.any(Function));
    expect(typeof unsub).toBe('function');
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith('server:status', expect.any(Function));
  });

  it('onError subscribes and returns unsubscribe', async () => {
    const api = await loadPreload();
    const cb = vi.fn();
    const unsub = api.server.onError(cb);
    expect(mockOn).toHaveBeenCalledWith('server:error', expect.any(Function));
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith('server:error', expect.any(Function));
  });
});

// =============================================================================
// Strategy namespace
// =============================================================================
describe('strategy namespace', () => {
  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.strategy.list();
    expect(mockInvoke).toHaveBeenCalledWith('strategy:list');
  });

  it('get calls invoke with id', async () => {
    const api = await loadPreload();
    await api.strategy.get('s1');
    expect(mockInvoke).toHaveBeenCalledWith('strategy:get', 's1');
  });

  it('save calls invoke with data', async () => {
    const api = await loadPreload();
    await api.strategy.save({ name: 'test' });
    expect(mockInvoke).toHaveBeenCalledWith('strategy:save', { name: 'test' });
  });

  it('delete calls invoke with id', async () => {
    const api = await loadPreload();
    await api.strategy.delete('s1');
    expect(mockInvoke).toHaveBeenCalledWith('strategy:delete', 's1');
  });

  it('generate calls invoke with config', async () => {
    const api = await loadPreload();
    await api.strategy.generate({ prompt: 'test' });
    expect(mockInvoke).toHaveBeenCalledWith('strategy:generate', { prompt: 'test' });
  });

  it('cancel calls invoke with taskId', async () => {
    const api = await loadPreload();
    await api.strategy.cancel('t1');
    expect(mockInvoke).toHaveBeenCalledWith('strategy:cancel', 't1');
  });

  it('onProgress subscribes and unsubscribes', async () => {
    const api = await loadPreload();
    const cb = vi.fn();
    const unsub = api.strategy.onProgress(cb);
    expect(mockOn).toHaveBeenCalledWith('strategy:progress', expect.any(Function));
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith('strategy:progress', expect.any(Function));
  });

  it('onComplete subscribes and unsubscribes', async () => {
    const api = await loadPreload();
    const unsub = api.strategy.onComplete(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('strategy:complete', expect.any(Function));
    unsub();
  });

  it('onError subscribes and unsubscribes', async () => {
    const api = await loadPreload();
    const unsub = api.strategy.onError(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('strategy:error', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// Data namespace
// =============================================================================
describe('data namespace', () => {
  it('ensure calls invoke', async () => {
    const api = await loadPreload();
    const config = { symbol: 'AAPL', startDate: '2024-01-01', endDate: '2024-12-31', interval: '1d' };
    await api.data.ensure(config);
    expect(mockInvoke).toHaveBeenCalledWith('data:ensure', config);
  });

  it('ensureMultiTimeframe calls invoke', async () => {
    const api = await loadPreload();
    const config = { symbol: 'AAPL', startDate: '2024-01-01', endDate: '2024-12-31', timeframes: ['1d', '1h'] };
    await api.data.ensureMultiTimeframe(config);
    expect(mockInvoke).toHaveBeenCalledWith('data:ensureMultiTimeframe', config);
  });

  it('checkCoverage calls invoke', async () => {
    const api = await loadPreload();
    const config = { symbol: 'AAPL', startDate: '2024-01-01', endDate: '2024-12-31', interval: '1d' };
    await api.data.checkCoverage(config);
    expect(mockInvoke).toHaveBeenCalledWith('data:checkCoverage', config);
  });

  it('searchSymbols calls invoke', async () => {
    const api = await loadPreload();
    await api.data.searchSymbols('AAPL', 'yfinance');
    expect(mockInvoke).toHaveBeenCalledWith('data:searchSymbols', 'AAPL', 'yfinance');
  });

  it('checkConnection calls invoke', async () => {
    const api = await loadPreload();
    await api.data.checkConnection('yfinance');
    expect(mockInvoke).toHaveBeenCalledWith('data:checkConnection', 'yfinance');
  });

  it('getSymbolDateRange calls invoke', async () => {
    const api = await loadPreload();
    await api.data.getSymbolDateRange('AAPL', 'yfinance');
    expect(mockInvoke).toHaveBeenCalledWith('data:getSymbolDateRange', 'AAPL', 'yfinance');
  });

  it('getProviderList calls invoke', async () => {
    const api = await loadPreload();
    await api.data.getProviderList();
    expect(mockInvoke).toHaveBeenCalledWith('data:getProviderList');
  });

  it('listProviders calls invoke', async () => {
    const api = await loadPreload();
    await api.data.listProviders();
    expect(mockInvoke).toHaveBeenCalledWith('data:listProviders');
  });

  it('checkProvidersProgressive calls invoke', async () => {
    const api = await loadPreload();
    await api.data.checkProvidersProgressive();
    expect(mockInvoke).toHaveBeenCalledWith('data:checkProvidersProgressive');
  });

  it('onProviderStatus subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.data.onProviderStatus(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('data:providerStatus', expect.any(Function));
    unsub();
  });

  it('onProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.data.onProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('data:progress', expect.any(Function));
    unsub();
  });

  it('cancelDownload calls send', async () => {
    const api = await loadPreload();
    api.data.cancelDownload();
    expect(mockSend).toHaveBeenCalledWith('data:cancelDownload');
  });

  it('getCacheStats calls invoke', async () => {
    const api = await loadPreload();
    await api.data.getCacheStats();
    expect(mockInvoke).toHaveBeenCalledWith('data:getCacheStats');
  });

  it('listSegments calls invoke', async () => {
    const api = await loadPreload();
    await api.data.listSegments({ provider: 'yfinance' });
    expect(mockInvoke).toHaveBeenCalledWith('data:listSegments', { provider: 'yfinance' });
  });

  it('deleteSegments calls invoke', async () => {
    const api = await loadPreload();
    await api.data.deleteSegments([1, 2]);
    expect(mockInvoke).toHaveBeenCalledWith('data:deleteSegments', [1, 2]);
  });

  it('enqueueDownload calls invoke', async () => {
    const api = await loadPreload();
    const cfg = { symbol: 'AAPL', interval: '1d', startDate: '2024-01-01', endDate: '2024-12-31', provider: 'yfinance' };
    await api.data.enqueueDownload(cfg);
    expect(mockInvoke).toHaveBeenCalledWith('data:enqueueDownload', cfg);
  });

  it('cancelQueueTask calls invoke', async () => {
    const api = await loadPreload();
    await api.data.cancelQueueTask('t1');
    expect(mockInvoke).toHaveBeenCalledWith('data:cancelQueueTask', 't1');
  });

  it('getQueueStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.data.getQueueStatus();
    expect(mockInvoke).toHaveBeenCalledWith('data:getQueueStatus');
  });

  it('clearAll calls invoke', async () => {
    const api = await loadPreload();
    await api.data.clearAll();
    expect(mockInvoke).toHaveBeenCalledWith('data:clearAll');
  });

  it('onDownloadQueueProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.data.onDownloadQueueProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('data:download-queue-progress', expect.any(Function));
    unsub();
  });

  it('cancelImport calls invoke', async () => {
    const api = await loadPreload();
    await api.data.cancelImport('imp-1');
    expect(mockInvoke).toHaveBeenCalledWith('data:cancelImport', 'imp-1');
  });

  // TICKET_308_1a (Phase 7): imported-package list for the data-source picker.
  it('listImportedPackages calls invoke', async () => {
    const api = await loadPreload();
    await api.data.listImportedPackages();
    expect(mockInvoke).toHaveBeenCalledWith('data:listImportedPackages');
  });

  it('onImportProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.data.onImportProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('data:importProgress', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// File namespace
// =============================================================================
describe('file namespace', () => {
  it('openDialog calls invoke', async () => {
    const api = await loadPreload();
    await api.file.openDialog({ title: 'Open' });
    expect(mockInvoke).toHaveBeenCalledWith('file:openDialog', { title: 'Open' });
  });

  it('saveDialog calls invoke', async () => {
    const api = await loadPreload();
    await api.file.saveDialog({ title: 'Save' });
    expect(mockInvoke).toHaveBeenCalledWith('file:saveDialog', { title: 'Save' });
  });

  it('read calls invoke', async () => {
    const api = await loadPreload();
    await api.file.read('/tmp/test.txt');
    expect(mockInvoke).toHaveBeenCalledWith('file:read', '/tmp/test.txt');
  });

  it('write calls invoke', async () => {
    const api = await loadPreload();
    await api.file.write('/tmp/test.txt', 'data');
    expect(mockInvoke).toHaveBeenCalledWith('file:write', '/tmp/test.txt', 'data');
  });
});

// =============================================================================
// Plugin namespace
// =============================================================================
describe('plugin namespace', () => {
  it('getPaths calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.getPaths();
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getPaths');
  });

  it('scanAll calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.scanAll();
    expect(mockInvoke).toHaveBeenCalledWith('plugin:scanAll');
  });

  it('getDirectories calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.getDirectories('/plugins');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getDirectories', '/plugins');
  });

  it('readFile calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.readFile('/plugins/manifest.json');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:readFile', '/plugins/manifest.json');
  });

  it('getManifest calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.getManifest('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getManifest', 'com.test.plugin');
  });

  it('getConfig calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.getConfig('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getConfig', 'com.test.plugin');
  });

  it('setConfig calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.setConfig('com.test.plugin', 'key', 'value');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:setConfig', 'com.test.plugin', 'key', 'value');
  });

  it('isInstalled calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.isInstalled('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:isInstalled', 'com.test.plugin');
  });

  // TICKET_1004: New registry-backed status queries
  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.getStatus('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getStatus', 'com.test.plugin');
  });

  it('getAllStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.plugin.getAllStatus();
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getAllStatus');
  });
});

// =============================================================================
// PluginProcess namespace
// =============================================================================
describe('pluginProcess namespace', () => {
  it('activate calls invoke', async () => {
    const api = await loadPreload();
    await api.pluginProcess.activate('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:process:activate', 'com.test.plugin');
  });

  it('deactivate calls invoke', async () => {
    const api = await loadPreload();
    await api.pluginProcess.deactivate('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:process:deactivate', 'com.test.plugin');
  });

  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.pluginProcess.getStatus('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:process:getStatus', 'com.test.plugin');
  });

  it('onPort subscribes with plugin-specific channel', async () => {
    const api = await loadPreload();
    const unsub = api.pluginProcess.onPort('com.test.plugin', vi.fn());
    expect(mockOn).toHaveBeenCalledWith('plugin-port:com.test.plugin', expect.any(Function));
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith('plugin-port:com.test.plugin', expect.any(Function));
  });
});

// =============================================================================
// Legacy top-level plugin functions
// =============================================================================
describe('legacy top-level plugin functions', () => {
  it('getPluginDirectories calls invoke', async () => {
    const api = await loadPreload();
    await api.getPluginDirectories('/plugins');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:getDirectories', '/plugins');
  });

  it('readFile calls invoke', async () => {
    const api = await loadPreload();
    await api.readFile('/test.txt');
    expect(mockInvoke).toHaveBeenCalledWith('plugin:readFile', '/test.txt');
  });

  it('storeGet calls invoke', async () => {
    const api = await loadPreload();
    await api.storeGet('key');
    expect(mockInvoke).toHaveBeenCalledWith('store:get', 'key');
  });

  it('storeSet calls invoke', async () => {
    const api = await loadPreload();
    await api.storeSet('key', 'value');
    expect(mockInvoke).toHaveBeenCalledWith('store:set', 'key', 'value');
  });

  it('storeDelete calls invoke', async () => {
    const api = await loadPreload();
    await api.storeDelete('key');
    expect(mockInvoke).toHaveBeenCalledWith('store:delete', 'key');
  });

  it('storeKeys calls invoke', async () => {
    const api = await loadPreload();
    await api.storeKeys();
    expect(mockInvoke).toHaveBeenCalledWith('store:keys');
  });

  it('showNotification calls send', async () => {
    const api = await loadPreload();
    const opts = { message: 'hello', type: 'info' as const };
    api.showNotification(opts);
    expect(mockSend).toHaveBeenCalledWith('ui:notification', opts);
  });

  it('showDialog calls invoke', async () => {
    const api = await loadPreload();
    await api.showDialog({ title: 'Test', message: 'msg' });
    expect(mockInvoke).toHaveBeenCalledWith('ui:dialog', { title: 'Test', message: 'msg' });
  });

  it('showProgress calls send', async () => {
    const api = await loadPreload();
    api.showProgress({ id: 'p1', title: 'Loading' });
    expect(mockSend).toHaveBeenCalledWith('ui:progress:show', { id: 'p1', title: 'Loading' });
  });

  it('updateProgress calls send', async () => {
    const api = await loadPreload();
    api.updateProgress({ id: 'p1', progress: 50, message: 'half' });
    expect(mockSend).toHaveBeenCalledWith('ui:progress:update', { id: 'p1', progress: 50, message: 'half' });
  });

  it('hideProgress calls send', async () => {
    const api = await loadPreload();
    api.hideProgress('p1');
    expect(mockSend).toHaveBeenCalledWith('ui:progress:hide', 'p1');
  });

  it('getMarketData calls invoke', async () => {
    const api = await loadPreload();
    const params = { symbol: 'AAPL', interval: '1d', start: '2024-01-01', end: '2024-12-31' };
    await api.getMarketData(params);
    expect(mockInvoke).toHaveBeenCalledWith('market:getData', params);
  });

  it('getSymbols calls invoke', async () => {
    const api = await loadPreload();
    await api.getSymbols();
    expect(mockInvoke).toHaveBeenCalledWith('market:getSymbols');
  });

  it('does not expose the retired market subscription stub', async () => {
    const api = await loadPreload();
    expect('subscribeMarketData' in api).toBe(false);
  });

  it('log calls send', async () => {
    const api = await loadPreload();
    api.log('info', 'TEST', 'hello');
    expect(mockSend).toHaveBeenCalledWith('log', 'info', 'TEST', 'hello');
  });
});

// =============================================================================
// Credential namespace
// =============================================================================
describe('credential namespace', () => {
  it('get calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.get('pluginA', 'apiKey');
    expect(mockInvoke).toHaveBeenCalledWith('credential:get', 'pluginA', 'apiKey');
  });

  it('set calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.set('pluginA', 'apiKey', 'secret');
    expect(mockInvoke).toHaveBeenCalledWith('credential:set', 'pluginA', 'apiKey', 'secret');
  });

  it('delete calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.delete('pluginA', 'apiKey');
    expect(mockInvoke).toHaveBeenCalledWith('credential:delete', 'pluginA', 'apiKey');
  });

  it('has calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.has('pluginA', 'apiKey');
    expect(mockInvoke).toHaveBeenCalledWith('credential:has', 'pluginA', 'apiKey');
  });

  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.list('pluginA');
    expect(mockInvoke).toHaveBeenCalledWith('credential:list', 'pluginA');
  });

  it('validateUser calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.validateUser('password123');
    expect(mockInvoke).toHaveBeenCalledWith('credential:validateUser', 'password123');
  });

  it('setMasterPassword calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.setMasterPassword('password123');
    expect(mockInvoke).toHaveBeenCalledWith('credential:setMasterPassword', 'password123');
  });

  it('executeWith calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.executeWith('pluginA', 'apiKey', 'trade', '{}');
    expect(mockInvoke).toHaveBeenCalledWith('credential:executeWith', 'pluginA', 'apiKey', 'trade', '{}');
  });

  it('getAuditLog calls invoke', async () => {
    const api = await loadPreload();
    await api.credential.getAuditLog('pluginA', 50);
    expect(mockInvoke).toHaveBeenCalledWith('credential:getAuditLog', 'pluginA', 50);
  });

  it('lifecycle operations call their dedicated IPC channels', async () => {
    const api = await loadPreload();
    await api.credential.lifecycleStatus();
    await api.credential.resetUnreadable(true);
    await api.credential.replaceUnreadable(
      'host', 'llm.openai.apiKey', 'sk-new', { state: 'credential_auth_failed' }, true,
    );
    await api.credential.migrateLegacy();
    await api.credential.rotateMasterKey();
    await api.credential.exportRecoveryBundle('pass');
    await api.credential.exportBackupRecoveryBundle('backup.db', 'pass');
    await api.credential.importRecoveryBundle('YnVuZGxl', 'pass');
    expect(mockInvoke).toHaveBeenCalledWith('credential:lifecycleStatus');
    expect(mockInvoke).toHaveBeenCalledWith('credential:resetUnreadable', true);
    expect(mockInvoke).toHaveBeenCalledWith(
      'credential:replaceUnreadable',
      'host',
      'llm.openai.apiKey',
      'sk-new',
      { state: 'credential_auth_failed' },
      true,
    );
    expect(mockInvoke).toHaveBeenCalledWith('credential:migrateLegacy');
    expect(mockInvoke).toHaveBeenCalledWith('credential:rotateMasterKey');
    expect(mockInvoke).toHaveBeenCalledWith('credential:exportRecoveryBundle', 'pass');
    expect(mockInvoke).toHaveBeenCalledWith('credential:exportBackupRecoveryBundle', 'backup.db', 'pass');
    expect(mockInvoke).toHaveBeenCalledWith('credential:importRecoveryBundle', 'YnVuZGxl', 'pass');
  });

  it('validateApiKey calls invoke', async () => {
    const api = await loadPreload();
    // TICKET_1266: validateApiKey forwards an optional third `baseUrl` arg
    // (undefined for providers without a custom endpoint).
    await api.credential.validateApiKey('openai', 'sk-test');
    expect(mockInvoke).toHaveBeenCalledWith('credential:validateApiKey', 'openai', 'sk-test', undefined);
  });

  it('validateApiKey forwards a custom base URL (OPENAI_COMPATIBLE, TICKET_1266)', async () => {
    const api = await loadPreload();
    await api.credential.validateApiKey('OPENAI_COMPATIBLE', 'sk-relay', 'https://api.linoapi.com/v1');
    expect(mockInvoke).toHaveBeenCalledWith(
      'credential:validateApiKey', 'OPENAI_COMPATIBLE', 'sk-relay', 'https://api.linoapi.com/v1',
    );
  });

  it('onKeychainUnavailable subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.credential.onKeychainUnavailable(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('security:keychain-unavailable', expect.any(Function));
    unsub();
  });

  it('onT0Rejected subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.credential.onT0Rejected(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('security:t0-rejected', expect.any(Function));
    unsub();
  });

  it('onT1Warning subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.credential.onT1Warning(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('security:t1-warning', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// UI namespace
// =============================================================================
describe('ui namespace', () => {
  it('showPluginSettings calls invoke', async () => {
    const api = await loadPreload();
    await api.ui.showPluginSettings('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('ui:showPluginSettings', 'com.test.plugin');
  });

  it('onNavigateToSettings subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.ui.onNavigateToSettings(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('navigate-to-settings', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// Config namespace
// =============================================================================
describe('config namespace', () => {
  it('get calls invoke', async () => {
    const api = await loadPreload();
    await api.config.get('network.port');
    expect(mockInvoke).toHaveBeenCalledWith('config:get', 'network.port');
  });

  it('getAll calls invoke', async () => {
    const api = await loadPreload();
    await api.config.getAll();
    expect(mockInvoke).toHaveBeenCalledWith('config:getAll');
  });

  it('set calls invoke', async () => {
    const api = await loadPreload();
    await api.config.set('network.port', 3000);
    expect(mockInvoke).toHaveBeenCalledWith('config:set', 'network.port', 3000);
  });

  it('reload calls invoke', async () => {
    const api = await loadPreload();
    await api.config.reload();
    expect(mockInvoke).toHaveBeenCalledWith('config:reload');
  });

  it('detectOptimalBacktestTasks calls invoke', async () => {
    const api = await loadPreload();
    await api.config.detectOptimalBacktestTasks();
    expect(mockInvoke).toHaveBeenCalledWith('config:detectOptimalBacktestTasks');
  });

  it('validate calls invoke', async () => {
    const api = await loadPreload();
    await api.config.validate();
    expect(mockInvoke).toHaveBeenCalledWith('config:validate');
  });

  it('onChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.config.onChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('config:changed', expect.any(Function));
    unsub();
  });

  it('onReloaded subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.config.onReloaded(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('config:reloaded', expect.any(Function));
    unsub();
  });

});

// =============================================================================
// Marketplace namespace
// =============================================================================
describe('marketplace namespace', () => {
  it('getRegistry calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.getRegistry(true);
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:getRegistry', true);
  });

  it('getPluginDetails calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.getPluginDetails('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:getPluginDetails', 'com.test.plugin');
  });

  it('install calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.install('com.test.plugin', '1.0.0');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:install', 'com.test.plugin', '1.0.0');
  });

  it('uninstall calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.uninstall('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:uninstall', 'com.test.plugin');
  });

  it('checkUpdates calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.checkUpdates();
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:checkUpdates');
  });

  it('openPurchaseUrl calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.openPurchaseUrl('https://example.com');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:openPurchaseUrl', 'https://example.com');
  });

  it('validateLicense calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.validateLicense('com.test.plugin', 'LICENSE-KEY');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:validateLicense', 'com.test.plugin', 'LICENSE-KEY');
  });

  it('activateLicense calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.activateLicense('com.test.plugin', 'LICENSE-KEY');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:activateLicense', 'com.test.plugin', 'LICENSE-KEY');
  });

  it('getLicenseStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.getLicenseStatus(['plugin1', 'plugin2']);
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:getLicenseStatus', ['plugin1', 'plugin2']);
  });

  it('removeLicense calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.removeLicense('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:removeLicense', 'com.test.plugin');
  });

  it('onInstallProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.marketplace.onInstallProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('marketplace:installProgress', expect.any(Function));
    unsub();
  });

  it('onInstallComplete subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.marketplace.onInstallComplete(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('marketplace:installComplete', expect.any(Function));
    unsub();
  });

  it('onInstallError subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.marketplace.onInstallError(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('marketplace:installError', expect.any(Function));
    unsub();
  });

  it('onLicenseStatusChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.marketplace.onLicenseStatusChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('marketplace:licenseStatusChanged', expect.any(Function));
    unsub();
  });

  it('checkEntitlement calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.checkEntitlement('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:checkEntitlement', 'com.test.plugin');
  });

  it('checkEntitlementsBatch calls invoke', async () => {
    const api = await loadPreload();
    await api.marketplace.checkEntitlementsBatch(['plugin1', 'plugin2']);
    expect(mockInvoke).toHaveBeenCalledWith('marketplace:checkEntitlementsBatch', ['plugin1', 'plugin2']);
  });

  it('onEntitlementChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.marketplace.onEntitlementChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('marketplace:entitlementChanged', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// Entitlement namespace
// =============================================================================
describe('entitlement namespace', () => {
  it('getPluginEntitlements calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getPluginEntitlements('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getPluginEntitlements', 'com.test.plugin');
  });

  it('getAllEntitlements calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getAllEntitlements();
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getAllEntitlements');
  });

  it('getServiceState calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getServiceState('svc1');
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getServiceState', 'svc1');
  });

  it('isServiceEnabled calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.isServiceEnabled('com.test.plugin', 'svc1');
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:isServiceEnabled', 'com.test.plugin', 'svc1');
  });

  it('toggleService calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.toggleService('com.test.plugin', 'svc1', true);
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:toggleService', 'com.test.plugin', 'svc1', true);
  });

  it('getAuditLog calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getAuditLog(100);
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getAuditLog', 100);
  });

  it('onServiceToggled subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.entitlement.onServiceToggled(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('entitlement:serviceToggled', expect.any(Function));
    unsub();
  });

  it('onConnectionModeChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.entitlement.onConnectionModeChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('entitlement:connectionModeChanged', expect.any(Function));
    unsub();
  });

  it('onUserTierChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.entitlement.onUserTierChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('entitlement:userTierChanged', expect.any(Function));
    unsub();
  });

  it('canAccessLLMFeatures calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.canAccessLLMFeatures();
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:canAccessLLMFeatures', undefined);
  });

  it('getConfiguredBYOKProviders calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getConfiguredBYOKProviders();
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getConfiguredBYOKProviders');
  });

  it('getLLMProvidersWithStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getLLMProvidersWithStatus();
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getLLMProvidersWithStatus');
  });

  it('setLLMProviderValidationStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.setLLMProviderValidationStatus('openai', true);
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:setLLMProviderValidationStatus', 'openai', true);
  });

  it('onLLMProviderStatusChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.entitlement.onLLMProviderStatusChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('entitlement:llmProviderStatusChanged', expect.any(Function));
    unsub();
  });

  it('onLLMExternalStoreChanged subscribes and unsubscribes (TICKET_1276 AC7)', async () => {
    const api = await loadPreload();
    const unsub = api.entitlement.onLLMExternalStoreChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('llm:externalStoreChanged', expect.any(Function));
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith('llm:externalStoreChanged', expect.any(Function));
  });

  it('resolveLLMApiKey calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.resolveLLMApiKey('openai');
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:resolveLLMApiKey', 'openai');
  });

  it('getPluginOwnership calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getPluginOwnership('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getPluginOwnership', 'com.test.plugin');
  });

  it('checkPluginAdmission calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.checkPluginAdmission('com.test.plugin');
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:checkPluginAdmission', 'com.test.plugin');
  });

  it('getEntitledPlugins calls invoke', async () => {
    const api = await loadPreload();
    await api.entitlement.getEntitledPlugins();
    expect(mockInvoke).toHaveBeenCalledWith('entitlement:getEntitledPlugins');
  });
});

// =============================================================================
// LLM Catalog namespace (TICKET_646 Phase 3)
// =============================================================================
describe('llmCatalog namespace', () => {
  it('getProviders calls invoke with llm-catalog:getProviders', async () => {
    const api = await loadPreload();
    await api.llmCatalog.getProviders();
    expect(mockInvoke).toHaveBeenCalledWith('llm-catalog:getProviders');
  });

  it('getModels without args calls invoke with undefined providerId', async () => {
    const api = await loadPreload();
    await api.llmCatalog.getModels();
    expect(mockInvoke).toHaveBeenCalledWith('llm-catalog:getModels', undefined);
  });

  it('getModels with providerId forwards the argument', async () => {
    const api = await loadPreload();
    await api.llmCatalog.getModels('OPENAI');
    expect(mockInvoke).toHaveBeenCalledWith('llm-catalog:getModels', 'OPENAI');
  });

  it('refresh calls invoke with llm-catalog:refresh', async () => {
    const api = await loadPreload();
    await api.llmCatalog.refresh();
    expect(mockInvoke).toHaveBeenCalledWith('llm-catalog:refresh');
  });

  // TICKET_646 Phase 5: Snapshot/status surface
  it('getStatus calls invoke with llm-catalog:getStatus', async () => {
    const api = await loadPreload();
    await api.llmCatalog.getStatus();
    expect(mockInvoke).toHaveBeenCalledWith('llm-catalog:getStatus');
  });

  it('onStatusChanged subscribes to llm-catalog:onStatusChanged and returns unsubscribe', async () => {
    const api = await loadPreload();
    const callback = vi.fn();
    const unsub = api.llmCatalog.onStatusChanged(callback);
    expect(mockOn).toHaveBeenCalledWith('llm-catalog:onStatusChanged', expect.any(Function));
    expect(typeof unsub).toBe('function');
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith('llm-catalog:onStatusChanged', expect.any(Function));
  });

  it('onStatusChanged forwards status payload to the callback', async () => {
    const api = await loadPreload();
    const callback = vi.fn();
    api.llmCatalog.onStatusChanged(callback);

    // Capture the listener registered with ipcRenderer.on
    const [, registeredListener] = mockOn.mock.calls.find(
      ([event]) => event === 'llm-catalog:onStatusChanged'
    )!;

    const status = {
      source: 'snapshot' as const,
      snapshotTimestamp: 1700000000000,
      lastFetchAttempt: 1700000005000,
    };
    registeredListener({}, status);

    expect(callback).toHaveBeenCalledWith(status);
  });
});

// =============================================================================
// BYOK namespace (TICKET_646_1 Phase 3)
// =============================================================================
describe('byok namespace', () => {
  it('getModels calls invoke with providerId', async () => {
    const api = await loadPreload();
    await api.byok.getModels('OPENAI');
    expect(mockInvoke).toHaveBeenCalledWith('byok:getModels', 'OPENAI', undefined);
  });

  it('getModels passes forceRefresh flag', async () => {
    const api = await loadPreload();
    await api.byok.getModels('CLAUDE', true);
    expect(mockInvoke).toHaveBeenCalledWith('byok:getModels', 'CLAUDE', true);
  });

  it('getModels defaults forceRefresh to undefined when omitted', async () => {
    const api = await loadPreload();
    await api.byok.getModels('DEEPSEEK');
    expect(mockInvoke).toHaveBeenCalledWith('byok:getModels', 'DEEPSEEK', undefined);
  });
});

// =============================================================================
// Locale namespace
// =============================================================================
describe('locale namespace', () => {
  it('getInitial calls invoke', async () => {
    const api = await loadPreload();
    await api.locale.getInitial();
    expect(mockInvoke).toHaveBeenCalledWith('locale:getInitial');
  });

  it('setUser calls invoke', async () => {
    const api = await loadPreload();
    await api.locale.setUser('en-US');
    expect(mockInvoke).toHaveBeenCalledWith('locale:setUser', 'en-US');
  });

  it('getSupported calls invoke', async () => {
    const api = await loadPreload();
    await api.locale.getSupported();
    expect(mockInvoke).toHaveBeenCalledWith('locale:getSupported');
  });

  it('getSystem calls invoke', async () => {
    const api = await loadPreload();
    await api.locale.getSystem();
    expect(mockInvoke).toHaveBeenCalledWith('locale:getSystem');
  });
});

// =============================================================================
// Auth namespace
// =============================================================================
describe('auth namespace', () => {
  it('login calls invoke', async () => {
    const api = await loadPreload();
    await api.auth.login('google');
    expect(mockInvoke).toHaveBeenCalledWith('auth:login', 'google');
  });

  it('logout calls invoke', async () => {
    const api = await loadPreload();
    await api.auth.logout();
    expect(mockInvoke).toHaveBeenCalledWith('auth:logout');
  });

  it('refresh calls invoke', async () => {
    const api = await loadPreload();
    await api.auth.refresh();
    expect(mockInvoke).toHaveBeenCalledWith('auth:refresh');
  });

  it('getState calls invoke', async () => {
    const api = await loadPreload();
    await api.auth.getState();
    expect(mockInvoke).toHaveBeenCalledWith('auth:getState');
  });

  it('getUser calls invoke', async () => {
    const api = await loadPreload();
    await api.auth.getUser();
    expect(mockInvoke).toHaveBeenCalledWith('auth:getUser');
  });

  it('getAccessToken calls invoke', async () => {
    const api = await loadPreload();
    await api.auth.getAccessToken();
    expect(mockInvoke).toHaveBeenCalledWith('auth:getAccessToken');
  });

  it('onStateChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.auth.onStateChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('auth:stateChanged', expect.any(Function));
    unsub();
  });

  it('onError subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.auth.onError(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('auth:error', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// InlineAuth namespace
// =============================================================================
describe('inlineAuth namespace', () => {
  it('sendCode calls invoke', async () => {
    const api = await loadPreload();
    await api.inlineAuth.sendCode('test@example.com');
    expect(mockInvoke).toHaveBeenCalledWith('inlineAuth:sendCode', 'test@example.com');
  });

  it('loginWithPassword calls invoke', async () => {
    const api = await loadPreload();
    await api.inlineAuth.loginWithPassword('test@example.com', 'pass123');
    expect(mockInvoke).toHaveBeenCalledWith('inlineAuth:loginPassword', 'test@example.com', 'pass123');
  });

  it('verifyCode calls invoke', async () => {
    const api = await loadPreload();
    await api.inlineAuth.verifyCode('test@example.com', '123456');
    expect(mockInvoke).toHaveBeenCalledWith('inlineAuth:verifyCode', 'test@example.com', '123456');
  });
});

// =============================================================================
// Hub namespace
// =============================================================================
describe('hub namespace', () => {
  it('invokeEntity calls invoke with dynamic channel', async () => {
    const api = await loadPreload();
    await api.hub.invokeEntity('create', 'strategy', { name: 'test' }, 'plugin1');
    expect(mockInvoke).toHaveBeenCalledWith('entity:create:strategy', { name: 'test' }, 'plugin1');
  });

  it('transaction calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.transaction([{ op: 'insert' }], 'plugin1');
    expect(mockInvoke).toHaveBeenCalledWith('hub:transaction', [{ op: 'insert' }], 'plugin1');
  });

  it('setState calls send', async () => {
    const api = await loadPreload();
    api.hub.setState('key', 'value', 'plugin1');
    expect(mockSend).toHaveBeenCalledWith('hub:state:set', { key: 'key', value: 'value', pluginId: 'plugin1' });
  });

  it('getState calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.getState('key');
    expect(mockInvoke).toHaveBeenCalledWith('hub:state:get', 'key');
  });

  it('getAllState calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.getAllState();
    expect(mockInvoke).toHaveBeenCalledWith('hub:state:getAll');
  });

  it('onStateChanged subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.hub.onStateChanged(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('hub:state:changed', expect.any(Function));
    unsub();
  });

  it('emit calls send', async () => {
    const api = await loadPreload();
    api.hub.emit('test', { data: 1 }, 'plugin1');
    expect(mockSend).toHaveBeenCalledWith('hub:emit', { type: 'test', payload: { data: 1 }, pluginId: 'plugin1' });
  });

  it('replay calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.replay('test');
    expect(mockInvoke).toHaveBeenCalledWith('hub:replay', 'test');
  });

  it('onEvent subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.hub.onEvent(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('hub:event', expect.any(Function));
    unsub();
  });

  it('findFiles calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.findFiles({ type: 'strategy' }, 'plugin1');
    expect(mockInvoke).toHaveBeenCalledWith('hub:file:find', { type: 'strategy' }, 'plugin1');
  });

  it('resolveFile calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.resolveFile('file1', 'plugin1');
    expect(mockInvoke).toHaveBeenCalledWith('hub:file:resolve', 'file1', 'plugin1');
  });

  it('removeFile calls invoke', async () => {
    const api = await loadPreload();
    await api.hub.removeFile('file1', true, 'plugin1');
    expect(mockInvoke).toHaveBeenCalledWith('hub:file:remove', { fileId: 'file1', deleteFile: true }, 'plugin1');
  });
});

// =============================================================================
// Kronos namespace
// =============================================================================
describe('kronos namespace', () => {
  it('predict calls invoke', async () => {
    const api = await loadPreload();
    const req = { model: 'm1', lookback: 100, pred_len: 10, temperature: 0.5, top_p: 0.9, top_k: 50, sample_count: 1, time_range: 'latest' as const, strategy_name: 'test', signal_filter: { filters: { confidence: { enabled: true, min_value: 0.5 }, expected_return: { enabled: false, min_value: 0 }, direction_filter: { enabled: false, mode: 'all' }, magnitude: { enabled: false, min_value: 0 }, consistency: { enabled: false, min_value: 0 } }, combination_logic: 'AND' as const } };
    await api.kronos.predict(req);
    expect(mockInvoke).toHaveBeenCalledWith('kronos:predict', req);
  });

  it('cancel calls invoke', async () => {
    const api = await loadPreload();
    await api.kronos.cancel('t1');
    expect(mockInvoke).toHaveBeenCalledWith('kronos:cancel', 't1');
  });

  it('getModels calls invoke', async () => {
    const api = await loadPreload();
    await api.kronos.getModels();
    expect(mockInvoke).toHaveBeenCalledWith('kronos:getModels');
  });

  it('onProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.kronos.onProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('kronos:progress', expect.any(Function));
    unsub();
  });

  it('onComplete subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.kronos.onComplete(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('kronos:complete', expect.any(Function));
    unsub();
  });

  it('onError subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.kronos.onError(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('kronos:error', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// KronosPrice namespace
// =============================================================================
describe('kronosPrice namespace', () => {
  it('health calls invoke', async () => {
    const api = await loadPreload();
    await api.kronosPrice.health();
    expect(mockInvoke).toHaveBeenCalledWith('kronos-price:health');
  });

  it('predict calls invoke', async () => {
    const api = await loadPreload();
    const req = { symbol: 'AAPL', timeframe: '1d', data_source: 'server' as const };
    await api.kronosPrice.predict(req);
    expect(mockInvoke).toHaveBeenCalledWith('kronos-price:predict', req);
  });
});

// =============================================================================
// Conversation namespace
// =============================================================================
describe('conversation namespace', () => {
  it('create calls invoke', async () => {
    const api = await loadPreload();
    await api.conversation.create({ user_id: 'u1', title: 'Test' });
    expect(mockInvoke).toHaveBeenCalledWith('conversation:create', { user_id: 'u1', title: 'Test' });
  });

  it('get calls invoke', async () => {
    const api = await loadPreload();
    await api.conversation.get(1);
    expect(mockInvoke).toHaveBeenCalledWith('conversation:get', 1);
  });

  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.conversation.list({ userId: 'u1', limit: 10 });
    expect(mockInvoke).toHaveBeenCalledWith('conversation:list', { userId: 'u1', limit: 10 });
  });

  it('update calls invoke', async () => {
    const api = await loadPreload();
    await api.conversation.update(1, { title: 'Updated' });
    expect(mockInvoke).toHaveBeenCalledWith('conversation:update', { id: 1, data: { title: 'Updated' } });
  });

  it('delete calls invoke', async () => {
    const api = await loadPreload();
    await api.conversation.delete(1);
    expect(mockInvoke).toHaveBeenCalledWith('conversation:delete', 1);
  });

  it('search calls invoke', async () => {
    const api = await loadPreload();
    await api.conversation.search('u1', 'test', 5);
    expect(mockInvoke).toHaveBeenCalledWith('conversation:search', { userId: 'u1', query: 'test', limit: 5 });
  });
});

// =============================================================================
// Message namespace
// =============================================================================
describe('message namespace', () => {
  it('add calls invoke', async () => {
    const api = await loadPreload();
    await api.message.add({ conversation_id: 1, type: 'user', content: 'hello' });
    expect(mockInvoke).toHaveBeenCalledWith('message:add', { conversation_id: 1, type: 'user', content: 'hello' });
  });

  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.message.list(1, { limit: 10 });
    expect(mockInvoke).toHaveBeenCalledWith('message:list', { conversationId: 1, limit: 10 });
  });

  it('delete calls invoke', async () => {
    const api = await loadPreload();
    await api.message.delete(5);
    expect(mockInvoke).toHaveBeenCalledWith('message:delete', 5);
  });
});

// =============================================================================
// Database namespace
// =============================================================================
describe('database namespace', () => {
  it('getAlgorithms calls invoke', async () => {
    const api = await loadPreload();
    await api.database.getAlgorithms({ userId: 'u1', strategyType: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('database:getAlgorithms', { userId: 'u1', strategyType: 1 });
  });

  it('getAlgorithms allows machine-scoped calls without userId', async () => {
    const api = await loadPreload();
    await api.database.getAlgorithms({ strategyType: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('database:getAlgorithms', { strategyType: 1 });
  });
});

// =============================================================================
// Executor namespace
// =============================================================================
describe('executor namespace', () => {
  it('runBacktest calls invoke', async () => {
    const api = await loadPreload();
    const config = { taskId: 't1', strategyPath: '/s.py', symbol: 'AAPL', interval: '1d', startDate: '2024-01-01', endDate: '2024-12-31', initialCapital: 10000, dataPath: '/data' };
    await api.executor.runBacktest(config);
    expect(mockInvoke).toHaveBeenCalledWith('v3:run-backtest', config);
  });

  it('registerTask calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.registerTask('t1', 'MyStrategy');
    expect(mockInvoke).toHaveBeenCalledWith('v3:executor:register-task', { taskId: 't1', strategyName: 'MyStrategy' });
  });

  it('cancelBacktest calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.cancelBacktest('t1');
    expect(mockInvoke).toHaveBeenCalledWith('v3:cancel-backtest', 't1');
  });

  it('cancelAllBacktests calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.cancelAllBacktests();
    expect(mockInvoke).toHaveBeenCalledWith('v3:queue-cancel-all');
  });

  it('getQueueStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.getQueueStatus();
    expect(mockInvoke).toHaveBeenCalledWith('v3:queue-status');
  });

  it('onQueueStatus subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onQueueStatus(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:queue-status', expect.any(Function));
    unsub();
  });

  it('getResults calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.getResults('t1');
    expect(mockInvoke).toHaveBeenCalledWith('v3:get-results', 't1');
  });

  it('getTaskStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.getTaskStatus('t1');
    expect(mockInvoke).toHaveBeenCalledWith('v3:get-task-status', 't1');
  });

  it('generateStrategy calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.generateStrategy({ prompt: 'create strategy' });
    expect(mockInvoke).toHaveBeenCalledWith('v3:generate-strategy', { prompt: 'create strategy' });
  });

  it('saveStrategy calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.saveStrategy({ name: 'test', code: 'print(1)' });
    expect(mockInvoke).toHaveBeenCalledWith('v3:save-strategy', { name: 'test', code: 'print(1)' });
  });

  it('loadStrategy calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.loadStrategy('test');
    expect(mockInvoke).toHaveBeenCalledWith('v3:load-strategy', 'test');
  });

  it('listStrategies calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.listStrategies();
    expect(mockInvoke).toHaveBeenCalledWith('v3:list-strategies');
  });

  it('generateWorkflowStrategy calls invoke', async () => {
    const api = await loadPreload();
    const config = { workflows: [], symbol: 'AAPL', interval: '1d', startTime: 0, endTime: 1, initialCapital: 10000 };
    await api.executor.generateWorkflowStrategy(config);
    expect(mockInvoke).toHaveBeenCalledWith('v3:generate-workflow-strategy', config);
  });

  it('getCurrentPhase calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.getCurrentPhase('t1');
    expect(mockInvoke).toHaveBeenCalledWith('executor:getCurrentPhase', 't1');
  });

  it('onStarted subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onStarted(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:started', expect.any(Function));
    unsub();
  });

  it('onPhase subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onPhase(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:phase', expect.any(Function));
    unsub();
  });

  it('onProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:progress', expect.any(Function));
    unsub();
  });

  it('onCompleted subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onCompleted(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:completed', expect.any(Function));
    unsub();
  });

  it('onError subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onError(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:error', expect.any(Function));
    unsub();
  });

  it('onCancelled subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onCancelled(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:cancelled', expect.any(Function));
    unsub();
  });

  it('onIncrement subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onIncrement(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:increment', expect.any(Function));
    unsub();
  });

  it('onDryRunLlm subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onDryRunLlm(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('executor:dryRunLlm', expect.any(Function));
    unsub();
  });

  it('compileAlgorithm calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.compileAlgorithm({ algorithmId: 1, sourceCode: 'code' });
    expect(mockInvoke).toHaveBeenCalledWith('v3:algorithm:compile', { algorithmId: 1, sourceCode: 'code' });
  });

  it('onCompilationStatus subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.executor.onCompilationStatus(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('v3:algorithm:compilation-status', expect.any(Function));
    unsub();
  });

  it('getHistory calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.getHistory({ limit: 10 });
    expect(mockInvoke).toHaveBeenCalledWith('backtest:getHistory', { limit: 10 });
  });

  it('getHistoryResult calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.getHistoryResult('t1');
    expect(mockInvoke).toHaveBeenCalledWith('backtest:getResult', 't1');
  });

  it('deleteHistoryResult calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.deleteHistoryResult('t1');
    expect(mockInvoke).toHaveBeenCalledWith('backtest:deleteResult', 't1');
  });

  it('fetchCandles calls invoke', async () => {
    const api = await loadPreload();
    const cfg = { symbol: 'AAPL', interval: '1d', startDate: '2024-01-01', endDate: '2024-12-31' };
    await api.executor.fetchCandles(cfg);
    expect(mockInvoke).toHaveBeenCalledWith('backtest:fetchCandles', cfg);
  });

  it('saveOpenTabs calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.saveOpenTabs([{ taskId: 't1', strategyName: 'S1', isActive: true, lastAccessedAt: 0 }]);
    expect(mockInvoke).toHaveBeenCalledWith('backtest:saveOpenTabs', expect.any(Array));
  });

  it('loadOpenTabs calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.loadOpenTabs();
    expect(mockInvoke).toHaveBeenCalledWith('backtest:loadOpenTabs');
  });

  it('loadTaskHistory calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.loadTaskHistory({ limit: 5 });
    expect(mockInvoke).toHaveBeenCalledWith('backtest:loadTaskHistory', { limit: 5 });
  });

  it('deleteTaskHistory calls invoke', async () => {
    const api = await loadPreload();
    await api.executor.deleteTaskHistory('t1');
    expect(mockInvoke).toHaveBeenCalledWith('backtest:deleteTaskHistory', 't1');
  });

  // TICKET_886_7: exportToQuantLab test removed (saved_strategies dead).
});

// =============================================================================
// Factor namespace
// =============================================================================
describe('factor namespace', () => {
  it('mining.start calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.mining.start({ loopCount: 3, hypothesisSource: 'llm' });
    expect(mockInvoke).toHaveBeenCalledWith('factor:mining:start', { loopCount: 3, hypothesisSource: 'llm' });
  });

  it('mining.startFromReports calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.mining.startFromReports({ reportUrls: ['url1'] });
    expect(mockInvoke).toHaveBeenCalledWith('factor:mining:start-from-reports', { reportUrls: ['url1'] });
  });

  it('mining.uploadReports calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.mining.uploadReports({ filePaths: ['/file.pdf'] });
    expect(mockInvoke).toHaveBeenCalledWith('factor:mining:upload-reports', { filePaths: ['/file.pdf'] });
  });

  it('mining.resume calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.mining.resume('session1');
    expect(mockInvoke).toHaveBeenCalledWith('factor:mining:resume', { sessionId: 'session1' });
  });

  it('results calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.results('t1');
    expect(mockInvoke).toHaveBeenCalledWith('factor:results', { taskId: 't1' });
  });

  it('sessions.list calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.sessions.list({ status: 'running' });
    expect(mockInvoke).toHaveBeenCalledWith('factor:sessions:list', { status: 'running' });
  });

  it('sessions.detail calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.sessions.detail('s1');
    expect(mockInvoke).toHaveBeenCalledWith('factor:sessions:detail', { sessionId: 's1' });
  });

  it('local.list calls invoke', async () => {
    const api = await loadPreload();
    await api.factor.local.list({ source: 'mining' });
    expect(mockInvoke).toHaveBeenCalledWith('factor:local:list', { source: 'mining' });
  });
});

// =============================================================================
// FactorCatalog namespace (TICKET_1335 D2)
// =============================================================================
describe('persona namespace', () => {
  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.persona.list();
    expect(mockInvoke).toHaveBeenCalledWith('persona:list');
  });
});

// =============================================================================
// Credit namespace
// =============================================================================
describe('credit namespace', () => {
  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.credit.getStatus();
    expect(mockInvoke).toHaveBeenCalledWith('credit:get-status');
  });
});

// =============================================================================
// Algorithm namespace
// =============================================================================
describe('algorithm namespace', () => {
  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.algorithm.list({ userId: 'u1', strategyType: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('entity:list:nona_algorithm', { userId: 'u1', strategyType: 1 });
  });

  // TICKET_886_7: exportAsSignalSource test removed (saved_strategies dead).
});

// =============================================================================
// BatchGeneration namespace
// =============================================================================
describe('batchGeneration namespace', () => {
  it('start calls invoke', async () => {
    const api = await loadPreload();
    await api.batchGeneration.start({ regime: 'bull', indicators: ['RSI'], quantity: 5 });
    expect(mockInvoke).toHaveBeenCalledWith('batch-generation:start', { regime: 'bull', indicators: ['RSI'], quantity: 5 });
  });

  it('cancel calls invoke', async () => {
    const api = await loadPreload();
    await api.batchGeneration.cancel();
    expect(mockInvoke).toHaveBeenCalledWith('batch-generation:cancel');
  });

  it('getState calls invoke', async () => {
    const api = await loadPreload();
    await api.batchGeneration.getState();
    expect(mockInvoke).toHaveBeenCalledWith('batch-generation:get-state');
  });

  it('onProgress subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.batchGeneration.onProgress(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('batch-generation:progress', expect.any(Function));
    unsub();
  });

  it('onComplete subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.batchGeneration.onComplete(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('batch-generation:complete', expect.any(Function));
    unsub();
  });

  it('onError subscribes', async () => {
    const api = await loadPreload();
    const unsub = api.batchGeneration.onError(vi.fn());
    expect(mockOn).toHaveBeenCalledWith('batch-generation:error', expect.any(Function));
    unsub();
  });
});

// =============================================================================
// SignalDiscovery namespace
// =============================================================================
describe('workspaceSync namespace', () => {
  it('export calls invoke', async () => {
    const api = await loadPreload();
    await api.workspaceSync.export('/target');
    expect(mockInvoke).toHaveBeenCalledWith('v3:workspace:sync:export', '/target');
  });

  it('import calls invoke', async () => {
    const api = await loadPreload();
    await api.workspaceSync.import('/source');
    expect(mockInvoke).toHaveBeenCalledWith('v3:workspace:sync:import', '/source');
  });

  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.workspaceSync.getStatus('/target');
    expect(mockInvoke).toHaveBeenCalledWith('v3:workspace:sync:status', '/target');
  });
});

// =============================================================================
// Audit namespace
// =============================================================================
describe('audit namespace', () => {
  it('getByAlgorithm calls invoke', async () => {
    const api = await loadPreload();
    await api.audit.getByAlgorithm(1);
    expect(mockInvoke).toHaveBeenCalledWith('audit:getByAlgorithm', 1);
  });

  it('list calls invoke', async () => {
    const api = await loadPreload();
    await api.audit.list({ signal_source: 'test', min_star: 3 });
    expect(mockInvoke).toHaveBeenCalledWith('audit:list', { signal_source: 'test', min_star: 3 });
  });
});

// =============================================================================
// Diagnostics namespace
// =============================================================================
describe('diagnostics namespace', () => {
  it('openLogFolder calls invoke', async () => {
    const api = await loadPreload();
    await api.diagnostics.openLogFolder();
    expect(mockInvoke).toHaveBeenCalledWith('diagnostics:openLogFolder');
  });
});

// =============================================================================
// Consent namespace
// =============================================================================
describe('consent namespace', () => {
  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.consent.getStatus();
    expect(mockInvoke).toHaveBeenCalledWith('consent:getStatus');
  });

  it('setConsent calls invoke', async () => {
    const api = await loadPreload();
    await api.consent.setConsent(true, false);
    expect(mockInvoke).toHaveBeenCalledWith('consent:setConsent', true, false);
  });
});

// =============================================================================
// DatabaseBackup namespace
// =============================================================================
describe('databaseBackup namespace', () => {
  it('backup calls invoke', async () => {
    const api = await loadPreload();
    await api.databaseBackup.backup();
    expect(mockInvoke).toHaveBeenCalledWith('v3:database:backup');
  });

  it('restore calls invoke', async () => {
    const api = await loadPreload();
    await api.databaseBackup.restore('/backup.db');
    expect(mockInvoke).toHaveBeenCalledWith('v3:database:restore', '/backup.db');
  });

  it('listBackups calls invoke', async () => {
    const api = await loadPreload();
    await api.databaseBackup.listBackups();
    expect(mockInvoke).toHaveBeenCalledWith('v3:database:list-backups');
  });
});

// =============================================================================
// RecycleBin namespace
// =============================================================================
describe('recycleBin namespace', () => {
  it('listDeleted calls invoke', async () => {
    const api = await loadPreload();
    await api.recycleBin.listDeleted('strategies', { limit: 10 });
    expect(mockInvoke).toHaveBeenCalledWith('v3:recycle-bin:list-deleted', { table: 'strategies', limit: 10 });
  });

  it('restore calls invoke', async () => {
    const api = await loadPreload();
    await api.recycleBin.restore('strategies', 1);
    expect(mockInvoke).toHaveBeenCalledWith('v3:recycle-bin:restore', { table: 'strategies', id: 1 });
  });

  it('purge calls invoke', async () => {
    const api = await loadPreload();
    await api.recycleBin.purge('strategies', 1);
    expect(mockInvoke).toHaveBeenCalledWith('v3:recycle-bin:purge', { table: 'strategies', id: 1 });
  });
});

// =============================================================================
// Onboarding namespace
// =============================================================================
describe('onboarding namespace', () => {
  it('getState calls invoke', async () => {
    const api = await loadPreload();
    await api.onboarding.getState();
    expect(mockInvoke).toHaveBeenCalledWith('onboarding:getState');
  });

  it('setEnabled calls invoke', async () => {
    const api = await loadPreload();
    await api.onboarding.setEnabled(true);
    expect(mockInvoke).toHaveBeenCalledWith('onboarding:setEnabled', true);
  });

  it('setAssistantMode calls invoke', async () => {
    const api = await loadPreload();
    await api.onboarding.setAssistantMode(true);
    expect(mockInvoke).toHaveBeenCalledWith('onboarding:setAssistantMode', true);
  });

  it('markCompleted calls invoke', async () => {
    const api = await loadPreload();
    await api.onboarding.markCompleted('tour1');
    expect(mockInvoke).toHaveBeenCalledWith('onboarding:markCompleted', 'tour1');
  });

  it('reset calls invoke', async () => {
    const api = await loadPreload();
    await api.onboarding.reset();
    expect(mockInvoke).toHaveBeenCalledWith('onboarding:reset');
  });
});

// =============================================================================
// CppToolchain namespace
// =============================================================================
describe('cppToolchain namespace', () => {
  it('getStatus calls invoke', async () => {
    const api = await loadPreload();
    await api.cppToolchain.getStatus();
    expect(mockInvoke).toHaveBeenCalledWith('v3:cpp-toolchain:status');
  });
});

// =============================================================================
// Edition namespace
// =============================================================================
describe('distribution namespace', () => {
  it('getDistribution calls invoke', async () => {
    const api = await loadPreload();
    await api.distribution.getDistribution();
    expect(mockInvoke).toHaveBeenCalledWith('distribution:getDistribution');
  });

  it('isPublicRelease calls invoke', async () => {
    const api = await loadPreload();
    await api.distribution.isPublicRelease();
    expect(mockInvoke).toHaveBeenCalledWith('distribution:isPublicRelease');
  });
});

// =============================================================================
// StartupAudit namespace (TICKET_560_2)
// =============================================================================
describe('startupAudit namespace', () => {
  it('getLatest calls invoke', async () => {
    const api = await loadPreload();
    await api.startupAudit.getLatest();
    expect(mockInvoke).toHaveBeenCalledWith('startup-audit:get-latest');
  });

  it('list calls invoke with limit', async () => {
    const api = await loadPreload();
    await api.startupAudit.list(10);
    expect(mockInvoke).toHaveBeenCalledWith('startup-audit:list', 10);
  });

  it('list calls invoke without limit', async () => {
    const api = await loadPreload();
    await api.startupAudit.list();
    expect(mockInvoke).toHaveBeenCalledWith('startup-audit:list', undefined);
  });
});
