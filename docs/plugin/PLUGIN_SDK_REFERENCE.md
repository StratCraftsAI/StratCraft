# Plugin SDK Reference

Complete API reference for third-party StratCraft plugin development.

## Overview

A StratCraft plugin has access to three API surfaces:

| API | Access | Purpose |
|-----|--------|---------|
| **PluginContext** | `activate(context)` parameter | Logging, storage, commands, messaging, state, UI, data |
| **Window API** | `globalThis.nexus.window` | View/editor registration, navigation, dialogs |
| **Electron IPC** | `window.electronAPI` | Main process APIs (data, executor, auth, config, etc.) |

Shared modules (`react`, `react-dom`, etc.) are provided via `globalThis.__nexus_modules__` and resolved automatically through the IIFE build configuration.

---

## Plugin Module Contract

Every plugin must default-export a `PluginModule`:

```typescript
interface PluginModule {
  activate(context: PluginContext): Promise<PluginApi>;
  deactivate?(): Promise<void>;
}
```

The returned `PluginApi`:

```typescript
interface PluginApi {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;
  onEvent?(event: PluginEvent): void;
}
```

**Minimal example:**

```typescript
const pluginModule = {
  async activate(context: PluginContext) {
    context.log.info('Plugin activating...');
    return {
      activate: async () => {},
      deactivate: async () => {},
    };
  },
  async deactivate() {},
};

export default pluginModule;
```

---

## PluginContext

Passed as the first argument to `activate()`.

```typescript
interface PluginContext {
  pluginId: string;       // "com.example.my-plugin"
  pluginPath: string;     // "/path/to/plugins/my-plugin"
  log: PluginLogger;
  storage: PluginStorage;
  commands: PluginCommands;
  messaging: PluginMessaging;
  state: PluginStateApi;
  ui: PluginUi;
  data: PluginData;
}
```

### context.log

```typescript
interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

**Usage:**
```typescript
context.log.info('Loaded %d items', items.length);
context.log.error('Failed to fetch data', error);
```

### context.storage

Persistent key-value storage scoped to the plugin.

```typescript
interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
```

**Usage:**
```typescript
await context.storage.set('lastSync', Date.now());
const ts = await context.storage.get<number>('lastSync');
```

### context.commands

Register and execute named commands.

```typescript
interface PluginCommands {
  register(id: string, handler: (...args: unknown[]) => unknown): void;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  getAll(): string[];
}
```

**Usage:**
```typescript
context.commands.register('my-plugin.refresh', () => {
  // reload data
});

// Execute from another part of the plugin
await context.commands.execute('my-plugin.refresh');
```

### context.messaging

Send messages between plugins.

```typescript
interface PluginMessaging {
  send(target: string, message: unknown): void;
  broadcast(message: unknown): void;
  onMessage(handler: (source: string, message: unknown) => void): void;
}
```

**Usage:**
```typescript
// Send to a specific plugin
context.messaging.send('data-plugin', { type: 'requestSymbols' });

// Listen for messages
context.messaging.onMessage((source, msg) => {
  context.log.info('Message from %s', source);
});
```

### context.state

Shared in-memory state with change subscriptions.

```typescript
interface PluginStateApi {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, handler: (value: unknown) => void): () => void;
}
```

**Usage:**
```typescript
context.state.set('selectedSymbol', 'AAPL');

const unsubscribe = context.state.subscribe('selectedSymbol', (value) => {
  console.log('Symbol changed to', value);
});

// Later: unsubscribe()
```

### context.ui

Show notifications and dialogs.

```typescript
interface PluginUi {
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  showDialog(options: DialogOptions): Promise<DialogResult>;
  showProgress(title: string): ProgressHandle;
}
```

**Usage:**
```typescript
context.ui.showNotification('Data loaded successfully', 'success');

const result = await context.ui.showDialog({
  title: 'Confirm',
  message: 'Delete this strategy?',
  buttons: ['Cancel', 'Delete'],
});
```

### context.data

Access market data.

```typescript
interface PluginData {
  getMarketData(symbol: string, interval: string, start: string, end: string): Promise<unknown[]>;
  getSymbols(): Promise<string[]>;
  subscribe(symbol: string, handler: (data: unknown) => void): () => void;
}
```

---

## Window API

Accessed via `globalThis.nexus.window`. Provides UI registration and navigation.

### View Providers

Register a React component as a view panel.

```typescript
registerViewProvider(viewId: string, provider: ViewProvider): Disposable;
getViewProvider(viewId: string): ViewProvider | undefined;
```

```typescript
interface ViewProvider {
  resolveView(viewId: string, options?: ViewOptions): ViewElement;
  onDidShow?(): void;
  onDidHide?(): void;
  dispose?(): void;
}

// Simplified form (used by most plugins)
interface SimpleViewProvider {
  render: () => React.ReactNode;
}
```

**Usage:**
```typescript
const disposable = globalThis.nexus!.window.registerViewProvider('my-plugin.panel', {
  render: () => <MyPanel />,
});

// Later: disposable.dispose()
```

### Tree Data Providers

Register a tree view (sidebar navigation, file explorer, etc.).

```typescript
registerTreeDataProvider<T>(viewId: string, provider: TreeDataProvider<T>): Disposable;
getTreeDataProvider<T>(viewId: string): TreeDataProvider<T> | undefined;
refreshTreeView(viewId: string): void;
onTreeRefresh(viewId: string, callback: () => void): Disposable;
```

```typescript
interface TreeDataProvider<T = unknown> {
  onDidChangeTreeData?: Event<T | undefined>;
  getTreeItem(element: T): TreeItem | Promise<TreeItem>;
  getChildren(element?: T): T[] | Promise<T[]>;
  getParent?(element: T): T | undefined | Promise<T | undefined>;
}
```

### Custom Editors

Register a custom editor for specific resource types.

```typescript
registerCustomEditorProvider(viewType: string, provider: CustomEditorProvider): Disposable;
getCustomEditorProvider(viewType: string): CustomEditorProvider | undefined;
openEditor(resourceUri: string, viewType: string): Promise<void>;
getActiveEditor(): { resourceUri: string; viewType: string } | undefined;
onEditorChange(callback: (editor: {...} | undefined) => void): Disposable;
```

```typescript
interface CustomEditorProvider {
  resolveCustomEditor(resourceUri: string, viewType: string): EditorElement;
  onDidChangeDocument?(resourceUri: string): void;
  saveDocument?(resourceUri: string): Promise<void>;
  dispose?(): void;
}
```

### Navigation

```typescript
openView(viewId: string, options?: ViewOptions): Promise<void>;
closeView(viewId: string): void;
getCurrentView(): { viewId: string | null; options?: ViewOptions };
onViewChange(callback: (viewId: string, options?: ViewOptions) => void): Disposable;
```

### Dialogs

```typescript
showAlert(message: string, options?: { title?: string }): Promise<void>;
showConfirm(message: string, options?: { title?: string }): Promise<boolean>;
showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
```

### Disposable

All registration methods return a `Disposable`. Call `dispose()` in your `deactivate()` to clean up:

```typescript
interface Disposable {
  dispose(): void;
}
```

**Pattern:**
```typescript
const disposables: Disposable[] = [];

async activate(context: PluginContext) {
  disposables.push(
    globalThis.nexus!.window.registerViewProvider('my.view', provider)
  );
  disposables.push(
    globalThis.nexus!.window.registerTreeDataProvider('my.tree', treeProvider)
  );
  // ...
},

async deactivate() {
  for (const d of disposables) d.dispose();
  disposables.length = 0;
}
```

---

## Electron IPC API

Accessed via `window.electronAPI`. These are the main process APIs available through the IPC bridge.

### Key Namespaces

| Namespace | Purpose | Auth Required |
|-----------|---------|--------------|
| `window.electronAPI.data` | Market data download, symbol search, cache | Some providers |
| `window.electronAPI.executor` | Backtest execution, strategy generation | No |
| `window.electronAPI.auth` | Login/logout, token management | N/A |
| `window.electronAPI.credential` | Secure credential storage (API keys) | No |
| `window.electronAPI.config` | Application configuration | No |
| `window.electronAPI.plugin` | Plugin system (scan, manifest, config) | No |
| `window.electronAPI.marketplace` | Plugin marketplace (install, update) | Some features |
| `window.electronAPI.entitlement` | Service entitlements, LLM access | No |
| `window.electronAPI.locale` | Locale management | No |

### IPC Response Pattern

All IPC methods return a standard envelope:

```typescript
interface IpcResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

**Usage:**
```typescript
const result = await window.electronAPI.data.searchSymbols('AAPL');
if (result.success) {
  // use result.data
} else {
  context.log.error('Search failed: %s', result.error);
}
```

### Event Subscriptions

IPC event listeners return an unsubscribe function:

```typescript
const unsubscribe = window.electronAPI.executor.onProgress((data) => {
  console.log('Progress:', data.percent);
});

// Later: unsubscribe()
```

### data

```typescript
window.electronAPI.data.searchSymbols(query: string, provider?: string): Promise<IpcResponse>;
window.electronAPI.data.ensure(config: DataEnsureConfig): Promise<IpcResponse>;
window.electronAPI.data.getProviderList(): Promise<IpcResponse>;
window.electronAPI.data.checkConnection(provider: string): Promise<IpcResponse>;
window.electronAPI.data.getSymbolDateRange(symbol: string, provider?: string): Promise<IpcResponse>;
window.electronAPI.data.onProgress(callback): () => void;
```

### executor

```typescript
window.electronAPI.executor.runBacktest(config): Promise<IpcResponse>;
window.electronAPI.executor.cancelBacktest(taskId: string): Promise<IpcResponse>;
window.electronAPI.executor.getResults(taskId: string): Promise<IpcResponse>;
window.electronAPI.executor.generateStrategy(config): Promise<IpcResponse>;
window.electronAPI.executor.onStarted(callback): () => void;
window.electronAPI.executor.onProgress(callback): () => void;
window.electronAPI.executor.onCompleted(callback): () => void;
window.electronAPI.executor.onError(callback): () => void;
```

### auth

```typescript
window.electronAPI.auth.login(providerName?: string): Promise<IpcResponse>;
window.electronAPI.auth.logout(): Promise<IpcResponse>;
window.electronAPI.auth.getState(): Promise<IpcResponse>;
window.electronAPI.auth.getUser(): Promise<IpcResponse>;
window.electronAPI.auth.getAccessToken(): Promise<IpcResponse>;
window.electronAPI.auth.onStateChanged(callback): () => void;
```

### credential

```typescript
window.electronAPI.credential.get(pluginId: string, key: string): Promise<IpcResponse>;
window.electronAPI.credential.set(pluginId: string, key: string, value: string): Promise<IpcResponse>;
window.electronAPI.credential.delete(pluginId: string, key: string): Promise<IpcResponse>;
window.electronAPI.credential.has(pluginId: string, key: string): Promise<IpcResponse>;
window.electronAPI.credential.list(pluginId: string): Promise<IpcResponse>;
```

### config

```typescript
window.electronAPI.config.get<T>(path: string): Promise<IpcResponse<T>>;
window.electronAPI.config.set(path: string, value: unknown): Promise<IpcResponse>;
window.electronAPI.config.getAll(): Promise<IpcResponse>;
window.electronAPI.config.onChanged(callback): () => void;
```

---

## Shared Modules

The host provides these modules at runtime via `globalThis.__nexus_modules__`. They must be declared as `external` in your Vite config and must NOT be bundled.

| Module | Global Key | Version |
|--------|-----------|---------|
| `react` | `__nexus_modules__.react` | 18.x |
| `react-dom` | `__nexus_modules__["react-dom"]` | 18.x |
| `react/jsx-runtime` | `__nexus_modules__["react/jsx-runtime"]` | 18.x |
| `react-i18next` | `__nexus_modules__["react-i18next"]` | - |
| `i18next` | `__nexus_modules__.i18next` | - |
| `lucide-react` | `__nexus_modules__["lucide-react"]` | - |

**Why externalize?** Bundling React creates a second React instance, which breaks hooks (`useState`, `useEffect`, etc.) and causes cryptic runtime errors.

---

## i18n Contributions

Plugins can provide translations by declaring an `i18n` contribution in `manifest.json`:

```json
{
  "contributes": {
    "i18n": {
      "path": "./locales",
      "namespaces": ["my-plugin"]
    }
  }
}
```

Directory structure:
```
locales/
+-- my-plugin/
    +-- en.json
    +-- zh.json
    +-- ja.json
```

Use `react-i18next` in components (provided via shared modules):

```typescript
import { useTranslation } from 'react-i18next';

const MyPanel: React.FC = () => {
  const { t } = useTranslation('my-plugin');
  return <h2>{t('title')}</h2>;
};
```

### Fallback-string discipline

The second argument to `t(key, fallback, vars?)` is **emergency text for a missing locale key**, not a place to encode design intent. It must satisfy four rules, enforced at pre-commit and in CI by `pnpm i18n:fallback`:

1. **Literal, neutral English description.** Prefer short noun phrases (`'Rows'`, `'Cancel'`) or plainly interpolated sentences (`'{{n}} rows'`, `'{{count}} symbols'`). Decorative wording belongs in the locale value, not the inline default.
2. **No decorative typography that can be mistaken for a placeholder.** Specifically forbidden in fallback strings: stray `{{` or `}}` outside a real `{{name}}` token, and the substring ` x ` placed between word characters in a placeholder-bearing string. Use `*`, `/`, `&`, or a real word like `by` instead. The  footgun was `'{{n}} folds x reps'` -- when the locale key was missing, ` x reps` rendered as if it were an unsubstituted variable.
3. **No leading or trailing whitespace.**
4. **Placeholder set must match `vars` keys.** Every `{{name}}` in the fallback must appear as a key in the third-argument `vars` object; every `vars` key must be referenced by at least one `{{name}}`.

The check covers all `t(KEY, FALLBACK, ...)` call sites under `apps/desktop/src` and every `plugins/<name>/(src|ui)/...` tree. Run locally with `pnpm i18n:fallback`; unit tests live at `scripts/i18n/__tests__/fallback-discipline.test.mjs`.

---

## Configuration Contributions

Plugins can declare user-configurable settings in `manifest.json`:

```json
{
  "contributes": {
    "configuration": {
      "title": "My Plugin Settings",
      "properties": {
        "my-plugin.refreshInterval": {
          "type": "number",
          "default": 60,
          "description": "Data refresh interval in seconds",
          "minimum": 10,
          "maximum": 3600
        },
        "my-plugin.apiKey": {
          "type": "string",
          "description": "API key for data provider",
          "secret": true
        }
      }
    }
  }
}
```

Read configuration at runtime:

```typescript
const config = await window.electronAPI.plugin.getConfig(context.pluginId);
const interval = config.data?.['my-plugin.refreshInterval'] ?? 60;
```

---

## Permissions

Declare required permissions in `manifest.json`:

```json
{
  "permissions": ["network", "filesystem", "database"]
}
```

| Permission | Description |
|------------|-------------|
| `network` | Make HTTP requests (internal only) |
| `network:internal` | Access internal APIs |
| `filesystem` | Read/write files (sandboxed to plugin directory) |
| `filesystem:full` | Full filesystem access |
| `database` | Access local SQLite database |
| `notification` | Show system notifications |
| `clipboard` | Access system clipboard |
| `shell` | Execute shell commands |
| `native` | Access native Node.js APIs |

For fine-grained control, use `detailedPermissions`:

```json
{
  "detailedPermissions": {
    "network": {
      "hosts": ["api.example.com", "data.provider.io"],
      "reason": "Fetch market data from provider API"
    },
    "fs": {
      "read": ["$PLUGIN_DATA/cache"],
      "write": ["$PLUGIN_DATA/cache"],
      "reason": "Cache downloaded market data locally"
    }
  }
}
```

---

## Source Files

| File | Contains |
|------|----------|
| `apps/desktop/src/shared/types/plugin.ts` | All plugin type definitions |
| `apps/desktop/src/renderer/lib/plugin-context.ts` | Context factory + Window API |
| `apps/desktop/src/renderer/lib/plugin-loader.ts` | Module loading + shared modules |
| `apps/desktop/src/renderer/lib/plugin-manager.ts` | Lifecycle management |
| `apps/desktop/src/preload/index.ts` | Electron IPC API definitions |
