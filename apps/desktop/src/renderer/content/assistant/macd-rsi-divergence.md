# MACD + RSI Divergence Strategy

A momentum-reversal strategy that identifies high-probability trend changes by catching price-momentum divergence confirmed by a MACD signal-line crossover.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: Liquid equities, major forex pairs, and crypto assets that exhibit clear swing structure and distinct momentum cycles
Best Timeframe: `4h` and `1D` provide the most reliable divergence signals; `15m` or `1h` can be used for tactical entries but produce more noise
Risk Warning: Divergence is a warning of exhaustion, not an immediate signal to trade. Momentum can stay divergent for a long time during strong parabolic moves, leading to premature entries
:::

## Core Idea

- `Price Action` identifies the structural trend (Lower Lows or Higher Highs).
- `RSI Divergence` signals that the underlying momentum is failing to support the price move.
- `MACD Confirmation` provides the structural trigger to enter once the reversal begins to materialize.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
- [RSI + Moving Average Strategy Guide](assistant:rsi-ma)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)
- [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
- [VWAP Strategy Guide](assistant:vwap-strategy)
- [Supertrend Strategy Guide](assistant:supertrend)
- [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)

## Decision Flow

1. Identify a mature trend showing signs of exhaustion (e.g., a series of Lower Lows).
2. Watch for `RSI` to form a Higher Low while price forms a Lower Low (Bullish Divergence).
3. Confirm that the `MACD Histogram` is shrinking and the MACD line is curling toward its signal line.
4. Enter when the MACD line crosses the signal line and RSI breaks its own local trendline or the `50` midline.
5. Exit when the counter-move stalls, a bearish divergence forms, or price breaks the new structural support.

## Indicator Stack

- `MACD(12, 26, 9)` provides the structural entry trigger and trend confirmation
- `RSI(14)` identifies momentum exhaustion and divergence setups
- `RSI 50 Midline` acts as a momentum-regime filter

## Market Read

- `Bullish Divergence` - Price makes a Lower Low while RSI makes a Higher Low
- `Bearish Divergence` - Price makes a Higher High while RSI makes a Lower High
- `Momentum Acceleration` - MACD histogram expanding away from zero
- `Momentum Contraction` - MACD histogram shrinking toward zero (early warning)

A divergence setup is a "lead" indicator. MACD is the "lag" indicator that confirms the lead signal is actually turning.

## RSI Read

- `Oversold (<30)` - Look for bullish divergence as price makes a final push lower
- `Overbought (>70)` - Look for bearish divergence as price makes a final push higher
- `Midline (50)` - A break above 50 confirms the shift from bearish to bullish momentum

Divergence is most powerful when it starts in an extreme zone (overbought/oversold) and resolves back toward the midline.

## MACD Read

- `MACD Crossover` - The primary trigger; a bullish cross below zero is the classic entry
- `Histogram Slopes` - Increasing slopes confirm the divergence is resolving into a new move
- `Zero Line Cross` - Confirms the broader trend shift from bearish to bullish

The MACD line crossing the signal line is the "go" signal. Without it, price can continue to drift lower despite the RSI divergence.

## Divergence Read

- `Regular Bullish` - Lower Low in price + Higher Low in RSI (Reversal signal)
- `Regular Bearish` - Higher High in price + Lower High in RSI (Reversal signal)
- `Hidden Bullish` - Higher Low in price + Lower Low in RSI (Continuation signal)

This strategy focuses primarily on **Regular Divergence** for catching trend reversals.

## Entry Setup

### Primary Bullish Setup

- Price makes a Lower Low (LL) compared to a recent swing
- RSI makes a Higher Low (HL) during the same period
- MACD histogram has already started to contract (shorter red bars)
- **Trigger**: MACD line crosses above the signal line

### Trade Checklist

- Is there a clear Regular Bullish Divergence on the RSI?
- Is the MACD histogram contracting?
- Has the MACD signal-line crossover occurred?
- Is there a clear Swing Low to place the stop below?
- Is the RSI still in a position to expand toward the 50 midline?

### Alternate Setups

- `RSI Trendline Break` - Draw a trendline on the RSI peaks; enter when the divergence resolves and the RSI trendline breaks
- `Double Divergence` - Price makes three Lower Lows while RSI makes three Higher Lows (very strong signal)
- `50-Midline Entry` - Wait for the divergence and MACD cross, then enter only when RSI crosses above 50

### Reject The Trade If

- the divergence is "weak" (RSI is almost flat)
- MACD is still expanding strongly in the direction of the original trend
- price is plunging vertically without any signs of structural slowing
- the divergence occurs in the middle of a range without a clear prior trend
- there is major fundamental news due that could override technical exhaustion

## Exit Setup

- `Initial Target` - Exit 50% when MACD reaches the zero line or price hits the first major resistance
- `Momentum Exit` - Exit when MACD signal line crosses back in the opposite direction
- `Structure Exit` - Exit if price breaks the Swing Low that formed the divergence
- `Counter-Divergence` - Fully exit if an opposite (bearish) divergence begins to form

### Practical Exit Sequence

1. Move stop to breakeven once price reaches a `1:1` risk/reward ratio.
2. Close half the position at the first structural resistance or RSI `60-70` zone.
3. Trail the remaining position using the `MACD signal line` or a short-term EMA.
4. Exit fully if a bearish MACD cross occurs at a higher timeframe resistance.

## Risk Management

- `Stop Loss` - Placed slightly below the Divergent Swing Low (the LL in price)
- `Take Profit` - Target previous swing highs or major Fibonacci retracement levels (e.g., 50% or 61.8%)
- `ATR Buffer` - Add a small buffer to the stop loss to avoid getting stopped out by minor volatility
- `Risk/Reward` - Aim for at least `1:2` given the reversal nature of the trade

### Main Failure Mode

The most common mistake is entering on the divergence alone without waiting for the MACD crossover. Divergence can persist for multiple "legs" of a trend; the MACD crossover acts as the filter that ensures the momentum has actually shifted before you commit capital.

## Parameters

- `macd_fast` - `12`
- `macd_slow` - `26`
- `macd_signal` - `9`
- `rsi_period` - `14`
- `divergence_lookback` - `60` candles

## Common Mistakes

- "Catching a falling knife" by entering before the MACD crossover confirms the turn
- Ignoring the overall trend context (counter-trend reversals have lower win rates)
- Using too short a lookback for divergence (missing the broader structural shift)
- Keeping the stop too tight and getting "hunted" at the swing low
- Failing to take profits when momentum stalls at the zero line

## Continue Exploring

Previous: [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)

Next: [EMA Crossover Strategy Guide](assistant:ema-crossover)
