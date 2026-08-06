---
title: "Indicator Exit: Automated Risk Management and Exit Signal Generation"
slug: "indicator-exit-risk-management"
category: "Feature"
tags: ["trading risk management", "exit signal generator", "circuit breaker", "drawdown limit"]
excerpt: "Indicator Exit generates automated risk management rules including circuit breakers, drawdown limits, and time-based exits for any strategy."
estimated_reading_time: "5 min"
---

## Introduction

Indicator Exit is a risk management module in StratCraft that generates automated exit signals and safety rules for any trading strategy. While entry signals decide when to open positions, Indicator Exit decides when to close them -- not based on profit targets, but on risk conditions like excessive drawdown, time limits, or market regime changes.

This is a universal module that works independently of how your entry was generated. Whether your entry comes from Regime Entry, Kronos, Trader AI, or AI Strategy Studio, Indicator Exit provides a consistent risk management layer on top. Available to Pro plan users.

## Key Highlights

- **Five Risk Rule Types** -- Circuit Breaker, Time Limit, Regime Detection, Drawdown Limit, and Indicator Guard -- each addressing a different category of risk.
- **Three-Layer Architecture** -- L0 Combinator (combine multiple rules), L1 Risk Override (the rules themselves), L2 Hard Safety (absolute stop-loss backstop).
- **Hard Safety Backstop** -- Configure a hard stop-loss percentage that overrides all other exit logic -- the final safety net.
- **Universal Compatibility** -- Pairs with any entry strategy regardless of builder mode.
- **Pro Feature** -- Indicator Exit requires a Pro plan subscription.

## How It Works

1. **Add Risk Rules** -- Select from five rule types:
   - **Circuit Breaker** -- Halt trading after N consecutive losses or a specified loss amount within a time window
   - **Time Limit** -- Force-close positions after a maximum holding period (e.g., close after 20 bars)
   - **Regime Detection** -- Exit when market regime changes (e.g., exit long positions when regime shifts from trend to range)
   - **Drawdown Limit** -- Exit when portfolio or position drawdown exceeds a threshold
   - **Indicator Guard** -- Exit when specified indicator conditions are met (e.g., exit when RSI > 80)
2. **Configure Hard Safety** -- Set an absolute stop-loss percentage as the final backstop (e.g., -5% from entry price).
3. **Generate** -- The AI produces a Python risk management strategy that evaluates all configured rules on each bar and generates exit signals when any rule triggers.

### Risk Architecture

```
Entry Strategy (any builder mode)
    |
    v
L0: Combinator (combines multiple risk rules)
    |
    v
L1: Risk Override (circuit breaker, time limit, regime, drawdown, indicator)
    |
    v
L2: Hard Safety (absolute stop-loss backstop)
```

### Example Configuration

```
Rules:
  1. Circuit Breaker: Halt after 3 consecutive losses
  2. Time Limit: Close positions after 50 bars
  3. Drawdown Limit: Exit at -8% portfolio drawdown

Hard Safety: -5% stop-loss from entry price
```

## Screenshots

<!-- SCREENSHOT: Indicator Exit page showing the five risk rule type selectors -->
<!-- FILE: images/blog/indicator-exit-risk-management/01.png -->

<!-- SCREENSHOT: Configured risk rules with circuit breaker and drawdown limit settings -->
<!-- FILE: images/blog/indicator-exit-risk-management/02.png -->

## Why This Matters

Entry signals get the most attention in strategy development, but exits determine profitability. A strategy with mediocre entries but disciplined exits will often outperform a strategy with excellent entries but poor risk management.

Indicator Exit addresses the most common failure mode in algorithmic trading: strategies that let losses run. The five rule types cover distinct risk categories -- behavioral (circuit breaker), temporal (time limit), contextual (regime detection), financial (drawdown limit), and technical (indicator guard). Together, they form a comprehensive risk management framework.

The three-layer architecture ensures that even if primary risk rules fail to trigger, the Hard Safety backstop provides an absolute floor on losses. This defense-in-depth approach reflects institutional risk management practices where multiple independent safety layers protect against catastrophic outcomes.

## Getting Started

- **Requires Pro Plan** -- Indicator Exit is a Pro feature
- **Navigate**: Strategy Builder > Indicator Exit
- **Pair with**: Any entry strategy from any builder mode
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

Indicator Exit generates `strategy_type: 6` (Exit Signal) with `signal_source: risk_override`. The API endpoint is `/api/risk_override_exit`. The architecture follows an L0-L1-L2 pattern: L0 Combinator aggregates multiple risk rules using configurable logic (any-trigger or majority-trigger), L1 Risk Override implements the five rule types as independent evaluators, and L2 Hard Safety provides an unconditional stop-loss that overrides all other logic. Each rule type is implemented as a separate evaluator class, making the system extensible for custom risk rules.
