# PLUGIN_Third-Party Plugin Lifecycle Specification

## Status: APPROVED

## Purpose

Document the complete lifecycle of third-party (Marketplace) plugins from build to activation, including the module format contract between host and plugin.

## Plugin Lifecycle Stages

```
Build -> Distribute -> Install -> Load -> Activate
```

### Stage 1: Build

- **Where**: Plugin repo CI/CD (e.g., `StratCraft-plugins/`)
- **Input**: Plugin source (`src/index.tsx`) + `vite.config.ts`
- **Output**: `dist/index.js` (IIFE format) + `manifest.json`
- **Key constraint**: Shared deps (`react`, `react-dom`, `react/jsx-runtime`, `react-i18next`, `i18next`, `lucide-react`) must be `external` in Rollup config
- **Format**: IIFE with `name: '__nexus_plugin_export__'`, globals mapped to `__nexus_modules__`
- **Config reference**: `vite.config.ts` in plugin repo
- **Local verification**: `deploy-local.sh` in plugin repo builds IIFE and verifies format before deploying

### Stage 2: Distribute

- **Where**: CI/CD pipeline packages `dist/` + `manifest.json` + assets into ZIP
- **Output**: `com.StratCraft.<plugin-name>-<version>.zip` uploaded to GitHub Release on `StratCraft-plugin-registry`
- **Registry update**: `registry.json` (version bump) + `plugins/<plugin-id>.json` (new version entry with download URL + SHA256)
- **CRITICAL**: ZIP must contain IIFE-format `index.js`. ESM-format builds will fail at Stage 4.
- **Reference**:  (Plugin Release CI/CD Automation)

### Stage 3: Install

- **Where**: Desktop app main process (`plugin-market-service.ts`)
- **Trigger**: User clicks "Install" or "Update" on Marketplace plugin card
- **Action**:
  1. Fetch plugin metadata from registry (`fetchPluginDetails`)
  2. Download ZIP from GitHub Release
  3. Verify SHA256 checksum
  4. Resolve plugin dependencies (install required plugins first)
  5. Extract ZIP to temp directory
  6. Flatten nested root directory if present
  7. Validate `manifest.json` exists
  8. Install Python dependencies if declared
  9. Move to final location: `~/.config/@StratCraft/desktop/plugins/<plugin-id>/`
  10. Record installation in `.installed.json`
  11. Emit `installComplete` event (broadcast to all renderer windows)
- **Key file**: `apps/desktop/src/main/services/plugin-market-service.ts`

### Stage 3.5: Post-Install Refresh

- **Where**: Renderer process (`main.tsx`, `plugin-manager.ts`)
- **Trigger**: `onInstallComplete` IPC event from main process
- **Action**:
  1. `main.tsx` module-scope listener receives `{ pluginId }` from `onInstallComplete`
  2. Calls `PluginManager.refresh()`:
     - Re-discovers all plugins from disk via `scanAll()` IPC
     - Removes stale plugins (uninstalled from disk) from internal Map
     - Loads newly discovered plugins (skips already-loaded via `plugins.has()`)
     - Reads **live** `enabledPlugins` from `persistenceManager` (not startup snapshot)
     - Auto-activates enabled plugins that are not yet active
     - Emits `discover:complete` event
  3. Explicitly activates the newly installed plugin by `pluginId`
  4. Persists `pluginId` to `enabledPlugins` via `persistenceManager.addEnabledPlugin()`
  5. `usePluginManager` hook receives `discover:complete` event, updates UI
- **Key files**: `main.tsx:38-49`, `plugin-manager.ts:188-220`

### Stage 4: Load

- **Where**: Renderer process (`plugin-loader.ts`)
- **Trigger**: `PluginManager.initialize()` (startup) or `PluginManager.refresh()` (after install)
- **Action for user plugins** (`_source === 'user'`):
  1. Host initializes `globalThis.__nexus_modules__` with shared module references (at module load time)
  2. Creates `<script src="modulePath">` tag and appends to `document.head`
  3. Browser fetches and executes IIFE code; shared deps resolve via `__nexus_modules__` globals
  4. IIFE assigns exports to `window.__nexus_plugin_export__`
  5. Host captures `.default` as `PluginModule`, cleans up `__nexus_plugin_export__`
  6. Script tag removed from DOM after execution
- **Action for bundled plugins** (`_source === 'bundled'`): Direct `import()` (Vite resolves bare imports)
- **CSP compliance**: Uses `<script src>` (not `eval()`) to comply with `script-src 'self'` policy
- **Key file**: `apps/desktop/src/renderer/lib/plugin-loader.ts`
- **Reference**:  (IIFE Module Loading)

### Stage 5: Activate

- **Where**: Renderer process (`plugin-loader.ts` / `plugin-manager.ts`)
- **Trigger**: Plugin is in `enabledPlugins` list (persisted state), or explicitly activated after install
- **Action**: Calls `pluginModule.activate(context)`, plugin registers ViewProviders, commands, etc.
- **Key API**: `globalThis.nexus.window.registerViewProvider(viewId, provider)`
- **Key file**: `apps/desktop/src/renderer/lib/plugin-context.ts`

## Module Format Contract

### Host provides (globalThis.__nexus_modules__)

| Module | Key |
|--------|-----|
| react | `__nexus_modules__.react` |
| react-dom | `__nexus_modules__["react-dom"]` |
| react/jsx-runtime | `__nexus_modules__["react/jsx-runtime"]` |
| react-i18next | `__nexus_modules__["react-i18next"]` |
| i18next | `__nexus_modules__.i18next` |
| lucide-react | `__nexus_modules__["lucide-react"]` |

### Plugin must

1. Build as IIFE format with `name: '__nexus_plugin_export__'`
2. Declare shared deps as `external` in Rollup config
3. Map externals to `__nexus_modules__` via `output.globals`
4. Export default a `PluginModule` object with `activate()` and `deactivate()` methods

## Error Scenarios

| Stage | Failure | Symptom |
|-------|---------|---------|
| Build | Missing external declaration | Plugin bundles its own React (duplicate React state, hooks crash) |
| Build | Wrong output format (ESM instead of IIFE) | Stage 4 fails: `SyntaxError: Cannot use import statement outside a module` |
| Distribute | Stale build artifact in ZIP | Same as wrong output format; ZIP must be rebuilt after config change |
| Install | ZIP corrupted or SHA256 mismatch | Install rejected, user notified via UI error |
| Load | `__nexus_modules__` not initialized | IIFE throws ReferenceError on shared dep access |
| Load | Plugin not IIFE format | `__nexus_plugin_export__` is undefined after script execution |
| Activate | `globalThis.nexus.window` unavailable | ViewProvider not registered (headless mode) |
| Refresh | Stale Vite dev server cache | Dev only: restart app to clear in-memory transform cache ( Issue 3) |

## Known Limitations

### Vite Dev Server Cache (Dev Environment Only)

In development, Vite dev server caches HTTP transform results in memory. When Marketplace install replaces `index.js` on disk (via main process), the renderer's `<script>` request may hit Vite's stale in-memory cache from the same session. **Workaround**: restart the app after Marketplace install/update in dev. This does not affect production builds.

## References

- - Directory structure standard
- [](../design/_PLUGIN_RUNTIME_LOAD_FAILURE.md) - IIFE module loading (CSP-compliant script tag)
- [](../design/_PLUGIN_RELEASE_CI_CD_AUTOMATION.md) - CI/CD pipeline
- [](../design/_MARKETPLACE_PLUGIN_NOT_ACTIVATED_AFTER_INSTALL.md) - Post-install refresh and activation
- [VS Code Extension Bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) - Industry reference
