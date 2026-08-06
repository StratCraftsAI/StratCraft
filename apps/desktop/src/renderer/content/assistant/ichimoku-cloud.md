# Ichimoku Cloud Strategy

A comprehensive framework designed to provide an "at-a-glance" view of momentum, trend direction, and dynamic support/resistance levels using five core price-based components.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: Trending liquid markets (Forex majors, large-cap equities, and established crypto pairs) that exhibit sustained multi-month cycles
Best Timeframe: `4h`, `1D`, and `1W` are the traditional domains of the Cloud; lower timeframes often produce "inside the cloud" noise and false TK crosses
Risk Warning: The Ichimoku system is notoriously weak in sideways, range-bound markets. When price enters the Kumo (Cloud), volatility increases and direction becomes unpredictable
:::

## Core Idea

- `Tenkan-sen` (Conversion) and `Kijun-sen` (Base) track short and medium-term momentum.
- `Senkou Span A & B` form the **Kumo** (Cloud), projecting future support and resistance zones.
- `Chikou Span` (Lagging) acts as the final trend-confirmation filter by comparing current price to history.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
- [RSI + Moving Average Strategy Guide](assistant:rsi-ma)
- [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
- [VWAP Strategy Guide](assistant:vwap-strategy)
- [Supertrend Strategy Guide](assistant:supertrend)
- [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)

## Decision Flow

1. Determine the macro trend by checking whether price is above or below the `Kumo` (Cloud).
2. Look for the `Tenkan-sen` to cross the `Kijun-sen` in the direction of the trend (TK Cross).
3. Confirm that the `Chikou Span` is clear of historical price action (Clear Path).
4. Enter when price breaks out of the Cloud or retests the Kijun-sen in a strong trend.
5. Exit when the TK cross reverses or price closes inside/below the Cloud structure.

## Indicator Stack

- `Tenkan-sen (9)` - Short-term momentum trigger
- `Kijun-sen (26)` - Medium-term baseline and major support
- `Senkou Span A (avg of T/K, shifted +26)` - Faster cloud boundary
- `Senkou Span B (52-period midpoint, shifted +26)` - Slower, institutional-grade cloud boundary
- `Chikou Span (price shifted -26)` - Lagging trend confirmation

## The Kumo (Cloud) Read

- `Price above Cloud` - Bullish sentiment (Buy only)
- `Price below Cloud` - Bearish sentiment (Sell only)
- `Price inside Cloud` - Consolidation or "no-trade" zone
- `Future Cloud Color` - Green Kumo suggests continued bullishness; Red Kumo suggests bearishness
- `Cloud Thickness` - Thicker clouds represent stronger historical support/resistance

The Cloud projects where support and resistance are likely to be 26 periods into the future.

## TK Cross Read (The Trigger)

- `Golden TK Cross` - Tenkan crosses above Kijun (Bullish)
- `Death TK Cross` - Tenkan crosses below Kijun (Bearish)
- `Strong Signal` - Cross occurs above the Cloud (Bullish) or below the Cloud (Bearish)
- `Weak Signal` - Cross occurs on the opposite side of the Cloud (higher risk)

The TK cross is most reliable when it aligns with the price's position relative to the Cloud.

## Chikou Span Read (The Filter)

- `Clear Path` - Chikou is not touching or crossing any historical candles
- `Bullish Path` - Chikou is above historical price action
- `Bearish Path` - Chikou is below historical price action

If Chikou is tangled with candles, the trend is likely non-existent or reversing.

## Entry Setup

### Primary Kumo Breakout Setup

- Price breaks and closes **above** the Kumo (Cloud)
- Tenkan-sen is above Kijun-sen (Bullish TK Cross)
- Future Cloud (Kumo) is Green
- Chikou Span is clear of historical price action
- **Trigger**: The close of the breakout candle or a limit order at the Senkou Span A level

### Trade Checklist

- Is price clearly above the Cloud?
- Is the TK Cross bullish?
- Is the Chikou Span in a clear path above candles?
- Is the future Cloud showing a bullish color/twist?
- Is the current Kumo thick enough to provide support if price pulls back?

### Alternate Setups

- `Kijun-sen Retest` - In an established uptrend, buy when price pulls back to touch the Kijun-sen and bounces
- `TK Cross above Cloud` - An existing breakout gains fresh momentum when a new TK cross occurs above the Cloud
- `Cloud Bounce (Edge-to-Edge)` - Price enters the cloud from one side and targets the opposite edge (high risk, tactical play)

### Reject The Trade If

- price is currently inside the Cloud (the "No-Man's Land")
- the TK Cross occurs below the Cloud for a long setup
- the Cloud is very thin and "twisting" frequently (sideways market)
- the Chikou Span is stuck inside historical candle ranges
- the entry is too far away from the Kijun-sen (overextended)

## Exit Setup

- `Momentum Exit (TK Death Cross)` - Exit when the Tenkan-sen crosses back below the Kijun-sen
- `Structural Exit (Kumo Break)` - Exit fully if price closes below the Cloud (Senkou Span B)
- `Trailing Exit (Kijun-sen)` - Use a close below the Kijun-sen as a tighter trailing stop
- `Chikou Rejection` - Exit if the Chikou Span hits historical resistance and starts turning back

### Practical Exit Sequence

1. Scale out partial profits when price reaches a major historical resistance zone.
2. Tighten the stop using **Flat Kijun Stop Placement** logic once the trend is established.
3. Fully exit if the TK cross reverses, especially if it happens near a Cloud edge.
4. Exit immediately if price slices through the Cloud with high volume.

## Risk Management

### Key Stop Loss Strategies

- **Flat Kijun Stop Placement**: When the Kijun-sen is flat, it represents a significant structural price floor. Place stops slightly below the flat portion of the Kijun-sen to allow for minor volatility while protecting against a real trend breakdown.
- **Opposite Cloud Boundary Stop**: For Kumo breakouts, place the initial stop at the far edge of the cloud (Senkou Span B). This uses the entire thickness of the Cloud as a volatility buffer, only exiting if price fully re-enters and collapses through the Cloud.

### Advanced Controls

- `Volatility Adjustment` - Thick clouds mean high historical volatility; reduce position size accordingly to account for a wider Opposite Cloud Boundary Stop.
- `R/R Threshold` - Target the next major horizontal level or the target projected by the Cloud thickness.
- `Trend Exhaustion` - Watch the distance between price and Kijun-sen; extreme gaps signal a "rubber band" effect and high reversal risk.

### Main Failure Mode

The "Inside-the-Cloud" trap is the most common failure. Traders often force entries when price is bouncing between Senkou Span A and B. This area is a volatility zone, not a trend zone. Success with Ichimoku requires waiting for the **Clean Break** and **Chikou Confirmation**.

## Parameters

- `tenkan_period` - `9`
- `kijun_period` - `26`
- `senkou_b_period` - `52`
- `displacement` - `26` (for cloud shift and lagging line)

## Common Mistakes

- trading inside the Kumo (Cloud)
- ignoring the Chikou Span filter (lagging line)
- entering when price is overextended from the Kijun-sen
- treating a TK cross below the Cloud as a strong buy signal
- failing to account for "Cloud Twists" that signal trend weakness

## Continue Exploring

Previous: [EMA Crossover Strategy Guide](assistant:ema-crossover)

Next: [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
