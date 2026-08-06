# Deprecated V1 UI Components

Renderer Adaptation**

This document lists UI components deprecated by the V3 Architecture Refactoring.

---

## Replacement Summary

| V1 Component | V3 Replacement | Status |
|--------------|----------------|--------|
| `BacktestPage.tsx` | Use V3 `ExecutorPanel` | DEPRECATED |
| `BacktestResultView.tsx` | `v3/ExecutorResults.tsx` | DEPRECATED |
| `PerformancePanel/*` | `v3/ExecutorResults.tsx` (MetricsPanel) | DEPRECATED |
| `EquityCurveChart/*` | `v3/ExecutorResults.tsx` (EquityCurvePanel) | DEPRECATED |
| `BacktestKLineChart/*` | Future: V3 chart integration | DEPRECATED |
| `workflow/*` | V3 simplified workflow | DEPRECATED |
| `hooks/useBacktestApi.ts` | `hooks/useExecutor.ts` | DEPRECATED |
| `stores/useBacktestStore.ts` | `useExecutor` hook state | DEPRECATED |
| `stores/useWorkflowStore.ts` | V3 strategy management | DEPRECATED |

---

## Deprecated Components Detail

### 1. Page Components

**`BacktestPage.tsx`**
- **Reason**: Complex multi-service orchestration replaced by unified ExecutorPanel
- **Replacement**: Import `ExecutorPanel` from `./components/v3`
- **Migration**: Replace entire page with ExecutorPanel component

### 2. Result Display Components

**`components/BacktestResultView.tsx`**
- **Reason**: Multi-tab result view replaced by integrated ExecutorResults
- **Replacement**: `v3/ExecutorResults.tsx`

**`components/PerformancePanel/`**
- `PerformancePanel.tsx` - Main panel container
- `MetricCard.tsx` - Individual metric display
- `MetricCategory.tsx` - Metric grouping
- `PerformanceTab.tsx` - Performance metrics tab
- `TradesTab.tsx` - Trade list tab
- `LLMDecisionTab.tsx` - LLM decision display
- **Reason**: Replaced by unified MetricsPanel in ExecutorResults
- **Replacement**: `v3/ExecutorResults.tsx`

**`components/EquityCurveChart/`**
- `EquityCurveChart.tsx` - Equity curve visualization
- **Reason**: Integrated into ExecutorResults EquityCurvePanel
- **Replacement**: `v3/ExecutorResults.tsx`

**`components/BacktestKLineChart/`**
- `BacktestKLineChart.tsx` - K-line chart with trade markers
- **Reason**: Future V3 chart integration planned
- **Replacement**: Pending V3 chart component

### 3. Workflow Components

**`components/workflow/`**
- `WorkflowTable.tsx` - Workflow list table
- `WorkflowRow.tsx` - Individual workflow row
- `WorkflowSubRow.tsx` - Nested workflow details
- `ExecuteConfigPanel.tsx` - Execution configuration
- `AlgorithmSelector.tsx` - Algorithm selection
- **Reason**: V3 uses simplified file-based strategy management
- **Replacement**: V3 strategy hooks (`useStrategiesV3`, `useSaveStrategyV3`)

### 4. Hooks

**`hooks/useBacktestApi.ts`**
- **Reason**: Complex multi-service API replaced by unified Executor API
- **Replacement**: `../../hooks/useExecutor.ts`
- **New APIs**:
  - `useExecutor()` - Main execution hook
  - `useExecutorResult(taskId)` - Result fetching
  - `useStrategiesV3()` - Strategy listing
  - `useSaveStrategyV3()` - Strategy saving
  - `useLoadStrategyV3()` - Strategy loading
  - `useGenerateStrategy()` - LLM strategy generation

### 5. Stores

**`stores/useBacktestStore.ts`**
- **Reason**: State management moved to useExecutor hook
- **Replacement**: `useExecutor()` returns all necessary state

**`stores/useWorkflowStore.ts`**
- **Reason**: Workflow concept replaced by simple strategy file management
- **Replacement**: V3 strategy hooks

---

## Migration Guide

### Before (V1)
```tsx
import { BacktestPage } from './features/backtest';
import { useBacktestStore } from './features/backtest/stores';
import { useBacktestApi } from './features/backtest/hooks';

function App() {
  const { results, isRunning } = useBacktestStore();
  const { runBacktest } = useBacktestApi();

  return <BacktestPage />;
}
```

### After (V3)
```tsx
import { ExecutorPanel } from './features/backtest/components/v3';
import { useExecutor } from './hooks';

function App() {
  const { result, isRunning, run } = useExecutor();

  return (
    <ExecutorPanel
      defaultSymbol="BTC/USDT"
      onComplete={(result) => console.log('Done:', result)}
    />
  );
}
```

---

## V3 Component Benefits

1. **Simplified State**: Single `useExecutor` hook manages all execution state
2. **Unified UI**: One component (`ExecutorPanel`) replaces 10+ V1 components
3. **Better Performance**: Direct IPC to Executor process (no gRPC overhead)
4. **Type Safety**: Strongly typed `ExecutorConfig` and `ExecutorResult`
5. **Progress Tracking**: Built-in progress reporting via `ExecutorProgress`

---

## Removal Timeline

- **Phase 4 Complete**: V3 components available
- **Phase 5**: Documentation and cleanup
- **Future Release**: Remove deprecated V1 components

**DO NOT** delete V1 components until migration is verified complete.
