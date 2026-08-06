# Bollinger Bands + MACD Strategy

A combined momentum-volatility strategy that uses Bollinger Bands to detect compression and MACD to confirm the direction of the breakout.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: Instruments that alternate between consolidation and expansion, including liquid equities, index futures, major crypto pairs, and momentum-driven trend names
Best Timeframe: `1h`, `4h`, and `1D` are usually cleaner; very low timeframes often produce too many weak squeezes and false MACD flips
Risk Warning: A squeeze only tells you volatility is compressed. It does not tell you direction. If MACD confirmation is weak or price fails to expand beyond the bands, breakout attempts can fail quickly
:::

## Core Idea

- `Bollinger Bands` tell you when volatility is contracting or expanding.
- `MACD` tells you whether momentum is confirming the move.
- The setup is strongest when compression ends and momentum agrees with the breakout.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [RSI + Moving Average Strategy Guide](assistant:rsi-ma)
- [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)
- [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
- [VWAP Strategy Guide](assistant:vwap-strategy)
- [Supertrend Strategy Guide](assistant:supertrend)
- [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)

## Decision Flow

1. Check whether Bollinger `bandwidth` is contracting into a squeeze.
2. Watch for price to press against or break beyond the outer bands.
3. Confirm the breakout direction with MACD line, signal line, or histogram expansion.
4. Enter only if volatility expands and momentum agrees.
5. Exit when the move stalls, MACD rolls over, or price mean-reverts back through the middle band.

## Indicator Stack

- `Bollinger Bands(20, 2)` track volatility compression and expansion
- `Bandwidth` measures how narrow or wide the bands are
- `%B` shows where price sits inside the bands
- `MACD(12, 26, 9)` confirms trend and momentum direction

## Bollinger Read

- `Narrow bands` - volatility is compressed and breakout potential is building
- `Wide bands` - volatility has already expanded and the move may be mature
- `Price near upper band` - bullish pressure or overextension, depending on context
- `Price near lower band` - bearish pressure or exhaustion, depending on context

The strategy cares most about the transition from narrow bands to expanding bands.

## MACD Read

- `MACD above signal` - bullish momentum confirmation
- `MACD below signal` - bearish momentum confirmation
- `Histogram expanding` - momentum is strengthening
- `Histogram shrinking` - momentum is fading even if the move is still continuing

A breakout without MACD agreement is often just noise.

## Squeeze Read

- `Squeeze active` - bandwidth is near a recent local minimum
- `Release phase` - bands begin expanding after compression
- `Directional confirmation` - price expansion and MACD direction align

The squeeze is the setup. The breakout plus MACD confirmation is the trigger.

## Entry Setup

### Primary Long Setup

- Bollinger `bandwidth` contracts into a squeeze
- Price pushes through or rides the upper band
- MACD line crosses above the signal line or histogram turns positive
- Expansion follows quickly after compression

### Trade Checklist

- Is bandwidth still near a recent low?
- Is price actually expanding out of compression?
- Is MACD confirming the same direction?
- Is there enough room before the next resistance zone?
- Is the stop still reasonable if the breakout fails?

### Alternate Long Setups

- `Early release` - price starts pressing the upper band before the full breakout and MACD is already improving
- `Retest after breakout` - price breaks out, pulls back toward the middle band, then MACD re-accelerates higher
- `Histogram-led continuation` - price remains strong while the histogram turns positive before a full crossover

### Reject The Trade If

- the bands are already wide and the move is already extended
- price touches the outer band but bandwidth is not actually expanding
- MACD stays flat or diverges against the breakout
- price keeps snapping back inside the bands after breakout attempts
- the breakout runs directly into major overhead resistance

## Exit Setup

- `Momentum exit` - MACD histogram starts declining after the expansion leg
- `Band reaction exit` - price touches the upper band and fails to continue
- `Mean-reversion exit` - price crosses back through the middle band
- `Failure exit` - breakout collapses back inside the bands with MACD losing confirmation

### Practical Exit Sequence

1. Scale out when the move is extended and the histogram begins to flatten.
2. Tighten the stop once price has clearly expanded away from the squeeze.
3. Exit faster if price re-enters the bands and MACD weakens together.
4. Fully exit if price crosses the middle band and the breakout thesis is broken.

## Risk Management

- `Stop loss` - below the breakout candle low, recent range low, or roughly `1 ATR` beyond the invalidation point
- `Take profit` - next resistance zone, measured move, or at least `1:2` risk/reward
- `Position size` - keep risk small because failed squeezes can reverse sharply
- `Re-entry discipline` - avoid repeated immediate re-entries unless compression clearly rebuilds

### Main Failure Mode

The classic mistake is treating every touch of the outer Bollinger Band as a breakout. The real edge comes from compression first, then expansion, then MACD confirmation. Without that sequence, the setup often degrades into random band tagging.

## Parameters

- `bb_period` - usually `20`
- `bb_std` - usually `2.0`
- `macd_fast` - usually `12`
- `macd_slow` - usually `26`
- `macd_signal` - usually `9`
- `squeeze_lookback` - often `20`

## Common Mistakes

- buying the first upper-band touch without checking whether a real squeeze exists
- treating MACD confirmation as optional instead of required
- entering after volatility has already fully expanded
- holding after price re-enters the bands and momentum is fading
- forcing the setup in dead markets where squeezes do not produce real follow-through

## Continue Exploring

Previous: [RSI + Moving Average Strategy Guide](assistant:rsi-ma)

Next: [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
