# VWAP Strategy

The Volume Weighted Average Price (VWAP) is the ultimate intraday benchmark that combines price and volume to show the "true" average price paid by all market participants since the opening bell.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: High-volume liquid equities, index futures (ES/NQ), and major crypto pairs during active trading hours (e.g., US market open)
Best Timeframe: `1m`, `5m`, and `15m` are the primary intraday domains; VWAP is an intraday tool that resets daily at 9:30 AM
Risk Warning: VWAP is less effective during the first 15-30 minutes of the open due to low sample size. Do not use VWAP on multi-day charts unless using an "Anchored VWAP" variant
:::

## Core Idea

- `VWAP Baseline` represents the intraday "Fair Value" for institutional algorithms.
- `Standard Deviation Bands` (?1 SD, ?2 SD) identify overextended or "cheap" price levels.
- `Volume Confirmation` identifies whether "Smart Money" is actively defending the VWAP level.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
- [RSI + Moving Average Strategy Guide](assistant:rsi-ma)
- [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)
- [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
- [Supertrend Strategy Guide](assistant:supertrend)
- [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)

## Decision Flow

1. Wait for the market to establish an initial VWAP slope (usually after the first 30 mins).
2. Determine the bias: Price > VWAP (Bullish), Price < VWAP (Bearish).
3. Identify the setup: Are you playing for a **Breakout** or **Mean Reversion**?
4. Look for volume expansion at the VWAP baseline or price exhaustion at the ?2 SD bands.
5. Enter with a target at the next major SD band or the VWAP baseline.

## Indicator Stack

- `VWAP Baseline` resets daily at the session open
- `Standard Deviation Bands` (?1 SD, ?2 SD) provide dynamic volatility boundaries
- `Volume Profile` confirms institutional participation at key VWAP levels

## Institutional Importance

- **Fair Value Benchmark**: Institutions use VWAP to measure execution quality; buying below VWAP is "discounted," selling above is "premium."
- **Smart Money Confirmation**: Large orders often defend the VWAP line, creating high-probability support/resistance.
- **Liquidity Mapping**: VWAP identifies where the bulk of the day's capital is committed.

If price is above a rising VWAP with high volume, institutions are accumulating.

## VWAP Breakout (Momentum Strategy)

- **The Setup**: Price consolidates near the VWAP line, then breaks out with a high-volume candle.
- **The Bias**: Trend continuation; the market sentiment has shifted, and buyers are now paying a premium.
- **The Target**: The +1 SD or +2 SD upper bands.

Breakouts are most powerful when the "Band Squeeze" (SD bands narrowing) precedes the move.

## VWAP Mean Reversion (Reversal Strategy)

- **The Setup**: Price stretches rapidly to the ?2 SD band without a sustained trend.
- **The Bias**: Counter-trend; the price is "overextended" and likely to snap back to the VWAP midline.
- **The Target**: The VWAP Baseline (Fair Value).

Mean reversion requires an exhaustion signal (e.g., a Shooting Star or Pin Bar) at the extreme band.

## Entry Setup

### Primary VWAP Reclaim Setup

- Price drops below the VWAP baseline (trap/stop run)
- Volume expands as price quickly snaps back and closes **above** VWAP
- This "reclaim" indicates that sellers failed and buyers are in control
- **Trigger**: The close of the reclaim candle or a limit order at the VWAP line

### Trade Checklist

- Has the market been open for at least 30-60 minutes?
- Is the VWAP line sloping in the direction of your trade?
- Is volume expanding as price approaches or breaks VWAP?
- Is price currently at an extreme (?2 SD) or at fair value (Baseline)?
- Is there a clear recent pivot low to place the stop below?

### Alternate Setups

- `Band-to-Band Play` - Enter at the -2 SD band with a target at the VWAP Baseline or +2 SD band (high R/R)
- `Pullback to VWAP` - In a strong uptrend, wait for price to touch the VWAP line and show a bullish rejection
- `SD Band Squeeze` - Enter when price breaks out of a very narrow SD band consolidation

### Reject The Trade If

- it is the first 15 minutes of the session (too much noise)
- the VWAP line is completely flat and price is chopping through it repeatedly
- volume is declining during the breakout attempt
- price is already at the +2 SD band (extremely overextended for a long entry)
- there is a major news event (e.g., FOMC) that will reset the intraday structure

## Exit Setup

- `Target 1` - Close 50% at the **+1 SD Band** or the **VWAP Baseline** (if mean reverting)
- `Target 2` - Close the remainder at the **+2 SD Band**
- `Structural Exit` - Exit fully if price closes back on the opposite side of the VWAP line
- `Climax Exit` - Exit if volume spikes to a daily high while price is at the ?2 SD band

### Practical Exit Sequence

1. Move stop to breakeven once price moves away from the VWAP baseline.
2. Scale out at the ?1 SD level to lock in gains.
3. Trail the remaining position using the `VWAP line` as a hard stop.
4. Exit fully if a high-volume reversal candle forms at the ?2 SD extreme.

## Risk Management

### Stop Loss Placement

- **VWAP Stop**: Placed 0.5% or `1 ATR` below the VWAP baseline when long.
- **Extreme Stop**: Placed slightly below the -2 SD band when playing a mean reversion long.

### Position Management

- `Standard Deviation Risk` - The distance between bands expands with volatility; adjust position size accordingly.
- `Session Context` - Be cautious of holding VWAP trades into the market close (3:30 PM - 4:00 PM), as rebalancing flows can cause random spikes.
- `R/R Ratio` - Ensure the distance to the VWAP baseline or the next SD band offers at least `1:2` R/R.

### Main Failure Mode

The "Choppy VWAP" is the biggest risk. On low-volume days, price will oscillate around the VWAP line without reaching the SD bands or trending. This results in multiple small losses. Success with VWAP requires **Volume Confirmation** and a **Clear Slope** in the baseline.

## Parameters

- `vwap_type` - Intraday (Reset Daily)
- `sd_multipliers` - `1.0, 2.0`
- `anchored_point` - Session Open (9:30 AM EST)

## Common Mistakes

- buying at the +2 SD band because "the trend is strong" (entering at exhaustion)
- ignoring the volume required to validate a VWAP breakout
- trading VWAP on a 1-hour or daily chart (VWAP is an intraday-specific tool)
- holding through a VWAP cross because "it will come back"
- failing to account for the "lunchtime lull" (12:00 PM - 1:30 PM) when VWAP signals are less reliable

## Continue Exploring

Previous: [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)

Next: [Supertrend Strategy Guide](assistant:supertrend)
