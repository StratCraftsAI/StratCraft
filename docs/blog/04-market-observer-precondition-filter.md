---
title: "Market Observer: Precondition Filtering for Smarter Trade Execution"
slug: "market-observer-precondition-filter"
category: "Feature"
tags: ["market precondition filter", "trading watchlist", "signal filter", "trade timing"]
excerpt: "Market Observer generates precondition filters that block trades during unfavorable market conditions, improving strategy quality."
estimated_reading_time: "5 min"
---

## Introduction

Market Observer is a precondition filter in StratCraft that generates rules to block trade execution during unfavorable market conditions. Rather than deciding when to trade, Market Observer decides when NOT to trade -- filtering out time periods where your strategy is likely to underperform.

Think of it as a gatekeeper: your entry strategy proposes trades, but Market Observer checks whether the broader market environment is suitable before allowing execution. This precondition layer is available to Pro plan users and can be paired with any Trader Mode entry strategy.

## Key Highlights

- **Precondition Logic** -- Generates market environment filters that must pass before any entry signal is executed.
- **Indicator-Based Observation** -- Define observation rules using technical indicators like volatility measures, trend strength, or volume conditions.
- **Custom Expression Rules** -- Write custom observation expressions beyond standard indicators for bespoke market condition detection.
- **Optional Pairing** -- Use standalone or pair with Trader AI Entry for filtered AI-driven trading.
- **Pro Feature** -- Market Observer requires a Pro plan subscription.

## How It Works

1. **Add Observation Indicators** -- Select technical indicators that define favorable versus unfavorable market conditions. For example, use ADX to measure trend strength, VIX for volatility, or volume indicators for liquidity.
2. **Write Observation Rules** -- Define custom expressions that describe when the market is suitable for trading. For example: "ADX > 25 AND Volume > Average Volume."
3. **Generate** -- The AI produces a Python strategy inheriting from `TraderObserverBase` that outputs a boolean signal: trade allowed or trade blocked.
4. **Pair with Entry Strategy** (optional) -- Connect the Market Observer output to a Trader AI Entry or AI Libero strategy. The entry strategy only executes when the observer permits trading.

### Example Use Cases

- **Volatility Filter** -- Block entries during extreme volatility spikes that cause whipsaw losses
- **Trend Strength Gate** -- Only allow trend-following entries when ADX confirms a strong trend
- **Volume Confirmation** -- Require minimum volume levels before executing trades
- **Time-of-Day Filter** -- Avoid trading during low-liquidity periods

## Screenshots

<!-- SCREENSHOT: Market Observer page with indicator blocks and observation rule expressions -->
<!-- FILE: images/blog/market-observer-precondition-filter/01.png -->

<!-- SCREENSHOT: Generated precondition strategy code showing boolean filter logic -->
<!-- FILE: images/blog/market-observer-precondition-filter/02.png -->

## Why This Matters

One of the most overlooked aspects of strategy development is knowing when to stay out of the market. Many strategies generate entries continuously, including during conditions where the underlying edge does not exist -- choppy markets, low volume periods, or regime transitions.

Market Observer addresses this by separating the "should I trade at all right now?" question from the "what trade should I take?" question. This separation of concerns produces cleaner strategies with fewer false signals and reduced drawdowns during adverse market conditions.

For traders using Trader AI Entry or AI Libero, the Market Observer provides a rules-based sanity check on the AI's trading decisions -- ensuring the AI agent only operates in market environments where it has been designed to perform.

## Getting Started

- **Requires Pro Plan** -- Market Observer is a Pro feature
- **Navigate**: Strategy Builder > Market Observer
- **Optional Next Step**: Pair with Trader AI Entry (see [Trader AI Entry article](/blog/trader-ai-entry-llm-agent))
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

Market Observer generates `strategy_type: 7` (Precondition) with `signal_source: watchlist`. The API endpoint is `/api/start_watchlist_operation`. Generated strategies inherit from `TraderObserverBase` and output boolean precondition signals that gate downstream entry strategies. The observer evaluates configured indicators and expressions on each bar, producing a pass/fail signal that the paired entry strategy reads before making trade decisions.
