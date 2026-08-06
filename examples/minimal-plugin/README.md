# Minimal Plugin Example

A working example of a StratCraft plugin with a single ViewProvider panel.

## What This Demonstrates

- Plugin manifest (`manifest.json`) with Tier 1 declaration
- ViewProvider registration via `globalThis.nexus.window.registerViewProvider`
- IIFE build output with shared module globals (`__nexus_modules__`)
- Ambient type declarations (`global.d.ts`)

## Build

```bash
cd ui/minimal-plugin-nexus
npm install
npm run build
```

This produces `dist/index.js` in IIFE format.

## Install Locally

Copy the entire plugin directory to the StratCraft plugins folder:

```bash
# Linux
cp -r ../../examples/minimal-plugin ~/.config/@StratCraft/desktop/plugins/minimal-plugin

# macOS
cp -r ../../examples/minimal-plugin ~/Library/Application\ Support/@StratCraft/desktop/plugins/minimal-plugin
```

Restart the StratCraft app and activate the plugin from the Plugin Manager.

## File Overview

| File | Purpose |
|------|---------|
| `manifest.json` | Plugin metadata, tier, entry point path |
| `ui/minimal-plugin-nexus/src/index.tsx` | Plugin entry: activate, deactivate, ViewProvider |
| `ui/minimal-plugin-nexus/src/types/global.d.ts` | Ambient type declarations for host APIs |
| `ui/minimal-plugin-nexus/vite.config.ts` | Build config: IIFE output, shared module externals |

## Learn More

- [Plugin Quick Start](../../docs/plugin/QUICKSTART.md)
- Plugin Directory Structure
- Plugin Lifecycle
