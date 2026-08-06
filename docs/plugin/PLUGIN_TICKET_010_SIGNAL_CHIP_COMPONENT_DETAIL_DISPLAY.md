# PLUGIN_Signal Chip Component Detail Display

## Status: COMPLETED

## Objective

Expand the `SignalChip` component from a single-name display to a detailed 3-slot view showing algorithm names with timeframe dropdowns. Each signal source exported from backtest contains 3 components (Analysis, Entry, Exit), and the UI must expose this structure with editable timeframes.

## Problem

### Current Behavior

`SignalChip` displays only the signal source name as a flat chip:

```
[ Backtest_ETXEUR_1d_20260206_0100  x ]
```

No visibility into:
- Which algorithms compose the signal (Analysis, Entry, Exit)
- What timeframe each component uses
- Whether the signal is single-timeframe or multi-timeframe

### Expected Behavior

Expanded signal card showing 3 component slots with algorithm names and timeframe dropdowns:

```
+----------------------------------------------------------+
| Backtest_ETXEUR_1d_20260206_0100                     [x] |
|                                                          |
|  Analysis:  RSI Regime              [1d v]               |
|  Entry:     Trend Breakout Entry    [1h v]               |
|  Exit:      TrailingStop            [1h v]               |
+----------------------------------------------------------+
```

- **Label**: Slot role (Analysis / Entry / Exit)
- **Algorithm name**: Read-only, from `signal_source_registry`
- **Timeframe dropdown**: Editable, default from DB export value
- **Exit row**: Only shown when exit component exists (`exit_algorithm_name IS NOT NULL`)

### Root Cause

`SignalChip` interface only carries `id` and `name`. The algorithm detail and timeframe data exist in `signal_source_registry` but are not propagated to the chip component.

---

## Data Source

### signal_source_registry (already stored)

| Field | Example | Usage |
|-------|---------|-------|
| `analysis_algorithm_name` | "RSI Regime" | Display in Analysis row |
| `analysis_timeframe` | "1d" | Default value for Analysis dropdown |
| `entry_algorithm_name` | "Trend Breakout Entry" | Display in Entry row |
| `entry_timeframe` | "1h" | Default value for Entry dropdown |
| `exit_algorithm_name` | "TrailingStop" (nullable) | Display in Exit row (if exists) |
| `exit_timeframe` | "1h" (nullable) | Default value for Exit dropdown (if exists) |

### 4-Slot to 3-Component Mapping

| Backtest 4-Slot | Alpha Factory Component | Exported |
|-----------------|------------------------|----------|
| Market Analysis (analysisSelections) | Analysis | Yes |
| Entry Filter (preConditionSelections) | -- | No |
| Entry Signal (stepSelections) | Entry | Yes |
| Exit Strategy (postConditionSelections) | Exit (optional) | Yes |

Entry Filter is not exported to Alpha Factory per design.

---

## Implementation Plan

### Phase 1: Extend SignalChip Type

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/types.ts`

Add component detail fields to `SignalChip`:

```typescript
export interface SignalChipComponent {
  algorithmName: string;
  timeframe: string;       // Editable, default from DB
}

export interface SignalChip {
  id: string;
  name: string;
  // Component details (from signal_source_registry)
  analysis: SignalChipComponent;
  entry: SignalChipComponent;
  exit?: SignalChipComponent;   // Optional (exit may not exist)
  // Backtest metrics (display reference)
  sharpe?: number | null;
  winRate?: number | null;
  totalTrades?: number | null;
}
```

### Phase 2: Update SignalChip Component

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalChip.tsx`

Transform from flat chip to expanded card:
- Header row: signal name with teal accent background (`bg-color-terminal-accent-teal`, dark text `text-color-terminal-bg`) matching breadcrumb active color
- 3 detail rows (Analysis, Entry, Exit)
- Each row: label + algorithm name + timeframe dropdown
- Exit row conditionally rendered

Timeframe dropdown: Reuse the portal-based `TimeframeDropdown` pattern from `plugins/back-test-nexus/ui/src/components/ui/TimeframeDropdown.tsx`. Since cross-plugin import is not allowed, implement a local timeframe `<select>` element matching the existing StratCraftsAI theme, using the same `TIMEFRAME_OPTIONS` values (`1m` through `1M`).

### Phase 3: Update SignalFactorySection Props

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalFactorySection.tsx`

Add `onTimeframeChange` callback prop:

```typescript
interface SignalFactorySectionProps {
  // ... existing props
  onTimeframeChange: (signalId: string, component: 'analysis' | 'entry' | 'exit', timeframe: string) => void;
}
```

### Phase 4: Update AlphaFactoryPage

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx`

1. Update `handleSelectSignalSource` to populate component fields from `SignalSourceItem`
2. Add `handleTimeframeChange` handler to update timeframe in state

### Phase 5: Verify SignalSourcePicker Data

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalSourcePicker.tsx`

Confirm `SignalSourceItem` already includes `analysis_algorithm_name`, `entry_algorithm_name`, `exit_algorithm_name`, `analysis_timeframe`, `entry_timeframe`, `exit_timeframe`. No changes needed if these fields are already queried (confirmed in PLUGIN_TICKET_007).

---

## Existing Reusable Components

### TimeframeDropdown (back-test-nexus)

`plugins/back-test-nexus/ui/src/components/ui/TimeframeDropdown.tsx` provides:
- Portal-based dropdown ( pattern)
- `TimeframeValue` type: `'1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w' | '1M'`
- `TIMEFRAME_OPTIONS` constant array

Cannot import cross-plugin. Use same values locally with a simple `<select>` or duplicate the timeframe constants in quant-lab-plugin.

### Timeframe Constants Reference

```typescript
const TIMEFRAME_OPTIONS = [
  '1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M'
];
```

---

## Files Affected

| File | Change | Phase |
|------|--------|-------|
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/types.ts` | Add `SignalChipComponent`, extend `SignalChip` | 1 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalChip.tsx` | Expand to 3-slot card with timeframe dropdowns | 2 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalFactorySection.tsx` | Add `onTimeframeChange` prop, pass to SignalChip | 3 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx` | Populate component fields, add timeframe handler | 4 |

---

## Design Decisions

### 1. Algorithm Name (not Slot Name)

Display the actual algorithm name (e.g., "RSI Regime") rather than generic slot label (e.g., "Market Analysis"). Algorithm names provide meaningful differentiation between signal sources. The slot role is shown as a label prefix.

### 2. Timeframe as Editable Dropdown

Timeframes from the original backtest export serve as defaults but must be editable. Alpha Factory may want to test the same signal source logic at different timeframes without re-exporting.

### 3. Exit Row Conditional

Exit component is optional in `signal_source_registry` (nullable fields). The Exit row only renders when `exit_algorithm_name` is not null.

### 4. Local Timeframe Select (not Cross-Plugin Import)

Plugin boundary prevents importing `TimeframeDropdown` from `back-test-nexus`. Use a themed `<select>` element with the same timeframe values. If future shared-component infrastructure is built, this can be refactored.

---

## Design References

- - Signal source selection (data provider)
- - Modular component extraction
- - Plugin directory structure
- [](../design/_STAGE_LEVEL_TIMEFRAME_SELECTOR.md) - Stage-level timeframe selector (backtest)
- [](../design/_REGIME_TO_SIGNAL_SOURCE_CONVERSION.md) - Workflow export to signal source
- [Migration 006](../../apps/desktop/src/main/database/migrations/scripts/006_signal_source_registry.sql) - Database schema

## Date

2026-02-07
