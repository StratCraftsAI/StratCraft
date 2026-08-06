# PLUGIN_Alpha Factory Signal Source Selection

## Status: Open

## Objective

Replace the hardcoded placeholder signal creation in Alpha Factory's "Add Signal" button with a signal source selection flow that queries the `signal_source_registry` SQLite table.

## Problem

### Current Behavior

Clicking "Add Signal" in `AlphaFactoryPage.tsx` directly creates a generic placeholder:

```typescript
// AlphaFactoryPage.tsx:34-37
const handleAddSignal = useCallback(() => {
  const newId = String(Date.now());
  setSignals(prev => [...prev, { id: newId, name: `Signal_${prev.length + 1}` }]);
}, []);
```

Result: `Signal_3`, `Signal_4`, etc. - no user selection, no database query.

### Expected Behavior

Clicking "Add Signal" should:
1. Query `signal_source_registry` table for exported workflow signal sources
2. Show a selection panel with signal name + backtest metrics
3. User selects a signal source
4. Selected signal added to Signal Factory with real data

### Root Cause

The **read path** from `signal_source_registry` is missing.  implemented the **write path** (Export to Quant Lab), but the corresponding read path was never built:

| Path | Status | Implementation |
|------|--------|----------------|
| **Write** (Export) | Implemented | `v3-handlers.ts` EXPORT_TO_QUANTLAB, `useExportToQuantLab` hook |
| **Read** (Selection) | **Missing** | No IPC handler, no preload API, no selection UI |

---

## Architecture

### Data Flow

```
signal_source_registry (SQLite)
         |
         v
IPC Handler (signal-source:list)        <-- MISSING
         |
         v
Preload API (signalSource.list)          <-- MISSING
         |
         v
SignalSourcePicker component             <-- MISSING
         |
         v
AlphaFactoryPage state (signals[])
```

### Target Interaction

```
User clicks "Add Signal"
         |
         v
Modal overlay opens (centered, backdrop blur)
  +--------------------------------------------------+
  | SELECT SIGNAL SOURCE                          [X] |
  |--------------------------------------------------|
  | [Search...]                                       |
  |                                                   |
  | ADX Regime + RSI Entry Strategy                   |
  | Sharpe: 1.85 | WR: 62% | Trades: 156             |
  | Exported: 2026-02-05                              |
  | [+ Add]                                           |
  |                                                   |
  | MACD Trend Following                              |
  | Sharpe: 1.42 | WR: 58% | Trades: 203             |
  | Exported: 2026-02-04                              |
  | [+ Add]                                           |
  |                                                   |
  | (Empty state: No exported signals yet.            |
  |  Export from Strategy Builder first.)              |
  +--------------------------------------------------+
```

---

## Implementation Plan

### Phase 1: IPC Handler (Read API)

**File**: `apps/desktop/src/main/ipc/v3-handlers.ts`

Add `signal-source:list` handler to query `signal_source_registry`:

```typescript
// Query: metadata + metrics only (no algorithm code)
ipcMain.handle('signal-source:list', async () => {
  const db = getDatabaseManager().getDb();
  const rows = db.prepare(`
    SELECT id, name, description, source_type, exported_at,
           analysis_algorithm_name, entry_algorithm_name, exit_algorithm_name,
           analysis_timeframe, entry_timeframe, exit_timeframe,
           backtest_sharpe, backtest_max_drawdown, backtest_win_rate,
           backtest_total_trades, backtest_profit_factor,
           symbol
    FROM signal_source_registry
    ORDER BY exported_at DESC
  `).all();
  return { success: true, data: rows };
});
```

**Design Note**: Query excludes `algorithm_code` columns (large text) since the selection UI only needs metadata and metrics.

### Phase 2: Preload API

**File**: `apps/desktop/src/preload/index.ts`

Expose signal source read API:

```typescript
signalSource: {
  list: () => ipcRenderer.invoke('signal-source:list'),
}
```

### Phase 3: SignalSourcePicker Modal Component

**File**: `apps/desktop/src/renderer/features/quant-lab/components/SignalSourcePicker.tsx`

Portal-based modal dialog (follows  modular component rules,  portal pattern):

```typescript
interface SignalSourceItem {
  id: string;
  name: string;
  description: string | null;
  exported_at: string;
  analysis_algorithm_name: string;
  entry_algorithm_name: string;
  exit_algorithm_name: string | null;
  analysis_timeframe: string;
  entry_timeframe: string;
  exit_timeframe: string | null;
  backtest_sharpe: number | null;
  backtest_max_drawdown: number | null;
  backtest_win_rate: number | null;
  backtest_total_trades: number | null;
  backtest_profit_factor: number | null;
  symbol: string | null;
}

interface SignalSourcePickerProps {
  visible: boolean;
  onSelect: (source: SignalSourceItem) => void;
  onClose: () => void;
  excludeIds?: string[];  // Already added signal IDs (prevent duplicates)
}
```

Features:
- Query `signal-source:list` on open
- Display signal name, backtest metrics (Sharpe, WinRate, Trades)
- Search/filter by name
- Empty state message when no exported signals exist
- Exclude already-added signals via `excludeIds`

### Phase 4: Update AlphaFactoryPage

**File**: `apps/desktop/src/renderer/features/quant-lab/components/AlphaFactoryPage.tsx`

1. Update `SignalChip` type to carry signal source metadata
2. Replace `handleAddSignal` with picker open logic
3. Handle selection callback

### Phase 5: Update types.ts

**File**: `apps/desktop/src/renderer/features/quant-lab/types.ts`

Extend `SignalChip` to hold real signal source data:

```typescript
export interface SignalChip {
  id: string;       // signal_source_registry.id
  name: string;     // signal_source_registry.name
  // Backtest metrics (display reference)
  sharpe?: number | null;
  winRate?: number | null;
  totalTrades?: number | null;
}
```

---

## Files Affected

| File | Change | Phase |
|------|--------|-------|
| `apps/desktop/src/main/ipc/v3-handlers.ts` | Add `signal-source:list` IPC handler | 1 |
| `apps/desktop/src/preload/index.ts` | Expose `signalSource.list` API | 2 |
| `apps/desktop/src/renderer/features/quant-lab/components/SignalSourcePicker.tsx` | **NEW** - Signal source selection modal | 3 |
| `apps/desktop/src/renderer/features/quant-lab/components/AlphaFactoryPage.tsx` | Replace hardcoded add with picker flow | 4 |
| `apps/desktop/src/renderer/features/quant-lab/components/SignalFactorySection.tsx` | No change needed (modal renders via portal, not as child) | 4 |
| `apps/desktop/src/renderer/features/quant-lab/types.ts` | Extend `SignalChip` interface | 5 |
| `apps/desktop/src/renderer/features/quant-lab/components/index.ts` | Export `SignalSourcePicker` | 3 |

---

## Design Decisions

### 1. Selection UI: Modal Dialog (not Inline Panel)

**Decision**: Use a centered Modal overlay for signal source selection.

**Rationale**: Inline panel disrupts the Signal Factory section layout by pushing down the Combinator and Lookback controls. Modal provides:
- No layout impact on the parent page
- Sufficient space for search + scrollable list + metrics display
- Clear focus isolation (user intent is "select from list")
- Standard UX pattern for "pick from collection" interactions
- Dismiss via close button, Escape key, or backdrop click

**Implementation**: Render a portal-based modal overlay with backdrop, consistent with existing StratCraftsAI glassmorphism theme.

### 2. No Algorithm Code in List Query

`signal_source_registry` stores full algorithm code (potentially large). The list query intentionally excludes `*_algorithm_code` columns since the selection UI only needs metadata + metrics.

### 3. Duplicate Prevention

`excludeIds` prop prevents adding the same signal source twice. The picker hides already-added signals.

### 4. Empty State

When `signal_source_registry` is empty, show guidance: "No exported signals. Export a backtest result from Strategy Builder first." This connects the user to the  export flow.

---

## Remove Hardcoded Seed Data

Current `AlphaFactoryPage.tsx` initializes with hardcoded signals:

```typescript
const [signals, setSignals] = useState<SignalChip[]>([
  { id: '1', name: 'RSI(14)' },
  { id: '2', name: 'MACD(12,26,9)' },
]);
```

These must be replaced with an empty initial state `[]`. Signals should only come from user selection via the picker.

---

## Success Criteria

1. Clicking "Add Signal" opens SignalSourcePicker showing exported signal sources from `signal_source_registry`
2. Each signal source displays name + backtest metrics (Sharpe, WinRate, Trades)
3. Selecting a signal source adds it as a SignalChip with real data
4. Already-added signals are excluded from the picker
5. Empty state shown when no signals have been exported
6. No hardcoded seed data in initial state
7. Double-clicking a signal source row triggers the same action as clicking "+ Add" button

---

## Design References

- [](../design/_REGIME_TO_SIGNAL_SOURCE_CONVERSION.md) - Export flow (write path)
- [](../design/_MODULAR_ALGORITHM_ORCHESTRATION_ARCHITECTURE.md) - Alpha Factory architecture
- - Modular component extraction
- [](../design/_StratCraftsAI_UI_COMPONENT_LIBRARY.md) - Component library rules
- [Migration 006](../../apps/desktop/src/main/database/migrations/scripts/006_signal_source_registry.sql) - Database schema

## Date

2026-02-06
