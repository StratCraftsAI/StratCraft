# PLUGIN_Combinator Page UI (Alpha Factory)

## Status: IMPLEMENTED (Pending Test)

## Objective

Implement the Combinator page UI for QUANT LAB plugin, following the Alpha Factory architecture (Signal Factory + Combinator pattern, Simons-style).

**Design Reference**: [_ORCHESTRATION_MODE_UI_DESIGN.md](../design/_ORCHESTRATION_MODE_UI_DESIGN.md)

## UI Layout

```
+------------------------------------------------------------------+
|  Alpha Factory                                                    |
+------------------------------------------------------------------+
|                                                                   |
|  SIGNAL FACTORY (Entry)                                           |
|  +--------------------------------------------------------------+ |
|  |  [Signal_A] [Signal_B] [Signal_C] [Signal_D] [+]            | |
|  +--------------------------------------------------------------+ |
|  Combinator: [sharpe_weighted v]   Lookback: [60] days           |
|                         |                                         |
+------------------------------------------------------------------+
|                                                                   |
|  EXIT FACTORY (Risk/Exit)                                         |
|  +--------------------------------------------------------------+ |
|  |  [TrailingStop] [VolatilityExit] [TimeDecay] [+]            | |
|  +--------------------------------------------------------------+ |
|  Combinator: [any v]  (any/all/majority/priority)                |
|                         |                                         |
+------------------------------------------------------------------+
|  [Validate]           [Save Workflow]         [Run Backtest]     |
+------------------------------------------------------------------+
```

## Architecture

### Two-Layer Structure

```
Layer 1: Signal Factory (Entry)
    [Signal_A] [Signal_B] [Signal_C]
           | Combinator (sharpe_weighted / correlation_adjusted / ...)
        Combined Entry Signal

Layer 2: Exit Factory (Risk/Exit)
    [Exit_A] [Exit_B] [Exit_C]
           | Combinator (any / all / majority / priority)
        Combined Exit Signal
```

### Combinator Methods

#### Signal Combinator (Entry)

| Method | Description | Use Case |
|--------|-------------|----------|
| `equal` | Simple average | Baseline |
| `sharpe_weighted` | Weight by Sharpe ratio | Performance-based |
| `correlation_adjusted` | Penalize correlated signals | Diversification |
| `regime_based` | Regime-dependent weights | Adaptive |

#### Exit Combinator

| Method | Description | Use Case |
|--------|-------------|----------|
| `any` | Any exit triggers | Conservative (safer) |
| `all` | All exits trigger | Aggressive (hold longer) |
| `majority` | >50% exits trigger | Balanced |
| `priority` | Check in order | Custom control |

## Implementation Tasks

### Phase 1: Navigation Setup

- [x] Add click handler to Combinator card in `QuantLabPage.tsx`
- [x] Create sub-page navigation (hub -> factory)
- [x] Set breadcrumb navigation with back navigation

### Phase 2: Page Layout

- [x] Create `AlphaFactoryPage` component in `QuantLabPage.tsx`
- [x] Implement two-section layout (Signal Factory + Exit Factory)
- [x] Add Combinator selector dropdowns

### Phase 3: Signal Chip UI

- [x] Implement chip-style signal cards (`SignalChipComponent`)
- [x] Add "+" button for adding new signals
- [x] Implement remove (x) button on hover
- [x] Flex-wrap layout for adaptive sizing

### Phase 4: Exit Factory

- [x] Implement exit algorithm chips (same pattern as signals)
- [x] Exit Combinator selector (any/all/majority/priority)

### Phase 5: Action Bar

- [x] Validate button (UI only)
- [x] Save Workflow button (UI only)
- [x] Run Backtest button (UI only)

### Phase 6: Pending (Future)

- [ ] Algorithm selector dialog (choose from saved algorithms)
- [ ] Persistence (save/load workflow to database)
- [ ] Backtest integration

## Existing Components

| Component | Location | Status |
|-----------|----------|--------|
| `CombinatorConfig.tsx` | `quant-lab-nexus/src/components/` | Exists (basic) |
| `SignalFlowCanvas.tsx` | `quant-lab-nexus/src/components/` | Exists (basic) |
| `AlphaFactoryPage.tsx` | `quant-lab-nexus/src/pages/` | Exists (needs enhancement) |

## Files Modified

1. `apps/desktop/src/renderer/features/quant-lab/QuantLabPage.tsx`
   - Added sub-page state management (`currentPage: 'hub' | 'factory'`)
   - Added `QuantLabHub` component (landing page with feature cards)
   - Added `AlphaFactoryPage` component (two-layer Signal+Exit layout)
   - Added `SignalChipComponent` for chip-style algorithm display
   - Added breadcrumb navigation with onClick callback for back navigation
   - Combinator card now navigates to Alpha Factory page

## Related

- QUANT LAB Architecture
- Alpha Factory UI Design
- QUANT LAB Implementation Plan
- PLUGIN_Plugin Card Click Navigation

## Date

2026-02-06
