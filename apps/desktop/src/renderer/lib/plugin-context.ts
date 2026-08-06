/**
 * PluginContext - Plugin Context
 *
 * Collection of APIs provided by host application to plugins
 * Plugins access through context:
 * - Logging service
 * - Storage service
 * - Command service
 * - Messaging service
 * - State service
 * - UI service
 * - Data service
 */

import type {
  PluginContext,
  PluginLogger,
  PluginStorage,
  PluginCommands,
  PluginMessaging,
  PluginStateApi,
  PluginUi,
  PluginData,
  DialogOptions,
  DialogResult,
  ProgressHandle,
  // Host/Plugin Architecture types (TICKET_059)
  TreeDataProvider,
  ViewProvider,
  CustomEditorProvider,
  Disposable,
  ViewOptions,
} from '@shared/types';
import { LOG_TRUNCATE_LENGTH } from '@shared/constants/formatting';
import { safeForEach } from '@shared/utils/safe-emit';
import i18n from 'i18next';
import { PluginError } from './plugin-loader';

// =============================================================================
// Logger Implementation
// =============================================================================

function createLogger(pluginId: string): PluginLogger {
  const prefix = `[Plugin:${pluginId}]`;

  return {
    debug: (message: string, ...args: unknown[]) => {
      console.debug(prefix, message, ...args);
    },
    info: (message: string, ...args: unknown[]) => {
      console.info(prefix, message, ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      console.warn(`[W:PLUGIN:SDK_WARN] ${prefix} ${message}`, ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      console.error(`[E:PLUGIN:SDK_ERROR] ${prefix} ${message}`, ...args);
    },
  };
}

// =============================================================================
// Storage Implementation
// =============================================================================

function createStorage(pluginId: string): PluginStorage {
  const storageKey = `plugin:${pluginId}:`;

  // Verify Electron API is available
  const requireElectronAPI = () => {
    if (!window.electronAPI) {
      throw new PluginError('PLUGIN_CONTEXT_STORAGE_API_UNAVAILABLE', 'Storage API not available: electronAPI is undefined');
    }
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      requireElectronAPI();
      const fullKey = storageKey + key;
      return window.electronAPI!.storeGet(fullKey);
    },

    async set<T>(key: string, value: T): Promise<void> {
      requireElectronAPI();
      const fullKey = storageKey + key;
      await window.electronAPI!.storeSet(fullKey, value);
    },

    async delete(key: string): Promise<void> {
      requireElectronAPI();
      const fullKey = storageKey + key;
      await window.electronAPI!.storeDelete(fullKey);
    },

    async keys(): Promise<string[]> {
      const prefix = storageKey;

      if (window.electronAPI?.storeKeys) {
        const allKeys = await window.electronAPI.storeKeys();
        return allKeys
          .filter((k: string) => k.startsWith(prefix))
          .map((k: string) => k.slice(prefix.length));
      }

      const result: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          result.push(key.slice(prefix.length));
        }
      }
      return result;
    },
  };
}

// =============================================================================
// Commands Implementation
// =============================================================================

// Global command registry
const globalCommandRegistry = new Map<string, (...args: unknown[]) => unknown>();

function createCommands(pluginId: string): PluginCommands {
  return {
    register(id: string, handler: (...args: unknown[]) => unknown): void {
      const fullId = id.includes('.') ? id : `${pluginId}.${id}`;
      globalCommandRegistry.set(fullId, handler);
    },

    async execute(id: string, ...args: unknown[]): Promise<unknown> {
      const handler = globalCommandRegistry.get(id);
      if (!handler) {
        throw new Error(i18n.t('renderer.plugin.commandNotFound', { ns: 'errors', id }));
      }
      return handler(...args);
    },

    getAll(): string[] {
      return Array.from(globalCommandRegistry.keys());
    },
  };
}

/**
 * Get global command registry
 */
export function getCommandRegistry(): Map<string, (...args: unknown[]) => unknown> {
  return globalCommandRegistry;
}

/**
 * Execute command
 */
export async function executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
  const handler = globalCommandRegistry.get(id);
  if (!handler) {
    throw new Error(`Command not found: ${id}`);
  }
  return handler(...args);
}

// =============================================================================
// Messaging Implementation
// =============================================================================

type MessageHandler = (source: string, message: unknown) => void;
const messageHandlers = new Map<string, Set<MessageHandler>>();

function createMessaging(pluginId: string): PluginMessaging {
  return {
    send(target: string, message: unknown): void {
      const handlers = messageHandlers.get(target);
      if (handlers) {
        safeForEach(handlers, `[E:PLUGIN:MESSAGE_HANDLER_ERROR] Message handler error in ${target}:`, pluginId, message);
      }
    },

    broadcast(message: unknown): void {
      for (const [targetId, handlers] of messageHandlers) {
        if (targetId !== pluginId) {
          safeForEach(handlers, `[E:PLUGIN:BROADCAST_HANDLER_ERROR] Broadcast handler error in ${targetId}:`, pluginId, message);
        }
      }
    },

    onMessage(handler: MessageHandler): void {
      let handlers = messageHandlers.get(pluginId);
      if (!handlers) {
        handlers = new Set();
        messageHandlers.set(pluginId, handlers);
      }
      handlers.add(handler);
    },
  };
}

// =============================================================================
// State Implementation
// =============================================================================

type StateSubscriber = (value: unknown) => void;
const pluginStates = new Map<string, Map<string, unknown>>();
const stateSubscribers = new Map<string, Set<StateSubscriber>>();

function createStateApi(pluginId: string): PluginStateApi {
  // Initialize plugin state storage
  if (!pluginStates.has(pluginId)) {
    pluginStates.set(pluginId, new Map());
  }

  return {
    get<T>(key: string): T | undefined {
      return pluginStates.get(pluginId)?.get(key) as T | undefined;
    },

    set<T>(key: string, value: T): void {
      const state = pluginStates.get(pluginId);
      if (state) {
        state.set(key, value);

        // Notify subscribers
        const subKey = `${pluginId}:${key}`;
        const subs = stateSubscribers.get(subKey);
        if (subs) {
          safeForEach(subs, `[E:PLUGIN:STATE_SUBSCRIBER_ERROR] State subscriber error for ${subKey}:`, value);
        }
      }
    },

    subscribe(key: string, handler: StateSubscriber): () => void {
      const subKey = `${pluginId}:${key}`;

      let subs = stateSubscribers.get(subKey);
      if (!subs) {
        subs = new Set();
        stateSubscribers.set(subKey, subs);
      }
      subs.add(handler);

      // Return unsubscribe function
      return () => {
        subs?.delete(handler);
        if (subs?.size === 0) {
          stateSubscribers.delete(subKey);
        }
      };
    },
  };
}

// =============================================================================
// UI Implementation
// =============================================================================

function createUi(): PluginUi {
  const requireElectronAPI = () => {
    if (!window.electronAPI) {
      throw new PluginError('PLUGIN_CONTEXT_UI_API_UNAVAILABLE', 'UI API not available: electronAPI is undefined');
    }
  };

  return {
    showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
      requireElectronAPI();
      if (!window.electronAPI!.showNotification) {
        throw new PluginError('PLUGIN_CONTEXT_SHOW_NOTIFICATION_UNAVAILABLE', 'showNotification API not available');
      }
      window.electronAPI!.showNotification({ message, type });
    },

    async showDialog(options: DialogOptions): Promise<DialogResult> {
      requireElectronAPI();
      if (!window.electronAPI!.showDialog) {
        throw new PluginError('PLUGIN_CONTEXT_SHOW_DIALOG_UNAVAILABLE', 'showDialog API not available');
      }
      return window.electronAPI!.showDialog(options);
    },

    showProgress(title: string): ProgressHandle {
      requireElectronAPI();

      let currentProgress = 0;
      let currentMessage = '';
      const progressId = `progress-${Date.now()}`;

      if (!window.electronAPI!.showProgress) {
        throw new PluginError('PLUGIN_CONTEXT_SHOW_PROGRESS_UNAVAILABLE', 'showProgress API not available');
      }
      window.electronAPI!.showProgress({ id: progressId, title });

      return {
        update(progress: number, message?: string): void {
          currentProgress = progress;
          if (message) currentMessage = message;

          if (!window.electronAPI?.updateProgress) {
            throw new PluginError('PLUGIN_CONTEXT_UPDATE_PROGRESS_UNAVAILABLE', 'updateProgress API not available');
          }
          window.electronAPI.updateProgress({
            id: progressId,
            progress: currentProgress,
            message: currentMessage,
          });
        },

        done(): void {
          if (!window.electronAPI?.hideProgress) {
            throw new PluginError('PLUGIN_CONTEXT_HIDE_PROGRESS_UNAVAILABLE', 'hideProgress API not available');
          }
          window.electronAPI.hideProgress(progressId);
        },
      };
    },
  };
}

// =============================================================================
// Data Implementation
// =============================================================================

function createDataApi(): PluginData {
  const requireElectronAPI = () => {
    if (!window.electronAPI) {
      throw new PluginError('PLUGIN_CONTEXT_DATA_API_UNAVAILABLE', 'Data API not available: electronAPI is undefined');
    }
  };

  return {
    async getMarketData(
      symbol: string,
      interval: string,
      start: string,
      end: string
    ): Promise<unknown[]> {
      requireElectronAPI();
      if (!window.electronAPI!.getMarketData) {
        throw new PluginError('PLUGIN_CONTEXT_GET_MARKET_DATA_UNAVAILABLE', 'getMarketData API not available');
      }
      return window.electronAPI!.getMarketData({ symbol, interval, start, end });
    },

    async getSymbols(): Promise<string[]> {
      requireElectronAPI();
      if (!window.electronAPI!.getSymbols) {
        throw new PluginError('PLUGIN_CONTEXT_GET_SYMBOLS_UNAVAILABLE', 'getSymbols API not available');
      }
      return window.electronAPI!.getSymbols();
    },
  };
}

// =============================================================================
// Window API Implementation (TICKET_059 - Host/Plugin Architecture)
// =============================================================================

// Global registries for Host/Plugin communication
const treeDataProviderRegistry = new Map<string, TreeDataProvider<unknown>>();
const viewProviderRegistry = new Map<string, ViewProvider>();
const customEditorProviderRegistry = new Map<string, CustomEditorProvider>();

// TICKET_300: Breadcrumb state removed - now managed centrally via useAppStore.subPagePath + useBreadcrumbs hook

// View state
let currentViewId: string | null = null;
let currentViewOptions: ViewOptions | undefined;
const viewChangeListeners = new Set<(viewId: string, options?: ViewOptions) => void>();

// Editor state
let activeEditor: { resourceUri: string; viewType: string } | undefined;
const editorChangeListeners = new Set<(editor: typeof activeEditor) => void>();

// Tree refresh listeners
const treeRefreshListeners = new Map<string, Set<() => void>>();

/**
 * Window API for Host/Plugin communication
 */
export const windowApi = {
  // ---------------------------------------------------------------------------
  // Tree Data Provider Management
  // ---------------------------------------------------------------------------

  registerTreeDataProvider<T>(
    viewId: string,
    provider: TreeDataProvider<T>
  ): Disposable {
    treeDataProviderRegistry.set(viewId, provider as TreeDataProvider<unknown>);
    console.debug(`[Window] TreeDataProvider registered for view: ${viewId}`);

    return {
      dispose: () => {
        treeDataProviderRegistry.delete(viewId);
        console.debug(`[Window] TreeDataProvider disposed for view: ${viewId}`);
      },
    };
  },

  getTreeDataProvider<T>(viewId: string): TreeDataProvider<T> | undefined {
    return treeDataProviderRegistry.get(viewId) as TreeDataProvider<T> | undefined;
  },

  refreshTreeView(viewId: string): void {
    const listeners = treeRefreshListeners.get(viewId);
    if (listeners) {
      safeForEach(listeners, `[E:PLUGIN:TREE_REFRESH_ERROR] [Window] Tree refresh listener error for ${viewId}:`);
    }
  },

  onTreeRefresh(viewId: string, callback: () => void): Disposable {
    let listeners = treeRefreshListeners.get(viewId);
    if (!listeners) {
      listeners = new Set();
      treeRefreshListeners.set(viewId, listeners);
    }
    listeners.add(callback);

    return {
      dispose: () => {
        listeners?.delete(callback);
        if (listeners?.size === 0) {
          treeRefreshListeners.delete(viewId);
        }
      },
    };
  },

  // ---------------------------------------------------------------------------
  // TICKET_300: Breadcrumb API removed - now managed centrally via useAppStore.subPagePath + useBreadcrumbs hook
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // View Provider Management
  // ---------------------------------------------------------------------------

  registerViewProvider(viewId: string, provider: ViewProvider): Disposable {
    viewProviderRegistry.set(viewId, provider);
    console.info(`[Window] ViewProvider registered: ${viewId}, registry size: ${viewProviderRegistry.size}`);
    console.info(`[Window] ViewProvider verify after set: ${viewProviderRegistry.has(viewId)}`);
    window.dispatchEvent(new CustomEvent('nexus:view-provider-registered', { detail: { viewId } }));
    console.info(`[Window] nexus:view-provider-registered event dispatched for: ${viewId}`);

    return {
      dispose: () => {
        const existing = viewProviderRegistry.get(viewId);
        if (existing === provider) {
          existing.dispose?.();
          viewProviderRegistry.delete(viewId);
          console.debug(`[Window] ViewProvider disposed: ${viewId}`);
        }
      },
    };
  },

  getViewProvider(viewId: string): ViewProvider | undefined {
    const result = viewProviderRegistry.get(viewId);
    console.info(`[Window] getViewProvider('${viewId}'): ${result ? 'FOUND' : 'NOT FOUND'}, registry size: ${viewProviderRegistry.size}, keys: [${[...viewProviderRegistry.keys()].join(', ')}]`);
    return result;
  },

  async openView(viewId: string, options?: ViewOptions): Promise<void> {
    const provider = viewProviderRegistry.get(viewId);
    if (!provider) {
      console.warn(`[W:PLUGIN:VIEW_PROVIDER_NOT_FOUND] [Window] No ViewProvider found for: ${viewId}`);
    }

    currentViewId = viewId;
    currentViewOptions = options;

    // Notify Host components
    safeForEach(viewChangeListeners, '[E:PLUGIN:VIEW_CHANGE_LISTENER_ERROR] [Window] View change listener error:', viewId, options);

    window.dispatchEvent(
      new CustomEvent('nexus:view-change', { detail: { viewId, options } })
    );
  },

  closeView(viewId: string): void {
    if (currentViewId === viewId) {
      currentViewId = null;
      currentViewOptions = undefined;

      window.dispatchEvent(
        new CustomEvent('nexus:view-close', { detail: { viewId } })
      );
    }
  },

  getCurrentView(): { viewId: string | null; options?: ViewOptions } {
    return { viewId: currentViewId, options: currentViewOptions };
  },

  onViewChange(callback: (viewId: string, options?: ViewOptions) => void): Disposable {
    viewChangeListeners.add(callback);

    return {
      dispose: () => {
        viewChangeListeners.delete(callback);
      },
    };
  },

  // ---------------------------------------------------------------------------
  // Custom Editor Provider Management
  // ---------------------------------------------------------------------------

  registerCustomEditorProvider(
    viewType: string,
    provider: CustomEditorProvider
  ): Disposable {
    customEditorProviderRegistry.set(viewType, provider);
    console.debug(`[Window] CustomEditorProvider registered: ${viewType}`);

    return {
      dispose: () => {
        const existing = customEditorProviderRegistry.get(viewType);
        if (existing === provider) {
          existing.dispose?.();
          customEditorProviderRegistry.delete(viewType);
          console.debug(`[Window] CustomEditorProvider disposed: ${viewType}`);
        }
      },
    };
  },

  getCustomEditorProvider(viewType: string): CustomEditorProvider | undefined {
    return customEditorProviderRegistry.get(viewType);
  },

  async openEditor(resourceUri: string, viewType: string): Promise<void> {
    const provider = customEditorProviderRegistry.get(viewType);
    if (!provider) {
      console.warn(`[W:PLUGIN:EDITOR_PROVIDER_NOT_FOUND] [Window] No CustomEditorProvider found for: ${viewType}`);
    }

    activeEditor = { resourceUri, viewType };

    // Notify Host components
    safeForEach(editorChangeListeners, '[E:PLUGIN:EDITOR_CHANGE_LISTENER_ERROR] [Window] Editor change listener error:', activeEditor);

    window.dispatchEvent(
      new CustomEvent('nexus:editor-open', { detail: activeEditor })
    );
  },

  getActiveEditor(): { resourceUri: string; viewType: string } | undefined {
    return activeEditor;
  },

  onEditorChange(
    callback: (editor: { resourceUri: string; viewType: string } | undefined) => void
  ): Disposable {
    editorChangeListeners.add(callback);

    return {
      dispose: () => {
        editorChangeListeners.delete(callback);
      },
    };
  },

  // ---------------------------------------------------------------------------
  // Registry Getters (for Host components)
  // ---------------------------------------------------------------------------

  getAllTreeDataProviders(): Map<string, TreeDataProvider<unknown>> {
    return new Map(treeDataProviderRegistry);
  },

  getAllViewProviders(): Map<string, ViewProvider> {
    return new Map(viewProviderRegistry);
  },

  getAllCustomEditorProviders(): Map<string, CustomEditorProvider> {
    return new Map(customEditorProviderRegistry);
  },

  // ---------------------------------------------------------------------------
  // Message Dialogs (TICKET_096)
  // ---------------------------------------------------------------------------

  /**
   * Show an alert dialog (single Ok button)
   * @param message - The message to display
   * @param options - Optional title
   */
  showAlert(message: string, options?: { title?: string; action?: string }): Promise<void> {
    console.log('[WindowApi] showAlert called with:', message?.substring(0, LOG_TRUNCATE_LENGTH));
    return new Promise(resolve => {
      const requestId = `modal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const handleResponse = (event: Event) => {
        const customEvent = event as CustomEvent<{ requestId: string; result: boolean }>;
        if (customEvent.detail.requestId === requestId) {
          window.removeEventListener('nexus:modal-response', handleResponse);
          resolve();
        }
      };

      window.addEventListener('nexus:modal-response', handleResponse);
      console.log('[WindowApi] Dispatching nexus:modal-request event, requestId:', requestId);
      window.dispatchEvent(
        new CustomEvent('nexus:modal-request', {
          detail: {
            requestId,
            type: 'alert',
            content: message,
            title: options?.title,
            action: options?.action,
          },
        })
      );
    });
  },

  /**
   * Show a confirm dialog (Ok + Cancel buttons)
   * @param message - The message to display
   * @param options - Optional title, variant, and button labels.
   *   `variant: 'destructive'` swaps the dialog to a red Trash2 header + red
   *   OK button (TICKET_770) for delete/remove confirmations. Default is the
   *   neutral teal confirm style.
   * @returns Promise resolving to true if Ok clicked, false if Cancel
   */
  showConfirm(
    message: string,
    options?: {
      title?: string;
      variant?: 'confirm' | 'destructive';
      okText?: string;
      cancelText?: string;
    }
  ): Promise<boolean> {
    return new Promise(resolve => {
      const requestId = `modal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const handleResponse = (event: Event) => {
        const customEvent = event as CustomEvent<{ requestId: string; result: boolean }>;
        if (customEvent.detail.requestId === requestId) {
          window.removeEventListener('nexus:modal-response', handleResponse);
          resolve(customEvent.detail.result);
        }
      };

      window.addEventListener('nexus:modal-response', handleResponse);
      window.dispatchEvent(
        new CustomEvent('nexus:modal-request', {
          detail: {
            requestId,
            // 'destructive' is a distinct modal variant; ModalProvider maps
            // it through to ModalDialog's destructive styling. 'confirm' is
            // the default neutral form for back-compat with existing callers.
            type: options?.variant === 'destructive' ? 'destructive' : 'confirm',
            content: message,
            title: options?.title,
            okText: options?.okText,
            cancelText: options?.cancelText,
          },
        })
      );
    });
  },

  /**
   * Show a toast notification
   * @param message - The message to display
   * @param type - Notification type (info, success, warning, error)
   */
  showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    if (!window.electronAPI?.showNotification) {
      console.warn('[W:PLUGIN:NOTIFICATION_API_MISSING] [Window] showNotification API not available');
      return;
    }
    window.electronAPI.showNotification({ message, type });
  },

  async openExternal(url: string): Promise<void> {
    const result = await window.electronAPI?.marketplace?.openPurchaseUrl(url);
    if (!result?.success) {
      throw new Error(result?.error || 'MSG_EXTERNAL_URL_OPEN_FAILED');
    }
  },
};

// =============================================================================
// Context Factory
// =============================================================================

/**
 * Create plugin context
 */
export function createPluginContext(pluginId: string, pluginPath: string): PluginContext {
  return {
    pluginId,
    pluginPath,
    log: createLogger(pluginId),
    storage: createStorage(pluginId),
    commands: createCommands(pluginId),
    messaging: createMessaging(pluginId),
    state: createStateApi(pluginId),
    ui: createUi(),
    data: createDataApi(),
  };
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Cleanup plugin context
 */
export function cleanupPluginContext(pluginId: string): void {
  // Cleanup state
  pluginStates.delete(pluginId);

  // Cleanup state subscriptions
  for (const key of stateSubscribers.keys()) {
    if (key.startsWith(`${pluginId}:`)) {
      stateSubscribers.delete(key);
    }
  }

  // Cleanup message handlers
  messageHandlers.delete(pluginId);

  // Cleanup commands
  for (const key of globalCommandRegistry.keys()) {
    if (key.startsWith(`${pluginId}.`)) {
      globalCommandRegistry.delete(key);
    }
  }
}

// =============================================================================
// Global Type Augmentation (Handled by preload/index.ts)
// =============================================================================

// =============================================================================
// Global Injection (TICKET_059 - Host/Plugin Architecture)
// =============================================================================

// Inject windowApi into globalThis for plugin access
// Plugins access via: globalThis.nexus?.window
declare global {
  // eslint-disable-next-line no-var
  var nexus: {
    window: typeof windowApi;
  } | undefined;
}

// Initialize global nexus object
if (typeof globalThis.nexus === 'undefined') {
  (globalThis as unknown as { nexus: object }).nexus = {};
}
(globalThis as unknown as { nexus: { window: typeof windowApi } }).nexus.window = windowApi;

// =============================================================================
// Default Export
// =============================================================================

export default createPluginContext;
