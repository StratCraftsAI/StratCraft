# PLUGIN_Data Plugin Extraction (Tier 0 Foundation Plugin)

## Status: COMPLETE

## Problem

Data source functionality (provider selector, symbol search, data source types) is currently embedded inside `back-test-nexus` (Tier 1). This prevents `quant-lab-nexus` (Alpha Factory) from reusing these components, forcing it to hardcode ClickHouse as the only data source (PLUGIN_TICKET_015).

With the Plugin Tier System introduced in PLUGIN_TICKET_009, a Tier 0 foundation plugin can be imported by any Tier 1 plugin, solving the cross-plugin reuse problem.

## Solution

Extract shared data source UI components and types from `back-test-nexus` into a new `data-plugin` (Tier 0).

## Architecture

```
data-plugin (Tier 0 - Foundation)
  |- DataSourceSelectField component
  |- DataSourceOption, SymbolSearchResult types
  |- DATA_PROVIDERS config
  |- DEFAULT_DATA_SOURCE constant
         ^                    ^
         |                    |
back-test-nexus (Tier 1)    quant-lab-nexus (Tier 1)
  |- BacktestDataConfigPanel   |- DataConfigPanel
  |- BacktestPage              |- AlphaFactoryPage
  (imports from data-plugin)   (imports from data-plugin)
```

## Scope

### What moves TO data-plugin

| Item | Source Location | Type |
|------|---------------|------|
| `DataSourceSelectField` | `BacktestDataConfigPanel.tsx` (internal) | Component (extract) |
| `DataSourceOption` | `BacktestDataConfigPanel.tsx:26-37` | Interface |
| `SymbolSearchResult` | `BacktestDataConfigPanel.tsx:39-48` | Interface |
| `TimeframeOption` | `BacktestDataConfigPanel.tsx` | Type |
| `DATA_PROVIDERS` | `config/data-providers.ts` | Config array |
| `DataProvider` | `config/data-providers.ts` | Interface |
| `getProviderBySecretKey()` | `config/data-providers.ts` | Utility |
| `isPrimarySecretKey()` | `config/data-providers.ts` | Utility |
| `DEFAULT_DATA_SOURCE` | `BacktestDataConfigPanel.tsx:109` | Constant |

### What stays in back-test-nexus

| Item | Reason |
|------|--------|
| `BacktestDataConfigPanel` | Backtest-specific layout (symbol, dates, capital, order size) |
| `BacktestDataConfig` | Backtest-specific config interface |
| `BacktestPage` provider loading logic | Business logic for backtest workflow |
| `SecretsTab` | Settings page for API key management |

### What stays in host layer (no change)

| Item | Location |
|------|----------|
| `data-handlers.ts` | IPC handlers (main process) |
| `data-providers/` | Provider implementations (main process) |
| `api.data.*` | Preload API namespace |
| `data-management/` | Data Management page (renderer) |

## data-plugin Directory Structure

```
plugins/data-plugin/
+-- manifest.json              # tier: 0
+-- ui/
|   +-- data-nexus/
|       +-- package.json
|       +-- tsconfig.json
|       +-- src/
|           +-- index.ts       # Barrel exports
|           +-- types/
|           |   +-- global.d.ts
|           |   +-- data-source.ts    # DataSourceOption, SymbolSearchResult, TimeframeOption
|           +-- components/
|           |   +-- DataSourceSelectField.tsx
|           +-- config/
|           |   +-- data-providers.ts  # DATA_PROVIDERS, DataProvider, utilities
|           +-- constants.ts          # DEFAULT_DATA_SOURCE
+-- locales/                   # (optional, future)
```

## Manifest

```json
{
  "name": "data-plugin",
  "version": "1.0.0",
  "tier": 0,
  "distribution": "bundled",
  "description": "Foundation plugin providing shared data source components and types",
  "ui": {
    "main": "./ui/data-nexus/src/index.ts"
  }
}
```

## Implementation Steps

### Step 1: Create data-plugin skeleton
- Create directory structure per PLUGIN_TICKET_009
- Create manifest.json with `"tier": 0`
- Create package.json, tsconfig.json

### Step 2: Extract types to data-plugin
- Move `DataSourceOption`, `SymbolSearchResult`, `TimeframeOption` to `data-plugin/ui/data-nexus/src/types/data-source.ts`
- Move `DataProvider` interface to `data-plugin/ui/data-nexus/src/config/data-providers.ts`
- Create barrel export `index.ts`

### Step 3: Extract DataSourceSelectField component
- Extract `DataSourceSelectField` (with `LatencyDot`) from `BacktestDataConfigPanel.tsx` into `data-plugin/ui/data-nexus/src/components/DataSourceSelectField.tsx`
- Ensure it accepts props: `dataSources`, `value`, `onChange`, `isAuthenticated`

### Step 4: Extract data-providers config
- Move `DATA_PROVIDERS`, `getProviderBySecretKey()`, `isPrimarySecretKey()` from `back-test-nexus/ui/src/config/data-providers.ts` to `data-plugin/ui/data-nexus/src/config/data-providers.ts`

### Step 5: Update back-test-nexus imports
- `BacktestDataConfigPanel.tsx`: import types and `DataSourceSelectField` from `@plugins/data-plugin`
- `SecretsTab.tsx`: import `DATA_PROVIDERS`, `getProviderBySecretKey` from `@plugins/data-plugin`
- `BacktestPage.tsx`: import `DataSourceOption` from `@plugins/data-plugin`
- Update manifest: add `"tier": 1`, `"dependencies": { "plugins": ["data-plugin"] }`
- Remove old `config/data-providers.ts`

### Step 6: Update quant-lab-nexus (Alpha Factory)
- Update manifest: add `"dependencies": { "plugins": ["data-plugin"] }`
- Add `dataSource` field to `DataConfig` interface
- Import `DataSourceSelectField` from `@plugins/data-plugin` into `DataConfigPanel.tsx`
- Update PLUGIN_TICKET_015 to remove "always ClickHouse" constraint

### Step 7: Build system integration
- Add data-plugin to webpack build config
- Ensure Tier 0 plugin compiles before Tier 1 plugins
- Verify tsconfig path aliases resolve correctly

## IPC API Dependencies

data-plugin UI components call these existing `api.data.*` methods (no IPC changes needed):

```typescript
// Used by DataSourceSelectField
api.data.getProviderList()              // Sync provider metadata
api.data.checkProvidersProgressive()    // Progressive connection check
api.data.onProviderStatus(callback)    // Status event subscription
```

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Build order dependency | Webpack config ensures Tier 0 compiles first |
| Import path breakage | tsconfig path aliases validated in CI |
| Runtime regression in back-test-nexus | Functional parity test: backtest data config behavior unchanged |

## Related Tickets

- PLUGIN_Plugin Tier System (prerequisite, already updated)
- PLUGIN_Alpha Factory backtest (will be updated in Step 6)
- IDataProvider unified interface (host layer, not affected)
- Auth-aware UI gating (DataSourceSelectField must respect `requiresAuth`)
- Progressive provider status with latency (LatencyDot moves with DataSourceSelectField)
