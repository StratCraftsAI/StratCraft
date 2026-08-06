# Fibonacci Trend Strategy

A precision-based trend strategy that identifies hidden support and resistance levels by anchoring impulsive price waves to the Golden Ratio and mathematical retracement levels.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: Liquid markets with clear, impulsive "legs" (Impulse Waves), including large-cap equities, index futures, and major crypto assets
Best Timeframe: `4h` and `1D` provide the most reliable anchors; lower timeframes can use Fibonacci for tactical entries but suffer from more noise during leg identification
Risk Warning: Fibonacci is a reactive tool. A retracement level only becomes support if buyers actually step in. Without price action confirmation, a Fibonacci level is just a line on a chart
:::

## Core Idea

- `Impulse Leg` identifies the primary market direction and the "Anchor" for the tool.
- `Golden Pocket` (61.8%) identifies the high-probability institutional entry zone.
- `Extensions` (-0.272, -0.618) project mathematical targets for profit taking.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
- [RSI + Moving Average Strategy Guide](assistant:rsi-ma)
- [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)
- [VWAP Strategy Guide](assistant:vwap-strategy)
- [Supertrend Strategy Guide](assistant:supertrend)
- [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)

## Decision Flow

1. Identify a high-momentum "Impulse Leg" (a clear move from a swing low to a swing high).
2. Anchor the Fibonacci tool from the exact `Swing Low` to the exact `Swing High`.
3. Wait for price to retrace into the key interest zones (38.2%, 50%, or 61.8%).
4. Look for a bullish candle rejection (pin bar, engulfing) or indicator confluence at the level.
5. Enter with a target at the Fibonacci Extension levels.

## Indicator Stack

- `Fibonacci Retracement Tool` anchors the impulsive move
- `Fibonacci Extensions` (-0.272, -0.618) project take-profit targets
- `EMA 20/50` provides trend confirmation and confluence at Fibonacci levels

## Key Retracement Levels

- **38.2% Level (Shallow)**: Used in extremely strong trends; price barely pauses before continuation. High risk, high momentum.
- **50.0% Level (Psychological)**: A common "halfway" reset point for a trend leg.
- **61.8% Level (The Golden Pocket)**: The highest probability entry zone for institutional retracements. A move beyond this often signals a trend failure.

The 61.8% level is the core focus for high-conviction reversal-into-trend trades.

## Fibonacci Extensions (The Targets)

- **-0.272 Extension**: The "First Target" for a successful continuation move.
- **-0.618 Extension**: The "Major Target" where price often meets significant resistance or exhaustion.

Extensions allow for objective profit taking instead of guessing where the trend might end.

## Entry Setup

### Primary Golden Pocket Setup

- Identify a clear impulsive leg up
- Price retraces slowly (corrective move) into the **61.8% zone**
- A bullish rejection candle (e.g., Hammer) forms exactly on the 61.8% line
- **Trigger**: The break of the rejection candle high or a limit order at the 61.8% level

### Trade Checklist

- Is the Anchor Leg a high-momentum move (not a choppy one)?
- Did price reach at least the 38.2% level?
- Is there a bullish candle confirmation at the level?
- Is there confluence (e.g., 61.8% level aligns with a previous resistance-turned-support)?
- Is the 100% retracement level clear for stop placement?

### Alternate Setups

- `Confluence Entry` - Buy when a 50% retracement aligns perfectly with a rising EMA 50
- `Breakout Continuation` - If price retraces only to 38.2% and then breaks the Swing High, enter on the breakout with extension targets
- `Deep Retracement` - If price dips to the 78.6% level, look for a "last-gasp" reversal before the trend origin is broken

### Reject The Trade If

- price retraces more than 100% of the original leg (thesis invalidated)
- the retracement is vertical and high-volume (looks like a crash, not a correction)
- the Fibonacci levels are being completely ignored by price action (choppy market)
- the original impulse leg is unclear or too small to be significant
- the entry occurs directly below a major daily/weekly resistance zone

## Exit Setup

- `Target 1` - Close 50% of the position at the **-0.272 Extension**
- `Target 2` - Close the remainder at the **-0.618 Extension**
- `Structural Exit` - Exit if price breaks back below the entry Fibonacci level (e.g., entry at 61.8%, exit if price closes below 78.6%)
- `Momentum Exit` - Exit if a bearish divergence forms at the -0.272 extension

### Practical Exit Sequence

1. Move stop to breakeven once price breaks the original Swing High (the "0" level).
2. Take initial profits at Target 1 (-0.272) to lock in a "risk-free" trade.
3. Trail the remaining position using a short-term EMA or the Target 2 (-0.618) projection.
4. Exit fully if a bearish reversal candle forms at Target 2.

## Risk Management

### Stop Loss Placement

- **Structural Stop**: Placed slightly below the **100% retracement level** (the origin of the impulse leg). If this is broken, the trend leg is completely invalidated.
- **Tight Stop**: Placed below the **78.6% level** when entering at the Golden Pocket (61.8%).

### Position Management

- `Impulse-to-Correction Ratio` - If the correction is much longer in time than the impulse, be cautious of a trend change.
- `Reward/Risk` - Ensure Target 1 provides at least a `1:1.5` R/R from the entry level.
- `Invalidation` - Once the 100% level is hit, do not "hold and hope"; the setup has failed.

### Main Failure Mode

The "False Leg" is the biggest risk. Traders often draw Fibonacci on minor price wiggles instead of significant market-moving impulses. Success depends on identifying **Institutional Impulse Legs**--moves that clear previous levels with significant momentum.

## Parameters

- `retracement_levels` - `38.2, 50.0, 61.8, 78.6`
- `extension_levels` - `-0.272, -0.618`
- `lookback_period` - user-defined based on swing identification

## Common Mistakes

- anchoring the tool to the wrong swing points (missing the wick or body)
- trading every Fibonacci level without waiting for candle confirmation
- using Fibonacci in a flat, range-bound market where "legs" don't exist
- ignoring the overall market structure (e.g., buying a bullish retracement in a bearish macro trend)
- failing to take profits at the mathematical extension targets

## Continue Exploring

Previous: [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)

Next: [VWAP Strategy Guide](assistant:vwap-strategy)
