# Supertrend Strategy

A high-momentum trend-following system that identifies market direction and provides a volatility-adjusted dynamic trailing stop using a single, intuitive trend line.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: Strongly trending markets (equities, index futures, and trending crypto pairs) that exhibit sustained directional momentum
Best Timeframe: `1h`, `4h`, and `1D` are the standard domains; lower timeframes like `5m` or `15m` create frequent color "flips" and whipsaws
Risk Warning: Supertrend is purely a trend-following tool. In sideways, range-bound markets, the indicator will flip back and forth repeatedly (Red to Green to Red), leading to multiple small losses
:::

## Core Idea

- `Trend Color` (Green/Red) provides an immediate visual gauge of market direction.
- `ATR Volatility` adjusts the distance of the stop line based on current market noise.
- `Price Close` is the primary trigger; the trend only flips when price closes on the opposite side of the line.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
- [RSI + Moving Average Strategy Guide](assistant:rsi-ma)
- [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)
- [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
- [VWAP Strategy Guide](assistant:vwap-strategy)

## Decision Flow

1. Identify the current Supertrend color and slope (Green = Bullish, Red = Bearish).
2. Confirm the trend with secondary indicators (e.g., RSI > 50 or Price > EMA 50).
3. Wait for a **Trend Flip** (price closes above/below the line) to trigger an entry.
4. Use the Supertrend line as a mechanical, self-calibrating **Trailing Stop**.
5. Exit immediately when the line color flips to the opposite side.

## Indicator Stack

- `Supertrend (14, 3)` - The primary trend gauge and trailing stop
- `ATR (14)` - The underlying volatility measurement used for the Supertrend calculation
- `EMA (50)` - Provides long-term trend confirmation to filter Supertrend flips

## The Importance of ATR

The Average True Range (ATR) is the engine behind the Supertrend. It ensures the indicator is "volatility-adjusted":
- **High Volatility**: The line moves further away from price to avoid accidental stops during spikes.
- **Low Volatility**: The line tightens to price to protect gains as momentum slows.

The multiplier (e.g., 3.0) is applied to the ATR to determine exactly how much "breathing room" the trend is allowed.

## Supertrend Parameters

- **ATR Period (Default: 14)**: The lookback window for volatility. Shorter periods are more sensitive; longer periods are smoother.
- **Multiplier (Default: 3.0)**: Determines the distance from price. A lower multiplier (2.0) is aggressive; a higher multiplier (4.0) is conservative.

Adjust these based on the asset's specific volatility profile.

## Entry Setup

### Primary Green Flip Setup

- Supertrend is currently Red (Bearish)
- Price makes a strong move and **closes above** the red line
- Secondary confirmation is bullish (e.g., RSI > 50 or MACD is positive)
- **Trigger**: The close of the candle that flips the line to Green

### Trade Checklist

- Is the price actually closing above the line (not just wicking through it)?
- Is there a clear trend on the higher timeframe (e.g., Daily chart is Green)?
- Is the volume expanding on the flip candle?
- Is price too far away from the line (overextended)?
- Is the market in a known trading range where flips might be false?

### Alternate Setups

- `Pullback to Green Line` - In a sustained uptrend, wait for price to pull back and touch the Green line without closing below it, then buy the rejection.
- `EMA 50 Confluence` - Buy a Green Flip that occurs exactly as price reclaims the EMA 50.
- `Breakout Continuation` - Enter after a consolidation period when the Supertrend remains Green and price breaks a new local high.

### Reject The Trade If

- the Supertrend has been flipping frequently in a tight range (sideways market)
- the flip occurs on very low volume or a narrow-range candle
- price is already "parabolic" and the stop loss (the ST line) is too far away
- the higher timeframe (Daily/Weekly) is clearly in a dominant downtrend
- a major news event is about to create random volatility spikes

## Exit Setup

- **Primary Exit (Color Flip)**: Exit the entire position as soon as price closes on the opposite side, flipping the line color.
- **Secondary Exit (Momentum)**: Close the position if a bearish divergence forms on the RSI while the trend is still Green.
- **Trailing Exit**: The Supertrend line *is* your exit; simply follow the line as it rises (Long) or falls (Short).

### Practical Exit Sequence

1. Set the initial stop loss at the Supertrend line level immediately upon entry.
2. Update the stop loss to the new Supertrend line level at the close of every new candle.
3. Scale out partial profits if price reaches a major horizontal resistance zone.
4. Fully exit when the line flips or price closes below the Green line (for Longs).

## Risk Management

### Trailing Guard Strategy

- The Supertrend line only moves in the direction of the trend; it never moves "backward" (it remains flat or moves up in an uptrend).
- Use this mechanical behavior to remove emotion from stop-loss management.

### Position Management

- `Multiplier Adjustment` - Use a higher multiplier (e.g., 4.0) during high-volatility regimes to prevent being "whipsawed" out of a good trend.
- `R/R Ratio` - Ensure the distance from the entry price to the Supertrend line (the stop) allows for at least a `1:2` R/R target.
- `Trend Filtering` - Only take Long Green Flips if price is above the EMA 200 to ensure you are trading with the macro trend.

### Main Failure Mode

The **"Sideways Saw"** is the primary risk. In a non-trending market, price will oscillate across the line, causing the color to flip repeatedly. This can result in a series of small, consecutive losses. Success requires identifying **Active Trending Regimes** before trusting the flips.

## Parameters

- `atr_period` - `14`
- `multiplier` - `3.0`
- `ema_filter` - `50` or `200`

## Common Mistakes

- buying a Green Flip in a sideways, flat market
- ignoring higher timeframe trend alignment
- entering too late after the price has already moved far beyond the ST line
- failing to move the stop loss manually or automatically to match the ST line
- treating every touch of the line as a reversal instead of waiting for a **Price Close**

## Continue Exploring

Previous: [VWAP Strategy Guide](assistant:vwap-strategy)

Next: [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)
