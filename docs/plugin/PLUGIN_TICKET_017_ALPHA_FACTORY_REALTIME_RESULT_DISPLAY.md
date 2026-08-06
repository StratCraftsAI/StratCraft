# PLUGIN_Alpha Factory Real-time Result Display

## Status: In Progress

## Problem

Alpha Factory backtest result page only displays **after** backtest completes. During execution, user sees only a progress bar ("Running backtest... XX%"). The full result (EquityCurve, Metrics, TradesTable) appears only when `status === 'completed'`.

This differs from the main BacktestPage behavior ( / ) which shows real-time incremental chart updates during execution.

## Current Behavior

```
Click Run
  -> status: loading_data  -> Progress bar "Loading market data..."
  -> status: generating    -> Progress bar "Generating strategy code..."
  -> status: running       -> Progress bar "Running backtest... XX%"
  -> status: completed     -> Full result page (EquityCurve + Metrics + TradesTable)
```

**ResultSection.tsx rendering logic:**
- `running` state: Only progress bar (lines 47-68)
- `completed` state: Full result display (lines 82-97)
- `onIncrement` events: Used only for progress percentage, NOT for chart data

## Expected Behavior (Per )

```
Click Run
  -> Immediately switch to result view
  -> During execution: Real-time equity curve updates via onIncrement events
  -> On completion: Final result with all metrics and trades
```

## Root Cause

Two implementation gaps (design is correct, Executor already sends full real-time data):

1. **`useAlphaFactoryBacktest.ts` (lines 207-212)**: `onIncrement` callback only reads `processedBars/totalBars` for progress percentage. The `newEquityPoints`, `newTrades`, `newCandles`, `currentMetrics` fields in the increment payload are completely ignored.

2. **`ResultSection.tsx` (lines 47-68)**: `running` status renders only a progress bar. No chart components are rendered until `status === 'completed'`.

## Fix

### File 1: `useAlphaFactoryBacktest.ts`
- Add throttled buffer pattern (100ms) matching BacktestPage implementation
- `onIncrement` callback pushes `data.increment` to buffer
- `flushBuffer` merges buffered increments and accumulates into `result` state via `setResult(prev => ...)`
- `onCompleted` clears buffer, preserves accumulated data

### File 2: `ResultSection.tsx`
- `running` status: when `result` has data, render progress bar **+** EquityCurveChart + MetricSummaryRow + TradesTable
- `running` status: when `result` is null, render progress bar only (loading_data/generating phase)

## Affected Files

| File | Role |
|------|------|
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/hooks/useAlphaFactoryBacktest.ts` | Add throttled buffer for onIncrement data accumulation |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ResultSection.tsx` | Render charts during running status when result data exists |

## Reference Implementation

Main BacktestPage ( / ):
- `plugins/back-test-nexus/ui/src/components/pages/BacktestPage.tsx` (lines 747-848)
- Throttled buffer (100ms) accumulates onIncrement data
- `flushBuffer` merges and appends equityCurve/trades/candles to result state
- Charts render whenever result data exists, regardless of execution status

## Related Tickets

- Backtest real-time display requirement
- Independent backtest result page architecture
- **PLUGIN_Alpha Factory run backtest (execution hook)
- **PLUGIN_Alpha Factory result page (current display components)
