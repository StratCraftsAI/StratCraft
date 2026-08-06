/**
 * Chart Plugin Types
 *
 * Type definitions imported from host application
 */

// PluginContext - API provided by host to plugins
export interface PluginContext {
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

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PluginCommands {
  register(id: string, handler: (...args: unknown[]) => unknown): void;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  getAll(): string[];
}

export interface PluginMessaging {
  send(target: string, message: unknown): void;
  broadcast(message: unknown): void;
  onMessage(handler: (source: string, message: unknown) => void): void;
}

export interface PluginStateApi {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, handler: (value: unknown) => void): () => void;
}

export interface PluginUi {
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  showDialog(options: DialogOptions): Promise<DialogResult>;
  showProgress(title: string): ProgressHandle;
}

export interface DialogOptions {
  title: string;
  message: string;
  buttons?: string[];
  type?: 'info' | 'warning' | 'error' | 'question';
}

export interface DialogResult {
  button: string;
  checkboxChecked?: boolean;
}

export interface ProgressHandle {
  update(progress: number, message?: string): void;
  done(): void;
}

export interface PluginData {
  getMarketData(symbol: string, interval: string, start: string, end: string): Promise<CandleData[]>;
  getSymbols(): Promise<string[]>;
}

// PluginApi - API provided by plugin to host
export interface PluginApi {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;
}

// Chart specific types
export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartConfig {
  symbol: string;
  interval: string;
  showVolume: boolean;
  showGrid: boolean;
  candleStyle: 'candles' | 'hollow' | 'ohlc' | 'line' | 'area';
}
