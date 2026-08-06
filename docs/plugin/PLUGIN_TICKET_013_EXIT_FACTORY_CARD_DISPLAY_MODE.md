# PLUGIN_Exit Factory Card Display Mode

## Status: Open

## Objective

Change the Exit Factory section display mode from compact horizontal chips (`h-10`, `flex-wrap`) to fixed-size card grid (`h-[200px]`, `grid-cols-5`), matching the Signal Factory section layout for visual consistency and richer detail display. Hard limit of **5 exit items maximum**; Add button is hidden when the limit is reached.

## Problem

### Current Behavior

Exit Factory renders exit items as compact 40px-high chips in a flex-wrap layout:

```
+-------------------------------------------+
| EXIT FACTORY (Risk/Exit)                  |
|                                           |
| [TrailingStop x] [ATR Exit x] [+ Add]    |
|                                           |
| Combinator: [Any v]                       |
+-------------------------------------------+
```

- Layout: `flex flex-wrap gap-2`
- Card height: `h-10` (40px)
- No component detail visibility (algorithm names, timeframes)
- Inconsistent with Signal Factory visual pattern

### Expected Behavior

Exit Factory renders exit items as fixed-size cards in a 5-column grid, matching Signal Factory:

**< 5 exits (Add button visible):**

```
+-----------------------------------------------------------------------+
| EXIT FACTORY (Risk/Exit)                                              |
|                                                                       |
| +-------------+ +-------------+ +-------------+ +-------+            |
| | TrailingStop | | ATR Exit    | | Vol Exit    | | + Add |            |
| |             | |             | |             | | Exit  |            |
| | Analysis:   | | Analysis:   | | Analysis:   | |       |            |
| |  RSI [1d v] | |  ATR [1h v] | |  Vol [4h v] | |       |            |
| | Entry:      | | Entry:      | | Entry:      | |       |            |
| |  xxx [1h v] | |  xxx [1h v] | |  xxx [1h v] | |       |            |
| | Exit:       | | Exit:       | | Exit:       | |       |            |
| |  yyy [1h v] | |  yyy [1h v] | |  yyy [1h v] | |       |            |
| |         [x] | |         [x] | |         [x] | |       |            |
| +-------------+ +-------------+ +-------------+ +-------+            |
|                                                                       |
| Combinator: [Any v]                                                   |
+-----------------------------------------------------------------------+
```

**= 5 exits (Add button hidden, full row):**

```
+-----------------------------------------------------------------------+
| EXIT FACTORY (Risk/Exit)                                              |
|                                                                       |
| +----------+ +----------+ +----------+ +----------+ +----------+     |
| | Trailing | | ATR Exit | | Vol Exit | | Time     | | MA Cross |     |
| | Stop     | |          | |          | | Exit     | | Exit     |     |
| | ...      | | ...      | | ...      | | ...      | | ...      |     |
| +----------+ +----------+ +----------+ +----------+ +----------+     |
|                                                                       |
| Combinator: [Any v]                                                   |
+-----------------------------------------------------------------------+
```

- Layout: `grid grid-cols-5 gap-3` (same as Signal Factory)
- Card height: `h-[200px]` (same as Signal Factory)
- Component detail rows with algorithm names + timeframe dropdowns
- Add button: same `h-[200px]` matching card height, **hidden when 5 exits reached**
- Hard limit: **maximum 5 exit items** (one full row)
- Visual consistency between Signal Factory and Exit Factory sections

### Root Cause

Exit Factory was originally designed as a lightweight secondary section with minimal display requirements. As the Alpha Factory architecture matured (PLUGIN_TICKET_006, PLUGIN_TICKET_010), Signal Factory received card-level detail display while Exit Factory remained in its original compact chip form.

---

## Design

### Layout Change

| Property | Current (Exit) | Target (Exit) | Reference (Signal) |
|----------|---------------|---------------|---------------------|
| Container layout | `flex flex-wrap gap-2` | `grid grid-cols-5 gap-3` | `grid grid-cols-5 gap-3` |
| Card height | `h-10` (40px) | `h-[200px]` | `h-[200px]` |
| Card structure | Name + delete only | Header + ComponentRows + Footer | Header + ComponentRows + Footer |
| Add button height | `h-10` | `h-[200px]` | `h-[200px]` |
| Accent color | `terminal-accent-teal` | `terminal-accent-teal` | `terminal-accent-primary` |
| Max items | No limit | **5** (one row) | No limit |
| Add button visibility | Always | Hidden when 5 reached | Always |

### Exit Count Limit

```typescript
const MAX_EXIT_COUNT = 5;
```

- Defined in `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/constants.ts`
- Add button conditionally rendered: `{exits.length < MAX_EXIT_COUNT && <button>...</button>}`
- When 5 exits fill the row, no Add button is shown -- the grid is exactly one full row of cards

### SignalChip Variant Reuse

The existing `SignalChip` component already supports both `signal` and `exit` variants. The `exit` variant currently renders a compact chip. The change requires:

1. **Exit variant with component details**: When `analysis` and `entry` props are provided, render the same fixed-size card layout as the signal variant (with teal accent instead of primary accent for visual differentiation)
2. **Exit variant without component details**: Keep existing compact chip as fallback

This follows the same conditional rendering pattern already used in the signal variant (line 79: `if (analysis && entry)`).

### Data Flow

Exit chips must carry the same component detail data as signal chips:

```
signal_source_registry
  -> SignalSourcePicker (query includes algorithm fields)
    -> AlphaFactoryPage (handleSelectExitSource populates component fields)
      -> ExitFactorySection (passes full SignalChip objects)
        -> SignalChip variant="exit" (renders card with details)
```

---

## Implementation Plan

### Phase 1: Add MAX_EXIT_COUNT Constant

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/constants.ts`

1. Add `MAX_EXIT_COUNT = 5` constant

### Phase 2: Update ExitFactorySection Layout

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ExitFactorySection.tsx`

1. Change container from `flex flex-wrap gap-2` to `grid grid-cols-5 gap-3`
2. Pass `analysis`, `entry`, `exit` component detail props to `SignalChip`
3. Add `onTimeframeChange` callback prop (same pattern as SignalFactorySection)
4. Update Add button from `h-10 px-4` to `h-[200px]` with centered layout
5. Conditionally render Add button: only when `exits.length < MAX_EXIT_COUNT`

### Phase 3: Update SignalChip Exit Variant

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalChip.tsx`

1. Add fixed-size card rendering for exit variant when component details are provided
2. Use `terminal-accent-teal` for header background (differentiates from signal cards which use same teal)
3. Retain compact chip fallback for exit variant without component details

### Phase 4: Update AlphaFactoryPage

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx`

1. Update `handleSelectExitSource` to populate `analysis`, `entry`, `exit` component fields from `SignalSourceItem` (same as `handleSelectSignalSource`)
2. Add `handleExitTimeframeChange` handler
3. Pass `onTimeframeChange` to `ExitFactorySection`

### Phase 5: Update ExitFactorySection Props

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ExitFactorySection.tsx`

Add new props to interface:

```typescript
interface ExitFactorySectionProps {
  exits: SignalChipType[];
  method: string;
  onAddExit: () => void;
  onRemoveExit: (id: string) => void;
  onMethodChange: (method: string) => void;
  onTimeframeChange: (exitId: string, component: 'analysis' | 'entry' | 'exit', timeframe: string) => void;
}
```

---

## Files Affected

| File | Change | Phase |
|------|--------|-------|
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/constants.ts` | Add `MAX_EXIT_COUNT = 5` | 1 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ExitFactorySection.tsx` | Grid layout, card props, timeframe callback, conditional Add button | 2, 5 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalChip.tsx` | Exit variant fixed-size card rendering | 3 |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx` | Exit source data population, timeframe handler | 4 |

---

## Design Decisions

### 1. Same Card Height as Signal Factory

Both sections use `h-[200px]` for visual consistency. The Alpha Factory page flows vertically: Signal Factory -> FlowDivider -> Exit Factory. Matching card sizes creates a unified grid appearance.

### 2. Teal Accent for Exit Cards

Exit cards retain `terminal-accent-teal` for header background (same as current exit chip border color). This provides subtle visual differentiation from signal cards while maintaining the same structural layout.

### 3. Reuse SignalChip Component

Rather than creating a separate `ExitChip` component, extend the existing `SignalChip` exit variant to support both compact and card modes. This follows the code reuse principle and keeps the component API consistent.

### 4. Fallback to Compact Chip

When exit items lack component detail data (e.g., manually added exits without signal source backing), the compact `h-10` chip rendering is preserved as fallback. This ensures backward compatibility.

### 5. Hard Limit of 5 Exits

Exit strategies are inherently limited in variety (trailing stop, ATR exit, volatility exit, time exit, etc.). A maximum of 5 fills exactly one grid row. When the limit is reached, the Add button is simply not rendered -- no error message or disabled state needed. The grid shows 5 clean cards with no extra UI clutter.

---

## Design References

- - Modular component extraction
- - Signal chip card display (reference implementation)
- - Plugin migration
- - Config persistence (timeframe changes must be persisted)

## Date

2026-02-07
