# PLUGIN_Quant Lab UI Migration from Host to Plugin Directory

## Status: COMPLETED

## Problem

Quant Lab business UI components were incorrectly placed in the Host layer (`apps/desktop/src/renderer/features/quant-lab/`), violating **** (Plugin UI Migration) which mandates **"NO PLUGIN UI IN HOST"** and **"HOST = SHELL ONLY"**.

## Root Cause

PLUGIN_TICKET_006 (Alpha Factory Modular Components) correctly decomposed the monolithic `QuantLabPage.tsx` into modular components, but placed them in `features/quant-lab/components/` (host layer) instead of `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/` (plugin layer). The refactoring improved modularity but violated the host-plugin boundary.

## Changes Completed

### Phase 1: Files Migrated (Host -> Plugin)

| # | Source (Host) | Target (Plugin) | Status |
|---|---|---|---|
| 1 | `features/quant-lab/types.ts` | `src/types.ts` | DONE |
| 2 | `features/quant-lab/constants.ts` | `src/constants.ts` | DONE |
| 3 | `components/QuantLabHub.tsx` | `src/pages/QuantLabHub.tsx` | DONE |
| 4 | `components/AlphaFactoryPage.tsx` | `src/pages/AlphaFactoryPage.tsx` | DONE |
| 5 | `components/SignalFactorySection.tsx` | `src/components/SignalFactorySection.tsx` | DONE |
| 6 | `components/ExitFactorySection.tsx` | `src/components/ExitFactorySection.tsx` | DONE |
| 7 | `components/SignalChip.tsx` | `src/components/SignalChip.tsx` | DONE |
| 8 | `components/SignalSourcePicker.tsx` | `src/components/SignalSourcePicker.tsx` | DONE |
| 9 | `components/FeatureCard.tsx` | `src/components/FeatureCard.tsx` | DONE |
| 10 | `components/FlowDivider.tsx` | `src/components/FlowDivider.tsx` | DONE |
| 11 | `components/ActionBar.tsx` | `src/components/ActionBar.tsx` | DONE |
| 12 | `components/index.ts` | `src/components/index.ts` (merged) | DONE |

All paths relative to `plugins/quant-lab-plugin/ui/quant-lab-nexus/`.

### Phase 2: Host Shell Simplified

- `QuantLabPage.tsx` reduced to ~60 lines (shell only)
- `features/quant-lab/components/` directory deleted (9 files)
- `features/quant-lab/types.ts` deleted
- `features/quant-lab/constants.ts` deleted
- Host imports via `@quant-lab-plugin/` alias

### Phase 3: Plugin Reconciled

- `pages/AlphaFactoryPage.tsx` reconciled (replaces old `pages/AlphaFactory.tsx`)
- `pages/QuantLabHub.tsx` added to pages directory
- `components/index.ts` merged (existing + migrated exports)
- `index.tsx` entry point exports all pages + components + hooks + types
- `src/types/global.d.ts` created for `window.electronAPI` type declarations
- `lucide-react` added to devDependencies

### Phase 4: Verification

- [x] Host `features/quant-lab/` contains only 2 files (Shell + index)
- [x] Plugin renders correctly via alias `@quant-lab-plugin/`
- [x] No broken imports across codebase
- [x] `npm run build` passes (6/6 tasks)

## Final Structure

### Host Layer (2 files)

```
apps/desktop/src/renderer/features/quant-lab/
+-- QuantLabPage.tsx            # Host Shell (~60 lines)
+-- index.ts                    # Exports
```

### Plugin Layer (complete)

```
plugins/quant-lab-plugin/ui/quant-lab-nexus/src/
+-- index.tsx                   # Entry point + plugin lifecycle
+-- types.ts                    # Business types (QuantLabSubPage, SignalChip, CombinatorMethod)
+-- constants.ts                # Business constants (SIGNAL/EXIT_COMBINATOR_METHODS)
+-- types/
|   +-- global.d.ts             # window.electronAPI ambient types
+-- pages/
|   +-- index.ts                # Page exports
|   +-- QuantLabHub.tsx         # Hub landing page
|   +-- AlphaFactoryPage.tsx    # Alpha Factory composition layer
|   +-- SignalLibrary.tsx       # Signal library page
+-- components/
|   +-- index.ts                # Component exports (13 components)
|   +-- ActionBar.tsx
|   +-- CombinatorConfig.tsx
|   +-- ExitFactorySection.tsx
|   +-- FeatureCard.tsx
|   +-- FlowDivider.tsx
|   +-- SignalChip.tsx
|   +-- SignalFactorySection.tsx
|   +-- SignalFlowCanvas.tsx
|   +-- SignalSourceCard.tsx
|   +-- SignalSourcePicker.tsx
|   +-- SignalTraceViewer.tsx
+-- hooks/
    +-- useAlphaFactory.ts
```

##  Compliance

- [x] **NO PLUGIN UI IN HOST** - Zero business components in `features/quant-lab/`
- [x] **HOST = SHELL ONLY** - QuantLabPage.tsx is navigation shell only
- [x] **PLUGIN SELF-CONTAINMENT** - All Quant Lab UI in `plugins/quant-lab-plugin/`
- [x] **SINGLE SOURCE OF TRUTH** - No duplicate components between host and plugin

## Design References

- [](../design/_PLUGIN_UI_MIGRATION.md) - Plugin UI Migration (mandatory rules)
- [](../design/_StratCraftsAI_UI_COMPONENT_LIBRARY.md) - Modular Component Rules
- [](../design/_MODULAR_ALGORITHM_ORCHESTRATION_ARCHITECTURE.md) - Alpha Factory Architecture
- - Modular Components (predecessor)
- - Third-Party Plugin Directory Standard
- [](../design/_BACKTEST_HOST_PLUGIN_SEPARATION_REFACTOR.md) - Backtest Host-Plugin Separation (reference pattern)

## Date

2026-02-07
