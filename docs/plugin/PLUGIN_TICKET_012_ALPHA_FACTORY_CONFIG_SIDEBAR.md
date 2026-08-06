# PLUGIN_Alpha Factory Configuration Sidebar

## Status: SUPERSEDED BY  (2026-06-11)

**The multi-configuration sidebar this ticket added is removed.** The Alpha
Factory page is designed to host a pool of ~20,000 signals; a sidebar of
named "configurations" was the wrong organising axis and was never used as
designed (every observed install carried exactly one "Default" entry).
Persistence collapses to a single active row in `alpha_factory_config`;
filter snapshots live in SignalExplorer's saved Views. See
[](../design/_ALPHA_FACTORY_REMOVE_CONFIGURATION_SIDEBAR.md).

## Objective

Add a file-manager-style sidebar to the Alpha Factory page, enabling users to browse, create, switch, search, and delete saved strategy configurations.

## Problem

### Current Behavior

Alpha Factory only operates on a single "active" config. The `listConfigs` and `deleteConfig` IPC channels exist (PLUGIN_TICKET_011) but are not exposed in the UI. Users cannot:

- See all saved configurations at a glance
- Switch between configurations by clicking
- Search or filter saved configurations
- Delete configurations from the UI

### Expected Behavior

Left sidebar displays a scrollable list of all saved configurations. Users can:

1. **Browse** all saved configs (name, signal count, last modified)
2. **Create** a new empty configuration ("New Config" button)
3. **Switch** between configs by clicking (loads into editor)
4. **Search** configs by name
5. **Delete** configs (hover to reveal delete button)
6. Active config is visually highlighted

---

## Architecture

### Layout Change

```
BEFORE (single panel):
+---------------------------------------------+
|              AlphaFactoryPage                |
|  max-w-4xl mx-auto                          |
|  [SignalFactorySection]                      |
|  [FlowDivider]                              |
|  [ExitFactorySection]                       |
|  [FlowDivider]                              |
|  [ActionBar]                                |
+---------------------------------------------+

AFTER (sidebar + content):
+----------+----------------------------------+
| Sidebar  |         Content Area             |
| (260px)  |  flex-1 overflow-auto p-6        |
|          |                                  |
| [NewBtn] |  [SignalFactorySection]           |
| [Search] |  [FlowDivider]                   |
| -------- |  [ExitFactorySection]            |
| Config A |  [FlowDivider]                   |
| Config B*|  [ActionBar]                     |
| Config C |                                  |
| Config D |                                  |
|          |                                  |
+----------+----------------------------------+

* = active (highlighted)
```

### Component Hierarchy

```
AlphaFactoryPage (layout: flex row)
  |
  +-- ConfigSidebar (new component, 260px width)
  |     +-- NewConfigButton (reusable, label="New Config")
  |     +-- ConfigSearch (reusable, search input)
  |     +-- ConfigList (reusable, scrollable list)
  |           +-- ConfigItem (sub-component, per row)
  |
  +-- Content Area (existing, flex-1)
        +-- SignalFactorySection
        +-- FlowDivider
        +-- ExitFactorySection
        +-- FlowDivider
        +-- ActionBar
```

### Design Pattern: Reference ConversationSidebar

Follow the established pattern from `strategy-builder-nexus/src/components/ai-studio/ConversationSidebar.tsx`:

| ConversationSidebar | ConfigSidebar (new) |
|---------------------|---------------------|
| `NewChatButton` | `NewConfigButton` (label="New Config") |
| `ConversationSearch` | `ConfigSearch` (placeholder="Search configs...") |
| `ConversationList` | `ConfigList` |
| `ConversationItem` | `ConfigItem` |
| `Conversation` type | `ConfigSummary` type |

**NOT a direct import** - the ConversationSidebar lives in a different plugin (`strategy-builder-nexus`). Cross-plugin imports are prohibited. Instead, create new components within `quant-lab-nexus` following the same patterns.

### Data Flow

```
ConfigSidebar                          useAlphaFactoryConfig (enhanced)
    |                                       |
    | onSelect(id)  ------>  switchConfig(id)
    |                           |
    |                           v
    |                   IPC: alpha-factory:load-config { id }
    |                           |
    |                           v
    |                   setState (signals, method, lookback, exits...)
    |                           |
    | <--- configs list ---  configList (from listConfigs)
    |
    | onNew()       ------>  createNewConfig()
    |                           |
    |                           v
    |                   Reset all state to defaults
    |                   IPC: alpha-factory:save-config { name: 'Untitled' }
    |                           |
    |                           v
    |                   setConfigId(newId), refresh list
    |
    | onDelete(id)  ------>  deleteConfig(id)
    |                           |
    |                           v
    |                   IPC: alpha-factory:delete-config { id }
    |                           |
    |                           v
    |                   Refresh list, load next config or empty state
```

---

## Type Definitions

### New Type: ConfigSummary

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/types.ts`

```typescript
/** Summary item for config sidebar list (from listConfigs IPC) */
export interface ConfigSummary {
  id: string;
  name: string;
  signalMethod: string;
  signalCount: number;
  exitCount: number;
  isActive: boolean;
  updatedAt: string;
}
```

This maps directly to the existing `alpha-factory:list-configs` IPC response shape.

---

## New Components

### 1. ConfigSidebar

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ConfigSidebar.tsx`

**Props**:

```typescript
export interface ConfigSidebarProps {
  configs: ConfigSummary[];
  activeConfigId: string | undefined;
  onNewConfig: () => void;
  onSelectConfig: (id: string) => void;
  onDeleteConfig: (id: string) => void;
  isLoading?: boolean;
  width?: number;  // default: 260
}
```

**Behavior**:
- Manages internal `searchQuery` state
- Filters `configs` by name (case-insensitive)
- Composes: NewConfigButton + ConfigSearch + ConfigList
- Loading overlay when `isLoading` is true

### 2. ConfigList + ConfigItem

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ConfigList.tsx`

**ConfigItem displays**:
- **Row 1**: Config name (truncated) + relative timestamp
- **Row 2**: Summary text (e.g., "3 signals | Sharpe Weighted")
- **Meta row**: Signal count icon + delete button (hover visible)
- Active state: accent color highlight with shadow
- Hover state: subtle translate + border

### 3. NewConfigButton

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/NewConfigButton.tsx`

Follows `NewChatButton` pattern with `label="New Config"` and `FolderPlus` icon.

### 4. ConfigSearch

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ConfigSearch.tsx`

Follows `ConversationSearch` pattern with `placeholder="Search configs..."`.

---

## Hook Enhancement: useAlphaFactoryConfig

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/hooks/useAlphaFactoryConfig.ts`

### New Return Fields

```typescript
interface UseAlphaFactoryConfigReturn {
  // Existing fields (unchanged)
  signals: SignalChip[];
  setSignals: React.Dispatch<React.SetStateAction<SignalChip[]>>;
  signalMethod: string;
  setSignalMethod: React.Dispatch<React.SetStateAction<string>>;
  lookback: number;
  setLookback: React.Dispatch<React.SetStateAction<number>>;
  exits: SignalChip[];
  setExits: React.Dispatch<React.SetStateAction<SignalChip[]>>;
  exitMethod: string;
  setExitMethod: React.Dispatch<React.SetStateAction<string>>;
  configName: string;
  saveAs: () => Promise<void>;

  // NEW fields for sidebar
  configId: string | undefined;
  configList: ConfigSummary[];
  isLoadingList: boolean;
  switchConfig: (id: string) => Promise<void>;
  createNewConfig: () => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  refreshConfigList: () => Promise<void>;
}
```

### New Behaviors

#### refreshConfigList

```
Call IPC: alpha-factory:list-configs
Update configList state with response.data
```

Invoked:
- On mount (after loading active config)
- After saveConfig (new config created)
- After deleteConfig
- After switchConfig

#### switchConfig(id)

```
1. IPC: alpha-factory:load-config { id }
2. setState with loaded config data
3. IPC: alpha-factory:save-config with is_active flag (mark new active)
4. refreshConfigList()
```

Note: The save-config handler already sets `is_active = 1` on the saved config and `is_active = 0` on all others. To mark a config as active without modifying it, we call save-config with the loaded data.

#### createNewConfig

```
1. Reset state to defaults: signals=[], signalMethod='sharpe_weighted', lookback=60, exits=[], exitMethod='any'
2. IPC: alpha-factory:save-config { name: 'Untitled', ...defaults }
3. setConfigId(newId), setConfigName('Untitled')
4. refreshConfigList()
```

#### deleteConfig(id)

```
1. IPC: alpha-factory:delete-config { id }
2. If deleted config was active:
   a. refreshConfigList()
   b. If list not empty: switchConfig(first item)
   c. If list empty: reset state to defaults, clear configId
3. If deleted config was not active:
   a. refreshConfigList() only
```

---

## Page Layout Change

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx`

### Current (line 106-148)

```tsx
<div className="flex-1 overflow-auto p-6">
  <div className="max-w-4xl mx-auto space-y-6">
    ...
  </div>
</div>
```

### Target

```tsx
<div className="flex flex-1 min-h-0">
  {/* Sidebar */}
  <ConfigSidebar
    configs={configList}
    activeConfigId={configId}
    onNewConfig={createNewConfig}
    onSelectConfig={switchConfig}
    onDeleteConfig={deleteConfig}
    isLoading={isLoadingList}
  />

  {/* Content Area (unchanged internals) */}
  <div className="flex-1 overflow-auto p-6">
    <div className="max-w-4xl mx-auto space-y-6">
      ...
    </div>
  </div>
</div>
```

**Layout Note**: Must use `flex-1 min-h-0` instead of `h-full`. The parent `QuantLabPage` is `flex flex-col h-full` with a `BreadcrumbBar` (h-8 = 32px) above AlphaFactoryPage. Using `h-full` would inherit 100% of grandparent height without subtracting BreadcrumbBar, causing sidebar overflow. `flex-1 min-h-0` lets flexbox correctly allocate remaining space.

---

## Styling

All components follow StratCraftsAI design system:

- **Sidebar background**: `bg-color-terminal-surface-secondary`
- **Sidebar border**: `border-r border-color-terminal-border`
- **Active item**: `bg-color-terminal-accent-primary text-color-terminal-bg shadow-lg`
- **Hover item**: `hover:bg-color-terminal-surface-hover hover:translate-x-1`
- **Delete button**: `opacity-0 group-hover:opacity-100` (red on hover)
- **New Config button**: `bg-color-terminal-accent-primary`, no `w-full` (flex stretch handles width)
- **Search input**: `bg-color-terminal-surface border-color-terminal-border focus:border-color-terminal-accent-primary`
- **Empty state**: Centered icon + muted text

---

## Implementation Plan

### Phase 1: Types - COMPLETED

- [x] Add `ConfigSummary` type to `types.ts`

### Phase 2: New Components (4 files) - COMPLETED

- [x] Create `ConfigSearch.tsx` (follow ConversationSearch pattern)
- [x] Create `NewConfigButton.tsx` (follow NewChatButton pattern)
- [x] Create `ConfigList.tsx` + `ConfigItem` (follow ConversationList pattern)
- [x] Create `ConfigSidebar.tsx` (composition of above three)
- [x] Export from `components/index.ts` and `index.tsx`

### Phase 3: Hook Enhancement - COMPLETED

- [x] Add `configList`, `isLoadingList` state
- [x] Implement `refreshConfigList()` using existing `listConfigs` IPC
- [x] Implement `switchConfig(id)` using existing `loadConfig` IPC
- [x] Implement `createNewConfig()` using existing `saveConfig` IPC
- [x] Implement `deleteConfig(id)` using existing `deleteConfig` IPC
- [x] Call `refreshConfigList()` on mount and after mutations

### Phase 4: Page Layout - COMPLETED

- [x] Change AlphaFactoryPage root to `flex flex-1 min-h-0` row layout
- [x] Add ConfigSidebar with props from enhanced hook
- [x] Wrap existing content in `flex-1 overflow-auto` container

---

## No IPC/Preload/Migration Changes Required

All necessary IPC channels already exist from PLUGIN_| Channel | Status | Used By |
|---------|--------|---------|
| `alpha-factory:save-config` | EXISTS | Auto-save, Save As, createNewConfig, switchConfig |
| `alpha-factory:load-config` | EXISTS | Mount load, switchConfig |
| `alpha-factory:list-configs` | EXISTS | refreshConfigList (NEW consumer) |
| `alpha-factory:delete-config` | EXISTS | deleteConfig (NEW consumer) |

This ticket is **UI-only** - no backend changes needed.

---

## Files Affected

| File | Change | Phase |
|------|--------|-------|
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/types.ts` | Add `ConfigSummary` type | 1 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ConfigSearch.tsx` | **NEW** | 2 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/NewConfigButton.tsx` | **NEW** | 2 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ConfigList.tsx` | **NEW** | 2 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ConfigSidebar.tsx` | **NEW** | 2 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/index.ts` | Add exports | 2 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/hooks/useAlphaFactoryConfig.ts` | Enhance with list/switch/create/delete | 3 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx` | Sidebar + flex layout | 4 |

---

## Post-Implementation Fixes

### Fix 1: Sidebar Height Overflow

**Problem**: ConfigSidebar overlapped BreadcrumbBar area.

**Root Cause**: `AlphaFactoryPage` used `h-full` which inherited 100% of grandparent height, ignoring BreadcrumbBar's 32px. In the nesting `QuantLabPage (flex-col h-full) > BreadcrumbBar (h-8) > AlphaFactoryPage (h-full)`, the page received full parent height instead of remaining space.

**Fix**: Changed `AlphaFactoryPage` root from `flex h-full` to `flex flex-1 min-h-0`. `flex-1` lets flexbox allocate remaining height after BreadcrumbBar. `min-h-0` overrides the default `min-height: auto` that prevents flex items from shrinking below content size.

### Fix 2: NewConfigButton Right-Side Clipping

**Problem**: Button's right rounded corners were clipped by sidebar's `overflow-hidden`.

**Root Cause**: `w-full` (width: 100% = 260px) + `mx-4` (32px total horizontal margin) = 292px total, exceeding the 260px sidebar width.

**Fix**: Removed `w-full` from NewConfigButton. In a `flex flex-col` container, flex items default to `align-self: stretch`, which correctly computes width as `container-width - horizontal-margin` (260 - 32 = 228px).

---

## Design References

- - Config persistence (IPC/DB foundation)
- - Modular component extraction
- [](../design/_StratCraftsAI_UI_COMPONENT_LIBRARY.md) - StratCraftsAI UI Component Library
- ConversationSidebar reference: `plugins/strategy-builder-nexus/src/components/ai-studio/ConversationSidebar.tsx`

## Date

2026-02-07
