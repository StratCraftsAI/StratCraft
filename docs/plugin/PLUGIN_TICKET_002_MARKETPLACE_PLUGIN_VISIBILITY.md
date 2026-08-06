# PLUGIN_Marketplace Plugin Visibility Control

## Status: OPEN

## Problem

When Quant Lab plugin is NOT installed, it still appears in the NexusHub "Backtest Module" plugin list (grayed out with offline status).

**Screenshot**: `image203.png` - Shows QUANT LAB v1.0.0 displayed under Backtest Module despite not being installed.

## Root Cause Analysis

### Discovery Flow

```
plugin:scanAll (main process)
    +-- Scan bundled: plugins/  (dev) or bundled_plugins/ (prod)
    |   +-- Found: quant-lab-plugin/manifest.json
    +-- Scan user: {userData}/plugins/
    |   +-- (empty - not installed)
    +-- Return ALL discovered plugins
```

### Display Flow

```
NexusHubPage
    +-- usePluginManager().plugins
        +-- categorizedPlugins.backtest
            +-- Filter: category === 'execution'
                +-- Quant Lab matches (category: "execution")
                    +-- DISPLAYED (incorrectly)
```

### Root Cause

1. **No distribution type distinction**: `plugin:scanAll` returns ALL discovered plugins without distinguishing between:
   - **Bundled plugins**: Always available (e.g., Backtest Nexus, Strategy Builder)
   - **Marketplace plugins**: Optional, requires installation

2. **No installation check**: Frontend displays all discovered plugins regardless of installation status

3. **Dev environment pollution**: `plugins/quant-lab-plugin/` exists as submodule for development, causing it to be discovered as "bundled"

## Expected Behavior

| Plugin Type | In bundled dir | Installed via Marketplace | Should Display |
|-------------|----------------|---------------------------|----------------|
| Core Plugin | Yes | N/A | Yes |
| Marketplace Plugin | Yes (dev only) | No | **No** |
| Marketplace Plugin | Yes (dev only) | Yes | Yes |
| Marketplace Plugin | No | Yes | Yes |

## Solution Design

### 1. Manifest Field: `distribution`

Add `distribution` field to manifest.json:

```json
{
  "id": "com.StratCraft.quant-lab-nexus",
  "distribution": "marketplace"
}
```

Values:
- `"bundled"` (default): Always displayed
- `"marketplace"`: Only displayed when installed

### 2. Installation Check in scanAll

Modify `plugin:scanAll` to check if marketplace plugins are installed:

```typescript
// In plugin-handlers.ts scanAll

// For marketplace plugins from bundled path, check if actually installed
if (plugin.source === 'bundled' && manifest.distribution === 'marketplace') {
  const isInstalled = await checkMarketplaceInstalled(manifest.id);
  if (!isInstalled) {
    continue; // Skip - not installed
  }
}
```

### 3. Installation Status Check

Use `PluginMarketService.isInstalled(pluginId)` or check `.installed.json`:

```typescript
async function checkMarketplaceInstalled(pluginId: string): Promise<boolean> {
  const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
  const installedManifestPath = path.join(userPluginsDir, '.installed.json');

  try {
    const content = await fs.promises.readFile(installedManifestPath, 'utf-8');
    const installed = JSON.parse(content) as Array<{ id: string }>;
    return installed.some(p => p.id === pluginId);
  } catch {
    return false;
  }
}
```

## Implementation Tasks

- [x] Add `"distribution": "marketplace"` to `plugins/quant-lab-plugin/manifest.json`
- [x] Add `isMarketplacePluginInstalled()` helper in `main/utils/plugin-install-checker.ts`
- [x] Modify `plugin:scanAll` to filter marketplace plugins based on installation status
- [x] Update TypeScript types for `PluginManifest.distribution`
- [ ] Test: Verify Quant Lab hidden when not installed
- [ ] Test: Verify Quant Lab visible after Marketplace install

## Files Modified

1. `plugins/quant-lab-plugin/manifest.json` - Added `"distribution": "marketplace"`
2. `apps/desktop/src/main/utils/plugin-install-checker.ts` - **NEW** Centralized installation checker
3. `apps/desktop/src/main/ipc/plugin-handlers.ts` - Filter logic in scanAll
4. `apps/desktop/src/shared/types/plugin.ts` - Added `PluginDistribution` type

## Related

- PLUGIN_Plugin Release Package Workflow
- Plugin Marketplace Implementation

## Date

2026-02-06
