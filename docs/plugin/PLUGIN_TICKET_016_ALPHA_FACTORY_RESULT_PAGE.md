# PLUGIN_Alpha Factory Result Display

## Context

PLUGIN_TICKET_015 implemented the Alpha Factory backtest execution flow, but results are displayed as a minimal inline `BacktestResultPanel` (5 metric cards) embedded at the bottom of the Alpha Factory page. Users cannot see equity curves, trade details, or candle charts.

### Design Decision: Inline Result (Not Independent Page)

Unlike the Backtest module (Page 41, ) which uses an independent result page, Alpha Factory displays results **inline within the Alpha Factory page** itself. Rationale:

- **Iterative workflow**: Alpha Factory is fundamentally about rapid iteration -- tweak signals, run test, check results, tweak again. Page navigation breaks this cycle.
- **Immediate feedback**: Config and results on the same page allows instant visual correlation between parameter changes and outcomes.
- **Scrollable layout**: The right-column content area is scrollable, providing sufficient vertical space for full result visualization (metric cards, equity curve, trades table) without sacrificing config visibility.

## Reference: Page 41 Architecture (Visual Components Only)

Reuse chart/table component patterns from Page 41, but NOT the routing/navigation architecture:

| Component | Reference File | Reuse |
|-----------|---------------|-------|
| Equity Curve | `BacktestResultPanel` equity section | Pattern reuse |
| Trades Table | `BacktestResultPanel` trades section | Pattern reuse |
| Metric Cards | `BacktestResultPanel` metrics section | Pattern reuse |

## Design

### 1. No Routing Change

No new view registration. No navigation trigger. Results render inline within the existing Alpha Factory page. The `AlphaFactoryPage` right-column content area uses `overflow-y: auto` to enable vertical scrolling.

### 2. Page Layout: Scrollable Right Column

The existing Alpha Factory page layout (ConfigSidebar left + content right) remains. The right column becomes a scrollable container with the following vertical order:

1. **SignalFactorySection** -- signal chips + combinator config
2. **FlowDivider**
3. **ExitFactorySection** -- risk rule toggles
4. **FlowDivider**
5. **DataConfigPanel** -- symbol, dates, capital
6. **ActionBar** -- Validate / Save As / Run Backtest
7. **ResultSection** -- (NEW) full result display, replaces minimal `BacktestResultPanel`

When backtest status is `idle`, the ResultSection is hidden. When status transitions to `running`, the ResultSection appears and the page auto-scrolls to it.

### 3. ResultSection Component

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ResultSection.tsx`

Replaces the current minimal `BacktestResultPanel`. Contains:

#### Progress State (status: loading_data | generating | running)

- Progress bar with label and percentage (same as current)

#### Completed State (status: completed)

Vertical stack, all visible without tabs (scrollable):

**Signal Summary Header**:
```
Signals: [MA_Cross_1d] [BB_Breakout_4h]   Method: Sharpe Weighted   Lookback: 20
Exit: Circuit Breaker (5 consecutive losses) + Max Drawdown (15%)
```
Compact display of the configuration that produced this result.

**Metric Summary Row**:
- 6 cards: Total PnL, Return %, Sharpe Ratio, Max Drawdown, Win Rate, Total Trades
- Color-coded: green (positive), red (negative)

**Equity Curve Chart**:
- SVG area chart with gradient fill (reuse pattern from back-test-nexus `BacktestResultPanel`)
- Real-time update during execution via `onIncrement` equity points
- Final equity value + percentage return label
- Height: 200px

No K-line candle chart. Alpha Factory focuses on signal combination performance (metrics + equity curve + trades), not individual price action analysis. K-line is available in the Backtest module (Page 41) for detailed strategy analysis.

**Trades Table**:
- Columns: #, Entry Time, Exit Time, Side, Entry Price, Exit Price, Qty, PnL
- Color-coded PnL and Side
- Max 100 rows with count indicator

#### Error State (status: error)

- Red error message box (same as current)

### 4. State Management

No new store. The existing `useAlphaFactoryBacktest` hook already manages:
- `status`, `progress`, `result`, `error`

Extend the hook to also store full executor result data (equity curve, trades) instead of only the summary metrics. The hook subscribes to executor events and updates local state.

### 5. Executor Event Flow

Same as PLUGIN_TICKET_015, subscriptions stay in the hook (no move needed):

1. Alpha Factory page calls `alphaFactory.run()` + `executor.runBacktest()` -> gets `taskId`
2. Hook subscribes to `executor.onProgress`, `onIncrement`, `onCompleted`, `onError`
3. Real-time updates: progress bar -> equity curve incremental points
4. On completion: full metric display + trades table
5. Page auto-scrolls to ResultSection when status changes from `idle`

### 6. Auto-Scroll Behavior

When backtest starts (`status` transitions from `idle` to `loading_data`):
- `ResultSection` ref + `scrollIntoView({ behavior: 'smooth' })`
- User sees progress immediately without manual scrolling
- User can scroll back up to view/modify config at any time

### 7. Data Contract

The hook receives the C++ executor result (same structure as Page 41):

```typescript
interface ExecutorResult {
  success: boolean;
  metrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalTrades: number;
    winRate: number;
    profitFactor: number;
  };
  equityCurve: Array<{ timestamp: number; equity: number; drawdown: number }>;
  trades: Array<{
    entryTime: number; exitTime: number;
    side: string; entryPrice: number; exitPrice: number;
    quantity: number; pnl: number;
  }>;
}
```

## UI Layout

```
+------------------------------------------------------------------+
| ConfigSidebar |  Right Column (overflow-y: auto)                  |
|               |                                                    |
|  [Config 1]   |  +----------------------------------------------+ |
|  [Config 2]   |  |  SIGNAL FACTORY                               | |
|  [Config 3]   |  |  [MA_Cross_1d] [BB_4h] [RSI_1h] ...         | |
|               |  |  Method: Sharpe Weighted  Lookback: 20        | |
|               |  +----------------------------------------------+ |
|               |  ---- FlowDivider ----                            |
|               |  +----------------------------------------------+ |
|               |  |  EXIT FACTORY                                  | |
|               |  |  Circuit Breaker [ON]  Max DD [ON] ...        | |
|               |  +----------------------------------------------+ |
|               |  ---- FlowDivider ----                            |
|               |  +----------------------------------------------+ |
|               |  |  DATA CONFIG                                   | |
|               |  |  BTCUSDT  2023-01-01 ~ 2024-01-01  $100,000  | |
|               |  +----------------------------------------------+ |
|               |  +----------------------------------------------+ |
|               |  |  [Validate]  [Save As]  [Run Backtest]        | |
|               |  +----------------------------------------------+ |
|               |                                                    |
|               |  ============= RESULT SECTION =================== |
|               |                                                    |
|               |  Signals: [MA_Cross_1d] [BB_4h]  Method: Sharpe  |
|               |  Exit: Circuit Breaker (5) + Max DD (15%)         |
|               |                                                    |
|               |  +--+--+--+--+--+--+                              |
|               |  |PnL|Ret|Shp|MDD|WR |Trd|  <- Metric Cards      |
|               |  +--+--+--+--+--+--+                              |
|               |                                                    |
|               |  +----------------------------------------------+ |
|               |  |       EQUITY CURVE (Area Chart)               | |
|               |  |  $125,000 (+25.0%)                            | |
|               |  +----------------------------------------------+ |
|               |                                                    |
|               |  +----------------------------------------------+ |
|               |  | # | Entry    | Exit     | Side | PnL         | |
|               |  | 1 | 2023-01  | 2023-02  | BUY  | +$1,200     | |
|               |  | 2 | 2023-03  | 2023-04  | SELL | -$300       | |
|               |  | ..| ...      | ...      | ...  | ...         | |
|               |  +----------------------------------------------+ |
|               |                                                    |
+------------------------------------------------------------------+
```

## File Summary

| File | Action | Layer |
|------|--------|-------|
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/ResultSection.tsx` | NEW | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/EquityCurveChart.tsx` | NEW | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/TradesTable.tsx` | NEW | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/MetricSummaryRow.tsx` | NEW | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/SignalSummaryHeader.tsx` | NEW | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/hooks/useAlphaFactoryBacktest.ts` | MODIFY | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/pages/AlphaFactoryPage.tsx` | MODIFY | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/types.ts` | MODIFY | Plugin |
| `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/BacktestResultPanel.tsx` | DELETE | Plugin |

## Dependencies

- PLUGIN_TICKET_015 (Alpha Factory Run Backtest) - completed
-  (Independent Backtest Result Page) - visual component reference only
