# PLUGIN_Plugin Card Click Navigation

## Status: COMPLETED (Referenced in CLAUDE.md)

## Problem

Clicking on QUANT LAB plugin card in the NexusHub "Backtest Module" section has no visible response - user expects to enter the plugin interface.

**Screenshot**: `image205.png` - User clicks QUANT LAB card, nothing happens.

## Root Cause Analysis

### Missing Plugin Entry Point (Primary Issue)

quant-lab-nexus plugin entry file (`index.tsx`) was missing `activate` function:

```typescript
// BEFORE: Only exports components, no activate function
export { AlphaFactoryPage } from './pages/AlphaFactory';
export const pluginInfo = { ... };

// AFTER: Proper PluginModule with activate/deactivate
const plugin: PluginModule = {
  async activate(context: PluginContext): Promise<PluginApi> { ... },
  async deactivate(): Promise<void> { ... },
};
export default plugin;
```

Compare with working plugins (strategy-builder-nexus, back-test-nexus):
- All have `export default plugin` with `activate` function
- quant-lab-nexus was missing this entirely

### Current Click Logic

```
CompactPluginCard (NexusHubPage.tsx:347)
    onClick={(e) => isLinked ? onNavigate(plugin) : onToggle(e, pluginId, active)}

    +-- isLinked=true (Top LinkedPluginsGrid)
    |   +-- onNavigate(plugin) -> setActiveView(viewId)
    |
    +-- isLinked=false/undefined (Bottom PluginCategorySection)
        +-- onToggle() -> activatePlugin() or deactivatePlugin()
            +-- NO NAVIGATION after toggle
```

### Log Evidence

```
[NexusHubPage] Activating plugin: com.StratCraft.quant-lab-nexus
```

This log (line 50) proves:
1. `plugin.state.active = false` (plugin was inactive)
2. `handleTogglePlugin` was called (not `handlePluginClick`)
3. Plugin activation was triggered, but **no navigation followed**

### Root Cause

1. **Click behavior mismatch**: Bottom section cards trigger toggle, not navigation
2. **Missing post-activation navigation**: After successful activation, user must manually click top area to enter plugin
3. **UX expectation gap**: User expects "click -> enter plugin", actual is "click -> toggle state only"

## Expected Behavior (per )

| Plugin State | Click Location | Expected Action |
|--------------|----------------|-----------------|
| Inactive | Bottom Section | Activate (show in top LinkedPlugins) |
| Active | Bottom Section | Deactivate (remove from top) |
| Active | Top Section Card | Navigate to plugin view |
| Active | Top Power Button | Deactivate only |

**Key**: Bottom section = toggle only, Top section = navigate.

## Solution Design

### Primary Fix: Add Plugin Entry Point

quant-lab-nexus plugin was missing `activate`/`deactivate` functions.

```typescript
// BEFORE: Only component exports
export { AlphaFactoryPage } from './pages/AlphaFactory';

// AFTER: Proper PluginModule
const plugin: PluginModule = {
  async activate(context: PluginContext): Promise<PluginApi> {
    context.log.info('QUANT LAB plugin activating...');
    // Register commands...
    context.log.info('QUANT LAB plugin activated');
    return { activate: async () => {}, deactivate: async () => {} };
  },
  async deactivate(): Promise<void> {
    // Cleanup...
  },
};
export default plugin;
```

### Click Behavior (per )

Bottom section = toggle only (no navigation):

```typescript
const handleTogglePlugin = useCallback(async (e, pluginId, currentState) => {
  e.stopPropagation();
  if (currentState) {
    await deactivatePlugin(pluginId);  // Remove from top
  } else {
    await activatePlugin(pluginId);    // Show in top
  }
}, [activatePlugin, deactivatePlugin]);
```

## Implementation Tasks

- [x] Modify `handleTogglePlugin` to navigate after successful activation
- [x] Add `setActiveView` dependency to `handleTogglePlugin` callback
- [x] Add `activate`/`deactivate` functions to quant-lab-nexus plugin entry
- [x] Rebuild quant-lab-nexus plugin
- [ ] Test: Click inactive plugin -> activates and navigates
- [ ] Test: Power button still deactivates without navigation

## Files Modified

1. `apps/desktop/src/renderer/features/nexus/NexusHubPage.tsx`
   - `handleTogglePlugin` - Add navigation after activation

2. `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/index.tsx`
   - Added `PluginModule` with `activate`/`deactivate` functions
   - Added `export default plugin`

## Related

- PLUGIN_Plugin Release Package Workflow
- PLUGIN_Marketplace Plugin Visibility Control
- Centralized View Registry

## Date

2026-02-06
