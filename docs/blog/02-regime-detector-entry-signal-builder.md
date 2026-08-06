---
title: "Market Regime Detection and Entry Signal Generation in StratCraft"
slug: "regime-detector-entry-signal-builder"
category: "Feature"
tags: ["market regime detection", "entry signal generator", "trend trading", "free strategy builder"]
excerpt: "Detect market regimes like trend and range, then generate AI-powered entry signals -- all free in StratCraft."
estimated_reading_time: "6 min"
---

## Introduction

The Regime Detector and Entry Signal builder is a two-stage strategy generation workflow in StratCraft that first classifies market conditions, then generates entry signals tuned to those conditions. This is the core free strategy builder -- no Pro plan or API key required to use the built-in Nona LLM provider.

Markets behave differently in trending versus ranging conditions. A strategy that works well in a trending market may generate false signals in a range-bound market. The Regime mode solves this by splitting strategy generation into two layers: detect the regime first, then apply regime-appropriate entry logic.

## Key Highlights

- **Five Regime Types** -- Detect Trend, Range, Consolidation, Oscillation, or define a Bespoke custom regime with your own conditions.
- **Two-Layer Architecture** -- Regime Detector (analysis layer) classifies market state; Entry Signal (execution layer) generates trades based on that classification.
- **Standalone or Paired** -- Use Entry Signal in standalone mode for direct indicator-based entries, or pair it with a Regime Detector for regime-aware trading.
- **Custom Expressions** -- Beyond standard technical indicators, write custom expressions to define your own regime detection or entry conditions.
- **Free Tier** -- Both Regime Detector and Entry Signal are available in the free version of StratCraft.

## How It Works

### Stage 1: Regime Detector

1. **Select a Regime Type** -- Choose from Trend, Range, Consolidation, Oscillation, or Bespoke. Each type determines the analysis framework the AI uses.
2. **Add Technical Indicators** -- Select indicators like RSI, MACD, SMA, or Bollinger Bands that will be used for regime classification.
3. **Write Custom Expressions** (optional) -- Add custom conditions using the expression builder for more specific regime definitions.
4. **Generate** -- The AI generates a Python strategy file inheriting from `RegimeStateBase` that classifies each bar into the selected regime state.

### Stage 2: Entry Signal

1. **Select Regime Context** -- Choose Trend, Range, or Standalone mode. Trend and Range modes pair with a Regime Detector; Standalone mode generates entries without regime classification.
2. **Configure Indicators** -- Add the technical indicators that drive your entry logic.
3. **Set Signal Mode** -- Choose between auto-reverse (always in a position) or long-only mode.
4. **Generate** -- The AI produces a Python entry strategy inheriting from the appropriate base class (e.g., `RegimeTrendEntryBase`).

### Example Output

The generated strategy is a standard Python file:

```python
class RegimeTrendEntry(RegimeTrendEntryBase):
    """AI-generated trend-following entry strategy"""

    def init(self):
        self.sma_fast = self.I(SMA, self.data.Close, 20)
        self.sma_slow = self.I(SMA, self.data.Close, 50)
        self.rsi = self.I(RSI, self.data.Close, 14)

    def next(self):
        if self.sma_fast[-1] > self.sma_slow[-1] and self.rsi[-1] > 50:
            self.buy()
        elif self.sma_fast[-1] < self.sma_slow[-1] and self.rsi[-1] < 50:
            self.sell()
```

## Screenshots

<!-- SCREENSHOT: Regime Detector page with regime type selector and indicator blocks -->
<!-- FILE: images/blog/regime-detector-entry-signal-builder/01.png -->

<!-- SCREENSHOT: Entry Signal page in Trend mode with indicator configuration and signal mode toggle -->
<!-- FILE: images/blog/regime-detector-entry-signal-builder/02.png -->

<!-- SCREENSHOT: Generated Python strategy code output -->
<!-- FILE: images/blog/regime-detector-entry-signal-builder/03.png -->

## Why This Matters

Most retail trading strategies ignore market regime entirely -- they apply the same rules regardless of whether the market is trending or ranging. This is one of the primary reasons strategies that look great in backtests fail in live trading: they were optimized for one regime but deployed across all regimes.

The Regime Detector and Entry Signal workflow addresses this directly. By separating regime classification from entry logic, traders can build strategies that adapt to changing market conditions. The two-layer design also makes strategies more maintainable -- you can swap out the entry logic without touching the regime detection, or vice versa.

Being available in the free tier makes this an accessible entry point for traders who want to explore systematic strategy development without financial commitment.

## Getting Started

- **Open StratCraft** and navigate to Strategy Builder from the Nexus Hub
- **Select Regime Detector** to start with market classification, or **Entry Signal** for direct entries
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)
- **No API key needed** -- The built-in Nona LLM provider works out of the box for free tier users

## Technical Details

The Regime Detector generates strategies with `strategy_type: 9` (Analysis) and signal sources like `indicator_detector_trend` or `indicator_detector_range`. Entry Signal generates `strategy_type: 3` (Entry Signal) with sources like `indicator_entry_trend`. The API endpoints are `/api/start_market_regime_analysis` for detection and `/api/start_regime_indicator_entry` for entry generation. Both use the same indicator block and expression input components, sharing the StratCraftsAI UI component library for consistent configuration UX.
