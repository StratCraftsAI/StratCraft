# PLUGIN_Fix Quant Lab Hub Page - Show Only Signal Factory Card

## Status: COMPLETED

## Problem

Current `QuantLabPage.tsx` Hub page displays three feature cards (Signal Factory, Combinator, Backtest). This is incorrect. The Hub should only show **one card: Signal Factory**, which navigates to the Signal Factory main page (Alpha Factory).

### Current (Incorrect)

```
Quant Lab Hub:
  +------------------+  +------------------+  +------------------+
  | Signal Factory   |  | Combinator       |  | Backtest         |
  | (non-functional) |  | (navigates)      |  | (non-functional) |
  +------------------+  +------------------+  +------------------+
  [Status bar: Plugin ready...]
```

Three cards shown:
- Signal Factory card (non-functional)
- Combinator card (navigates to Alpha Factory)
- Backtest card (non-functional)

### Correct Design

```
Quant Lab Hub:
  +------------------+
  | Signal Factory   |  --> Click to navigate to Alpha Factory page
  +------------------+
```

- Hub page is kept (needed as plugin landing page)
- Only one card: **Signal Factory**
- Click Signal Factory card -> navigate to Alpha Factory page (two-layer Signal + Exit layout)

### Navigation Flow

```
NexusHub -> Quant Lab Hub (1 card: Signal Factory) -> Alpha Factory Page
```

## Root Cause

Hub was implemented with three cards (Signal Factory, Combinator, Backtest) instead of a single Signal Factory card. The Combinator and Backtest are sub-features of the Alpha Factory, not separate top-level entries.

## Required Changes

### 1. Remove Extra Cards from Hub

- Remove Combinator card
- Remove Backtest card
- Keep only Signal Factory card

### 2. Update Signal Factory Card Navigation

- Signal Factory card click -> navigate to Alpha Factory page (currently only Combinator does this)

### 3. Preserve Existing Components

- Keep Hub page structure (header, status bar)
- Keep `AlphaFactoryPage` component (two-layer layout)
- Keep sub-page navigation mechanism (`hub` -> `factory`)

## Files Affected

1. `apps/desktop/src/renderer/features/quant-lab/QuantLabPage.tsx`
   - `QuantLabHub`: Remove Combinator and Backtest `FeatureCard`
   - Signal Factory card: Add `onClick={onNavigateToFactory}`

## Design References

- [](../design/_ORCHESTRATION_MODE_UI_DESIGN.md) - Alpha Factory UI Design
- - Combinator Page UI

## Date

2026-02-06
