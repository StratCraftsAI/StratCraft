# DATA_001: Alpaca US Equities Provider

**Status**: Discussion
**Priority**: High
**Parent**:  (Data Source Distribution Strategy)

## Goal

Implement AlpacaProvider for US equities minute-level data via `IDataProvider` interface.

## Decisions

### 1. API Call Pattern: TypeScript REST -- DECIDED

**Decision: TypeScript REST (Direct HTTP)**

Alpaca Market Data API v2 is a clean REST API with simple JSON response. Unlike yfinance (which wraps pandas/Yahoo internals and requires pandas ecosystem), Alpaca needs no Python dependency. TypeScript `fetch` with `next_page_token` pagination loop is straightforward.

```
AlpacaProvider.queryOHLCV()
    -> fetch('https://data.alpaca.markets/v2/stocks/{symbol}/bars')
    -> paginate via next_page_token
    -> parse JSON -> OHLCVRow[]
```

### 2. Data Flow: On-Demand First -- DECIDED

**Decision: On-Demand (Option A) as foundation**

Existing `data:ensure` + `ParquetCacheService` already implements:
- First request -> Alpaca API -> OHLCVRow[] -> write Parquet cache
- Subsequent requests -> local Parquet (offline)

Bulk Download UI (Option B) deferred to future Data Manager enhancement.

### 3. Multi-Timeframe Aggregation Architecture -- DECIDED

**Decision: Strategy Pattern -- centralized orchestrator + provider-registered aggregation strategies**

#### Problem

QuantNexus backtest framework supports multi-timeframe strategies. Current `data:ensureMultiTimeframe` calls `provider.queryOHLCV()` independently per timeframe. This works for ClickHouse (server-side SQL) but is wasteful for Alpaca (5 overlapping API calls).

Current issues found in codebase:
- No centralized aggregation mechanism
- No `baseInterval` concept in `ProviderCapabilities`
- Hardcoded default `'clickhouse'` in 4 places in `data-handlers.ts`
- Each provider must independently handle all intervals

#### Key Insight

Different providers have fundamentally different aggregation characteristics:

| Provider | Raw Data | Aggregation Method | Where |
|---|---|---|---|
| **ClickHouse (forex)** | Tick (bid/ask) | SQL `GROUP BY` with forex trading day (17:00 EST boundary) | Server-side |
| **ClickHouse (stock)** | OHLCV | Direct query, no aggregation | Server-side |
| **YFinance** | OHLCV per interval | yfinance library handles natively | Library-side |
| **Alpaca** | OHLCV 1m base | Group N bars, standard OHLCV merge | Local |
| **Dukascopy (future)** | Tick | Tick-to-OHLCV conversion | Local |
| **CCXT (future)** | OHLCV 1m base | Group N bars, standard OHLCV merge | Local |

A single static aggregation function cannot cover all cases. The aggregation algorithm varies by data source format and market conventions.

#### Architecture: Strategy Pattern

```
apps/desktop/src/main/services/data-providers/
  aggregation/
    types.ts                       # IAggregationStrategy interface
    aggregation-service.ts         # Centralized orchestrator (singleton)
    strategies/
      standard-ohlcv-strategy.ts   # OHLCV 1m -> higher intervals (Alpaca, CCXT)
      tick-to-ohlcv-strategy.ts    # Tick -> OHLCV (Dukascopy, future)
```

**1. Strategy Interface:**

```typescript
interface IAggregationStrategy {
  /**
   * Aggregate source-interval bars into target-interval bars.
   * Input: OHLCVRow[] sorted by timestamp ASC at source interval.
   * Output: OHLCVRow[] sorted by timestamp ASC at target interval.
   */
  aggregate(
    bars: OHLCVRow[],
    sourceInterval: string,
    targetInterval: string
  ): OHLCVRow[];
}
```

**2. Built-in Strategies:**

```typescript
// Standard OHLCV -> OHLCV aggregation (Alpaca, CCXT, any OHLCV-based provider)
class StandardOHLCVStrategy implements IAggregationStrategy {
  aggregate(bars, sourceInterval, targetInterval) {
    // Group bars by target interval boundary
    // Per group: open=first.open, high=max(highs), low=min(lows),
    //            close=last.close, volume=sum(volumes)
    // 5m/15m/30m: floor timestamp to N-minute boundary
    // 1h: floor to hour
    // 1d: group by calendar date
  }
}

// Tick -> OHLCV aggregation (Dukascopy, future tick providers)
class TickToOHLCVStrategy implements IAggregationStrategy {
  aggregate(ticks, sourceInterval, targetInterval) {
    // Different algorithm: tick data has different semantics
    // open=first tick price, close=last tick price
    // May use bid, ask, or mid price depending on market convention
  }
}
```

**3. Centralized Orchestrator:**

```typescript
class AggregationService {
  private strategies = new Map<string, IAggregationStrategy>();

  // Register named strategies at startup
  registerStrategy(name: string, strategy: IAggregationStrategy): void;

  // Core method: called by data:ensureMultiTimeframe
  async ensureMultiTimeframe(
    provider: IDataProvider,
    symbol: string,
    timeframes: string[],
    startDate: string,
    endDate: string,
    cache: ParquetCacheService
  ): Promise<DataFeeds> {

    const caps = provider.capabilities;

    if (!caps.baseInterval) {
      // --- NATIVE MODE (ClickHouse, YFinance) ---
      // Provider handles each interval independently
      for (const tf of timeframes) {
        // check cache -> provider.queryOHLCV(symbol, tf, ...) -> write cache
      }
      return dataFeeds;
    }

    // --- AGGREGATE MODE (Alpaca, CCXT, Dukascopy) ---
    // Step 1: Fetch base interval (download complete, then proceed)
    const baseRows = await provider.queryOHLCV(symbol, caps.baseInterval, startDate, endDate);
    // write base to cache

    // Step 2: Aggregate to each target via registered strategy
    const strategyName = caps.aggregationStrategy || 'standard';
    const strategy = this.strategies.get(strategyName);

    for (const tf of timeframes) {
      if (tf === caps.baseInterval) continue;  // already cached
      const aggregated = strategy.aggregate(baseRows, caps.baseInterval, tf);
      // write aggregated to cache
    }

    return dataFeeds;
  }
}
```

**4. Extended ProviderCapabilities:**

```typescript
interface ProviderCapabilities {
  assetTypes: ReadonlyArray<'forex' | 'stock' | 'crypto' | 'etf' | 'index'>;
  intervals: string[];
  maxLookback?: Record<string, string>;
  requiresAuth: boolean;
  supportsSearch: boolean;

  // NEW: Aggregation control
  baseInterval?: string;           // null = native mode, '1m' = aggregate from 1m
  aggregationStrategy?: string;    // 'standard' | 'tick' | custom name (default: 'standard')
}
```

**5. Provider Registration Example:**

```typescript
// Alpaca: fetch 1m, aggregate locally via standard strategy
new AlpacaProvider()  // capabilities.baseInterval = '1m', aggregationStrategy = 'standard'

// ClickHouse: native intervals, no local aggregation
new ClickHouseProvider()  // capabilities.baseInterval = undefined (native mode)

// YFinance: native intervals via python library
new YFinanceProvider()  // capabilities.baseInterval = undefined (native mode)

// Dukascopy (future): fetch tick, aggregate via tick strategy
new DukascopyProvider()  // capabilities.baseInterval = 'tick', aggregationStrategy = 'tick'
```

#### Aggregation Timing: Post-Download

Aggregation runs AFTER the full base download completes, not during. Reasons:
- **Boundary integrity**: Aggregation requires complete interval boundaries. Paginated batches may split an interval across pages.
- **Memory is trivial**: ~982,800 bars x 56 bytes = ~55 MB.
- **Aggregation is instant**: Millisecond-level in-memory computation. Bottleneck is network.
- **Clean separation**: Download -> Cache -> Aggregate. No cross-concern complexity.

#### Decision Flow Diagram

```
data:ensureMultiTimeframe(['1m', '5m', '1h', '1d'], provider='alpaca')
    |
    v
AggregationService.ensureMultiTimeframe()
    |
    v
Check provider.capabilities.baseInterval
    |
    +-- baseInterval = undefined (ClickHouse, YFinance)
    |       -> NATIVE MODE: fetch each timeframe independently
    |       -> provider.queryOHLCV(symbol, '5m', ...)
    |       -> provider.queryOHLCV(symbol, '1h', ...)
    |       -> provider.queryOHLCV(symbol, '1d', ...)
    |
    +-- baseInterval = '1m' (Alpaca, CCXT)
    |       -> AGGREGATE MODE:
    |       -> Step 1: provider.queryOHLCV(symbol, '1m', ...) [full download]
    |       -> Step 2: strategy.aggregate(rows, '1m', '5m')
    |       ->         strategy.aggregate(rows, '1m', '1h')
    |       ->         strategy.aggregate(rows, '1m', '1d')
    |
    +-- baseInterval = 'tick' (Dukascopy future)
            -> AGGREGATE MODE with 'tick' strategy:
            -> Step 1: provider.queryOHLCV(symbol, 'tick', ...)
            -> Step 2: tickStrategy.aggregate(ticks, 'tick', '1m')
            ->         tickStrategy.aggregate(ticks, 'tick', '1h')
    |
    v
Cache each timeframe as independent Parquet file
    |
    v
Return dataFeeds: { '1m': {path, bars}, '5m': {path, bars}, ... }
```

### 4. Local Storage Format: Parquet -- DECIDED

**Decision: Parquet (maintain current architecture)**

Parquet is the correct choice for OHLCV data storage:
- Zero-copy to NumPy via Apache Arrow (V3 Executor requirement)
- Columnar format optimized for analytical workloads
- Excellent compression (~50 MB per symbol for 10 years 1m data)
- Already implemented via `ParquetCacheService`

SQLite is not suitable for this use case -- row-oriented storage breaks the zero-copy pipeline and adds unnecessary conversion overhead for the C++ Executor.

### 5. Symbol Date Range Detection: Boundary Probe -- DECIDED

**Decision: 2-request boundary probe via Alpaca bars API**

**Context:** `BacktestDataConfigPanel` auto-updates start/end date when user selects a symbol. Each provider implements `getSymbolDateRange(symbol)`. Alpaca has no dedicated "data availability" API, unlike ClickHouse (SQL min/max) or YFinance (`Ticker.info['firstTradeDateMilliseconds']`).

**Implementation:**

```typescript
async getSymbolDateRange(symbol: string): Promise<{ startTime: string | null; endTime: string | null }> {
  // Request 1: Find earliest available bar
  // Query from far past (2015-01-01) with limit=1, ascending
  const earliest = await this.fetchBars(symbol, {
    start: '2015-01-01T00:00:00Z',
    timeframe: '1Day',
    limit: 1,
  });

  // Request 2: Find latest available bar
  // Query up to now with limit=1, descending (sort=desc)
  const latest = await this.fetchBars(symbol, {
    end: new Date().toISOString(),
    timeframe: '1Day',
    limit: 1,
    sort: 'desc',
  });

  return {
    startTime: earliest.bars[0]?.t?.split('T')[0] || null,
    endTime: latest.bars[0]?.t?.split('T')[0] || null,
  };
}
```

**Cost:** 2 lightweight API requests (1 bar each), negligible latency.

**Flow in BacktestDataConfigPanel:**

```
User selects AAPL from Alpaca provider
    -> handleSymbolSelect()
    -> searchSymbols result has no startTime/endTime
    -> fallback: getSymbolDateRange('AAPL')
    -> AlpacaProvider: 2 probe requests (earliest + latest 1Day bar)
    -> returns { startTime: '2016-03-17', endTime: '2026-02-10' }
    -> UI updates date pickers
```

## Download Capacity Analysis

### 10 Years 1-Minute Data Per Symbol

| Parameter | Value |
|---|---|
| Trading days per year | ~252 |
| 10-year trading days | ~2,520 |
| 1m bars per day | 390 (6.5h x 60min, regular hours) |
| **Total 1m bars (10 years)** | **~982,800** |

### Alpaca API Limits (Free Plan)

| Parameter | Value |
|---|---|
| Max bars per request | 10,000 |
| Rate limit | 200 requests/min |
| Feed | IEX (regular hours only) |
| History depth | ~10 years |

### Download Time Estimation

```
Pagination:  982,800 / 10,000 = ~99 requests
Rate limit:  99 / 200 req/min = ~30 seconds (theoretical minimum)
With network latency + JSON parsing: ~1-3 minutes per symbol
```

### Storage Size Estimation

```
JSON transfer:    ~150 bytes/bar x 982,800 = ~147 MB (network)
Parquet (1m):     ~30-50 MB per symbol (compressed)
Aggregated (all): ~35-55 MB per symbol (1m + 5m + 15m + 1h + 1d)
```

**Conclusion:** Downloading 10 years of 1m data is fully feasible. ~99 paginated requests, ~1-3 minutes per symbol, ~50 MB local storage. Aggregated timeframes add minimal overhead since higher intervals compress to very small files.

## Alpaca API Reference

**Endpoint**: `GET /v2/stocks/{symbol}/bars`

**Base URL**: `https://data.alpaca.markets` (free plan)

**Authentication**: `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers

**Parameters**:
| Param | Example | Note |
|---|---|---|
| timeframe | 1Min, 5Min, 1Hour, 1Day | Alpaca format |
| start | 2020-01-01T00:00:00Z | RFC3339 |
| end | 2024-01-01T00:00:00Z | RFC3339 |
| limit | 10000 | Max per page |
| page_token | (string) | Pagination cursor |
| feed | iex / sip | iex = free, sip = paid |
| sort | asc / desc | Default asc |

**Response**:
```json
{
  "bars": [
    { "t": "2024-01-02T09:30:00Z", "o": 150.0, "h": 151.0, "l": 149.5, "c": 150.5, "v": 12345 }
  ],
  "next_page_token": "..."
}
```

## Interval Mapping

| QuantNexus | Alpaca |
|---|---|
| 1m | 1Min |
| 5m | 5Min |
| 15m | 15Min |
| 30m | 30Min |
| 1h | 1Hour |
| 1d | 1Day |

## API Key Storage

User must provide Alpaca API key + secret. Storage options:
- Electron Store (encrypted, existing infrastructure)
- Plugin Settings ( pattern)

TBD based on auth-aware UI gating.

## Pre-requisite Issues (Found During Investigation)

Issues in current codebase that must be addressed before or alongside AlpacaProvider:

### P1. Hardcoded Default Provider 'clickhouse' (4 places)

`data-handlers.ts` uses `config.provider || 'clickhouse'` in:
- `data:ensure` (line 163)
- `data:ensureMultiTimeframe` (line 281)
- `data:searchSymbols` (line 489)
- `data:getSymbolDateRange` (line 518)

**Impact:** All unspecified-provider requests fail when ClickHouse is unavailable.
**Fix:** Use `DataProviderManager.getDefaultProvider()` or require explicit provider selection from UI.

### P2. No Aggregation Orchestration

Current `data:ensureMultiTimeframe` calls `provider.queryOHLCV()` per timeframe independently. No awareness of `baseInterval` or aggregation strategies.

**Fix:** Implement `AggregationService` as designed in Section 3 above.

### P3. No `baseInterval` in ProviderCapabilities

Current `ProviderCapabilities` interface lacks `baseInterval` and `aggregationStrategy` fields. The handler cannot distinguish native-interval providers from base-aggregate providers.

**Fix:** Extend `ProviderCapabilities` interface as designed in Section 3.

### P4. Parquet Cache Has No Provider Isolation

Cache filename: `{symbol}_{interval}_{start}_{end}.parquet`. No provider ID in the path. Different providers returning different data for the same symbol/interval will overwrite each other.

**Fix:** Include provider ID in cache path: `{provider}/{symbol}_{interval}_{start}_{end}.parquet`.

### P5. Interval Support Inconsistency

| Provider | Has but other lacks |
|---|---|
| ClickHouse | `2h`, `4h` |
| YFinance | `1w`, `1M` |

Not a blocker, but UI should respect each provider's `capabilities.intervals` for validation.

## Action Items

**Decisions:**
- [x] Decide: TypeScript REST (decided)
- [x] Decide: On-Demand data flow (decided)
- [x] Decide: Multi-timeframe aggregation -- Strategy Pattern (decided)
- [x] Decide: Local storage format -- Parquet (decided)
- [x] Decide: Symbol date range detection -- boundary probe (decided)
- [ ] Decide: API key storage mechanism

**Pre-requisites (fix existing issues):**
- [ ] P1: Replace hardcoded `'clickhouse'` default in data-handlers.ts
- [ ] P2: Implement AggregationService orchestrator
- [ ] P3: Extend ProviderCapabilities with baseInterval + aggregationStrategy
- [ ] P4: Add provider ID to Parquet cache path

**Implementation:**
- [ ] Implement StandardOHLCVStrategy (1m -> 5m/15m/30m/1h/1d)
- [ ] Implement AlpacaProvider (queryOHLCV, getSymbolDateRange, searchSymbols)
- [ ] Register AlpacaProvider + StandardOHLCVStrategy in startup
- [ ] Test with real Alpaca API key
- [ ] Future: TickToOHLCVStrategy (for Dukascopy)
- [ ] Future: Data Manager UI for bulk download
