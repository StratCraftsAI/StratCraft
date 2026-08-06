/**
 * Ambient type declarations for StratCraft plugin host APIs.
 *
 * Declare only the subset of window.electronAPI that your plugin actually uses.
 * The full API is available at runtime; these declarations provide type safety
 * during development.
 */

// -- Host-provided Plugin Context ------------------------------------------

interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

interface PluginCommands {
  register(commandId: string, callback: (...args: unknown[]) => void): void;
  execute(commandId: string, ...args: unknown[]): Promise<void>;
}

interface PluginMessaging {
  send(targetPluginId: string, message: unknown): void;
  onMessage(callback: (fromPluginId: string, message: unknown) => void): void;
}

interface PluginStateApi {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  onChange(key: string, callback: (value: unknown) => void): void;
}

interface PluginUi {
  showNotification(options: {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
  }): void;
}

interface PluginData {
  // Declare data API methods your plugin uses
}

interface PluginContext {
  pluginId: string;
  pluginPath: string;
  log: PluginLogger;
  storage: PluginStorage;
  commands: PluginCommands;
  messaging: PluginMessaging;
  state: PluginStateApi;
  ui: PluginUi;
  data: PluginData;
}

interface PluginApi {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;
}

// -- Host-provided Window API (globalThis.nexus.window) --------------------

interface ViewProvider {
  render: () => React.ReactNode;
}

interface NexusWindowApi {
  registerViewProvider(viewId: string, provider: ViewProvider): { dispose(): void };
  registerTreeDataProvider(viewId: string, provider: unknown): { dispose(): void };
  openView(viewId: string): void;
  closeView(viewId: string): void;
  showAlert(options: { title: string; message: string }): Promise<void>;
  showConfirm(options: { title: string; message: string }): Promise<boolean>;
  showNotification(options: { message: string; type?: string }): void;
}

// -- Electron IPC bridge ---------------------------------------------------

interface ElectronAPI {
  // Declare only the IPC methods your plugin calls.
  // Example:
  // myFeature: {
  //   getData(): Promise<{ success: boolean; data?: unknown; error?: string }>;
  // };
}

// -- Global augmentation ---------------------------------------------------

declare global {
  var nexus: { window: NexusWindowApi } | undefined;

  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
