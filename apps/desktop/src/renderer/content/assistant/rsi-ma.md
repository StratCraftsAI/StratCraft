# RSI + Moving Average Strategy

A momentum-plus-trend strategy that uses RSI to time pullbacks and moving averages to decide whether the broader trend still deserves the trade.

## Reference Note

This strategy is provided as an educational example inspired by common public technical-analysis concepts and reference material. It is for research and product demonstration only and does not constitute investment advice.

:::info-cards
Best Market: Trending equities, index futures, liquid crypto majors, and other instruments that regularly form pullback-and-continuation structure
Best Timeframe: `1h`, `4h`, and `1D` are usually cleaner; lower timeframes create more noise around the RSI `50` midline
Risk Warning: This setup degrades fast in sideways ranges. RSI oversold does not mean immediate reversal, and a flat or broken `SMA(50)` usually means the trend filter is no longer protecting you
:::

## Core Idea

- `RSI` times the pullback.
- `Moving averages` decide whether the setup is structurally valid.
- The goal is not to buy every dip. The goal is to buy momentum resets inside an intact trend.

## Recommended Reading

- [Strategy Studio Guide](assistant:strategy-overview)
- [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
- [MACD + RSI Divergence Strategy Guide](assistant:macd-rsi-divergence)
- [EMA Crossover Strategy Guide](assistant:ema-crossover)
- [Ichimoku Cloud Strategy Guide](assistant:ichimoku-cloud)
- [Fibonacci Trend Strategy Guide](assistant:fibonacci-trend)
- [VWAP Strategy Guide](assistant:vwap-strategy)
- [Supertrend Strategy Guide](assistant:supertrend)
- [Dual MA + Volume Strategy Guide](assistant:dual-ma-volume)

## Decision Flow

1. Check whether price is still above `SMA(50)` and `SMA(200)`.
2. Use `EMA(20)` and `SMA(50)` to locate likely pullback support.
3. Wait for RSI to reset toward `30` or the `50` midline.
4. Enter only when momentum turns back up and structure still holds.
5. Exit when RSI overheats, short-term support fails, or the trend filter breaks.

## Indicator Stack

- `RSI(14)` tracks momentum
- `EMA(20)` tracks short-term pullbacks
- `SMA(50)` is the medium-term trend filter
- `SMA(200)` is the long-term trend filter

## Market Read

- `Bullish structure` - price above `SMA(50)` and `SMA(200)`, with `SMA(50)` rising
- `Bearish structure` - price below `SMA(50)` and `SMA(200)`, with `SMA(50)` falling
- `Transition regime` - moving averages flattening, crossing, or losing slope

If price keeps chopping across both moving averages while RSI keeps snapping around `50`, signal quality is usually poor.

## RSI Read

- `Below 30` - momentum is stretched enough to look for pullback completion
- `Around 50` - momentum is neutral, useful for continuation setups
- `Above 70` - the move is extended and profit protection matters more than fresh entries

An oversold RSI inside an uptrend can be opportunity. An oversold RSI below a falling `SMA(50)` is often just weakness.

## Moving Average Read

- `EMA(20)` keeps the strategy responsive enough to catch pullback entries
- `SMA(50)` is the main directional filter and often acts as medium-term support
- `SMA(200)` helps avoid bullish pullback trades in weak long-term structure

Together, they help separate a healthy retracement from a breakdown.

## Entry Setup

### Primary Long Setup

- Price remains above a rising `SMA(50)`
- RSI drops below `30` or resets toward the `50` midline
- Price approaches `EMA(20)` or `SMA(50)` support
- RSI turns back up within `1` to `3` candles of support holding

### Trade Checklist

- Is price still above `SMA(50)`?
- Is `SMA(50)` still sloping upward?
- Did RSI reset into a useful zone?
- Did price react constructively at `EMA(20)` or `SMA(50)`?
- Is the invalidation level clear and close enough?

### Alternate Long Setups

- `RSI Midline Bounce` - RSI pulls back toward `50`, then resumes higher while price remains above `SMA(50)`
- `Golden Cross Confirmation` - `SMA(50)` crosses above `SMA(200)` and RSI is already back above `50`
- `Bullish Divergence At MA Support` - price makes a lower low near support while RSI makes a higher low

### Reject The Trade If

- price is already below `SMA(50)` and trying to reclaim it from underneath
- `SMA(50)` is flat after long consolidation
- RSI is oversold because the trend is breaking, not because it is pausing
- volatility is expanding sharply against the setup
- the reward target is too small relative to the stop

## Exit Setup

- `Primary exit` - RSI pushes above `70` and price then loses `EMA(20)` support
- `Momentum exit` - RSI breaks back below `50` after the trade has moved in your favor
- `Structure exit` - price closes below `SMA(50)` and the slope starts flattening or turning down
- `Trend reversal exit` - `Death Cross` forms and RSI falls below `50`

### Practical Exit Sequence

1. Scale out when RSI is extended and price approaches obvious resistance.
2. Tighten the stop once price starts riding above `EMA(20)`.
3. Exit faster if RSI rolls over and price loses short-term support together.
4. Fully exit if the medium-term structure breaks.

## Risk Management

- `Stop loss` - below the recent swing low or roughly `1 ATR` below `SMA(50)`
- `Take profit` - next resistance zone or at least `1:2` risk/reward
- `Position size` - risk no more than `2%` of portfolio equity
- `Trailing stop` - follow `EMA(20)` once the trade is in profit

### Main Failure Mode

The classic mistake is treating every RSI oversold signal as a buy. If the moving-average filter is broken, RSI is no longer giving you a pullback entry. It is just describing persistent weakness.

## Parameters

- `rsi_period` - usually `14`
- `ema_fast_period` - usually `20`
- `sma_trend_period` - usually `50`
- `sma_long_period` - usually `200`
- `rsi_overbought` - usually `70`
- `rsi_oversold` - usually `30`

## Common Mistakes

- buying the first RSI oversold print without waiting for momentum to turn up
- ignoring `SMA(50)` slope and focusing only on price location
- treating `EMA(20)` as strong support in a weak market regime
- entering too late after RSI has already fully recovered
- refusing to exit when price breaks structure because the trade still "looks oversold"

## Continue Exploring

Previous: [Strategy Studio Guide](assistant:strategy-overview)

Next: [Bollinger Bands + MACD Strategy Guide](assistant:bollinger-macd)
