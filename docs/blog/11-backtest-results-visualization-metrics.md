---
title: "Backtest Results: Real-Time Visualization and Performance Metrics Analysis"
slug: "backtest-results-visualization-metrics"
category: "Feature"
tags: ["backtest results visualization", "trading performance metrics", "equity curve analysis", "strategy evaluation"]
excerpt: "StratCraft displays backtest results in real-time with equity curves, trade logs, drawdown analysis, and comprehensive performance metrics."
estimated_reading_time: "5 min"
---

## Introduction

The Backtest Results page in StratCraft provides real-time visualization of strategy performance as the backtest executes. Instead of waiting for the entire backtest to complete before seeing results, the UI switches to the results view immediately when execution starts, displaying charts and metrics as data arrives.

This is an independent page in StratCraft -- not a sub-level of another view -- with direct navigation from the Nexus Hub. All result visualization features are available in the free tier.

## Key Highlights

- **Real-Time Display** -- Results appear as the backtest runs, not after completion. The UI shows empty chart structures (Empty Structure pattern) during executor startup, then fills with data progressively.
- **Comprehensive Metrics** -- Total PnL, Sharpe Ratio, Maximum Drawdown, Win Rate, Profit Factor, and trade count -- all calculated and displayed automatically.
- **Equity Curve** -- Interactive chart showing portfolio value over time with drawdown highlighting.
- **Trade Log** -- Complete list of every trade with entry/exit prices, timestamps, PnL, and holding period.
- **Independent Result Page** -- Dedicated page with direct navigation, not nested inside the backtest configuration view.
- **Free Tier** -- All result visualization features are available to free users.

## How It Works

1. **Run a Backtest** -- From any builder mode, click "Run Backtest" after generating a strategy.
2. **Automatic Navigation** -- The UI immediately switches to the Backtest Results page. Empty charts are displayed while the C++ Executor starts up (Empty Structure pattern -- no loading spinners).
3. **Real-Time Updates** -- As the Executor processes bars, equity curve data, trades, and metrics stream to the UI via IPC events.
4. **Final Results** -- When the backtest completes, all metrics are finalized and the complete trade log is available for analysis.

### Performance Metrics

| Metric | Description |
|--------|-------------|
| **Total PnL** | Net profit/loss in currency and percentage |
| **Sharpe Ratio** | Risk-adjusted return (annualized) |
| **Maximum Drawdown** | Largest peak-to-trough decline |
| **Win Rate** | Percentage of profitable trades |
| **Profit Factor** | Gross profit / Gross loss |
| **Total Trades** | Number of completed round-trip trades |
| **Avg Trade Duration** | Mean holding period per trade |

### Backtest Parameters

All backtests run with standardized parameters:
- Initial Capital: $100,000
- Commission: 0.1%
- Slippage: 0.05%
- Maximum Position: 100%

## Screenshots

<!-- SCREENSHOT: Backtest Results page with equity curve chart and performance metrics panel -->
<!-- FILE: images/blog/backtest-results-visualization-metrics/01.png -->

<!-- SCREENSHOT: Trade log table showing individual trades with entry/exit details -->
<!-- FILE: images/blog/backtest-results-visualization-metrics/02.png -->

<!-- SCREENSHOT: Empty Structure pattern during executor startup - empty charts ready for data -->
<!-- FILE: images/blog/backtest-results-visualization-metrics/03.png -->

## Why This Matters

The speed at which you can evaluate a strategy directly affects your research productivity. Traditional backtesting tools require you to wait for complete execution before seeing any results -- for a long backtest, this means minutes of idle waiting before discovering that the strategy is unprofitable.

StratCraft's real-time display eliminates this wait. You see the equity curve forming as the backtest runs, which means you can identify clearly failing strategies early and cancel them to try a different approach. The Empty Structure pattern (showing empty chart frames rather than loading spinners) provides immediate visual context for where results will appear, reducing the cognitive load of waiting.

The independent result page design also supports workflow efficiency. You can navigate directly to results from the Nexus Hub without going through the backtest configuration, making it easy to review previous backtest outcomes.

## Getting Started

- **Included in Free Tier** -- All result visualization features are free
- **Automatic**: Run any backtest and the results page opens automatically
- **Navigate**: Nexus Hub > Backtest Results (to review previous results)
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

The Backtest Results page is registered as an independent view (`backtestResult`) with `parentViewId: backtest` for breadcrumb navigation. Real-time updates use IPC event subscription (async polling pattern per ) with the Executor emitting progress, trade, and completion events. The Empty Structure pattern renders chart components with empty data sets during `isExecuting` state, avoiding spinner-based loading indicators. Results are persisted in the local SQLite database for historical review. The Executor queue ensures serial execution with 60-second result retention.
