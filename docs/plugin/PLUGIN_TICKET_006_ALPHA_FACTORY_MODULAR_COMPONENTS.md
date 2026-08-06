# PLUGIN_Alpha Factory Page Modular Components

## Status: COMPLETED

## Objective

Refactor `QuantLabPage.tsx` (single monolithic ~380-line file) into modular components following  component library rules. All components must be props-driven, self-contained, and independently reusable.

## Problem

Current `QuantLabPage.tsx` contains **5 components + 2 constant arrays + types** in a single file:

```
QuantLabPage.tsx (~380 lines)
  - QuantLabPage        (Host Shell, navigation)
  - QuantLabHub          (Landing page)
  - FeatureCard          (Card component)
  - AlphaFactoryPage     (Factory UI, ~160 lines inline)
  - SignalChipComponent   (Chip component)
  - SIGNAL_COMBINATOR_METHODS  (constant)
  - EXIT_COMBINATOR_METHODS    (constant)
  - SignalChip type       (type definition)
```

### Violations

| Rule | Violation |
|---|---|
| Self-contained components | All components coupled in one file |
| Props-driven data | Constants hardcoded inline |
| Exported types | Types not exported, not reusable |
| Separation of concerns | Composition + UI + data in single file |
| Single file per component | 5 components in 1 file |

## Target Structure

```
features/quant-lab/
+-- QuantLabPage.tsx                    # Host Shell only (~60 lines)
+-- types.ts                            # All type definitions
+-- constants.ts                        # Combinator method definitions
+-- components/
|   +-- index.ts                        # Unified exports
|   +-- QuantLabHub.tsx                 # Hub landing page
|   +-- AlphaFactoryPage.tsx            # Factory composition layer
|   +-- SignalFactorySection.tsx         # Signal Factory section (Entry)
|   +-- ExitFactorySection.tsx           # Exit Factory section (Risk/Exit)
|   +-- SignalChip.tsx                   # Reusable signal/exit chip
|   +-- FeatureCard.tsx                  # Reusable feature card
|   +-- FlowDivider.tsx                  # Arrow divider between sections
|   +-- ActionBar.tsx                    # Validate / Save / Run buttons
```

## Component Definitions

### 1. QuantLabPage (Host Shell)

**File**: `QuantLabPage.tsx`
**Responsibility**: Navigation + breadcrumb management only.
**Lines**: ~60

```typescript
// Host Shell - navigation only, no business logic
export const QuantLabPage: React.FC = () => {
  // Sub-page state: 'hub' | 'factory'
  // Breadcrumb management
  // Renders QuantLabHub or AlphaFactoryPage
};
```

### 2. types.ts

```typescript
export type QuantLabSubPage = 'hub' | 'factory';

export interface SignalChip {
  id: string;
  name: string;
}

export interface CombinatorMethod {
  id: string;
  name: string;
  description: string;
}
```

### 3. constants.ts

```typescript
import { CombinatorMethod } from './types';

export const SIGNAL_COMBINATOR_METHODS: CombinatorMethod[] = [
  { id: 'equal', name: 'Equal Weight', ... },
  { id: 'sharpe_weighted', name: 'Sharpe Weighted', ... },
  { id: 'correlation_adjusted', name: 'Correlation Adjusted', ... },
  { id: 'regime_based', name: 'Regime Based', ... },
];

export const EXIT_COMBINATOR_METHODS: CombinatorMethod[] = [
  { id: 'any', name: 'Any', ... },
  { id: 'all', name: 'All', ... },
  { id: 'majority', name: 'Majority', ... },
  { id: 'priority', name: 'Priority', ... },
];
```

### 4. QuantLabHub

**File**: `components/QuantLabHub.tsx`
**Props**: `onNavigateToFactory: () => void`

Hub landing page with header, FeatureCard, and status display.

### 5. AlphaFactoryPage (Composition Layer)

**File**: `components/AlphaFactoryPage.tsx`
**Responsibility**: Composes SignalFactorySection + FlowDivider + ExitFactorySection + ActionBar.
**State**: Manages signals, exits, combinator selections (lifts state for children).

```
AlphaFactoryPage
  +-- SignalFactorySection (props: signals, method, lookback, callbacks)
  +-- FlowDivider
  +-- ExitFactorySection   (props: exits, method, callbacks)
  +-- FlowDivider
  +-- ActionBar            (props: onValidate, onSave, onRunBacktest)
```

### 6. SignalFactorySection

**File**: `components/SignalFactorySection.tsx`
**Props**:

```typescript
interface SignalFactorySectionProps {
  signals: SignalChip[];
  method: string;
  lookback: number;
  onAddSignal: () => void;
  onRemoveSignal: (id: string) => void;
  onMethodChange: (method: string) => void;
  onLookbackChange: (days: number) => void;
}
```

Signal Factory (Entry) section: signal chips container + combinator selector + lookback input.

### 7. ExitFactorySection

**File**: `components/ExitFactorySection.tsx`
**Props**:

```typescript
interface ExitFactorySectionProps {
  exits: SignalChip[];
  method: string;
  onAddExit: () => void;
  onRemoveExit: (id: string) => void;
  onMethodChange: (method: string) => void;
}
```

Exit Factory (Risk/Exit) section: exit chips container + combinator selector.

### 8. SignalChip

**File**: `components/SignalChip.tsx`
**Props**:

```typescript
interface SignalChipProps {
  name: string;
  onRemove: () => void;
  variant?: 'signal' | 'exit';
}
```

Reusable chip component for both signal and exit items.

### 9. FeatureCard

**File**: `components/FeatureCard.tsx`
**Props**:

```typescript
interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick?: () => void;
}
```

### 10. FlowDivider

**File**: `components/FlowDivider.tsx`
**Props**: None (or optional `height`, `color`).

Vertical arrow/line between sections indicating data flow direction.

### 11. ActionBar

**File**: `components/ActionBar.tsx`
**Props**:

```typescript
interface ActionBarProps {
  onValidate: () => void;
  onSave: () => void;
  onRunBacktest: () => void;
}
```

## Implementation Tasks

### Phase 1: File Structure

- [x] Create `features/quant-lab/types.ts`
- [x] Create `features/quant-lab/constants.ts`
- [x] Create `features/quant-lab/components/` directory

### Phase 2: Extract Components

- [x] Extract `SignalChip` -> `components/SignalChip.tsx`
- [x] Extract `FeatureCard` -> `components/FeatureCard.tsx`
- [x] Create `FlowDivider` -> `components/FlowDivider.tsx`
- [x] Create `ActionBar` -> `components/ActionBar.tsx`

### Phase 3: Extract Sections

- [x] Extract `SignalFactorySection` -> `components/SignalFactorySection.tsx`
- [x] Extract `ExitFactorySection` -> `components/ExitFactorySection.tsx`

### Phase 4: Extract Pages

- [x] Extract `QuantLabHub` -> `components/QuantLabHub.tsx`
- [x] Extract `AlphaFactoryPage` -> `components/AlphaFactoryPage.tsx` (composition layer)
- [x] Create `components/index.ts` (unified exports)

### Phase 5: Simplify Host Shell

- [x] Reduce `QuantLabPage.tsx` to Host Shell only (~60 lines)
- [x] Import all components from `components/index.ts`

##  Compliance Checklist

- [x] Props-driven data (no hardcoded data sources)
- [x] Exported types (all interfaces in `types.ts`)
- [x] Callback handlers (state changes via callback props)
- [x] Self-contained (each component independently usable)
- [x] Single file per component
- [x] Unified exports from `index.ts`

## Files Affected

1. `apps/desktop/src/renderer/features/quant-lab/QuantLabPage.tsx` - Reduce to Host Shell
2. `apps/desktop/src/renderer/features/quant-lab/types.ts` - NEW
3. `apps/desktop/src/renderer/features/quant-lab/constants.ts` - NEW
4. `apps/desktop/src/renderer/features/quant-lab/components/index.ts` - NEW
5. `apps/desktop/src/renderer/features/quant-lab/components/QuantLabHub.tsx` - NEW
6. `apps/desktop/src/renderer/features/quant-lab/components/AlphaFactoryPage.tsx` - NEW
7. `apps/desktop/src/renderer/features/quant-lab/components/SignalFactorySection.tsx` - NEW
8. `apps/desktop/src/renderer/features/quant-lab/components/ExitFactorySection.tsx` - NEW
9. `apps/desktop/src/renderer/features/quant-lab/components/SignalChip.tsx` - NEW
10. `apps/desktop/src/renderer/features/quant-lab/components/FeatureCard.tsx` - NEW
11. `apps/desktop/src/renderer/features/quant-lab/components/FlowDivider.tsx` - NEW
12. `apps/desktop/src/renderer/features/quant-lab/components/ActionBar.tsx` - NEW

## Design References

- [](../design/_StratCraftsAI_UI_COMPONENT_LIBRARY.md) - Modular Component Rules
- [](../design/_PLUGIN_UI_MIGRATION.md) - Plugin UI Migration
- [](../design/_MODULAR_ALGORITHM_ORCHESTRATION_ARCHITECTURE.md) - Alpha Factory Architecture
- - Combinator Page UI
- - Hub Page Fix

## Date

2026-02-06
