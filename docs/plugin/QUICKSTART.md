# Plugin Development Quick Start

Build and install a StratCraft plugin in 15 minutes.

## Prerequisites

- Node.js 20+
- pnpm 9+
- TypeScript 5+
- A running StratCraft desktop app (for testing)

## 1. Scaffold from Template

Click **"Use this template"** on [StratCraft-plugin-template](https://github.com/StratCraftsAI/StratCraft-plugin-template), then clone your new repository:

```bash
git clone https://github.com/your-username/my-plugin.git
cd my-plugin
```

## 2. Directory Structure

A StratCraft plugin follows this layout:

```
my-plugin/
+-- manifest.json              # Plugin metadata (required)
+-- ui/
|   +-- my-plugin-nexus/       # UI module
|       +-- package.json
|       +-- tsconfig.json
|       +-- vite.config.ts     # IIFE build configuration
|       +-- src/
|           +-- index.tsx       # Entry point (activate/deactivate)
|           +-- types/
|           |   +-- global.d.ts # Host API type declarations
|           +-- components/
|           +-- pages/
|           +-- hooks/
+-- locales/                   # i18n (optional)
+-- scripts/
|   +-- validate.mjs          # Post-build validator
+-- LICENSE
```

## 3. manifest.json

Every plugin requires a manifest at the root:

```json
{
  "id": "com.example.my-plugin",
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "tier": 1,
  "distribution": "marketplace",
  "main": "./ui/my-plugin-nexus/dist/index.js",
  "dependencies": {
    "plugins": []
  }
}
```

**Key fields**:
- `tier`: `0` for foundation plugins, `1` for business plugins (most plugins are Tier 1)
- `main`: path to built IIFE output relative to plugin root
- `distribution`: `"marketplace"` for third-party plugins
- `dependencies.plugins`: array of required plugin names (e.g., `["data-plugin"]`)

## 4. Implement a ViewProvider

Edit `ui/my-plugin-nexus/src/index.tsx`:

```typescript
import React from 'react';

const MyPanel: React.FC = () => (
  <div style={{ padding: '16px', color: 'var(--color-text-primary)' }}>
    <h2>Hello from My Plugin</h2>
    <p>This panel is rendered by my custom plugin.</p>
  </div>
);

const pluginModule = {
  async activate(context: PluginContext) {
    context.log.info('My Plugin activating...');

    globalThis.nexus!.window.registerViewProvider('my-plugin.panel', {
      render: () => <MyPanel />,
    });

    return {
      activate: async () => {},
      deactivate: async () => {},
    };
  },

  async deactivate() {
    // Cleanup resources
  },
};

export default pluginModule;
```

### Context API

The `context` parameter provides:

| Namespace | Purpose | Example |
|-----------|---------|---------|
| `context.pluginId` | Plugin identifier | `"com.example.my-plugin"` |
| `context.pluginPath` | Filesystem path | `"/path/to/plugins/my-plugin"` |
| `context.log` | Logging | `context.log.info('loaded')` |
| `context.storage` | Key-value persistence | `await context.storage.get('key')` |
| `context.commands` | Command registration | `context.commands.register('cmd', fn)` |
| `context.messaging` | Inter-plugin messaging | `context.messaging.send('target', data)` |
| `context.state` | Shared state | `context.state.set('key', value)` |
| `context.ui` | Notifications/dialogs | `context.ui.showNotification({...})` |
| `context.data` | Data access | Provider-specific methods |

### Window API

`globalThis.nexus.window` provides UI registration:

| Method | Purpose |
|--------|---------|
| `registerViewProvider(viewId, provider)` | Register a UI panel |
| `registerTreeDataProvider(viewId, provider)` | Register a tree view |
| `openView(viewId)` / `closeView(viewId)` | Navigate views |
| `showAlert(options)` | Show alert dialog |
| `showConfirm(options)` | Show confirmation dialog |
| `showNotification(options)` | Show toast notification |

## 5. Type Declarations

The template includes `src/types/global.d.ts` with ambient declarations for the host APIs (`PluginContext`, `NexusWindowApi`, `ElectronAPI`). Extend `ElectronAPI` to declare only the IPC methods your plugin calls:

```typescript
interface ElectronAPI {
  myFeature: {
    getData(): Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
}
```

## 6. Build Configuration (IIFE)

Plugins must output **IIFE format**, not ESM. The template includes a pre-configured `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      name: '__nexus_plugin_export__',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-i18next',
        'i18next',
        'lucide-react',
      ],
      output: {
        globals: {
          react: '__nexus_modules__.react',
          'react-dom': '__nexus_modules__["react-dom"]',
          'react/jsx-runtime': '__nexus_modules__["react/jsx-runtime"]',
          'react-i18next': '__nexus_modules__["react-i18next"]',
          i18next: '__nexus_modules__.i18next',
          'lucide-react': '__nexus_modules__["lucide-react"]',
        },
      },
    },
  },
});
```

**Why IIFE?** The host provides shared modules (`react`, `react-dom`, etc.) via `globalThis.__nexus_modules__`. IIFE format resolves these as globals at runtime, avoiding duplicate React instances and hooks crashes.

## 7. Build

```bash
cd ui/my-plugin-nexus
pnpm install
pnpm build
```

This produces `dist/index.js` in IIFE format.

## 8. Validate

```bash
pnpm validate
```

Checks:
- `dist/index.js` exists and is IIFE format
- `__nexus_plugin_export__` is present
- React is not bundled (externalized correctly)
- `manifest.json` has all required V3 fields

## 9. Install and Test Locally

Copy the entire plugin directory to the StratCraft plugins folder:

```bash
# Linux
cp -r . ~/.config/@StratCraft/desktop/plugins/my-plugin/

# macOS
cp -r . ~/Library/Application\ Support/@StratCraft/desktop/plugins/my-plugin/

# Windows
xcopy . %APPDATA%\@StratCraft\desktop\plugins\my-plugin\ /E
```

Restart the StratCraft app. Your plugin appears in the Nexus Hub. Click **Activate** to load it.

**Tip**: Use a symlink for faster iteration during development:
```bash
ln -s $(pwd) ~/.config/@StratCraft/desktop/plugins/my-plugin
```

## Tier System

| Tier | Purpose | Can Import From |
|------|---------|-----------------|
| Tier 0 | Foundation (shared data, UI components) | Nothing |
| Tier 1 | Business logic (strategies, backtest, analysis) | Tier 0 and other Tier 1 plugins |

**Rule**: Only upward imports are prohibited. Tier 0 plugins cannot import from Tier 1 plugins.

If your plugin needs data provider components, declare a Tier 0 dependency in `manifest.json`:

```json
{
  "dependencies": {
    "plugins": ["data-plugin"]
  }
}
```

Then reference Tier 0 types via `tsconfig.json` path mapping:

```json
{
  "compilerOptions": {
    "paths": {
      "@plugins/data-plugin/*": ["../../../data-plugin/ui/data-nexus/src/*"]
    }
  }
}
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot use import statement outside a module` | ESM output instead of IIFE | Set `formats: ['iife']` in vite.config.ts |
| Duplicate React / hooks crash | Plugin bundles its own React | Add `react`, `react-dom` to `external` |
| `__nexus_plugin_export__` undefined | Wrong IIFE name | Set `name: '__nexus_plugin_export__'` in lib config |
| Plugin not visible in Nexus Hub | Missing/invalid manifest.json | Run `pnpm validate` to check |
| Plugin not activating after install | Stale Vite dev server cache | Restart the StratCraft app |

## Next Steps

- Plugin Directory Structure - Full structure specification
- Plugin Lifecycle - Build, distribute, install, load, activate stages
- [Plugin Template](https://github.com/StratCraftsAI/StratCraft-plugin-template) - Starter template repository
