import { contextBridge, ipcRenderer } from 'electron';
import type { BacktestExecutorRequest } from '../shared/types/backtest';
import type { CompilationStatusUpdate, ServerStatus } from '../shared/types';
import type { InstallProgress, InstalledPlugin, RegistryPlugin } from '../shared/types/marketplace';
import type { GetAlgorithmsOptions, GetAlgorithmsResult } from '../shared/types/algorithm';
import type {
  BarInterval,
  BatchGenerationState,
  FeedPlan,
  CredentialHealth,
  // TICKET_1334 P4: the runtime-role state the renderer labels launch controls
  // from. Type-only, and imported from the shared owner rather than restated --
  // a restated shape is how the two surfaces drift (TICKET_854).
  ServiceApiRuntimeRoleState,
  // TICKET_1335: the shared environment contract. Consumed as the exact shape
  // the service owns -- Service API, MCP, preload, and the renderer all use this
  // type rather than surface-local variants.
  ResearchEnvironmentStatus,
  ResearchEnvironmentJob,
  ExtensionCapabilityRequest,
  ExtensionEvent,
  ExtensionInvocation,
} from '@StratCraft/types';
import { EXTENSION_BRIDGE_CHANNELS } from '../shared/constants/channels';
import type {
  LifecycleMutationResponse,
  ResetUnreadableResult,
  SetSecretResponse,
  SecureStoreLifecycleStatus,
} from '@StratCraft/secure-store';
// =============================================================================
// Type Definitions
// =============================================================================

interface DialogOptions {
  title: string;
  message: string;
  buttons?: string[];
  type?: 'info' | 'warning' | 'error' | 'question';
}

interface DialogResult {
  button: string;
  checkboxChecked?: boolean;
}

interface NotificationOptions {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface ProgressOptions {
  id: string;
  title: string;
}

interface ProgressUpdate {
  id: string;
  progress: number;
  message: string;
}

interface MarketDataParams {
  symbol: string;
  interval: string;
  start: string;
  end: string;
}

// =============================================================================
// API Contract Version (TICKET_434)
// =============================================================================
const API_VERSION = '1.0.0';

// =============================================================================
// API Definition
// =============================================================================

// Expose secure API to renderer process
const api = {
  /** Generic signed-extension transport. Contains no plugin command inventory. */
  extensionBridge: {
    getCapability: (request: ExtensionCapabilityRequest): Promise<unknown> =>
      ipcRenderer.invoke(EXTENSION_BRIDGE_CHANNELS.CAPABILITY, request),
    invoke: (request: ExtensionInvocation): Promise<unknown> =>
      ipcRenderer.invoke(EXTENSION_BRIDGE_CHANNELS.INVOKE, request),
    onEvent: (callback: (event: ExtensionEvent) => void): (() => void) => {
      const handler = (_event: unknown, event: ExtensionEvent) => callback(event);
      ipcRenderer.on(EXTENSION_BRIDGE_CHANNELS.EVENT, handler);
      return () => ipcRenderer.removeListener(EXTENSION_BRIDGE_CHANNELS.EVENT, handler);
    },
  },
  // API Contract Version
  version: API_VERSION,

  // System Info
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // Application Info
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    getPath: () => ipcRenderer.invoke('app:path'),
    // TICKET_958_5 follow-up: research-mode mirror for catalog visibility.
    // Returns true iff STRATCRAFT_RESEARCH_MODE=1 in the main process;
    // packaged releases never set it. Renderer-side picker uses this to
    // decide whether to opt into research-only providers via
    // `flattenProviderCatalog({ includeResearch: true })`.
    isResearchMode: (): Promise<boolean> => ipcRenderer.invoke('app:research-mode'),
  },

  // Server Status
  server: {
    getStatus: (): Promise<ServerStatus> => ipcRenderer.invoke('server:status'),
    onStatusChange: (callback: (status: ServerStatus) => void) => {
      const handler = (_: unknown, status: ServerStatus) => callback(status);
      ipcRenderer.on('server:status', handler);
      return () => ipcRenderer.removeListener('server:status', handler);
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: unknown, error: string) => callback(error);
      ipcRenderer.on('server:error', handler);
      return () => ipcRenderer.removeListener('server:error', handler);
    },
  },

  // Strategy API
  strategy: {
    // CRUD operations
    list: () => ipcRenderer.invoke('strategy:list'),
    get: (id: string) => ipcRenderer.invoke('strategy:get', id),
    save: (data: unknown) => ipcRenderer.invoke('strategy:save', data),
    delete: (id: string) => ipcRenderer.invoke('strategy:delete', id),

    // LLM Generation (TICKET_045)
    generate: (config: unknown) => ipcRenderer.invoke('strategy:generate', config),
    generateFromCatalog: (config: unknown) => ipcRenderer.invoke('strategy:generate-from-catalog', config),
    cancel: (taskId: string) => ipcRenderer.invoke('strategy:cancel', taskId),
    onProgress: (callback: (event: unknown, data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(_, data);
      ipcRenderer.on('strategy:progress', handler);
      return () => ipcRenderer.removeListener('strategy:progress', handler);
    },
    onComplete: (callback: (event: unknown, data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(_, data);
      ipcRenderer.on('strategy:complete', handler);
      return () => ipcRenderer.removeListener('strategy:complete', handler);
    },
    onError: (callback: (event: unknown, data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(_, data);
      ipcRenderer.on('strategy:error', handler);
      return () => ipcRenderer.removeListener('strategy:error', handler);
    },
  },

  // Data API (TICKET_045)
  data: {
    // Ensure data is available (download if needed)
    ensure: (config: {
      symbol: string;
      startDate: string;
      endDate: string;
      interval: string;
      provider?: string;
      forceDownload?: boolean;
      callerId?: string;
    }) => ipcRenderer.invoke('data:ensure', config),

    // TICKET_248 Phase 2: Ensure data for multiple timeframes
    ensureMultiTimeframe: (config: {
      symbol: string;
      startDate: string;
      endDate: string;
      timeframes: string[];
      provider?: string;
      forceDownload?: boolean;
      callerId?: string;
    }) => ipcRenderer.invoke('data:ensureMultiTimeframe', config),

    // Check data coverage
    checkCoverage: (config: {
      symbol: string;
      startDate: string;
      endDate: string;
      interval: string;
    }) => ipcRenderer.invoke('data:checkCoverage', config),

    // Search symbols
    searchSymbols: (query: string, provider?: string) => ipcRenderer.invoke('data:searchSymbols', query, provider),

    // Check provider connection
    checkConnection: (provider: string) => ipcRenderer.invoke('data:checkConnection', provider),

    // TICKET_305 Phase 2: Get data availability date range for a symbol
    getSymbolDateRange: (symbol: string, provider?: string) =>
      ipcRenderer.invoke('data:getSymbolDateRange', symbol, provider),

    // TICKET_077_COMPONENT8: Sync provider metadata (no connection checks)
    getProviderList: () => ipcRenderer.invoke('data:getProviderList'),

    // TICKET_292 / TICKET_883: List providers (returns cached snapshot)
    listProviders: () => ipcRenderer.invoke('data:listProviders'),

    // TICKET_883: Force-refresh provider status, returns fresh snapshot
    refreshProviderStatus: () => ipcRenderer.invoke('data:refreshProviderStatus'),

    // TICKET_883: Subscribe to provider status change events (full snapshot on any delta)
    onProviderStatusChanged: (callback: (data: Array<{
      id: string;
      name: string;
      status: 'connected' | 'disconnected' | 'error' | 'not-configured' | 'checking';
      capabilities: Record<string, unknown>;
      latencyMs?: number;
      error?: string;
    }>) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as Array<{
        id: string;
        name: string;
        status: 'connected' | 'disconnected' | 'error' | 'not-configured' | 'checking';
        capabilities: Record<string, unknown>;
        latencyMs?: number;
        error?: string;
      }>);
      ipcRenderer.on('data:providerStatusChanged', handler);
      return () => ipcRenderer.removeListener('data:providerStatusChanged', handler);
    },

    // TICKET_880_4_1: List available symbols from a provider (for sweep data source selector)
    getSymbols: (providerId: string, limit?: number) =>
      ipcRenderer.invoke('data:getSymbols', providerId, limit) as Promise<{
        symbols: string[];
        total: number;
        supported: boolean;
      }>,

    // TICKET_332: Progressive per-provider connection check
    checkProvidersProgressive: () => ipcRenderer.invoke('data:checkProvidersProgressive'),

    // TICKET_332: Subscribe to per-provider status events
    // TICKET_588: Added 'not-configured' status for missing credentials
    onProviderStatus: (callback: (data: {
      id: string;
      status: 'connected' | 'disconnected' | 'error' | 'not-configured';
      latencyMs?: number;
      error?: string;
    }) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as {
        id: string;
        status: 'connected' | 'disconnected' | 'error' | 'not-configured';
        latencyMs?: number;
        error?: string;
      });
      ipcRenderer.on('data:providerStatus', handler);
      return () => ipcRenderer.removeListener('data:providerStatus', handler);
    },

    // Progress events
    onProgress: (callback: (event: unknown, data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(_, data);
      ipcRenderer.on('data:progress', handler);
      return () => ipcRenderer.removeListener('data:progress', handler);
    },

    // Cancel download
    cancelDownload: () => ipcRenderer.send('data:cancelDownload'),

    // TICKET_340: Data Management Center
    getCacheStats: () => ipcRenderer.invoke('data:getCacheStats'),

    listSegments: (filters: {
      provider?: string;
      symbol?: string;
      interval?: string;
      limit?: number;
      offset?: number;
    }) => ipcRenderer.invoke('data:listSegments', filters),

    deleteSegments: (ids: number[]) => ipcRenderer.invoke('data:deleteSegments', ids),

    enqueueDownload: (config: {
      symbol: string;
      interval: string;
      startDate: string;
      endDate: string;
      provider: string;
    }) => ipcRenderer.invoke('data:enqueueDownload', config),

    cancelQueueTask: (taskId: string) => ipcRenderer.invoke('data:cancelQueueTask', taskId),

    getQueueStatus: () => ipcRenderer.invoke('data:getQueueStatus'),

    // Clear all data cache (parquet files + DB tables + download queue)
    clearAll: () => ipcRenderer.invoke('data:clearAll'),

    onDownloadQueueProgress: (callback: (data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on('data:download-queue-progress', handler);
      return () => {
        ipcRenderer.removeListener('data:download-queue-progress', handler);
      };
    },

    cancelImport: (taskId: string) => ipcRenderer.invoke('data:cancelImport', taskId),

    // TICKET_308_3_3: Preview a data package without importing.
    scanDataPackage: (payload: {
      request: {
        sourcePath: string;
        packageName?: string;
      };
    }) => ipcRenderer.invoke('data:scanDataPackage', payload),

    // TICKET_308_3_2: Manifest-aware directory/DuckDB/CSV package import.
    // TICKET_919_10: optional archivalCadence so HistData / Dukascopy
    // importer flows (which know the source is a monthly archive) can
    // declare it explicitly. Absent => DIALECT_ARCHIVAL_DEFAULT[dialect].
    importDataPackage: (payload: {
      taskId: string;
      request: {
        sourcePath: string;
        packageName: string;
        adjustMode: 'none' | 'qfq' | 'hfq';
        manifest?: unknown;
        archivalCadence?:
          | 'monthly_archive'
          | 'weekly_archive'
          | 'daily_eod'
          | 'snapshot'
          | 'realtime';
      };
    }) => ipcRenderer.invoke('data:importDataPackage', payload),

    // TICKET_308_2: Bulk-register pre-existing Parquet files from a cache
    // provider directory. Used for histdata.com forex and similar offline imports.
    // TICKET_919_10: optional archivalCadence. Renderer flows that know
    // the source is a HistData / Dukascopy monthly archive MUST pass
    // 'monthly_archive' so windows are floored to the cadence boundary.
    registerParquetDirectory: (payload: {
      packageName: string;
      adjustMode: 'none' | 'qfq' | 'hfq';
      sourceDialect: string;
      archivalCadence?:
        | 'monthly_archive'
        | 'weekly_archive'
        | 'daily_eod'
        | 'snapshot'
        | 'realtime';
    }) => ipcRenderer.invoke('data:registerParquetDirectory', payload),

    // TICKET_308_1a (Phase 7): list every BYOD imported-package catalog row so
    // the data-source picker can offer each imported package as its own source
    // (distinct from getProviderList, which only returns live providers).
    listImportedPackages: () => ipcRenderer.invoke('data:listImportedPackages'),

    listImportedPackageSummaries: () => ipcRenderer.invoke('data:listImportedPackageSummaries'),

    appendToPackage: (opts: { packageName: string; sourcePath: string; symbolFilter?: string[]; force?: boolean }) =>
      ipcRenderer.invoke('data:appendToPackage', opts),

    // TICKET_308_3_3: List files for a specific imported package (expanded detail).
    listImportedPackageFiles: (packageName: string) =>
      ipcRenderer.invoke('data:listImportedPackageFiles', packageName),

    // TICKET_308_3_4: Remove an imported package (all cache files + catalog row).
    removeImportedPackage: (packageName: string) =>
      ipcRenderer.invoke('data:removeImportedPackage', packageName),

    // TICKET_308_3_4: Health check -- verify registered cache files exist on disk.
    checkImportedPackageHealth: (packageName: string) =>
      ipcRenderer.invoke('data:checkImportedPackageHealth', packageName),

    checkImportedPackageIntegrity: (packageName: string) =>
      ipcRenderer.invoke('data:checkImportedPackageIntegrity', packageName),

    auditImportedPackageOrphans: (packageName: string) =>
      ipcRenderer.invoke('data:auditImportedPackageOrphans', packageName),

    buildCoverageReport: (packageName: string) =>
      ipcRenderer.invoke('data:buildCoverageReport', packageName),

    buildCoverageReportCsv: (packageName: string) =>
      ipcRenderer.invoke('data:buildCoverageReportCsv', packageName),

    onImportProgress: (callback: (data: {
      taskId: string;
      packageName?: string;
      phase: 'validating' | 'importing' | 'registering' | 'complete' | 'error';
      symbol?: string;
      interval?: string;
      seriesIndex?: number;
      seriesTotal?: number;
      seriesImported?: number;
      skippedEmpty?: number;
      skippedMissingTables?: number;
      skippedFiles?: number;
      message?: string;
    }) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('data:importProgress', handler);
      return () => ipcRenderer.removeListener('data:importProgress', handler);
    },
  },

  // File Operations
  file: {
    openDialog: (options: object) => ipcRenderer.invoke('file:openDialog', options),
    saveDialog: (options: object) => ipcRenderer.invoke('file:saveDialog', options),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    write: (path: string, data: unknown) => ipcRenderer.invoke('file:write', path, data),
  },

  // ===========================================================================
  // Plugin System API
  // ===========================================================================

  // Plugin Paths (dual-path loading)
  plugin: {
    // Get plugin paths (bundled + user)
    getPaths: (): Promise<{ bundled: string; user: string }> =>
      ipcRenderer.invoke('plugin:getPaths'),

    // Scan all plugins from both paths
    scanAll: (): Promise<Array<{
      id: string;
      path: string;
      source: 'bundled' | 'user';
      manifest: unknown;
    }>> => ipcRenderer.invoke('plugin:scanAll'),

    // Get directories in a specific path (legacy)
    getDirectories: (baseDir: string): Promise<string[]> =>
      ipcRenderer.invoke('plugin:getDirectories', baseDir),

    // Read file
    readFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('plugin:readFile', filePath),

    // Get plugin manifest by ID (TICKET_093)
    getManifest: (pluginId: string): Promise<{
      success: boolean;
      manifest?: unknown;
      error?: string;
    }> => ipcRenderer.invoke('plugin:getManifest', pluginId),

    // Get plugin config (TICKET_093)
    getConfig: (pluginId: string): Promise<{
      success: boolean;
      config?: Record<string, unknown>;
      error?: string;
    }> => ipcRenderer.invoke('plugin:getConfig', pluginId),

    // Set plugin config value (TICKET_093)
    setConfig: (pluginId: string, key: string, value: unknown): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('plugin:setConfig', pluginId, key, value),

    // TICKET_1004: Check if plugin is installed (registry-backed, replaces TICKET_264 filesystem scan)
    isInstalled: (pluginId: string): Promise<{
      success: boolean;
      installed: boolean;
    }> => ipcRenderer.invoke('plugin:isInstalled', pluginId),

    // TICKET_1004: Get full status entry for a single plugin
    getStatus: (pluginId: string): Promise<{
      success: boolean;
      data: {
        id: string;
        displayName: string;
        version: string;
        tier: number;
        distribution: 'bundled' | 'marketplace';
        installedAt: string;
        path: string;
        active: boolean;
      } | null;
    }> => ipcRenderer.invoke('plugin:getStatus', pluginId),

    // TICKET_1004: Get status entries for all registered plugins
    getAllStatus: (): Promise<{
      success: boolean;
      data: Array<{
        id: string;
        displayName: string;
        version: string;
        tier: number;
        distribution: 'bundled' | 'marketplace';
        installedAt: string;
        path: string;
        active: boolean;
      }>;
    }> => ipcRenderer.invoke('plugin:getAllStatus'),
  },

  // ===========================================================================
  // Plugin Process API (TICKET_632_2)
  // ===========================================================================
  pluginProcess: {
    activate: (pluginId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('plugin:process:activate', pluginId),

    deactivate: (pluginId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('plugin:process:deactivate', pluginId),

    getStatus: (pluginId: string): Promise<{
      success: boolean;
      status?: string;
      restartCount?: number;
      pid?: number;
      error?: string;
    }> => ipcRenderer.invoke('plugin:process:getStatus', pluginId),

    onPort: (pluginId: string, callback: (port: MessagePort) => void): (() => void) => {
      const channel = `plugin-port:${pluginId}`;
      const handler = (event: Electron.IpcRendererEvent) => {
        if (event.ports && event.ports.length > 0) {
          callback(event.ports[0]);
        }
      };
      ipcRenderer.on(channel, handler as (...args: unknown[]) => void);
      return () => ipcRenderer.removeListener(channel, handler as (...args: unknown[]) => void);
    },
  },

  // ===========================================================================
  // Plugin Port Bridge (TICKET_1037 Failure Mode C)
  // ===========================================================================
  // MessagePort objects cannot cross the contextBridge proxy — their native
  // methods (postMessage, onmessage, start, close) are stripped. Instead, the
  // real MessagePort lives here in the preload scope. The renderer uses these
  // serialization-safe wrappers.
  pluginPort: (() => {
    const ports = new Map<string, MessagePort>();
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    const readyCallbacks = new Map<string, Array<() => void>>();

    function setupPort(pluginId: string, port: MessagePort): void {
      ports.set(pluginId, port);
      port.onmessage = (event: MessageEvent) => {
        const cbs = listeners.get(pluginId);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(event.data);
            } catch (err) {
              ipcRenderer.send(
                'log',
                'error',
                'preload',
                `[E:PRELOAD:PLUGIN_MSG_HANDLER] plugin=${pluginId}`,
                err,
              );
            }
          }
        }
      };
      port.start();
      const pending = readyCallbacks.get(pluginId);
      if (pending) {
        for (const cb of pending) cb();
        readyCallbacks.delete(pluginId);
      }
    }

    return {
      listen: (pluginId: string): void => {
        if (ports.has(pluginId)) return;
        const channel = `plugin-port:${pluginId}`;
        const handler = (event: Electron.IpcRendererEvent) => {
          if (event.ports && event.ports.length > 0) {
            setupPort(pluginId, event.ports[0]);
          }
        };
        ipcRenderer.on(channel, handler as (...args: unknown[]) => void);
      },

      isReady: (pluginId: string): boolean => ports.has(pluginId),

      waitForReady: (pluginId: string): Promise<void> => {
        if (ports.has(pluginId)) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const pending = readyCallbacks.get(pluginId) ?? [];
          pending.push(resolve);
          readyCallbacks.set(pluginId, pending);
        });
      },

      send: (pluginId: string, data: unknown): void => {
        const port = ports.get(pluginId);
        if (!port) throw new Error(`Plugin port not ready: ${pluginId}`);
        port.postMessage(data);
      },

      onMessage: (pluginId: string, callback: (data: unknown) => void): (() => void) => {
        let cbs = listeners.get(pluginId);
        if (!cbs) {
          cbs = new Set();
          listeners.set(pluginId, cbs);
        }
        cbs.add(callback);
        return () => {
          cbs!.delete(callback);
          if (cbs!.size === 0) listeners.delete(pluginId);
        };
      },

      close: (pluginId: string): void => {
        const port = ports.get(pluginId);
        if (port) {
          port.close();
          ports.delete(pluginId);
        }
        listeners.delete(pluginId);
        readyCallbacks.delete(pluginId);
      },
    };
  })(),

  // Legacy Plugin File System (deprecated, use plugin.* instead)
  getPluginDirectories: (baseDir: string): Promise<string[]> =>
    ipcRenderer.invoke('plugin:getDirectories', baseDir),

  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('plugin:readFile', filePath),

  // Plugin Storage
  storeGet: <T>(key: string): Promise<T | undefined> =>
    ipcRenderer.invoke('store:get', key),

  storeSet: <T>(key: string, value: T): Promise<void> =>
    ipcRenderer.invoke('store:set', key, value),

  storeDelete: (key: string): Promise<void> =>
    ipcRenderer.invoke('store:delete', key),

  storeKeys: (): Promise<string[]> =>
    ipcRenderer.invoke('store:keys'),

  // UI Notifications
  showNotification: (options: NotificationOptions): void => {
    ipcRenderer.send('ui:notification', options);
  },

  showDialog: (options: DialogOptions): Promise<DialogResult> =>
    ipcRenderer.invoke('ui:dialog', options),

  showProgress: (options: ProgressOptions): void => {
    ipcRenderer.send('ui:progress:show', options);
  },

  updateProgress: (options: ProgressUpdate): void => {
    ipcRenderer.send('ui:progress:update', options);
  },

  hideProgress: (id: string): void => {
    ipcRenderer.send('ui:progress:hide', id);
  },

  // Market Data
  getMarketData: (params: MarketDataParams): Promise<unknown[]> =>
    ipcRenderer.invoke('market:getData', params),

  getSymbols: (): Promise<string[]> =>
    ipcRenderer.invoke('market:getSymbols'),

  // ===========================================================================
  // Credential API (TICKET_032 Phase 3)
  // ===========================================================================
  credential: {
    // Get credential value (Standard Protection only)
    get: (pluginId: string, key: string): Promise<{
      success: boolean;
      value?: string;
      errorCode?: string | number;
      errorMessage?: string;
      health?: CredentialHealth;
    }> => ipcRenderer.invoke('credential:get', pluginId, key),

    // Set credential value
    set: (pluginId: string, key: string, value: string): Promise<{
      success: boolean;
      errorCode?: string | number;
      errorMessage?: string;
      health?: Exclude<CredentialHealth, { state: 'usable' }>;
    }> => ipcRenderer.invoke('credential:set', pluginId, key, value),

    // Delete credential
    delete: (pluginId: string, key: string): Promise<{
      success: boolean;
      errorCode?: string | number;
      errorMessage?: string;
      health?: Exclude<CredentialHealth, { state: 'usable' }>;
    }> => ipcRenderer.invoke('credential:delete', pluginId, key),

    // Check if credential exists
    has: (pluginId: string, key: string): Promise<{
      success: boolean;
      exists: boolean;
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:has', pluginId, key),

    // List all credential keys for a plugin
    list: (pluginId: string): Promise<{
      success: boolean;
      keys: string[];
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:list', pluginId),

    // Validate user with master password
    validateUser: (password: string): Promise<{
      success: boolean;
      sessionToken?: string;
      errorCode?: number;
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:validateUser', password),

    // Set master password (initial setup)
    setMasterPassword: (password: string): Promise<{
      success: boolean;
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:setMasterPassword', password),

    // Execute with High Protection credential
    executeWith: (pluginId: string, key: string, operation: string, params: string): Promise<{
      success: boolean;
      data?: string;
      errorCode?: number;
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:executeWith', pluginId, key, operation, params),

    // Get audit log
    // Entries shape mirrors CredentialAuditEntry in shared/constants/credential-tiers.ts
    // (service is the source of truth; IPC transports the array verbatim).
    getAuditLog: (pluginId?: string, maxEntries?: number): Promise<{
      success: boolean;
      entries: Array<{
        timestamp: number;
        operation: 'get' | 'set' | 'delete';
        pluginId: string;
        key: string;
        tier: number;
      }>;
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:getAuditLog', pluginId, maxEntries),

    lifecycleStatus: (): Promise<{
      success: boolean;
      status?: SecureStoreLifecycleStatus;
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:lifecycleStatus'),

    resetUnreadable: (confirm: boolean): Promise<ResetUnreadableResult> =>
      ipcRenderer.invoke('credential:resetUnreadable', confirm),

    replaceUnreadable: (
      pluginId: string,
      key: string,
      value: string,
      health: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>,
      confirm: boolean,
    ): Promise<SetSecretResponse> => ipcRenderer.invoke(
      'credential:replaceUnreadable', pluginId, key, value, health, confirm,
    ),

    migrateLegacy: (): Promise<LifecycleMutationResponse> =>
      ipcRenderer.invoke('credential:migrateLegacy'),

    rotateMasterKey: (): Promise<LifecycleMutationResponse> =>
      ipcRenderer.invoke('credential:rotateMasterKey'),

    exportRecoveryBundle: (passphrase: string): Promise<
      LifecycleMutationResponse & { bundleBase64?: string }
    > => ipcRenderer.invoke('credential:exportRecoveryBundle', passphrase),

    exportBackupRecoveryBundle: (backupFilename: string, passphrase: string): Promise<
      LifecycleMutationResponse & { bundleBase64?: string }
    > => ipcRenderer.invoke('credential:exportBackupRecoveryBundle', backupFilename, passphrase),

    importRecoveryBundle: (
      bundleBase64: string,
      passphrase: string,
    ): Promise<LifecycleMutationResponse> =>
      ipcRenderer.invoke('credential:importRecoveryBundle', bundleBase64, passphrase),

    // TICKET_192: Validate API key for LLM providers
    // TICKET_311: Added keyType for Alpaca Paper/Live detection
    // TICKET_1266: optional baseUrl for the OPENAI_COMPATIBLE custom endpoint
    validateApiKey: (provider: string, apiKey: string, baseUrl?: string): Promise<{
      success: boolean;
      data?: {
        valid: boolean;
        error?: string;
        errorCode?: 'INVALID_FORMAT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'UNKNOWN';
        provider: string;
        keyType?: 'paper' | 'live';
      };
      errorMessage?: string;
    }> => ipcRenderer.invoke('credential:validateApiKey', provider, apiKey, baseUrl),

    // TICKET_580_4: Security event listeners
    onKeychainUnavailable: (callback: (data: {
      platform: string;
      desktop: string;
      instructions: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { platform: string; desktop: string; instructions: string });
      ipcRenderer.on('security:keychain-unavailable', handler);
      return () => ipcRenderer.removeListener('security:keychain-unavailable', handler);
    },

    onT0Rejected: (callback: (data: {
      pluginId: string;
      key: string;
      errorMessage: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string; key: string; errorMessage: string });
      ipcRenderer.on('security:t0-rejected', handler);
      return () => ipcRenderer.removeListener('security:t0-rejected', handler);
    },

    onT1Warning: (callback: (data: {
      pluginId: string;
      key: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string; key: string });
      ipcRenderer.on('security:t1-warning', handler);
      return () => ipcRenderer.removeListener('security:t1-warning', handler);
    },
  },

  // ===========================================================================
  // TICKET_054: Authorization, Authentication, and ModuleAuth APIs REMOVED
  // - Client-side user level verification is insecure
  // - All features unlocked in open-source version
  // ===========================================================================

  // ===========================================================================
  // UI Service API (Simplified - auth views removed)
  // ===========================================================================
  ui: {
    // Show plugin settings
    showPluginSettings: (pluginId: string): Promise<{
      success: boolean;
      errorMessage?: string;
    }> => ipcRenderer.invoke('ui:showPluginSettings', pluginId),

    // Receive navigation commands
    onNavigateToSettings: (callback: (pluginId: string) => void): (() => void) => {
      const handler = (_: unknown, pluginId: string) => callback(pluginId);
      ipcRenderer.on('navigate-to-settings', handler);
      return () => ipcRenderer.removeListener('navigate-to-settings', handler);
    },
  },

  // ===========================================================================
  // Configuration API (TICKET_046)
  // ===========================================================================
  config: {
    // Get a single config value by path (e.g., 'performance.maxBacktestTasks')
    get: <T>(path: string): Promise<{
      success: boolean;
      value?: T;
      error?: string;
    }> => ipcRenderer.invoke('config:get', path),

    // Get entire configuration
    getAll: (): Promise<{
      success: boolean;
      config?: unknown;
      error?: string;
    }> => ipcRenderer.invoke('config:getAll'),

    // Set a config value
    set: (path: string, value: unknown): Promise<{
      success: boolean;
      changed: boolean;
      requiresRestart: boolean;
      error?: string;
    }> => ipcRenderer.invoke('config:set', path, value),

    // Force reload configuration from file
    // TICKET_641_3: Returns health info when reload is rejected due to parse errors
    reload: (): Promise<{
      success: boolean;
      error?: string;
      health?: {
        status: 'healthy' | 'warning' | 'error';
        message: string;
        lastGoodLoadAt: number | null;
        usingFallback: boolean;
      };
    }> => ipcRenderer.invoke('config:reload'),

    // Auto-detect optimal backtest concurrency
    detectOptimalBacktestTasks: (): Promise<number> =>
      ipcRenderer.invoke('config:detectOptimalBacktestTasks'),

    // TICKET_976_1: Machine info for pre-run time estimation
    getMachineInfo: (): Promise<{ cpuCores: number; ramBytes: number }> =>
      ipcRenderer.invoke('config:getMachineInfo'),

    // Validate current configuration
    validate: (): Promise<{
      success: boolean;
      valid?: boolean;
      errors?: string[];
      error?: string;
    }> => ipcRenderer.invoke('config:validate'),

    // Subscribe to config changes
    onChanged: (callback: (event: {
      path: string;
      oldValue: unknown;
      newValue: unknown;
      requiresRestart: boolean;
    }) => void): (() => void) => {
      const handler = (_: unknown, event: unknown) => callback(event as {
        path: string;
        oldValue: unknown;
        newValue: unknown;
        requiresRestart: boolean;
      });
      ipcRenderer.on('config:changed', handler);
      return () => ipcRenderer.removeListener('config:changed', handler);
    },

    // Subscribe to config reloads
    onReloaded: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('config:reloaded', handler);
      return () => ipcRenderer.removeListener('config:reloaded', handler);
    },

    // TICKET_641_3: Get config health status
    getHealth: (): Promise<{
      success: boolean;
      health?: {
        status: 'healthy' | 'warning' | 'error';
        message: string;
        lastGoodLoadAt: number | null;
        usingFallback: boolean;
      };
      error?: string;
    }> => ipcRenderer.invoke('config:getHealth'),

    // TICKET_641_3: Subscribe to config health changes
    onHealthChanged: (callback: (health: {
      status: 'healthy' | 'warning' | 'error';
      message: string;
      lastGoodLoadAt: number | null;
      usingFallback: boolean;
    }) => void): (() => void) => {
      const handler = (_: unknown, health: {
        status: 'healthy' | 'warning' | 'error';
        message: string;
        lastGoodLoadAt: number | null;
        usingFallback: boolean;
      }) => callback(health);
      ipcRenderer.on('config:healthChanged', handler);
      return () => ipcRenderer.removeListener('config:healthChanged', handler);
    },
  },

  // ===========================================================================
  // Plugin Marketplace API (TICKET_051)
  // ===========================================================================
  marketplace: {
    // Get registry with stats and installed plugins
    getRegistry: (forceRefresh?: boolean): Promise<{
      success: boolean;
      registry?: RegistryPlugin[];
      stats?: Record<string, { downloads: number; stars: number; lastUpdated: string }>;
      installed?: InstalledPlugin[];
      error?: string;
    }> => ipcRenderer.invoke('marketplace:getRegistry', forceRefresh),

    // Get detailed plugin information
    getPluginDetails: (pluginId: string): Promise<{
      success: boolean;
      details?: unknown;
      installedVersion?: string;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:getPluginDetails', pluginId),

    // Install a plugin
    install: (pluginId: string, version?: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:install', pluginId, version),

    // Uninstall a plugin
    uninstall: (pluginId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:uninstall', pluginId),

    // Check for updates
    checkUpdates: (): Promise<{
      success: boolean;
      updates?: Array<{
        pluginId: string;
        currentVersion: string;
        latestVersion: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:checkUpdates'),

    // TICKET_447_1: Open external purchase URL
    openPurchaseUrl: (url: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:openPurchaseUrl', url),

    // TICKET_447_1: Validate a license key
    validateLicense: (pluginId: string, licenseKey: string): Promise<{
      success: boolean;
      data?: { valid: boolean; error?: string; expiresAt?: string };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:validateLicense', pluginId, licenseKey),

    // TICKET_447_1: Validate and store (activate) a license key
    activateLicense: (pluginId: string, licenseKey: string): Promise<{
      success: boolean;
      data?: { valid: boolean; error?: string; expiresAt?: string };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:activateLicense', pluginId, licenseKey),

    // TICKET_447_1: Get license statuses for multiple plugins
    getLicenseStatus: (pluginIds: string[]): Promise<{
      success: boolean;
      data?: Array<{
        pluginId: string;
        hasKey: boolean;
        valid: boolean;
        checkedAt: string;
        expiresAt?: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:getLicenseStatus', pluginIds),

    // TICKET_447_1: Remove a stored license key
    removeLicense: (pluginId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:removeLicense', pluginId),

    // Subscribe to install progress events
    onInstallProgress: (callback: (progress: InstallProgress) => void): (() => void) => {
      const handler = (_: unknown, progress: unknown) =>
        callback(progress as InstallProgress);
      ipcRenderer.on('marketplace:installProgress', handler);
      return () => ipcRenderer.removeListener('marketplace:installProgress', handler);
    },

    // Subscribe to install complete events
    onInstallComplete: (callback: (data: { pluginId: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string });
      ipcRenderer.on('marketplace:installComplete', handler);
      return () => ipcRenderer.removeListener('marketplace:installComplete', handler);
    },

    // Subscribe to install error events
    onInstallError: (callback: (data: { pluginId: string; error: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string; error: string });
      ipcRenderer.on('marketplace:installError', handler);
      return () => ipcRenderer.removeListener('marketplace:installError', handler);
    },

    // TICKET_447_1: Subscribe to license status change events
    onLicenseStatusChanged: (callback: (data: {
      pluginId: string;
      hasKey: boolean;
      valid: boolean;
      checkedAt: string;
      expiresAt?: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as {
          pluginId: string;
          hasKey: boolean;
          valid: boolean;
          checkedAt: string;
          expiresAt?: string;
        });
      ipcRenderer.on('marketplace:licenseStatusChanged', handler);
      return () => ipcRenderer.removeListener('marketplace:licenseStatusChanged', handler);
    },

    // TICKET_551: Check entitlement for a first-party paid plugin
    checkEntitlement: (pluginId: string): Promise<{
      success: boolean;
      data?: {
        pluginId: string;
        entitled: boolean;
        status: 'active' | 'expired' | 'revoked' | null;
        purchasedAt: string | null;
        expiresAt: string | null;
      };
      error?: string;
    }> => ipcRenderer.invoke('marketplace:checkEntitlement', pluginId),

    // TICKET_551: Batch check entitlements for multiple plugins
    checkEntitlementsBatch: (pluginIds: string[]): Promise<{
      success: boolean;
      data?: Array<{
        pluginId: string;
        entitled: boolean;
        status: 'active' | 'expired' | 'revoked' | null;
        purchasedAt: string | null;
        expiresAt: string | null;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('marketplace:checkEntitlementsBatch', pluginIds),

    // TICKET_551: Subscribe to entitlement change events (from deep link or polling)
    onEntitlementChanged: (callback: (data: {
      pluginId: string;
      entitled: boolean;
      status: 'active' | 'expired' | 'revoked' | null;
      purchasedAt: string | null;
      expiresAt: string | null;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as {
          pluginId: string;
          entitled: boolean;
          status: 'active' | 'expired' | 'revoked' | null;
          purchasedAt: string | null;
          expiresAt: string | null;
        });
      ipcRenderer.on('marketplace:entitlementChanged', handler);
      return () => ipcRenderer.removeListener('marketplace:entitlementChanged', handler);
    },

    // TICKET_805_2: Promo telemetry persistent state
    //
    // Renderer-side helpers for the once-only gates on
    // `marketplace.promo.first_run` and `marketplace.promo.converted`. Main
    // process owns the SQLite row; renderer is the emit site and decides
    // whether to call emitTelemetry based on the returned booleans.
    promoTelemetry: {
      markFirstRunIfFirst: (pluginId: string): Promise<{
        success: boolean;
        isFirstRun: boolean;
        error?: string;
      }> => ipcRenderer.invoke('marketplace:promoTelemetry:markFirstRunIfFirst', pluginId),

      setInstallWithPromoAt: (pluginId: string): Promise<{
        success: boolean;
        error?: string;
      }> => ipcRenderer.invoke('marketplace:promoTelemetry:setInstallWithPromoAt', pluginId),

      getInstallWithPromoAt: (pluginId: string): Promise<{
        success: boolean;
        installWithPromoAt: number | null;
        error?: string;
      }> => ipcRenderer.invoke('marketplace:promoTelemetry:getInstallWithPromoAt', pluginId),

      clearInstallWithPromoAt: (pluginId: string): Promise<{
        success: boolean;
        error?: string;
      }> => ipcRenderer.invoke('marketplace:promoTelemetry:clearInstallWithPromoAt', pluginId),
    },

    // TICKET_805_2: Subscribe to plugin-activation broadcasts (main -> renderer).
    // Fires every time a plugin's independent process is activated, from any
    // origin (renderer click, auto-activate, deep-link). The renderer hook
    // applies the once-per-plugin first_run gate via promoTelemetry above.
    onPluginActivated: (callback: (data: { pluginId: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string });
      ipcRenderer.on('marketplace:pluginActivated', handler);
      return () => ipcRenderer.removeListener('marketplace:pluginActivated', handler);
    },
  },

  // ===========================================================================
  // Logging API
  // ===========================================================================
  log: (level: 'debug' | 'info' | 'warn' | 'error', category: string, message: string, ...args: unknown[]): void => {
    ipcRenderer.send('log', level, category, message, ...args);
  },

  // ===========================================================================
  // Entitlement API (TICKET_066)
  // ===========================================================================
  entitlement: {
    // Get all entitlements for a specific plugin
    getPluginEntitlements: (pluginId: string): Promise<{
      success: boolean;
      data?: {
        pluginId: string;
        services: Array<{
          id: string;
          name: string;
          description?: string;
          tier: string;
          category?: string;
          icon?: string;
          enabled: boolean;
          effectiveEnabled: boolean;
          source: 'manifest' | 'user-config' | 'server';
          locked: boolean;
          lockReason?: string;
          quota?: number;
          used?: number;
        }>;
      };
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getPluginEntitlements', pluginId),

    // Get all entitlements across all registered plugins
    getAllEntitlements: (): Promise<{
      success: boolean;
      data?: Array<{
        pluginId: string;
        services: Array<{
          id: string;
          name: string;
          description?: string;
          tier: string;
          category?: string;
          icon?: string;
          enabled: boolean;
          effectiveEnabled: boolean;
          source: 'manifest' | 'user-config' | 'server';
          locked: boolean;
          lockReason?: string;
          quota?: number;
          used?: number;
        }>;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getAllEntitlements'),

    // Get a specific service state (searches all plugins)
    getServiceState: (serviceId: string): Promise<{
      success: boolean;
      data?: {
        id: string;
        name: string;
        description?: string;
        tier: string;
        category?: string;
        icon?: string;
        enabled: boolean;
        effectiveEnabled: boolean;
        source: 'manifest' | 'user-config' | 'server';
        locked: boolean;
        lockReason?: string;
        quota?: number;
        used?: number;
      };
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getServiceState', serviceId),

    // Check if a service is enabled (simple boolean)
    isServiceEnabled: (pluginId: string, serviceId: string): Promise<{
      success: boolean;
      data?: boolean;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:isServiceEnabled', pluginId, serviceId),

    // Toggle a service's enabled state
    toggleService: (pluginId: string, serviceId: string, enabled: boolean): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:toggleService', pluginId, serviceId, enabled),

    // Get audit log
    getAuditLog: (limit?: number): Promise<{
      success: boolean;
      data?: Array<{
        timestamp: number;
        pluginId: string;
        serviceId: string;
        action: string;
        result: string;
        reason?: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getAuditLog', limit),

    // Subscribe to service toggle events
    onServiceToggled: (callback: (data: {
      pluginId: string;
      serviceId: string;
      enabled: boolean;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string; serviceId: string; enabled: boolean });
      ipcRenderer.on('entitlement:serviceToggled', handler);
      return () => ipcRenderer.removeListener('entitlement:serviceToggled', handler);
    },

    // Subscribe to connection mode changes
    onConnectionModeChanged: (callback: (data: {
      mode: 'standalone' | 'connected';
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { mode: 'standalone' | 'connected' });
      ipcRenderer.on('entitlement:connectionModeChanged', handler);
      return () => ipcRenderer.removeListener('entitlement:connectionModeChanged', handler);
    },

    // TICKET_187: Subscribe to user tier changes
    onUserTierChanged: (callback: (data: {
      pluginId: string;
      tier: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { pluginId: string; tier: string });
      ipcRenderer.on('entitlement:userTierChanged', handler);
      return () => ipcRenderer.removeListener('entitlement:userTierChanged', handler);
    },

    // TICKET_190: Check LLM feature access (BYOK)
    // TICKET_705: Added selectedProvider param for provider-specific key validation
    canAccessLLMFeatures: (selectedProvider?: string): Promise<{
      success: boolean;
      data?: {
        allowed: boolean;
        source: 'platform' | 'byok' | 'none';
        reason: 'platform_key' | 'byok_configured' | 'no_key' | 'default_provider' | 'no_provider_configured' | 'selected_provider_not_configured';
        requiresBYOK: boolean;
        userTier: string | null;
        configuredProvider?: string;
      };
      error?: string;
    }> => ipcRenderer.invoke('entitlement:canAccessLLMFeatures', selectedProvider ? { selectedProvider } : undefined),

    // TICKET_190: Get configured BYOK providers
    getConfiguredBYOKProviders: (): Promise<{
      success: boolean;
      data?: string[];
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getConfiguredBYOKProviders'),

    // TICKET_194/195: Get LLM providers with verification status and models
    getLLMProvidersWithStatus: (): Promise<{
      success: boolean;
      data?: Array<{
        id: string;
        name: string;
        configured: boolean;
        status: 'platform' | 'verified' | 'unverified';
        defaultModel: string;
        models: Array<{ id: string; name: string }>; // TICKET_195
      }>;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getLLMProvidersWithStatus'),

    // TICKET_194: Set LLM provider validation status
    setLLMProviderValidationStatus: (providerId: string, validated: boolean): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:setLLMProviderValidationStatus', providerId, validated),

    // TICKET_194_1: Listen for LLM provider status changes
    onLLMProviderStatusChanged: (callback: (data: { providerId: string; validated: boolean }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { providerId: string; validated: boolean }) => callback(data);
      ipcRenderer.on('entitlement:llmProviderStatusChanged', handler);
      return () => ipcRenderer.removeListener('entitlement:llmProviderStatusChanged', handler);
    },

    // TICKET_1276 AC7: an external process (MCP standalone) changed the shared
    // LLM stores (selection file / credentials table); consumers re-fetch.
    onLLMExternalStoreChanged: (callback: (data: { kind: 'selection' | 'credentials'; provider?: string; model?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { kind: 'selection' | 'credentials'; provider?: string; model?: string }) => callback(data);
      ipcRenderer.on('llm:externalStoreChanged', handler);
      return () => ipcRenderer.removeListener('llm:externalStoreChanged', handler);
    },

    // TICKET_193: Resolve LLM API key for a provider
    resolveLLMApiKey: (providerId: string): Promise<{
      success: boolean;
      data?: {
        source: 'platform' | 'byok' | 'none';
        key?: string;
        providerId: string;
      };
      error?: string;
    }> => ipcRenderer.invoke('entitlement:resolveLLMApiKey', providerId),

    // TICKET_892_4: Get plugin ownership from server-authoritative cache
    getPluginOwnership: (pluginId: string): Promise<{
      success: boolean;
      data?: { owned: boolean; tier: string };
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getPluginOwnership', pluginId),

    // TICKET_1307: Tier-aware admission check
    checkPluginAdmission: (pluginId: string): Promise<{
      success: boolean;
      data?: { admitted: boolean; grantedTier: string; requiredTier: string; reason?: string };
      error?: string;
    }> => ipcRenderer.invoke('entitlement:checkPluginAdmission', pluginId),

    // TICKET_892_4: Get all entitled plugins from server-authoritative cache
    getEntitledPlugins: (): Promise<{
      success: boolean;
      data?: Array<{ plugin_id: string; tier: string }>;
      error?: string;
    }> => ipcRenderer.invoke('entitlement:getEntitledPlugins'),

  },

  // ===========================================================================
  // LLM Catalog API (TICKET_646 Phase 3)
  //
  // Unified catalog entry point. Thin wrapper over the same llm-key-resolver
  // calls. Phase 8: Legacy `nona:*` shims removed from entitlement namespace.
  // ===========================================================================
  llmCatalog: {
    getProviders: (): Promise<{
      success: boolean;
      data?: Array<{
        id: string;
        name: string;
        defaultModel: string;
        models: Array<{ id: string; name: string }>;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('llm-catalog:getProviders'),

    getModels: (providerId?: string): Promise<{
      success: boolean;
      data?: Array<{ id: string; name: string; category: string; tier?: string }>;
      error?: string;
    }> => ipcRenderer.invoke('llm-catalog:getModels', providerId),

    refresh: (): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('llm-catalog:refresh'),

    // TICKET_646 Phase 5: Offline-badge surface.
    // `getStatus()` returns the current catalog source + snapshot timestamp.
    // `onStatusChanged()` subscribes to live transitions; returns an unsubscribe.
    getStatus: (): Promise<{
      success: boolean;
      data?: {
        source: 'live' | 'snapshot' | 'empty';
        snapshotTimestamp: number | null;
        lastFetchAttempt: number | null;
      };
      error?: string;
    }> => ipcRenderer.invoke('llm-catalog:getStatus'),

    onStatusChanged: (
      handler: (status: {
        source: 'live' | 'snapshot' | 'empty';
        snapshotTimestamp: number | null;
        lastFetchAttempt: number | null;
      }) => void
    ): (() => void) => {
      const listener = (_event: unknown, status: {
        source: 'live' | 'snapshot' | 'empty';
        snapshotTimestamp: number | null;
        lastFetchAttempt: number | null;
      }) => handler(status);
      ipcRenderer.on('llm-catalog:onStatusChanged', listener);
      return () => {
        ipcRenderer.removeListener('llm-catalog:onStatusChanged', listener);
      };
    },
  },

  // ===========================================================================
  // BYOK Model Discovery API (TICKET_646_1 Phase 3)
  //
  // Fetches available models from each LLM provider's own API using the
  // user's stored BYOK key. Results are cached (24h TTL) per provider.
  // ===========================================================================
  byok: {
    getModels: (
      providerId: string,
      forceRefresh?: boolean
    ): Promise<{
      success: boolean;
      data?: Array<{ id: string; name: string }>;
      error?: string;
    }> => ipcRenderer.invoke('byok:getModels', providerId, forceRefresh),
  },

  // ===========================================================================
  // Locale API (TICKET_084)
  // ===========================================================================
  locale: {
    // Get initial locale (respects priority chain: user > system > default)
    getInitial: (): Promise<string> =>
      ipcRenderer.invoke('locale:getInitial'),

    // Set user locale preference (persisted)
    setUser: (locale: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('locale:setUser', locale),

    // Get all supported locales (sorted by sortOrder)
    getSupported: (): Promise<{
      success: boolean;
      locales: Array<{
        code: string;
        shortCode: string;
        name: string;
        localName: string;
      }>;
    }> => ipcRenderer.invoke('locale:getSupported'),

    // Get system locale (for debugging)
    getSystem: (): Promise<{ success: boolean; locale: string }> =>
      ipcRenderer.invoke('locale:getSystem'),

    // Locale changed outside this renderer (e.g. MCP set_locale) — TICKET_1235_8 AC2
    onChanged: (callback: (locale: string) => void): (() => void) => {
      const handler = (_: unknown, locale: string) => callback(locale);
      ipcRenderer.on('locale:changed', handler);
      return () => {
        ipcRenderer.removeListener('locale:changed', handler);
      };
    },
  },

  // ===========================================================================
  // Data Provider Defaults API (TICKET_811)
  // ===========================================================================
  // Persists the user's preferred default data provider per domain
  // (today: `us_equity` -> alpaca | alpha_vantage | polygon). Used by
  // the Tool Sweep ProviderPickerDialog (read on Run + write on "Use
  // as default") and the Settings ProviderCard radio.
  dataProviderDefaults: {
    get: (): Promise<Partial<Record<string, string>>> =>
      ipcRenderer.invoke('dataProviderDefaults:get'),
    set: (
      domain: string,
      providerId: string | null,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('dataProviderDefaults:set', domain, providerId),
    onChanged: (
      callback: (defaults: Partial<Record<string, string>>) => void,
    ): (() => void) => {
      const handler = (
        _event: unknown,
        defaults: Partial<Record<string, string>>,
      ) => callback(defaults);
      ipcRenderer.on('dataProviderDefaults:changed', handler);
      return () => {
        ipcRenderer.removeListener('dataProviderDefaults:changed', handler);
      };
    },
  },

  // ===========================================================================
  // Data Routing API (TICKET_927_2_2)
  // ===========================================================================
  // Per-market provider preference list. Renderer reads listMarkets to render
  // one row per MarketId in the Settings "Data routing" sub-panel; writes via
  // setMarketPreference to reorder. Persistence flows through
  // PluginConfigManager (host plugin id `com.stratcraft.data-routing`).
  dataRouting: {
    listMarkets: (): Promise<Array<{
      market: string;
      candidates: string[];
      preference: string[];
    }>> => ipcRenderer.invoke('dataRouting:listMarkets'),
    getMarketPreference: (
      market: string,
    ): Promise<{ ok: true; preference: string[] } | { ok: false; error: string }> =>
      ipcRenderer.invoke('dataRouting:getMarketPreference', market),
    setMarketPreference: (
      market: string,
      preference: string[],
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('dataRouting:setMarketPreference', market, preference),
  },

  // ===========================================================================
  // Authentication API (TICKET_066_1)
  // ===========================================================================
  auth: {
    // Initiate OAuth login flow (opens browser)
    login: (providerName?: string): Promise<{
      success: boolean;
      data?: { authUrl: string };
      error?: string;
    }> => ipcRenderer.invoke('auth:login', providerName),

    // Logout (revoke tokens and clear session)
    logout: (): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('auth:logout'),

    // Refresh tokens
    refresh: (): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('auth:refresh'),

    // Get current auth state
    getState: (): Promise<{
      success: boolean;
      data?: {
        isAuthenticated: boolean;
        user: {
          id: string;
          email: string;
          name: string;
          avatar?: string;
          plan: 'FREE' | 'PRO' | 'GOLD';
        } | null;
        expiresAt: number | null;
      };
      error?: string;
    }> => ipcRenderer.invoke('auth:getState'),

    // Get current user
    getUser: (): Promise<{
      success: boolean;
      data?: {
        id: string;
        email: string;
        name: string;
        avatar?: string;
        plan: 'FREE' | 'PRO' | 'GOLD';
      } | null;
      error?: string;
    }> => ipcRenderer.invoke('auth:getUser'),

    // Get access token (TICKET_165: Silent Token Refresh)
    getAccessToken: (): Promise<{
      success: boolean;
      data?: string | null;
      error?: string;
    }> => ipcRenderer.invoke('auth:getAccessToken'),

    // Subscribe to auth state changes
    onStateChanged: (callback: (data: {
      isAuthenticated: boolean;
      user: {
        id: string;
        email: string;
        name: string;
        avatar?: string;
        plan: 'FREE' | 'PRO' | 'GOLD';
      } | null;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as {
          isAuthenticated: boolean;
          user: {
            id: string;
            email: string;
            name: string;
            avatar?: string;
            plan: 'FREE' | 'PRO' | 'GOLD';
          } | null;
        });
      ipcRenderer.on('auth:stateChanged', handler);
      return () => ipcRenderer.removeListener('auth:stateChanged', handler);
    },

    // Subscribe to auth errors
    onError: (callback: (data: { error: string; code?: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { error: string; code?: string });
      ipcRenderer.on('auth:error', handler);
      return () => ipcRenderer.removeListener('auth:error', handler);
    },
  },

  // ===========================================================================
  // Inline Auth API (TICKET_564: In-App Registration)
  // ===========================================================================
  inlineAuth: {
    // Send verification code to email
    sendCode: (email: string): Promise<{
      success: boolean;
      data?: { message?: string; retryAfter?: number };
      error?: string;
    }> => ipcRenderer.invoke('inlineAuth:sendCode', email),

    // Login with email + password (triggers login on success)
    loginWithPassword: (email: string, password: string): Promise<{
      success: boolean;
      data?: {
        id: string;
        email: string;
        name: string;
        avatar?: string;
        plan: 'FREE' | 'PRO' | 'GOLD';
      };
      error?: string;
    }> => ipcRenderer.invoke('inlineAuth:loginPassword', email, password),

    // Verify email + code (triggers login on success)
    verifyCode: (email: string, code: string): Promise<{
      success: boolean;
      data?: {
        id: string;
        email: string;
        name: string;
        avatar?: string;
        plan: 'FREE' | 'PRO' | 'GOLD';
      };
      error?: string;
    }> => ipcRenderer.invoke('inlineAuth:verifyCode', email, code),
  },

  // ===========================================================================
  // Data Hub API (TICKET_117_1)
  // ===========================================================================
  hub: {
    // Entities
    invokeEntity: (action: string, entity: string, payload: any, pluginId: string) =>
      ipcRenderer.invoke(`entity:${action}:${entity}`, payload, pluginId),

    transaction: (operations: any[], pluginId: string) =>
      ipcRenderer.invoke('hub:transaction', operations, pluginId),

    // State
    setState: (key: string, value: any, pluginId: string) =>
      ipcRenderer.send('hub:state:set', { key, value, pluginId }),

    getState: (key: string) =>
      ipcRenderer.invoke('hub:state:get', key),

    getAllState: () =>
      ipcRenderer.invoke('hub:state:getAll'),

    onStateChanged: (callback: (data: any) => void) => {
      const handler = (_: unknown, data: any) => callback(data);
      ipcRenderer.on('hub:state:changed', handler);
      return () => ipcRenderer.removeListener('hub:state:changed', handler);
    },

    // Events
    emit: (type: string, payload: any, pluginId: string) =>
      ipcRenderer.send('hub:emit', { type, payload, pluginId }),

    replay: (type: string) =>
      ipcRenderer.invoke('hub:replay', type),

    onEvent: (callback: (data: any) => void) => {
      const handler = (_: unknown, data: any) => callback(data);
      ipcRenderer.on('hub:event', handler);
      return () => ipcRenderer.removeListener('hub:event', handler);
    },

    // Files (TICKET_117_2)
    findFiles: (query: any, pluginId: string) =>
      ipcRenderer.invoke('hub:file:find', query, pluginId),

    resolveFile: (fileId: string, pluginId: string) =>
      ipcRenderer.invoke('hub:file:resolve', fileId, pluginId),

    removeFile: (fileId: string, deleteFile: boolean, pluginId: string) =>
      ipcRenderer.invoke('hub:file:remove', { fileId, deleteFile }, pluginId),
  },

  // ===========================================================================
  // Kronos Predictor API (TICKET_205)
  // ===========================================================================
  kronos: {
    // Run Kronos AI prediction
    predict: (request: {
      model: string;
      lookback: number;
      pred_len: number;
      temperature: number;
      top_p: number;
      top_k: number;
      sample_count: number;
      time_range: 'latest' | 'custom';
      start_time?: string;
      strategy_name: string;
      signal_filter: {
        filters: {
          confidence: { enabled: boolean; min_value: number };
          expected_return: { enabled: boolean; min_value: number };
          direction_filter: { enabled: boolean; mode: string };
          magnitude: { enabled: boolean; min_value: number };
          consistency: { enabled: boolean; min_value: number };
        };
        combination_logic: 'AND' | 'OR';
      };
    }): Promise<{
      success: boolean;
      taskId?: string;
      // Synchronous result fields (TICKET_206)
      strategyCode?: string;
      className?: string;
      strategyName?: string;
      // Legacy prediction fields
      prediction?: {
        direction: 'buy' | 'sell' | 'hold';
        confidence: number;
        expectedReturn: number;
        magnitude: number;
      };
      error?: string;
    }> => ipcRenderer.invoke('kronos:predict', request),

    // Cancel running prediction
    cancel: (taskId: string): Promise<{
      success: boolean;
      taskId?: string;
      error?: string;
    }> => ipcRenderer.invoke('kronos:cancel', taskId),

    // Get available models
    getModels: (): Promise<{
      success: boolean;
      models?: Array<{
        id: string;
        name: string;
        params: string;
        maxContext: number;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('kronos:getModels'),

    // Subscribe to prediction progress
    onProgress: (callback: (data: {
      taskId: string;
      status: string;
      progress: number;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string; status: string; progress: number });
      ipcRenderer.on('kronos:progress', handler);
      return () => ipcRenderer.removeListener('kronos:progress', handler);
    },

    // Subscribe to prediction completion
    onComplete: (callback: (data: {
      taskId: string;
      result: {
        success: boolean;
        // Strategy code generation result (from backend)
        strategy_code?: string;
        class_name?: string;
        strategy_name?: string;
        // Legacy prediction fields
        prediction?: {
          direction: 'buy' | 'sell' | 'hold';
          confidence: number;
          expectedReturn: number;
          magnitude: number;
        };
        signals?: Array<{
          timestamp: number;
          direction: 'buy' | 'sell';
          confidence: number;
          expectedReturn: number;
        }>;
      };
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as {
          taskId: string;
          result: {
            success: boolean;
            strategy_code?: string;
            class_name?: string;
            strategy_name?: string;
            prediction?: {
              direction: 'buy' | 'sell' | 'hold';
              confidence: number;
              expectedReturn: number;
              magnitude: number;
            };
            signals?: Array<{
              timestamp: number;
              direction: 'buy' | 'sell';
              confidence: number;
              expectedReturn: number;
            }>;
          };
        });
      ipcRenderer.on('kronos:complete', handler);
      return () => ipcRenderer.removeListener('kronos:complete', handler);
    },

    // Subscribe to prediction errors
    onError: (callback: (data: {
      taskId?: string;
      message: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId?: string; message: string });
      ipcRenderer.on('kronos:error', handler);
      return () => ipcRenderer.removeListener('kronos:error', handler);
    },
  },

  // ===========================================================================
  // Kronos Price Prediction API (TICKET_226)
  // ===========================================================================
  kronosPrice: {
    // Check service health
    health: (): Promise<{
      success: boolean;
      data?: {
        status: string;
        available_models: string[];
      };
      error?: string;
    }> => ipcRenderer.invoke('kronos-price:health'),

    // Request price prediction (sync, up to 120s)
    predict: (request: {
      symbol: string;
      timeframe: string;
      data_source: 'client' | 'server';
      candles?: Array<{ open: number; high: number; low: number; close: number; volume: number }>;
      timestamps?: string[];
      prediction_settings?: {
        lookback?: number;
        pred_len?: number;
        model_version?: string;
      };
      advanced_settings?: {
        temperature?: number;
        top_p?: number;
        top_k?: number;
        sample_count?: number;
      };
    }): Promise<{
      success: boolean;
      data?: {
        symbol: string;
        timeframe: string;
        model_version: string;
        prediction_length: number;
        prediction: Array<{
          timestamp: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>;
      };
      error?: {
        code: string;
        message: string;
        retry_suggested?: boolean;
        retry_after_seconds?: number;
      };
    }> => ipcRenderer.invoke('kronos-price:predict', request),
  },

  // ===========================================================================
  // AI Conversation API (TICKET_077_19)
  // ===========================================================================
  conversation: {
    // Create a new conversation
    create: (data: {
      user_id: string;
      title?: string;
      preview?: string;
      token_limit?: number;
      strategy_rules?: string;
    }): Promise<{
      success: boolean;
      data?: {
        id: number;
        user_id: string;
        title: string;
        preview: string | null;
        message_count: number;
        token_usage: number;
        token_limit: number;
        strategy_rules: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      };
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('conversation:create', data),

    // Get a conversation by ID
    get: (id: number): Promise<{
      success: boolean;
      data?: {
        id: number;
        user_id: string;
        title: string;
        preview: string | null;
        message_count: number;
        token_usage: number;
        token_limit: number;
        strategy_rules: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      };
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('conversation:get', id),

    // List conversations for a user
    list: (options: {
      userId: string;
      limit?: number;
      offset?: number;
      status?: string;
    }): Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        user_id: string;
        title: string;
        preview: string | null;
        message_count: number;
        token_usage: number;
        token_limit: number;
        strategy_rules: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('conversation:list', options),

    // Update a conversation
    update: (id: number, data: {
      title?: string;
      preview?: string;
      message_count?: number;
      token_usage?: number;
      token_limit?: number;
      strategy_rules?: string;
      status?: 'active' | 'archived' | 'deleted';
    }): Promise<{
      success: boolean;
      data?: {
        id: number;
        user_id: string;
        title: string;
        preview: string | null;
        message_count: number;
        token_usage: number;
        token_limit: number;
        strategy_rules: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      };
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('conversation:update', { id, data }),

    // Delete a conversation
    delete: (id: number): Promise<{
      success: boolean;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('conversation:delete', id),

    // Search conversations
    search: (userId: string, query: string, limit?: number): Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        user_id: string;
        title: string;
        preview: string | null;
        message_count: number;
        token_usage: number;
        token_limit: number;
        strategy_rules: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('conversation:search', { userId, query, limit }),
  },

  // ===========================================================================
  // AI Message API (TICKET_077_19)
  // ===========================================================================
  message: {
    // Add a message to a conversation
    add: (data: {
      conversation_id: number;
      type: 'user' | 'assistant' | 'system';
      content: string;
      token_count?: number;
      metadata?: string;
    }): Promise<{
      success: boolean;
      data?: {
        messageId: number;
        conversation: {
          id: number;
          user_id: string;
          title: string;
          preview: string | null;
          message_count: number;
          token_usage: number;
          token_limit: number;
          strategy_rules: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
      };
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('message:add', data),

    // List messages for a conversation
    list: (conversationId: number, options?: {
      limit?: number;
      offset?: number;
    }): Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        conversation_id: number;
        type: 'user' | 'assistant' | 'system';
        content: string;
        token_count: number;
        metadata: string | null;
        created_at: string;
      }>;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('message:list', { conversationId, ...options }),

    // Delete a message
    delete: (messageId: number): Promise<{
      success: boolean;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('message:delete', messageId),
  },

  // ===========================================================================
  // Database API (TICKET_077_COMPONENT7)
  // ===========================================================================
  database: {
    // Get algorithms filtered by strategyType and/or signalSourcePrefix
    getAlgorithms: (options: GetAlgorithmsOptions): Promise<GetAlgorithmsResult> =>
      ipcRenderer.invoke('database:getAlgorithms', options),
  },

  // ===========================================================================
  // V3 Executor API (TICKET_133)
  // ===========================================================================
  executor: {
    // Run backtest with Executor
    // TICKET_157: Use shared BacktestExecutorRequest type
    runBacktest: (config: BacktestExecutorRequest): Promise<{
      success: boolean;
      taskId?: string;
      error?: string;
    }> => ipcRenderer.invoke('v3:run-backtest', config),

    // TICKET_366: Register task in queue before data download
    registerTask: (taskId: string, strategyName: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('v3:executor:register-task', { taskId, strategyName }),

    // Cancel running backtest
    cancelBacktest: (taskId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('v3:cancel-backtest', taskId),

    // TICKET_352 Phase 3: Cancel all queued and running backtests
    cancelAllBacktests: (): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('v3:queue-cancel-all'),

    // TICKET_352 Phase 3: Get executor queue status
    getQueueStatus: (): Promise<{
      success: boolean;
      data?: {
        tasks: Array<{
          taskId: string;
          status: 'preparing' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
          createdAt: number;
        }>;
        activeCount: number;
        queuedCount: number;
      };
      error?: string;
    }> => ipcRenderer.invoke('v3:queue-status'),

    // TICKET_352 Phase 3: Subscribe to queue status updates from backend
    onQueueStatus: (callback: (data: {
      tasks: Array<{
        taskId: string;
        status: 'preparing' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
        createdAt: number;
      }>;
      activeCount: number;
      queuedCount: number;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as {
        tasks: Array<{
          taskId: string;
          status: 'preparing' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
          createdAt: number;
        }>;
        activeCount: number;
        queuedCount: number;
      });
      ipcRenderer.on('executor:queue-status', handler);
      return () => ipcRenderer.removeListener('executor:queue-status', handler);
    },

    // Get backtest results
    getResults: (taskId: string): Promise<{
      success: boolean;
      status?: string;
      result?: {
        success: boolean;
        errorMessage?: string;
        metrics: {
          totalPnl: number;
          totalReturn: number;
          sharpeRatio: number;
          maxDrawdown: number;
          totalTrades: number;
          winRate: number;
        };
        equityCurve: Array<{ timestamp: number; equity: number; drawdown: number }>;
        trades: Array<{
          entryTime: number;
          exitTime: number;
          symbol: string;
          side: string;
          entryPrice: number;
          exitPrice: number;
          quantity: number;
          pnl: number;
        }>;
      };
      error?: string;
    }> => ipcRenderer.invoke('v3:get-results', taskId),

    // Get task status
    getTaskStatus: (taskId: string): Promise<{
      success: boolean;
      taskId?: string;
      status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      startTime?: number;
      endTime?: number;
      error?: string;
    }> => ipcRenderer.invoke('v3:get-task-status', taskId),

    // Generate strategy code (LLM)
    generateStrategy: (config: {
      prompt: string;
      strategyType?: string;
      indicators?: string[];
    }): Promise<{
      success: boolean;
      code?: string;
      strategyName?: string;
      error?: string;
    }> => ipcRenderer.invoke('v3:generate-strategy', config),

    // Save strategy to disk
    saveStrategy: (config: {
      name: string;
      code: string;
      params?: Record<string, unknown>;
      description?: string;
    }): Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }> => ipcRenderer.invoke('v3:save-strategy', config),

    // Load strategy from disk
    loadStrategy: (name: string): Promise<{
      success: boolean;
      code?: string;
      metadata?: Record<string, unknown>;
      path?: string;
      error?: string;
    }> => ipcRenderer.invoke('v3:load-strategy', name),

    // List all saved strategies
    listStrategies: (): Promise<{
      success: boolean;
      strategies?: Array<{
        name: string;
        path: string;
        description?: string;
        createdAt: number;
        modifiedAt: number;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('v3:list-strategies'),

    // TICKET_144: Generate workflow strategy from config
    generateWorkflowStrategy: (config: {
      workflows: unknown[];
      symbol: string;
      interval: string;
      startTime: number;
      endTime: number;
      initialCapital: number;
      confidenceWeightedSizing?: boolean;
    }): Promise<{
      success: boolean;
      strategyPath?: string;
      language?: 'cpp';
      // TICKET_1225 P4 / TICKET_1228: the handler returns the codegen FeedPlan;
      // the declaration must say so or callers lose the field at the type level.
      feedPlan?: FeedPlan;
      error?: string;
    }> => ipcRenderer.invoke('v3:generate-workflow-strategy', config),

    // TICKET_327: Query current phase from Main Process (late-subscriber replay)
    getCurrentPhase: (taskId: string): Promise<string | null> =>
      ipcRenderer.invoke('executor:getCurrentPhase', taskId),

    // Subscribe to executor events
    onStarted: (callback: (data: { taskId: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string });
      ipcRenderer.on('executor:started', handler);
      return () => ipcRenderer.removeListener('executor:started', handler);
    },

    // TICKET_321: Pipeline phase events from C++ executor
    // TICKET_387_P2: Added optional message for loading sub-step tooltip
    onPhase: (callback: (data: { taskId: string; phase: string; message?: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string; phase: string; message?: string });
      ipcRenderer.on('executor:phase', handler);
      return () => ipcRenderer.removeListener('executor:phase', handler);
    },

    onProgress: (callback: (data: {
      taskId: string;
      percent: number;
      message: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string; percent: number; message: string });
      ipcRenderer.on('executor:progress', handler);
      return () => ipcRenderer.removeListener('executor:progress', handler);
    },

    onCompleted: (callback: (data: {
      taskId: string;
      // TICKET_398_1: lightweight payload (no equityCurve/trades/candles).
      // TICKET_789 step 6: finalSeq is the seq of the [FINAL_SEQ] sentinel
      // emitted after stratforge-runner's last [INCREMENT_V2]; renderer
      // uses it to prove all increments have been observed before applying
      // terminal state. Field is best-effort: missing on crash/cancel paths
      // (executor-service falls back to lastObservedSeq).
      result: {
        success: boolean;
        errorMessage?: string;
        startTime?: number;
        endTime?: number;
        executionTimeMs?: number;
        metrics?: {
          totalPnl: number;
          totalReturn: number;
          sharpeRatio: number;
          maxDrawdown: number;
          totalTrades: number;
          winningTrades: number;
          losingTrades: number;
          winRate: number;
          profitFactor: number;
        };
        dryRunInfo?: unknown;
        finalSeq?: number;
      };
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback(data as any);
      ipcRenderer.on('executor:completed', handler);
      return () => ipcRenderer.removeListener('executor:completed', handler);
    },

    onError: (callback: (data: {
      taskId: string;
      error: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string; error: string });
      ipcRenderer.on('executor:error', handler);
      return () => ipcRenderer.removeListener('executor:error', handler);
    },

    onCancelled: (callback: (data: { taskId: string }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string });
      ipcRenderer.on('executor:cancelled', handler);
      return () => ipcRenderer.removeListener('executor:cancelled', handler);
    },

    // TICKET_155: Realtime chart updates with candles
    // TICKET_789 step 6: V2 wire shape carries monotonic `seq` per flush and
    // an `isFinal` terminal sentinel from upstream IncrementBatcher. The
    // renderer tracks lastAppliedSeq against [FINAL_SEQ]'s finalSeq to prove
    // every increment has been applied before terminal state.
    onIncrement: (callback: (data: {
      taskId: string;
      increment: {
        seq: number;
        isFinal?: boolean;
        droppedSinceLastFlush?: number;
        newCandles: Array<{
          timestamp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>;
        newTrades: Array<{
          entryTime: number;
          exitTime: number;
          symbol: string;
          side: string;
          entryPrice: number;
          exitPrice: number;
          quantity: number;
          pnl: number;
          commission: number;
          reason: string;
        }>;
        newEquityPoints: Array<{
          timestamp: number;
          equity: number;
          drawdown: number;
        }>;
        currentMetrics: {
          totalPnl: number;
          totalReturn: number;
          totalTrades: number;
          winningTrades: number;
          losingTrades: number;
          winRate: number;
        };
        processedBars: number;
        totalBars: number;
      };
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback(data as any);
      ipcRenderer.on('executor:increment', handler);
      return () => ipcRenderer.removeListener('executor:increment', handler);
    },

    // TICKET_398_2: Real-time dry run LLM call counts
    onDryRunLlm: (callback: (data: {
      taskId: string;
      dryRunLlm: {
        processedBars: number;
        totalBars: number;
        llmCalls: Array<{ label: string; count: number }>;
        totalLlmCalls: number;
      };
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { taskId: string; dryRunLlm: { processedBars: number; totalBars: number; llmCalls: Array<{ label: string; count: number }>; totalLlmCalls: number } });
      ipcRenderer.on('executor:dryRunLlm', handler);
      return () => ipcRenderer.removeListener('executor:dryRunLlm', handler);
    },

    // TICKET_077_C6: C++ strategy compilation status events
    compileAlgorithm: (request: {
      algorithmId: number | string;
      sourceCode?: string;
      strategyName?: string;
    }): Promise<{
      success: boolean;
      algorithmId: string;
      status: 'pending' | 'success' | 'error';
      artifactPath?: string;
      sourceHash?: string;
      error?: string;
    }> => ipcRenderer.invoke('v3:algorithm:compile', request),

    getCompilationStatus: (algorithmId: number): Promise<{
      success: boolean;
      data?: {
        algorithmId: string;
        status: string;
        error?: string;
      };
      error?: string;
    }> => ipcRenderer.invoke('v3:algorithm:get-compilation-status', algorithmId),

    onCompilationStatus: (callback: (data: CompilationStatusUpdate) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as CompilationStatusUpdate);
      ipcRenderer.on('v3:algorithm:compilation-status', handler);
      return () => ipcRenderer.removeListener('v3:algorithm:compilation-status', handler);
    },

    // TICKET_650 Phase 4: Backend validation report
    getValidationReport: (algorithmId: number): Promise<{
      success: boolean;
      data?: import('../shared/types/validation-report').ValidationReport | null;
      error?: string;
    }> => ipcRenderer.invoke('v3:algorithm:get-validation-report', algorithmId),

    // TICKET_153_1: History queries
    getHistory: (options?: { limit?: number }): Promise<{
      success: boolean;
      data?: Array<{
        task_id: string;
        strategy_name: string;
        symbol: string;
        timeframe: string;
        start_date: string;
        end_date: string;
        initial_capital: number;
        final_capital: number;
        total_pnl: number | null;
        total_return: number | null;
        sharpe_ratio: number | null;
        max_drawdown: number | null;
        win_rate: number | null;
        profit_factor: number | null;
        total_trades: number | null;
        execution_time_ms: number | null;
        created_at: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('backtest:getHistory', options),

    getHistoryResult: (taskId: string): Promise<{
      success: boolean;
      data?: {
        task_id: string;
        strategy_name: string;
        symbol: string;
        timeframe: string;
        trades_json: string | null;
        equity_curve_json: string | null;
        [key: string]: unknown;
      };
      error?: string;
    }> => ipcRenderer.invoke('backtest:getResult', taskId),

    deleteHistoryResult: (taskId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('backtest:deleteResult', taskId),

    // TICKET_360_1: Re-fetch candles from parquet cache for tab restore
    fetchCandles: (config: {
      symbol: string;
      interval: string;
      startDate: string;
      endDate: string;
      dataPath?: string;
    }): Promise<{
      success: boolean;
      candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>;
      error?: string;
    }> => ipcRenderer.invoke('backtest:fetchCandles', config),

    // TICKET_360 GAP-3: Open tabs persistence
    saveOpenTabs: (tabs: { taskId: string; strategyName: string; isActive: boolean; lastAccessedAt: number }[]): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('backtest:saveOpenTabs', tabs),

    loadOpenTabs: (): Promise<{
      success: boolean;
      data?: { task_id: string; strategy_name: string; is_active: number; last_accessed_at: number }[];
      error?: string;
    }> => ipcRenderer.invoke('backtest:loadOpenTabs'),

    // TICKET_371: Cancelled/failed task persistence
    loadTaskHistory: (options?: { limit?: number }): Promise<{
      success: boolean;
      data?: { task_id: string; strategy_name: string; status: string; error_message: string | null; created_at: number; finished_at: number }[];
      error?: string;
    }> => ipcRenderer.invoke('backtest:loadTaskHistory', options),

    deleteTaskHistory: (taskId: string): Promise<{
      success: boolean;
      error?: string;
    }> => ipcRenderer.invoke('backtest:deleteTaskHistory', taskId),

    // TICKET_886_6: Auto-persist builder signal on backtest complete
    autoPersist: (data: {
      strategyName: string;
      components: {
        analysis: { code: string; algorithmName: string };
        entry:    { code: string; algorithmName: string };
        exit?:    { code: string; algorithmName: string } | null;
      };
      builderMode: string;
      symbol: string;
      interval: string;
      dataProvider: string;
      dateRangeStart: string;
      dateRangeEnd: string;
      initialCapital: number;
      trades: unknown[];
      equityCurve: Array<{ timestamp: number; equity: number; drawdown: number }>;
      candles: unknown[];
      metrics: {
        sharpe: number;
        maxDrawdown: number;
        winRate: number;
        totalTrades: number;
        profitFactor?: number;
        totalReturn?: number;
      };
    }): Promise<{
      success: boolean;
      signalId?: number;
      error?: string;
    }> => ipcRenderer.invoke('backtest:auto-persist', data),

    // TICKET_886_7: exportToQuantLab removed (saved_strategies dead).
  },

  // ===========================================================================
  // TICKET_278: Factor Mining API (task-based async via nona_server)
  // ===========================================================================
  factor: {
    mining: {
      start: (params: {
        loopCount: number;
        hypothesisSource: string;
        maxDuration?: string;
      }): Promise<{
        success: boolean;
        data?: { taskId: string; taskType: string; status: string; createdAt: string };
        error?: string;
      }> => ipcRenderer.invoke('factor:mining:start', params),

      startFromReports: (params: {
        reportUrls: string[];
        maxReports?: number;
        maxDuration?: string;
      }): Promise<{
        success: boolean;
        data?: { taskId: string; taskType: string; status: string; createdAt: string };
        error?: string;
      }> => ipcRenderer.invoke('factor:mining:start-from-reports', params),

      uploadReports: (params: {
        filePaths: string[];
        maxReports?: number;
        maxDuration?: string;
      }): Promise<{
        success: boolean;
        data?: { taskId: string; taskType: string; status: string; createdAt: string };
        error?: string;
      }> => ipcRenderer.invoke('factor:mining:upload-reports', params),

      resume: (sessionId: string): Promise<{
        success: boolean;
        data?: { taskId: string; taskType: string; status: string; createdAt: string };
        error?: string;
      }> => ipcRenderer.invoke('factor:mining:resume', { sessionId }),
    },

    results: (taskId: string): Promise<{
      success: boolean;
      data?: {
        taskId: string;
        status: string;
        factors: Array<{ name: string; ic: number; icir: number; formula: string }>;
        bestIc: number;
        bestIcir: number;
      };
      error?: string;
    }> => ipcRenderer.invoke('factor:results', { taskId }),

    sessions: {
      list: (params?: { status?: string; resumableOnly?: boolean }): Promise<{
        success: boolean;
        data?: unknown[];
        error?: string;
      }> => ipcRenderer.invoke('factor:sessions:list', params),

      detail: (sessionId: string): Promise<{
        success: boolean;
        data?: unknown;
        error?: string;
      }> => ipcRenderer.invoke('factor:sessions:detail', { sessionId }),
    },

    // Local cached factors (populated by mining results)
    local: {
      list: (params?: { source?: string; category?: string; factor_type?: string }): Promise<{
        success: boolean;
        data?: Array<{
          id: string;
          name: string;
          category: string;
          source: string;
          factor_type: string; // TICKET_281: 'time_series' | 'cross_sectional'
          formula: string | null;
          translation_status: string | null; // TICKET_285: "ok" | "structured" | "unsupported"
          qlib_expr: string | null;          // TICKET_285: Qlib expression
          cs_pipeline: unknown[] | null;     // TICKET_285: Pipeline steps
          ic: number | null;
          icir: number | null;
          sharpe: number | null;
        }>;
        error?: string;
      }> => ipcRenderer.invoke('factor:local:list', params),
    },
  },

  // ===========================================================================
  // TICKET_286/287: Factor Catalog Registry API
  //
  // TICKET_1335 D2: `python_package` and `installed` are gone from this
  // surface. The column was removed because the locked pixi manifest owns
  // Python package identity, and `installed` was renamed `catalog_active`
  // because a seeded catalog is not evidence that a dependency is importable.
  // install/uninstall are renamed activate/deactivate for the same reason: this
  // layer no longer mutates packages.
  // ===========================================================================
  persona: {
    list: (): Promise<{
      success: boolean;
      data?: Array<{
        id: string;
        label: string;
        description: {
          must_include: string[];
          regime_bias: string[];
          holding_period: string;
          risk_style: string;
          forbidden: string[];
        };
      }>;
      total?: number;
      error?: string;
    }> => ipcRenderer.invoke('persona:list'),
  },

  // ===========================================================================
  // TICKET_519: Credit Status API
  // ===========================================================================
  credit: {
    getStatus: (): Promise<{
      success: boolean;
      data?: {
        hasCredit: boolean;
        remaining: number;
        totalRecharged?: number;
        totalConsumed?: number;
        updatedAt?: string;
        resetDate?: string;
      };
      error?: string;
    }> => ipcRenderer.invoke('credit:get-status'),
  },

  // ===========================================================================
  // TICKET_426_1: Algorithm Browser API
  // ===========================================================================
  algorithm: {
    list: (options: { userId?: string; strategyType?: number }): Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        code: string;
        strategyName: string;
        strategyType: number;
        classificationMetadata: string | null;
        strategyRules: string | null;
        status: number;
        createTime: string;
      }>;
      error?: unknown;
    }> => ipcRenderer.invoke('entity:list:nona_algorithm', options),

    // TICKET_886_7: exportAsSignalSource removed (saved_strategies dead).
  },

  // ===========================================================================
  // TICKET_426_1: Batch Strategy Generation API
  // ===========================================================================
  batchGeneration: {
    start: (config: {
      regime: string;
      indicators: string[];
      quantity: number;
      preference?: string;
      persona?: string | null;
      llmProvider?: string;
      llmModel?: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('batch-generation:start', config),

    cancel: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('batch-generation:cancel'),

    getState: (): Promise<{
      success: boolean;
      data?: BatchGenerationState;
      error?: string;
    }> => ipcRenderer.invoke('batch-generation:get-state'),

    onProgress: (callback: (data: {
      completed: number;
      total: number;
      currentName: string;
      algorithmId?: number;
      error?: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as {
        completed: number;
        total: number;
        currentName: string;
        algorithmId?: number;
        error?: string;
      });
      ipcRenderer.on('batch-generation:progress', handler);
      return () => ipcRenderer.removeListener('batch-generation:progress', handler);
    },

    onComplete: (callback: (data: {
      total: number;
      succeeded: number;
      failed: number;
      results: Array<{ algorithmId: number; strategyName: string }>;
      errors: Array<{ index: number; error: string }>;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as {
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{ algorithmId: number; strategyName: string }>;
        errors: Array<{ index: number; error: string }>;
      });
      ipcRenderer.on('batch-generation:complete', handler);
      return () => ipcRenderer.removeListener('batch-generation:complete', handler);
    },

    onError: (callback: (data: {
      message: string;
      partial?: boolean;
      completed?: number;
      total?: number;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as {
        message: string;
        partial?: boolean;
        completed?: number;
        total?: number;
      });
      ipcRenderer.on('batch-generation:error', handler);
      return () => ipcRenderer.removeListener('batch-generation:error', handler);
    },
  },

  // ===========================================================================
  // TICKET_568_1: Signal Discovery (Hypothesis-Testing Loop) API
  // TICKET_568_3: Dedup, auto-persistence, batch loop
  // ===========================================================================
  dataReadiness: {
    evaluate: (manifest: {
      runId: string;
      entries: ReadonlyArray<{
        market: string;
        symbol: string;
        interval: string;
        window: { startUtc: string; endUtc: string };
      }>;
    }): Promise<{
      runId: string;
      snapshotId?: string;
      entries: ReadonlyArray<{
        market: string;
        symbol: string;
        interval: string;
        window: { startUtc: string; endUtc: string };
        status: 'ready' | 'needs_ingest' | 'unsupported';
        providerId?: string;
        reason?: string;
      }>;
      summary: { ready: number; needsIngest: number; unsupported: number };
    }> => ipcRenderer.invoke('data-readiness:evaluate', manifest),

    run: (manifest: {
      runId: string;
      entries: ReadonlyArray<{
        market: string;
        symbol: string;
        interval: string;
        window: { startUtc: string; endUtc: string };
      }>;
    }): Promise<{ runId: string }> =>
      ipcRenderer.invoke('data-readiness:run', manifest),

    onProgress: (
      runId: string,
      callback: (msg: {
        kind: 'entry_started' | 'entry_completed' | 'entry_failed' | 'terminal';
        runId: string;
        entry?: {
          market: string;
          symbol: string;
          interval: string;
          window: { startUtc: string; endUtc: string };
          status: 'ready' | 'needs_ingest' | 'unsupported';
          providerId?: string;
          reason?: string;
        };
        providerId?: string;
        reason?: string;
        report?: {
          runId: string;
          snapshotId?: string;
          entries: ReadonlyArray<{
            market: string;
            symbol: string;
            interval: string;
            window: { startUtc: string; endUtc: string };
            status: 'ready' | 'needs_ingest' | 'unsupported';
            providerId?: string;
            reason?: string;
          }>;
          summary: { ready: number; needsIngest: number; unsupported: number };
        };
      }) => void,
    ): (() => void) => {
      const handler = (_: unknown, msg: { kind: string; runId: string; [k: string]: unknown }) => {
        if (msg.runId === runId) callback(msg as Parameters<typeof callback>[0]);
      };
      ipcRenderer.on('data-readiness:progress', handler);
      return () => ipcRenderer.removeListener('data-readiness:progress', handler);
    },
  },

  // ===========================================================================
  // TICKET_556: Workspace Sync API
  // ===========================================================================
  workspaceSync: {
    export: (targetDir: string): Promise<{
      success: boolean;
      exportedStrategies: number;
      exportedAlgorithms: number;
      exportedResults: number;
      error?: string;
    }> => ipcRenderer.invoke('v3:workspace:sync:export', targetDir),

    import: (sourceDir: string): Promise<{
      success: boolean;
      importedStrategies: number;
      importedAlgorithms: number;
      importedResults: number;
      error?: string;
    }> => ipcRenderer.invoke('v3:workspace:sync:import', sourceDir),

    getStatus: (targetDir: string): Promise<{
      success: boolean;
      data?: {
        lastSyncedAt: string | null;
        lastSyncedMachineId: string;
        targetDir: string;
        remoteManifest: {
          version: number;
          timestamp: string;
          machineId: string;
          appVersion: string;
          exportedAt: string;
        } | null;
      };
      error?: string;
    }> => ipcRenderer.invoke('v3:workspace:sync:status', targetDir),
  },

  // ===========================================================================
  // TICKET_546: Strategy Audit Scoring API
  // ===========================================================================
  audit: {
    getByAlgorithm: (algorithmId: number): Promise<{
      success: boolean;
      data?: {
        id: number;
        algorithm_id: number;
        signal_source: string;
        regime: string | null;
        llm_provider: string;
        llm_model: string;
        d1_completeness: number;
        d2_similarity: number;
        d3_indicator_fit: number;
        d4_code_quality: number;
        d5_robustness: number;
        overall_score: number;
        star_rating: number;
        audit_detail: string;
        code_hash: string;
        ast_fingerprint: string;
        create_time: string;
      } | null;
      error?: string;
    }> => ipcRenderer.invoke('audit:getByAlgorithm', algorithmId),

    list: (filters?: {
      signal_source?: string;
      llm_provider?: string;
      llm_model?: string;
      min_star?: number;
      max_star?: number;
      limit?: number;
    }): Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        algorithm_id: number;
        signal_source: string;
        llm_provider: string;
        llm_model: string;
        overall_score: number;
        star_rating: number;
        create_time: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke('audit:list', filters),

  },

  // =========================================================================
  // Diagnostics (TICKET_573: Production Log & Diagnostics)
  // =========================================================================
  diagnostics: {
    openLogFolder: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('diagnostics:openLogFolder'),
  },

  // =========================================================================
  // Consent (TICKET_573 Phase 4A: Sentry Crash Reporting)
  // =========================================================================
  consent: {
    getStatus: (): Promise<{
      success: boolean;
      consent?: { crashes: boolean; analytics: boolean; timestamp: string; appVersion: string };
      isFirstLaunch?: boolean;
      error?: string;
    }> => ipcRenderer.invoke('consent:getStatus'),
    setConsent: (crashes: boolean, analytics: boolean): Promise<{
      success: boolean;
      consent?: { crashes: boolean; analytics: boolean; timestamp: string; appVersion: string };
      error?: string;
    }> => ipcRenderer.invoke('consent:setConsent', crashes, analytics),
  },

  // =========================================================================
  // Database Backup API (TICKET_580_5)
  // =========================================================================
  databaseBackup: {
    backup: (): Promise<{
      success: boolean;
      path?: string;
      errorMessage?: string;
    }> => ipcRenderer.invoke('v3:database:backup'),
    restore: (backupPath: string): Promise<{
      success: boolean;
      errorMessage?: string;
    }> => ipcRenderer.invoke('v3:database:restore', backupPath),
    listBackups: (): Promise<{
      success: boolean;
      backups: Array<{
        path: string;
        filename: string;
        timestamp: number;
        size: number;
      }>;
      errorMessage?: string;
    }> => ipcRenderer.invoke('v3:database:list-backups'),
  },

  // =========================================================================
  // Recycle Bin API (TICKET_580_6)
  // =========================================================================
  recycleBin: {
    listDeleted: (table: string, options?: { limit?: number; offset?: number }): Promise<{
      success: boolean;
      records: Record<string, unknown>[];
      errorMessage?: string;
    }> => ipcRenderer.invoke('v3:recycle-bin:list-deleted', { table, ...options }),
    restore: (table: string, id: number | string): Promise<{
      success: boolean;
      errorMessage?: string;
    }> => ipcRenderer.invoke('v3:recycle-bin:restore', { table, id }),
    purge: (table: string, id: number | string): Promise<{
      success: boolean;
      errorMessage?: string;
    }> => ipcRenderer.invoke('v3:recycle-bin:purge', { table, id }),
  },

  // =========================================================================
  // Onboarding (TICKET_593: In-App Onboarding System)
  // =========================================================================
  onboarding: {
    getState: (): Promise<{
      success: boolean;
      state?: { enabled: boolean; assistantMode: boolean; completedTours: string[]; timestamp: string; appVersion: string };
      error?: string;
    }> => ipcRenderer.invoke('onboarding:getState'),
    setEnabled: (enabled: boolean): Promise<{
      success: boolean;
      state?: { enabled: boolean; assistantMode: boolean; completedTours: string[]; timestamp: string; appVersion: string };
      error?: string;
    }> => ipcRenderer.invoke('onboarding:setEnabled', enabled),
    setAssistantMode: (enabled: boolean): Promise<{
      success: boolean;
      state?: { enabled: boolean; assistantMode: boolean; completedTours: string[]; timestamp: string; appVersion: string };
      error?: string;
    }> => ipcRenderer.invoke('onboarding:setAssistantMode', enabled),
    markCompleted: (tourId: string): Promise<{
      success: boolean;
      state?: { enabled: boolean; assistantMode: boolean; completedTours: string[]; timestamp: string; appVersion: string };
      error?: string;
    }> => ipcRenderer.invoke('onboarding:markCompleted', tourId),
    reset: (): Promise<{
      success: boolean;
      state?: { enabled: boolean; assistantMode: boolean; completedTours: string[]; timestamp: string; appVersion: string };
      error?: string;
    }> => ipcRenderer.invoke('onboarding:reset'),
  },

  // =========================================================================
  // Signal Generator (TICKET_605: Bundled CCXT Signal Generator)
  // =========================================================================
  // =========================================================================
  // NONABT Phase 4A: C++ Toolchain
  // =========================================================================
  cppToolchain: {
    getStatus: (): Promise<{
      available: boolean;
      info?: {
        compiler: string;
        linker: string;
        sysroot?: string;
        stdlib: string;
        includes: string[];
        type: 'bundled' | 'system';
        version: string;
      };
      runner?: {
        path: string;
        type: 'bundled' | 'system';
      };
      error?: string;
      setupRequired: boolean;
    }> => ipcRenderer.invoke('v3:cpp-toolchain:status'),
  },

  // ===========================================================================
  // Distribution Detection API (TICKET_631 / TICKET_635)
  // ===========================================================================
  distribution: {
    getDistribution: (): Promise<string> => ipcRenderer.invoke('distribution:getDistribution'),
    isPublicRelease: (): Promise<boolean> => ipcRenderer.invoke('distribution:isPublicRelease'),
  },

  // ===========================================================================
  // Startup Audit API (TICKET_560_2)
  // ===========================================================================
  startupAudit: {
    getLatest: () => ipcRenderer.invoke('startup-audit:get-latest'),
    list: (limit?: number) => ipcRenderer.invoke('startup-audit:list', limit),
  },

  // ===========================================================================
  // API Proxy (TICKET_672: Route plugin requests through Main Process)
  // ===========================================================================
  api: {
    proxy: (req: { endpoint: string; method: string; body?: unknown; skipAuth?: boolean }): Promise<{ status: number; body: string }> =>
      ipcRenderer.invoke('api:proxy', req),
  },

  // ===========================================================================
  // Install Token API (TICKET_673 Task 8)
  // ===========================================================================
  installToken: {
    /** Get stored install token for anonymous free-tier requests */
    get: (): Promise<string | null> => ipcRenderer.invoke('installToken:get'),
    /** Re-register install token after invalidation (403 self-healing) */
    reRegister: (): Promise<string | null> => ipcRenderer.invoke('installToken:reRegister'),
  },

  // ===========================================================================
  // Rate Limit API (TICKET_704: Free-tier BYOK rate limit status)
  // ===========================================================================
  rateLimit: {
    /** Get current rate limit status (remaining quota, cooldown) */
    getStatus: (): Promise<{ limited: boolean; remaining: { minute: number; hour: number }; retryAfterMs: number }> =>
      ipcRenderer.invoke('rateLimit:status'),
  },

  // ===========================================================================
  // Scoreboard API (TICKET_196_6 Phase 3: Signal Performance Scoreboard)
  // ===========================================================================
  universe: {
    list: (provider: string): Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        name: string;
        provider: string;
        basedOn: string | null;
        symbolCount: number;
        updatedAt: number;
        targetSize: number | null;
      }>;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:list', provider),

    get: (id: number): Promise<{
      success: boolean;
      data?: {
        id: number;
        name: string;
        provider: string;
        basedOn: string | null;
        symbolCount: number;
        updatedAt: number;
        targetSize: number | null;
        symbols: string[];
      } | null;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:get', id),

    create: (params: {
      name: string;
      provider: string;
      symbols?: string[];
    }): Promise<{
      success: boolean;
      data?: { id: number };
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:create', params),

    update: (params: {
      id: number;
      name?: string;
      targetSize?: number | null;
    }): Promise<{
      success: boolean;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:update', params),

    delete: (id: number): Promise<{
      success: boolean;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:delete', id),

    addSymbols: (params: {
      universeId: number;
      symbols: string[];
    }): Promise<{
      success: boolean;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:addSymbols', params),

    removeSymbols: (params: {
      universeId: number;
      symbols: string[];
    }): Promise<{
      success: boolean;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('universe:removeSymbols', params),
  },

  // ===========================================================================
  // Nona Universe Registry API (TICKET_927_1_2_B)
  // ===========================================================================
  nonaUniverse: {
    persist: (params: {
      id: string;
      name?: string;
      sleeves: ReadonlyArray<{ providerId: string; symbols: ReadonlyArray<string> }>;
    }): Promise<{
      success: boolean;
      data?: {
        id: string;
        name: string;
        marketSleeves: Array<{ providerId: string; marketIds: string[]; symbols: string[] }>;
        symbols: string[];
        createdAt: number;
        updatedAt: number;
      };
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('nona-universe:persist', params),

    get: (id: string): Promise<{
      success: boolean;
      data?: {
        id: string;
        name: string;
        marketSleeves: Array<{ providerId: string; marketIds: string[]; symbols: string[] }>;
        symbols: string[];
        createdAt: number;
        updatedAt: number;
      } | null;
      error?: { code: string; message: string };
    }> => ipcRenderer.invoke('nona-universe:get', id),
  },

  // ===========================================================================
  // Auto-Update API (TICKET_882_1)
  // ===========================================================================
  update: {
    check: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:check'),

    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download'),

    install: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:install'),

    getStatus: (): Promise<{
      state: string;
      version?: string;
      releaseNotes?: string;
      progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
      error?: string;
    }> => ipcRenderer.invoke('update:get-status'),

    onStatusChanged: (callback: (status: {
      state: string;
      version?: string;
      releaseNotes?: string;
      progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
      error?: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('update:status-changed', handler);
      return () => ipcRenderer.removeListener('update:status-changed', handler);
    },
  },

  // TICKET_978: Sweep session state query + resume + dismiss
  sweep: {
    getSessionState: (): Promise<any> =>
      ipcRenderer.invoke('sweep:get-session-state'),
    resumeSession: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('sweep:resume-session'),
    dismissSession: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('sweep:dismiss-session'),
    // TICKET_978_1: Sweep queue management
    getQueue: (): Promise<any> =>
      ipcRenderer.invoke('sweep:queue-get'),
    enqueue: (session: any): Promise<{ success: boolean; queueId?: string; position?: number }> =>
      ipcRenderer.invoke('sweep:queue-enqueue', session),
    cancelQueue: (queueId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('sweep:queue-cancel', queueId),
    clearQueue: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('sweep:queue-clear'),
    onQueueChanged: (callback: (state: any) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) => callback(data as any);
      ipcRenderer.on('sweep:queue-changed', handler);
      return () => ipcRenderer.removeListener('sweep:queue-changed', handler);
    },
  },

  /**
   * TICKET_1334 P4 (D4 / AC5_1): who serves the Service API.
   *
   * The desktop app can be running while a headless `serve` runtime holds the
   * Service API runtime role (D3 -- the losing host starts everything else
   * normally). The launch controls still work in that case, because they reach
   * the SAME shared operation through whichever process hosts the transport --
   * so D4 keeps them enabled and labels them instead. This pair is how the
   * label learns the truth.
   *
   * TICKET_206: `getRole` is the direct await, `onRoleChanged` the async
   * subscription. Both carry the identical payload -- the role is re-sampled by
   * a watcher plus a liveness poll in main, so a boot-time read alone would go
   * stale the moment the external runtime is stopped or killed.
   *
   * The payload is `ServiceApiRuntimeRoleState` from `@StratCraft/types` -- the
   * same type main resolves and the renderer store holds, so the shape is
   * validated once and cannot drift across the boundary.
   */
  serviceApi: {
    getRole: (): Promise<ServiceApiRuntimeRoleState> =>
      ipcRenderer.invoke('service-api:get-role'),
    onRoleChanged: (
      callback: (state: ServiceApiRuntimeRoleState) => void,
    ): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as ServiceApiRuntimeRoleState);
      ipcRenderer.on('service-api:role-changed', handler);
      return () => ipcRenderer.removeListener('service-api:role-changed', handler);
    },
  },

  /**
   * TICKET_1335: research environment lifecycle.
   *
   * `install` and `repair` take NO parameters. This is the D6 contract made
   * structural rather than merely documented: there is no argument through which
   * a renderer could pass a confirmation boolean, approval token, or approval
   * object, because Main shows the dialog, observes the human, and builds the
   * approval itself. A renderer that wanted to fake approval would have nothing
   * to fake it with.
   *
   * Both resolve as soon as the job is admitted, returning its ID. They do not
   * wait for the download -- the renderer follows progress through `getJob`.
   */
  researchEnvironment: {
    getStatus: (): Promise<{ success: boolean; data?: ResearchEnvironmentStatus; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:get-status'),
    getJob: (jobId: string): Promise<{ success: boolean; data?: ResearchEnvironmentJob; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:get-job', jobId),
    verify: (): Promise<{ success: boolean; data?: { jobId: string }; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:verify'),
    install: (): Promise<{ success: boolean; data?: { jobId: string }; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:install'),
    repair: (): Promise<{ success: boolean; data?: { jobId: string }; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:repair'),
    uninstall: (): Promise<{ success: boolean; data?: { jobId: string }; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:uninstall'),
    removeGpquant: (): Promise<{ success: boolean; data?: { jobId: string }; error?: string; code?: string }> =>
      ipcRenderer.invoke('research-environment:remove-gpquant'),
  },

  // TICKET_1364: HistData forex acquisition
  histdataAcquisition: {
    review: (draft?: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('histdata-acquisition:review', draft),
    confirm: (args: { review: unknown; planFingerprint: string }): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('histdata-acquisition:confirm', args),
    execute: (confirmedPlan: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('histdata-acquisition:execute', confirmedPlan),
    onProgress: (callback: (progress: unknown) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on('histdata-acquisition:progress', handler);
      return () => ipcRenderer.removeListener('histdata-acquisition:progress', handler);
    },
  },

  // TICKET_897: System resource stats (CPU/memory) emitted by main process
  system: {
    onResourceStats: (callback: (stats: {
      cpuPercent: number;
      memUsedBytes: number;
      memTotalBytes: number;
      appMemUsedBytes: number;
      appCpuPercent: number;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as { cpuPercent: number; memUsedBytes: number; memTotalBytes: number; appMemUsedBytes: number; appCpuPercent: number });
      ipcRenderer.on('system:resource-stats', handler);
      return () => ipcRenderer.removeListener('system:resource-stats', handler);
    },
  },

  // TICKET_991_1: LSTM Model Management
  artifactStorage: {
    get: (): Promise<{
      success: boolean;
      data?: { configuredPath: string; resolvedPath: string; isDefault: boolean };
      error?: string;
    }> => ipcRenderer.invoke('artifact-storage:get'),

    set: (newPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('artifact-storage:set', newPath),

    usage: (): Promise<{
      success: boolean;
      data?: { totalBytes: number; directoryCount: number };
      error?: string;
    }> => ipcRenderer.invoke('artifact-storage:usage'),

    migrate: (newPath: string): Promise<{
      success: boolean;
      data?: { moved: number; dbUpdated: number };
      error?: string;
    }> => ipcRenderer.invoke('artifact-storage:migrate', newPath),
  },

  // TICKET_1303_1_10_1: renderer supplies navigation intent only. Main owns
  // the candidate policy, native confirmation, validation, and CAS commit.
  decisionTrustPolicy: {
    openSettings: (): Promise<{
      status: 'cancelled' | 'committed';
      policyVersion?: number;
    }> => ipcRenderer.invoke('trust-policy:open-settings'),
  },

  // ===========================================================================
  // TICKET_1208_1: Strategy Generation Background Persistence
  // ===========================================================================
  generation: {
    start: (config: {
      pageId: string;
      strategyName: string;
      startEndpoint: string;
      pollEndpoint: string;
      requestBody: Record<string, unknown>;
      pollInterval?: number;
      timeout?: number;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('generation:start', config),

    cancel: (pageId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('generation:cancel', { pageId }),

    getState: (pageId: string): Promise<{
      pageId: string;
      status: 'idle' | 'generating' | 'completed' | 'failed';
      result: unknown | null;
      error: string | null;
      strategyName: string;
      startedAt: number;
    } | null> =>
      ipcRenderer.invoke('generation:state', { pageId }),

    onComplete: (callback: (data: {
      pageId: string;
      status: string;
      strategy_code?: string;
      strategy_id?: number;
      reason_code?: string;
      language?: 'python' | 'cpp';
      includes?: string[];
      strategy_class?: string;
      error?: unknown;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('generation:complete', handler);
      return () => ipcRenderer.removeListener('generation:complete', handler);
    },

    onError: (callback: (data: {
      pageId: string;
      errorCode: string;
      errorMessage: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('generation:error', handler);
      return () => ipcRenderer.removeListener('generation:error', handler);
    },

    onStatus: (callback: (data: {
      pageId: string;
      status: 'idle' | 'generating' | 'completed' | 'failed';
      strategyName: string;
    }) => void): (() => void) => {
      const handler = (_: unknown, data: unknown) =>
        callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('generation:status', handler);
      return () => ipcRenderer.removeListener('generation:status', handler);
    },
  },

  // TICKET_1361 P5: Corrective Layer (PoP) operations
  corrective: {
    readConfig: (): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:read-config'),
    writeConfig: (partial: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:write-config', partial),
    validateReadiness: (): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:validate-readiness'),
    startTraining: (config?: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:start-training', config),
    getTrainingStatus: (jobId: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:get-training-status', jobId),
    publishArtifact: (jobId: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:publish-artifact', jobId),
    listArtifacts: (): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:list-artifacts'),
    getArtifactReport: (artifactId: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:get-artifact-report', artifactId),
    runComparison: (artifactId: string, strategyArtifactId: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:run-comparison', artifactId, strategyArtifactId),
    getComparison: (comparisonId: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('corrective:get-comparison', comparisonId),
  },

};

// Type Export
export type ElectronAPI = typeof api;

// Expose to window object
contextBridge.exposeInMainWorld('electronAPI', api);

// Type Declaration
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Log to main process via IPC
setTimeout(() => {
  if (typeof window !== 'undefined' && window.electronAPI?.log) {
    window.electronAPI.log('info', 'PRELOAD', 'Preload script loaded successfully');
  }
}, 0);
