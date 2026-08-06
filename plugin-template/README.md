# StratCraft Plugin Template

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A starter template for building third-party StratCraft plugins. Clone, build, and install in under 15 minutes.

## Quick Start

```bash
# 1. Clone and reset
git clone https://github.com/StratCraftsAI/StratCraft-plugin-template.git my-plugin
cd my-plugin
rm -rf .git && git init

# 2. Install and build
cd ui/my-plugin-nexus
pnpm install
pnpm build

# 3. Validate
pnpm validate

# 4. Install into StratCraft (Linux)
cp -r ../../ ~/.config/@StratCraft/desktop/plugins/my-plugin/

# 5. Restart StratCraft -> Nexus Hub -> Activate your plugin
```

## Directory Structure

```
my-plugin/
+-- manifest.json                   # Plugin metadata (V3 format)
+-- ui/
|   +-- my-plugin-nexus/            # UI module
|       +-- package.json
|       +-- tsconfig.json
|       +-- vite.config.ts          # IIFE build configuration
|       +-- dist/                   # Build output (generated)
|       |   +-- index.js            # IIFE bundle loaded by host
|       +-- src/
|           +-- index.tsx           # Entry point (activate/deactivate)
|           +-- types/
|           |   +-- global.d.ts     # Host API type declarations
|           +-- components/         # Reusable UI components
|           +-- pages/              # Page-level components
|           +-- hooks/              # Custom React hooks
+-- locales/                        # i18n translations (optional)
|   +-- my-plugin/
+-- scripts/
|   +-- validate.mjs               # Post-build validator
+-- LICENSE
```

## manifest.json

Every plugin must have a `manifest.json` at the root:

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

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Reverse-domain identifier (`com.yourorg.plugin-name`) |
| `name` | Yes | Short name (used as directory name) |
| `displayName` | Yes | Human-readable name shown in Nexus Hub |
| `version` | Yes | Semver version |
| `tier` | Yes | `0` = Foundation (shared infra), `1` = Business (most plugins) |
| `distribution` | Yes | `"marketplace"` for third-party plugins |
| `main` | Yes | Path to built IIFE entry point |
| `dependencies.plugins` | Yes | Array of required plugin names (e.g., `["data-plugin"]`) |

## Entry Point

The host loads your plugin's IIFE bundle and calls `activate()` on the default export:

```typescript
// src/index.tsx
import React from 'react';

const pluginModule = {
  async activate(context: PluginContext) {
    // Register UI, commands, etc.
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

The `context` parameter provides these namespaces:

| Namespace | Purpose | Example |
|-----------|---------|---------|
| `context.log` | Logging | `context.log.info('loaded')` |
| `context.storage` | Key-value persistence | `await context.storage.get('key')` |
| `context.commands` | Register/execute commands | `context.commands.register('cmd', fn)` |
| `context.messaging` | Inter-plugin messaging | `context.messaging.send('other-plugin', data)` |
| `context.state` | Shared state | `context.state.set('key', value)` |
| `context.ui` | Notifications/dialogs | `context.ui.showNotification({...})` |
| `context.data` | Data access | Provider-specific |

### Window API

`globalThis.nexus.window` provides UI registration:

| Method | Purpose |
|--------|---------|
| `registerViewProvider(viewId, provider)` | Register a UI panel |
| `registerTreeDataProvider(viewId, provider)` | Register a tree view |
| `openView(viewId)` | Navigate to a view |
| `closeView(viewId)` | Close a view |
| `showAlert(options)` | Show alert dialog |
| `showConfirm(options)` | Show confirmation dialog |
| `showNotification(options)` | Show toast notification |

## Build Configuration

Plugins **must** output IIFE format. The host provides shared modules (`react`, `react-dom`, etc.) via `globalThis.__nexus_modules__`. See `vite.config.ts` for the complete configuration.

**Why IIFE?** The host injects shared dependencies at runtime. IIFE format resolves these as globals, avoiding duplicate React instances and hooks crashes.

**Critical externals** - these must NOT be bundled:
- `react`, `react-dom`, `react/jsx-runtime`
- `react-i18next`, `i18next`
- `lucide-react`

## Development

### Watch Mode

```bash
cd ui/my-plugin-nexus
pnpm dev
```

This runs `vite build --watch` - rebuilds on every source change.

### Local Testing

Symlink your plugin directory into the StratCraft plugins folder for faster iteration:

```bash
# Linux
ln -s $(pwd) ~/.config/@StratCraft/desktop/plugins/my-plugin

# macOS
ln -s $(pwd) ~/Library/Application\ Support/@StratCraft/desktop/plugins/my-plugin
```

After each rebuild, restart StratCraft to reload the plugin.

### Validation

```bash
pnpm validate
```

Checks IIFE format, `__nexus_plugin_export__` presence, React externalization, and manifest fields.

## Tier System

| Tier | Purpose | Can Import From | Example |
|------|---------|-----------------|---------|
| **0** | Foundation (shared infra) | Nothing | `data-plugin` |
| **1** | Business logic | Tier 0 only | Strategy builder, backtest, analysis |

**Rules**:
- Same-tier imports are **prohibited** (Tier 1 cannot import Tier 1)
- Upward imports are **prohibited** (Tier 0 cannot import Tier 1)
- Tier 0 dependencies are declared in `manifest.json`:

```json
{
  "tier": 1,
  "dependencies": {
    "plugins": ["data-plugin"]
  }
}
```

Reference Tier 0 types via `tsconfig.json` path mapping:

```json
{
  "compilerOptions": {
    "paths": {
      "@plugins/data-plugin/*": ["../../../data-plugin/ui/data-nexus/src/*"]
    }
  }
}
```

## Install Paths

| Platform | Path |
|----------|------|
| Linux | `~/.config/@StratCraft/desktop/plugins/` |
| macOS | `~/Library/Application Support/@StratCraft/desktop/plugins/` |
| Windows | `%APPDATA%\@StratCraft\desktop\plugins\` |

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot use import statement outside a module` | ESM output instead of IIFE | Set `formats: ['iife']` in vite.config.ts |
| Duplicate React / hooks crash | Plugin bundles its own React | Add `react`, `react-dom` to `external` in vite.config.ts |
| `__nexus_plugin_export__` undefined | Wrong IIFE name | Set `name: '__nexus_plugin_export__'` in vite.config.ts `lib` |
| Plugin not visible in Nexus Hub | Missing or invalid manifest.json | Run `pnpm validate` to check manifest fields |
| Plugin not activating after install | Stale Vite dev server cache | Restart the StratCraft app |
| ViewProvider not registered | `globalThis.nexus` not available | Ensure `activate()` is called (check plugin is enabled) |

## Publishing

Package your plugin as a ZIP for Marketplace distribution:

```bash
cd my-plugin
zip -r com.example.my-plugin-1.0.0.zip \
  manifest.json \
  ui/my-plugin-nexus/dist/ \
  locales/
```

The ZIP is uploaded to your GitHub Release and registered in the [StratCraft Plugin Registry](https://github.com/StratCraftsAI/StratCraft-plugin-registry).

## References

- Plugin Directory Structure - Mandatory layout specification
- Plugin Lifecycle - Build/Distribute/Install/Load/Activate stages
- [Quick Start Guide](https://github.com/StratCraftsAI/StratCraft/blob/main/docs/plugin/QUICKSTART.md) - 15-minute tutorial

## License

[MIT](LICENSE)
