# PLUGIN_Alpha Factory Run Backtest

**Status**: Open
**Priority**: High
**Category**: Feature - Alpha Factory Execution
**Date**: 2026-02-08
**Depends On**:  (Alpha Factory Architecture),  (Exit Factory), PLUGIN_TICKET_011 (Config Persistence)

---

## 1. Objective

Implement the "Run Backtest" flow for Alpha Factory. When user clicks "Run Backtest", the system:
1. Reads N signal sources from `signal_source_registry` (algorithm code)
2. Generates a 2-layer Python strategy (Signal Factory + Combinator)
3. Executes via the existing C++ Executor (Backtrader embedded Python)
4. Displays real-time results (equity curve, trades, metrics)

---

## 2. Architecture

```
Alpha Factory Page (UI)
    |
    | [Run Backtest] click
    v
Plugin: Validate config (signals > 0, data config set)
    |
    v
IPC: alpha-factory:run  (new channel)
    |
    v
Main Process:
    1. Load algorithm code from signal_source_registry for each signal
    2. Generate 2-layer Python strategy (Signal Factory + Combinator + Exit Rules)
    3. Write main.py to temp directory
    4. Call executorService.runBacktest(config)
    |
    v
C++ Executor (embedded Python / Backtrader)
    |  stdout: [PROGRESS], [INCREMENT]
    v
Main Process -> IPC events -> Renderer
    |
    v
Alpha Factory Page: real-time result display
```

---

## 3. Data Config

**Decision**: Simplified `DataConfigPanel` component in quant-lab-nexus plugin.

### 3.1 Rationale

- Executor requires: symbol, interval, startDate, endDate, initialCapital, orderSize, orderSizeUnit
- Signal sources have historical data refs but user needs freedom to choose different data ranges
- `BacktestDataConfigPanel` (back-test-nexus) cannot be cross-plugin imported (PLUGIN_TICKET_009)
- Copy simplified version, no i18n dependency, independently maintained

### 3.2 New Component: `DataConfigPanel.tsx`

```
plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/DataConfigPanel.tsx
```

Simplified from `back-test-nexus/BacktestDataConfigPanel.tsx` (590 lines -> ~200 lines):

| Row | Fields | Notes |
|-----|--------|-------|
| Row 1 | Symbol (search + autocomplete) + Timeframe (select) | ClickHouse symbol search via `data:searchSymbols` IPC |
| Row 2 | Start Date + End Date | Auto-populated on symbol select |
| Row 3 | Initial Capital + Order Size + Unit | Defaults: 100000 / 100 / percent |

Removed vs back-test-nexus version:
- No i18n (`useTranslation`) - hardcoded English labels
- ~~No Data Source selector (always ClickHouse)~~ **UPDATED by PLUGIN_Data Source selector restored via Tier 0 data-plugin
- Add Timeframe selector (back-test-nexus moved it to stage-level, Alpha Factory needs it here)

### 3.3 DataConfig Interface

```typescript
interface DataConfig {
  symbol: string;
  timeframe: string;       // '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
  startDate: string;       // 'YYYY-MM-DD'
  endDate: string;         // 'YYYY-MM-DD'
  initialCapital: number;  // default 100000
  orderSize: number;       // default 100
  orderSizeUnit: 'cash' | 'percent' | 'shares';  // default 'percent'
}
```

### 3.4 Symbol Search

Reuse existing IPC `data:searchSymbols`. Need to add to `quant-lab-nexus/types/global.d.ts`:

```typescript
data: {
  searchSymbols: (query: string) => Promise<{
    success: boolean;
    data?: Array<{ symbol: string; name: string; exchange?: string; startTime?: string; endTime?: string }>;
  }>;
}
```

### 3.5 Placement in AlphaFactoryPage

```
Alpha Factory Page Layout:
+------------------+----------------------------------------------+
|  Config Sidebar  |  Signal Factory Section                      |
|                  |  ---- FlowDivider ----                       |
|                  |  Exit Factory Section (Risk Override)         |
|                  |  ---- FlowDivider ----                       |
|                  |  [NEW] Data Config Panel                     |
|                  |  ---- FlowDivider ----                       |
|                  |  Action Bar (Validate | Save As | Run)       |
+------------------+----------------------------------------------+
```

---

## 4. IPC Channel

### 4.1 New Channel: `alpha-factory:run`

```typescript
// Request
interface AlphaFactoryRunRequest {
  configId: string;               // alpha_factory_config.id
  signalIds: string[];            // signal_source_registry IDs
  signalMethod: string;           // combinator method (equal, sharpe_weighted, etc.)
  lookback: number;               // lookback period for signal weighting
  exitRules: ExitRules;           //  risk override rules
  exitMethod: string;             // exit combinator (any, all, majority, priority)
  // Section 3: Data config from DataConfigPanel
  dataConfig: {
    symbol: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    initialCapital: number;
    orderSize: number;
    orderSizeUnit: 'cash' | 'percent' | 'shares';
  };
}

// Response (immediate)
interface AlphaFactoryRunResponse {
  success: boolean;
  taskId?: string;                // executor task ID for event subscription
  error?: string;
}
```

### 4.2 Main Process Handler

```
1. Validate signalIds non-empty
2. Load all signal sources from DB:
   SELECT * FROM signal_source_registry WHERE id IN (?, ?, ...)
3. Ensure data available via data:ensure IPC (ClickHouse -> Parquet cache)
   Uses dataConfig.symbol, timeframe, startDate, endDate
4. Generate Alpha Factory strategy code (see Section 5)
5. Write main.py
6. Build ExecutorConfig (strategyPath, dataPath from step 3, dataConfig params)
7. Call executorService.runBacktest(config)
8. Return { success: true, taskId }
```

### 4.3 V3_CHANNELS Addition

```typescript
ALPHA_FACTORY_RUN: 'alpha-factory:run',
```

### 4.4 Preload API Addition

```typescript
alphaFactory: {
  // ... existing saveConfig, loadConfig, listConfigs, deleteConfig
  run: (request: AlphaFactoryRunRequest) => ipcRenderer.invoke('alpha-factory:run', request),
}
```

---

## 5. Strategy Code Generation

### 5.1 Alpha Factory Strategy Template

The generated C++ strategy must implement:
- **Layer 1 (Signal Factory)**: Instantiate N signal algorithms, each producing a signal value per bar
- **Layer 2 (Combinator)**: Combine N signals into composite score using selected method
- **Exit Override**: Apply enabled exit rules as risk override on combinator output

### 5.2 Code Structure

> **NOTE**: The Python/backtrader code example below is OUTDATED. As of , all strategy generation produces C++ code compiled via ABI v2 factory pattern. This design doc needs a C++ code structure rewrite when implementation begins.

```python
# [OUTDATED - Python backtrader removed per ]
# Auto-generated by Alpha Factory
# Config: {config_name}
# Signals: {N} sources, Method: {signal_method}

import backtrader as bt
import numpy as np
from framework.base_classes import ...

# --- Layer 1: Signal Algorithms ---

class Signal_0_AnalysisAlgo(AnalysisAlgorithm):
    # {analysis_algorithm_code from signal_source_0}

class Signal_0_EntryAlgo(EntryAlgorithm):
    # {entry_algorithm_code from signal_source_0}

class Signal_1_AnalysisAlgo(AnalysisAlgorithm):
    # ...

# ... N signal algorithms

# --- Layer 2: Combinator ---

class AlphaFactoryStrategy(bt.Strategy, BacktraderEmitMixin):
    params = dict(
        signal_method='{signal_method}',
        lookback={lookback},
        initial_capital={initial_capital},
        order_size=100,
        order_size_unit='percent',
    )

    def __init__(self):
        # Initialize all signal algorithms
        self.signals = [
            Signal_0(self.data, ...),
            Signal_1(self.data, ...),
            # ...
        ]
        # Exit rules config
        self.exit_rules = {exit_rules_json}

    def next(self):
        # Layer 1: Collect signals
        signal_values = [s.get_signal() for s in self.signals]

        # Layer 2: Combine
        composite = self._combine(signal_values)

        # Exit Override: Check risk rules
        override = self._check_exit_rules()
        if override:
            self._apply_exit_action(override)
            return

        # Execute on composite signal
        self._execute(composite)

    def _combine(self, signals):
        if self.p.signal_method == 'equal':
            return np.mean(signals)
        elif self.p.signal_method == 'sharpe_weighted':
            # Weight by historical Sharpe from signal metadata
            ...
```

### 5.3 Implementation Function

New function in `v3-handlers.ts`:

```typescript
function generateAlphaFactoryStrategyCode(
  signalSources: SignalSourceRecord[],
  signalMethod: string,
  lookback: number,
  exitRules: ExitRules,
  exitMethod: string,
): string
```

This is separate from `generateWorkflowStrategyCode()` because the architecture is fundamentally different (multi-signal combinator vs single-workflow).

---

## 6. UI Flow

### 6.1 AlphaFactoryPage Changes

```
handleRunBacktest():
  1. Validate: signals.length > 0 (show error if empty)
  2. Call IPC: alphaFactory.run({ configId, signalIds, signalMethod, ... })
  3. If success: store taskId, subscribe to executor events
  4. Show execution progress (reuse executor event pattern)
  5. On completion: display result panel
```

### 6.2 State Additions to AlphaFactoryPage

```typescript
// Execution state
const [isExecuting, setIsExecuting] = useState(false);
const [taskId, setTaskId] = useState<string | null>(null);
const [progress, setProgress] = useState(0);
const [result, setResult] = useState<BacktestResult | null>(null);
const [error, setError] = useState<string | null>(null);
```

### 6.3 Event Subscription

Reuse existing `window.electronAPI.executor` event APIs:
- `onProgress(cb)` - update progress bar
- `onIncrement(cb)` - real-time chart data
- `onCompleted(cb)` - final result
- `onError(cb)` - execution error

### 6.4 Result Display

Phase 1: Show basic result summary (total return, Sharpe, max DD, win rate, trade count) in a panel below ActionBar.

Phase 2 (future): Full result page with equity curve, trade list, signal decomposition.

---

## 7. Validation

Before execution, validate:

| Check | Error Message |
|-------|---------------|
| `signals.length === 0` | "Add at least one signal source" |
| `dataConfig.symbol` empty | "Select a symbol" |
| `dataConfig.startDate/endDate` empty | "Set date range" |
| Data ensure fails | "Market data not available for {symbol}" |

---

## 8. Files Summary

| File | Action |
|------|--------|
| `quant-lab-nexus/components/DataConfigPanel.tsx` | **NEW** - Simplified data config (symbol search, date range, capital) |
| `quant-lab-nexus/pages/AlphaFactoryPage.tsx` | **MODIFY** - Add DataConfigPanel, implement handleRunBacktest, execution state |
| `quant-lab-nexus/components/ActionBar.tsx` | **MODIFY** - Disable button during execution, show progress |
| `quant-lab-nexus/types/global.d.ts` | **MODIFY** - Add run + data search API type declarations |
| `v3-handlers.ts` | **MODIFY** - Add `alpha-factory:run` handler + code generation |
| `preload/index.ts` | **MODIFY** - Add `alphaFactory.run()` API |

---

## 9. Dependencies

- **Existing**: `executorService.runBacktest()`, executor event system, `signal_source_registry` table
- ExitRules data structure (done)
- 2-layer architecture spec (done)
- **Data**: Requires market data (Parquet files) for the symbol. Data loading via existing `dataAPI.ensure()` or direct path from signal source metadata.

---

## 10. References

- Alpha Factory Architecture (Appendix G - 2-layer design)
- Exit Factory Risk Override Rules
- Workflow Backtest Execution (reference pattern)
- Backtest Real-Time Display
- BacktestPage.tsx: Complete reference implementation for executor integration
