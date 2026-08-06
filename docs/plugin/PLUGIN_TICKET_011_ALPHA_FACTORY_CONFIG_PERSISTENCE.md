# PLUGIN_Alpha Factory Configuration Persistence

## Status: COMPLETED

## Objective

Persist all user-configured state on the Alpha Factory page to SQLite, so configurations survive page navigation and application restart.

## Problem

### Current Behavior

All Alpha Factory state lives in React `useState` - lost on any navigation or refresh:

```typescript
// AlphaFactoryPage.tsx - ALL state is ephemeral
const [signals, setSignals] = useState<SignalChip[]>([]);
const [signalMethod, setSignalMethod] = useState('sharpe_weighted');
const [lookback, setLookback] = useState(60);
const [exits, setExits] = useState<SignalChip[]>([{ id: '1', name: 'TrailingStop' }]);
const [exitMethod, setExitMethod] = useState('any');
```

### Expected Behavior

1. User configures Alpha Factory (signals, combinator, lookback, exits)
2. **Every change auto-saves** to SQLite (no manual Save required)
3. User navigates away or restarts app
4. User returns to Alpha Factory -> last state auto-restored
5. User can manage multiple named configurations (Save As, load, delete)

### Root Cause

No persistence layer designed for Alpha Factory workflow configurations. The `signal_source_registry` stores **signal source definitions** (raw materials), but there is no table for **factory configurations** (how those materials are assembled).

```
signal_source_registry  = Raw materials (individual signal sources)
alpha_factory_config    = Assembly instructions (which signals + how to combine)  <-- MISSING
```

---

## Architecture

### Auto-Save Design

**Principle**: Alpha Factory is a workbench. State persists automatically like a desktop IDE - no manual save required for the active configuration.

```
User action (add signal, change timeframe, modify lookback...)
    |
    v
React setState (immediate UI update)
    |
    v
Debounce 500ms (coalesce rapid changes)
    |
    v
IPC: alpha-factory:save-config (silent auto-persist)
    |
    v
SQLite alpha_factory_config (active config updated)
```

**Save Button** is repurposed as **Save As** - creates a new named configuration from current state.

### Conceptual Model

```
signal_source_registry
    |
    | User selects N signal sources via SignalSourcePicker
    v
+--------------------------------------------------+
| Alpha Factory Configuration                       |
|                                                    |
| Signal Factory:                                    |
|   signals: [ref_1, ref_2, ..., ref_N]             |
|   method: 'sharpe_weighted'                        |
|   lookback: 60                                     |
|                                                    |
| Exit Factory:                                      |
|   exits: [exit_1, exit_2, ..., exit_M]             |
|   method: 'any'                                    |
|                                                    |
+--------------------------------------------------+
    |
    | Auto-save (debounced) -> alpha_factory_config (SQLite)
    v
Persisted. Restored on next visit.
```

### Data Flow

```
Auto-Save (on every state change, debounced 500ms):
  React state change (signal add/remove, timeframe change, method change...)
       |
       v
  Debounce timer reset (500ms)
       |
       v (after 500ms idle)
  IPC: alpha-factory:save-config
       |
       v
  UPSERT alpha_factory_config (SQLite)

Load (on page mount):
  Page mount
       |
       v
  IPC: alpha-factory:load-config (no id = load active)
       |
       v
  SELECT from alpha_factory_config WHERE is_active = 1
       |
       v
  setState -> UI restored

Save As (explicit user action):
  User clicks "Save As"
       |
       v
  NamingDialog -> user enters name
       |
       v
  IPC: alpha-factory:save-config (new id, new name)
       |
       v
  INSERT new alpha_factory_config row (becomes active)
```

---

## Database Schema

### Migration: `007_alpha_factory_config.sql` (Version 12)

**Status**: COMPLETED - Migration applied successfully.

```sql
-- Migration: 007_alpha_factory_config
-- Description: PLUGIN_TICKET_011 - Alpha Factory configuration persistence
-- Date: 2026-02-07

-- Alpha Factory saved configurations
-- Each row = one named configuration (signal selections + combinator settings)
CREATE TABLE alpha_factory_config (
    -- Identity
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,

    -- Signal Factory
    signal_method TEXT NOT NULL DEFAULT 'sharpe_weighted',
    lookback INTEGER NOT NULL DEFAULT 60,
    signals TEXT NOT NULL DEFAULT '[]',  -- JSON array of signal references

    -- Exit Factory
    exit_method TEXT NOT NULL DEFAULT 'any',
    exits TEXT NOT NULL DEFAULT '[]',    -- JSON array of exit references

    -- Lifecycle
    is_active INTEGER NOT NULL DEFAULT 0,  -- 1 = last active config (auto-load)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_alpha_factory_updated ON alpha_factory_config(updated_at DESC);
```

### JSON Column Structures

**`signals`** column - Array of signal source references with user overrides:

```json
[
  {
    "signal_source_id": "wf_1707123456_abc123",
    "name": "ADX Regime + RSI Entry Strategy",
    "analysis": {
      "algorithmName": "ADX Regime Detector",
      "timeframe": "1d"
    },
    "entry": {
      "algorithmName": "RSI Trend Entry",
      "timeframe": "1h"
    },
    "exit": {
      "algorithmName": "ATR Trailing Stop",
      "timeframe": "1h"
    },
    "sharpe": 1.85,
    "winRate": 0.62,
    "totalTrades": 156
  }
]
```

**`exits`** column - Array of exit configurations:

```json
[
  {
    "id": "exit_1707123456_xyz",
    "name": "TrailingStop",
    "signal_source_id": null,
    "analysis": null,
    "entry": null,
    "exit": {
      "algorithmName": "TrailingStop",
      "timeframe": "1h"
    }
  }
]
```

### Design Rationale: JSON vs Relational

| Approach | Pros | Cons |
|----------|------|------|
| **JSON columns** | Simple schema, single query load/save, flexible structure | No per-signal SQL queries |
| Relational (junction tables) | SQL queryable per signal | Over-engineered for this use case |

**Decision**: JSON columns. Rationale:
- Signals are always loaded/saved as a complete set (never queried individually)
- Desktop app with single user (no concurrent access concerns)
- Schema matches the React state structure 1:1 (simple serialization)
- Timeframe overrides (PLUGIN_TICKET_010) are per-config, not per-registry-entry

---

## IPC Handlers

### Channels

**Status**: COMPLETED - All 4 channels registered.

```typescript
// V3_CHANNELS additions
ALPHA_FACTORY_SAVE_CONFIG   = 'alpha-factory:save-config'
ALPHA_FACTORY_LOAD_CONFIG   = 'alpha-factory:load-config'
ALPHA_FACTORY_LIST_CONFIGS  = 'alpha-factory:list-configs'
ALPHA_FACTORY_DELETE_CONFIG = 'alpha-factory:delete-config'
```

### Handler Specifications

#### 1. Save Config

**Channel**: `alpha-factory:save-config`

```typescript
interface AlphaFactorySaveConfigRequest {
  id?: string;           // If provided, update existing; if null, create new
  name: string;
  signalMethod: string;
  lookback: number;
  signals: SignalChip[];  // Full signal chip data (with component details)
  exitMethod: string;
  exits: SignalChip[];
}

// Response
{ success: true, id: string }
```

**Behavior**:
- If `id` provided and exists: UPDATE
- If `id` not provided: INSERT with generated ID (`af_{timestamp}_{random}`)
- Set `is_active = 1` on saved config, `is_active = 0` on all others
- Set `updated_at` to current ISO timestamp

#### 2. Load Config

**Channel**: `alpha-factory:load-config`

```typescript
// Request: config ID (or null for active config)
{ id?: string }

// Response
{
  success: true,
  data: {
    id: string;
    name: string;
    signalMethod: string;
    lookback: number;
    signals: SignalChip[];
    exitMethod: string;
    exits: SignalChip[];
    createdAt: string;
    updatedAt: string;
  } | null  // null if no config found
}
```

**Behavior**:
- If `id` provided: load specific config
- If `id` omitted: load the active config (`is_active = 1`)
- Parse JSON columns (`signals`, `exits`) back to arrays
- Return `null` if no config found (fresh install, no saved configs)

#### 3. List Configs

**Channel**: `alpha-factory:list-configs`

```typescript
// No request params

// Response
{
  success: true,
  data: Array<{
    id: string;
    name: string;
    signalMethod: string;
    signalCount: number;   // Derived from JSON array length
    exitCount: number;
    isActive: boolean;
    updatedAt: string;
  }>
}
```

**Behavior**:
- Return all saved configs, ordered by `updated_at DESC`
- Include summary info (signal/exit counts) without full JSON payload

#### 4. Delete Config

**Channel**: `alpha-factory:delete-config`

```typescript
// Request
{ id: string }

// Response
{ success: true }
```

**Behavior**:
- Delete config by ID
- If deleted config was active, no config is active (page shows empty state)

---

## Preload API

**Status**: COMPLETED

**File**: `apps/desktop/src/preload/index.ts`

```typescript
alphaFactory: {
  saveConfig: (config: AlphaFactorySaveConfigRequest) =>
    ipcRenderer.invoke('alpha-factory:save-config', config),
  loadConfig: (id?: string) =>
    ipcRenderer.invoke('alpha-factory:load-config', { id }),
  listConfigs: () =>
    ipcRenderer.invoke('alpha-factory:list-configs'),
  deleteConfig: (id: string) =>
    ipcRenderer.invoke('alpha-factory:delete-config', { id }),
}
```

---

## UI Changes

### AlphaFactoryPage Updates

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx`

#### Auto-Load on Mount

**Status**: COMPLETED

```typescript
// On mount: load active config
useEffect(() => {
  window.electronAPI.alphaFactory.loadConfig()
    .then(response => {
      if (response.success && response.data) {
        setSignals(response.data.signals);
        setSignalMethod(response.data.signalMethod);
        setLookback(response.data.lookback);
        setExits(response.data.exits);
        setExitMethod(response.data.exitMethod);
        setConfigId(response.data.id);
        setConfigName(response.data.name);
      }
    });
}, []);
```

#### Auto-Save on State Change (Debounced)

**Status**: TODO - Pending implementation

Replace manual Save with debounced auto-save:

```typescript
// Debounced auto-save: triggers 500ms after last state change
useEffect(() => {
  // Skip auto-save during initial load (before first config is loaded or created)
  if (!configId) return;

  const timer = setTimeout(() => {
    window.electronAPI.alphaFactory.saveConfig({
      id: configId,
      name: configName,
      signalMethod,
      lookback,
      signals,
      exitMethod,
      exits,
    });
  }, 500);

  return () => clearTimeout(timer);
}, [configId, configName, signalMethod, lookback, signals, exitMethod, exits]);
```

**First visit (no configId yet)**: Auto-create a default config on first state change:

```typescript
// On first meaningful state change, create default config
useEffect(() => {
  if (configId || signals.length === 0) return;

  const timer = setTimeout(async () => {
    const response = await window.electronAPI.alphaFactory.saveConfig({
      name: 'Default',
      signalMethod,
      lookback,
      signals,
      exitMethod,
      exits,
    });
    if (response.success && response.id) {
      setConfigId(response.id);
      setConfigName('Default');
    }
  }, 500);

  return () => clearTimeout(timer);
}, [configId, signals, signalMethod, lookback, exitMethod, exits]);
```

#### Save As Handler

Repurpose Save button as "Save As" (create new named config):

```typescript
const handleSaveAs = useCallback(async () => {
  const input = window.prompt('Enter configuration name:');
  if (!input || !input.trim()) return;
  const name = input.trim();

  const response = await window.electronAPI.alphaFactory.saveConfig({
    name,           // New name (no id = create new config)
    signalMethod,
    lookback,
    signals,
    exitMethod,
    exits,
  });

  if (response.success && response.id) {
    setConfigId(response.id);
    setConfigName(name);
  }
}, [signalMethod, lookback, signals, exitMethod, exits]);
```

#### New State

**Status**: COMPLETED

```typescript
const [configId, setConfigId] = useState<string | undefined>();
const [configName, setConfigName] = useState('');
```

---

## Implementation Plan

### Phase 1: Database Migration - COMPLETED

- [x] Create `007_alpha_factory_config.sql` migration script (version 12)
- [x] Verify migration runs on app startup (confirmed in logs)

### Phase 2: IPC Handlers - COMPLETED

- [x] Add channel constants to `V3_CHANNELS`
- [x] Implement `alpha-factory:save-config` handler (UPSERT)
- [x] Implement `alpha-factory:load-config` handler
- [x] Implement `alpha-factory:list-configs` handler
- [x] Implement `alpha-factory:delete-config` handler
- [x] Register handlers in `registerV3Handlers()`

### Phase 3: Preload API - COMPLETED

- [x] Expose `alphaFactory` API in preload bridge
- [x] Add TypeScript type declarations (global.d.ts)

### Phase 4: UI Integration - COMPLETED

- [x] Add `configId` / `configName` state to AlphaFactoryPage
- [x] Implement auto-load on mount (load active config)
- [x] **Implement debounced auto-save on state change** (replace manual save)
- [x] Auto-create "Default" config on first signal selection
- [x] Repurpose Save button as "Save As" (create new named config)
- [x] Extract centralized `useAlphaFactoryConfig` hook (all persistence logic)

### Phase 5: Config Management (Optional Enhancement)

- [ ] Config list dropdown in ActionBar (load different configs)
- [ ] Delete config option
- [ ] Duplicate config option

---

## What Gets Persisted

| Field | Source | Trigger | Type | Default |
|-------|--------|---------|------|---------|
| `signals` | User selection from SignalSourcePicker | Auto-save on add/remove | `SignalChip[]` (JSON) | `[]` |
| `signalMethod` | Combinator dropdown | Auto-save on change | `string` | `'sharpe_weighted'` |
| `lookback` | Lookback input | Auto-save on change (debounced) | `number` | `60` |
| `exits` | Exit configuration | Auto-save on add/remove | `SignalChip[]` (JSON) | `[]` |
| `exitMethod` | Exit combinator dropdown | Auto-save on change | `string` | `'any'` |
| Timeframe overrides | PLUGIN_TICKET_010 per-component dropdowns | Auto-save on change | Embedded in signal JSON | Original values |

### Timeframe Override Persistence

When user modifies a signal's component timeframe via PLUGIN_TICKET_010, the override is stored inside the signal's JSON entry:

```
Original (from registry):     analysis.timeframe = '1d'
User override in Alpha Factory: analysis.timeframe = '4h'
Saved in config JSON:         analysis.timeframe = '4h'  (override preserved)
```

The `signal_source_registry` is NOT modified. Overrides are config-local.

---

## Files Affected

| File | Change | Phase | Status |
|------|--------|-------|--------|
| `apps/desktop/src/main/database/migrations/migration-manager.ts` | Migration v12 embedded | 1 | DONE |
| `apps/desktop/src/main/database/migrations/scripts/007_alpha_factory_config.sql` | **NEW** - Doc reference | 1 | DONE |
| `apps/desktop/src/main/ipc/v3-handlers.ts` | 4 IPC handlers + channels + register | 2 | DONE |
| `apps/desktop/src/preload/index.ts` | `alphaFactory` API namespace | 3 | DONE |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/types/global.d.ts` | ElectronAPI extension | 3 | DONE |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/hooks/useAlphaFactoryConfig.ts` | **NEW** - Centralized config persistence hook | 4 | DONE |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx` | Simplified - delegates persistence to hook | 4 | DONE |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ActionBar.tsx` | Save Workflow -> Save As | 4 | DONE |

---

## Relationship to Existing Tables

```
signal_source_registry
    |
    | signal_source_id referenced in signals JSON
    |
alpha_factory_config (THIS TICKET)
    |
    | Stores user's assembly configuration
    | (which signals + how to combine + exits)
    v
Execution
```

`signal_source_registry` = **library of available signal sources** (write: Builder export, read: SignalSourcePicker)
`alpha_factory_config` = **user's saved factory setup** (write: auto-save, read: page mount)

---

## Success Criteria

1. User selects a signal -> **auto-saved** to `alpha_factory_config` table (debounced 500ms)
2. User changes timeframe/method/lookback -> auto-saved
3. User navigates away from Alpha Factory page
4. User returns to Alpha Factory -> last state auto-restored
5. User restarts application -> last state auto-restored
6. Timeframe overrides (PLUGIN_TICKET_010) preserved in saved config
7. Exit configurations persisted and restored
8. No hardcoded seed data on page load (empty state if no saved config)
9. "Save As" creates a new named configuration from current state

---

## Design References

- [](../design/_REGIME_TO_SIGNAL_SOURCE_CONVERSION.md) - Signal source registry (write path)
- - Signal source selection (read path)
- - Modular component extraction
- - Component detail + timeframe override
- [](../design/_MODULAR_ALGORITHM_ORCHESTRATION_ARCHITECTURE.md) - Alpha Factory architecture
- [Migration 006](../../apps/desktop/src/main/database/migrations/scripts/006_signal_source_registry.sql) - Signal source registry schema

## Date

2026-02-07
