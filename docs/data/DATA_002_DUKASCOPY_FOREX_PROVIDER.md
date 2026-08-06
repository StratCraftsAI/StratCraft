# DATA_002: Dukascopy Forex & Multi-Asset Provider

**Status**: Discussion
**Priority**: High
**Parent**:  (Data Source Distribution Strategy)

## Goal

Implement DukascopyProvider for forex (primary), crypto, stocks, ETFs, commodities, and indices via `IDataProvider` interface. Zero-authentication data source using `dukascopy-node` npm package.

## Strategic Value

Dukascopy fills a critical gap in the provider matrix:
- **Forex primary source** -- no existing provider covers forex with minute-level data
- **Zero friction** -- no API key, no signup, no cost
- **Deep history** -- forex data from ~2003, crypto from ~2017
- **1000+ instruments** across 10+ asset classes

## Decisions

### 1. API Call Pattern: dukascopy-node npm -- DECIDED

**Decision: Use `dukascopy-node` npm package (Node.js library)**

Unlike Alpaca (clean REST API suitable for direct `fetch`), Dukascopy data is served as compressed binary artifacts from CDN servers. The `dukascopy-node` package handles:
- URL generation for date-range artifacts
- Binary decompression (LZMA)
- Tick-to-OHLCV aggregation at source level
- Batched downloading with configurable pacing

Direct HTTP fetch would require reimplementing binary parsing logic -- no benefit over using the maintained open-source library.

```
DukascopyProvider.queryOHLCV()
    -> dukascopy-node getHistoricalRates({ instrument, dates, timeframe })
    -> returns { timestamp, open, high, low, close, volume }[]
    -> map to OHLCVRow[]
```

### 2. Data Flow: On-Demand -- DECIDED

**Decision: On-Demand (same as Alpaca, reuse existing pipeline)**

Existing `data:ensure` + `ParquetCacheService` pipeline handles:
- First request -> dukascopy-node download -> OHLCVRow[] -> write Parquet cache
- Subsequent requests -> local Parquet (offline)

No new IPC channels required. Full reuse of `data:ensure` and `data:ensureMultiTimeframe`.

### 3. Multi-Timeframe Strategy: Standard OHLCV Aggregation -- DECIDED

**Decision: Aggregate mode with baseInterval='1m', reuse StandardOHLCVStrategy**

Dukascopy-node supports native timeframes (tick, m1, m5, m15, m30, h1, h4, d1, mn1). Two approaches:

**Option A: Native mode** -- fetch each timeframe independently from dukascopy-node
**Option B: Aggregate mode** -- fetch 1m base, aggregate locally via StandardOHLCVStrategy

**Decision: Option B (Aggregate mode)**

Rationale:
- Consistent with Alpaca pattern -- same code path, same aggregation
- Single download per symbol -- avoids redundant CDN artifact fetching
- StandardOHLCVStrategy already tested and proven
- dukascopy-node's internal aggregation is slower than our in-memory strategy for cached data

```typescript
capabilities: {
  baseInterval: '1m',
  aggregationStrategy: 'standard',  // reuse StandardOHLCVStrategy
}
```

Note: Tick-level data (`baseInterval: 'tick'` + `TickToOHLCVStrategy`) deferred to future enhancement. 1m base is sufficient for backtesting use cases.

### 4. Symbol Format: Lowercase Concatenated -- DECIDED

**Decision: Use dukascopy-node native instrument IDs internally, display standard format to user**

Dukascopy instruments use lowercase concatenated format: `eurusd`, `btcusd`, `spyususd`.

```
User sees:    EUR/USD, BTC/USD, AAPL
Internal ID:  eurusd, btcusd, aaborgnok
```

DukascopyProvider translates between display format and internal ID in `searchSymbols()`.

### 5. Symbol Search: Static Instrument Table -- DECIDED

**Decision: Use dukascopy-node built-in instrument metadata for local search**

dukascopy-node ships with a complete instrument table (~1000+ entries) including:
- Instrument ID (e.g., `eurusd`)
- Display name (e.g., `EUR/USD`)
- Asset class (forex, crypto, stock, etc.)
- Historical data start date

No network request needed for symbol search -- pure in-memory filtering with relevance ranking (same pattern as Alpaca ).

### 6. Authentication: None -- DECIDED

**Decision: No authentication required**

```typescript
capabilities: {
  requiresAuth: false,
}
```

No credential storage, no SecureCredentialService integration, no SecretsTab entry.

### 7. Date Range Detection: Instrument Metadata -- DECIDED

**Decision: Use dukascopy-node instrument metadata for startTime, probe for endTime**

dukascopy-node instrument metadata includes `startHourForTicks` (earliest available data timestamp). For endTime, use current date minus 1 day (Dukascopy data is available up to the previous trading day).

```typescript
async getSymbolDateRange(symbol: string) {
  const instrument = findInstrument(symbol);
  return {
    startTime: instrument.startDate,      // from metadata
    endTime: yesterdayDateString(),        // Dukascopy data ~1 day lag
  };
}
```

### 8. Batching Configuration -- DECIDED

**Decision: Conservative defaults to respect Dukascopy servers**

```typescript
const BATCH_SIZE = 5;                    // concurrent downloads per batch
const PAUSE_BETWEEN_BATCHES_MS = 1500;   // pause between batches
```

Large date ranges (e.g., 10 years forex 1m) may involve thousands of artifact downloads. Conservative pacing prevents server-side throttling.

## Reuse Analysis

### 100% Reuse (No Changes)

| Component | File | Reason |
|-----------|------|--------|
| IDataProvider interface | `data-providers/types.ts` | Universal contract |
| StandardOHLCVStrategy | `aggregation/strategies/standard-ohlcv-strategy.ts` | Same 1m->higher aggregation |
| AggregationService | `aggregation/aggregation-service.ts` | Strategy orchestrator |
| ParquetCacheService | `parquet-cache-service.ts` | Provider-isolated cache paths |
| IPC data handlers | `ipc/data-handlers.ts` | All channels work with any provider |
| Preload API | `preload/index.ts` | No new channels needed |
| BacktestDataConfigPanel | Plugin UI | Auto-discovers via `listProviders` |

### Minimal Changes (1-2 Lines)

| Component | File | Change |
|-----------|------|--------|
| Provider Manager | `provider-manager.ts` | Add `instance.register(new DukascopyProvider())` |

### New Implementation

| Component | File | LOC Estimate |
|-----------|------|-------------|
| DukascopyProvider | `data-providers/dukascopy-provider.ts` | ~200 lines |
| npm dependency | `package.json` | `dukascopy-node` |

## Download Capacity Analysis

### Forex 1-Minute Data (EUR/USD, 10 Years)

| Parameter | Value |
|-----------|-------|
| Trading days per year | ~260 (forex: 5.5 days/week) |
| 10-year trading days | ~2,600 |
| 1m bars per day | ~1,440 (24h market) |
| **Total 1m bars (10 years)** | **~3,744,000** |

### Download Characteristics

```
Dukascopy artifacts: hourly compressed binary files
10 years = ~87,600 hourly artifacts (365 * 24 * 10)
Batch size 5, pause 1.5s: ~87,600 / 5 * 1.5s = ~26,280s (~7.3 hours theoretical)
Practical estimate: 15-30 minutes (parallel within batch, small artifact size)
```

### Storage Size Estimation

```
Parquet (1m):     ~80-120 MB per forex symbol (24h market, more bars than stocks)
Aggregated (all): ~90-130 MB per symbol (1m + 5m + 15m + 1h + 1d)
```

## Instrument Categories

| Category | Count | Example IDs | Key Markets |
|----------|-------|-------------|-------------|
| Forex Majors | ~60 | eurusd, gbpusd, usdjpy | All major/minor pairs |
| Forex Crosses | ~290 | eurgbp, audnzd | Cross rates |
| Crypto | ~33 | btcusd, ethusd, ltcusd | Major crypto |
| US Stocks | ~608 | aaborgnok, spyususd | S&P 500 constituents |
| ETFs | ~70 | spyususd | US, EU, HK |
| Commodities | ~30 | xauusd, xagusd | Metals, Energy, Agri |
| Indices | ~40 | usa30idxusd, de30idxeur | Major global indices |

## DukascopyProvider Implementation Sketch

```typescript
export class DukascopyProvider implements IDataProvider {
  readonly id = 'dukascopy';
  readonly name = 'Dukascopy (Free)';
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['forex', 'crypto', 'stock', 'etf', 'index'],
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
    requiresAuth: false,
    supportsSearch: true,
    baseInterval: '1m',
    aggregationStrategy: 'standard',
  };

  async queryOHLCV(symbol, interval, startDate, endDate): Promise<OHLCVRow[]> {
    const { getHistoricalRates } = await import('dukascopy-node');
    const data = await getHistoricalRates({
      instrument: symbol,
      dates: { from: new Date(startDate), to: new Date(endDate) },
      timeframe: 'm1',
      format: 'json',
      batchSize: BATCH_SIZE,
      pauseBetweenBatchesMs: PAUSE_BETWEEN_BATCHES_MS,
    });
    return data.map(bar => ({
      timestamp: Math.floor(bar.timestamp / 1000),  // ms -> s
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  }

  async searchSymbols(query, limit): Promise<ProviderSymbolInfo[]> {
    // Use dukascopy-node built-in instrument list
    // Filter + relevance sort (same pattern as Alpaca )
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    // Lightweight probe: fetch 1 bar of EURUSD
    // No auth check needed
  }

  async getSymbolDateRange(symbol): Promise<{ startTime, endTime }> {
    // Use instrument metadata for startTime
    // yesterday() for endTime
  }
}
```

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Dukascopy CDN throttling | Conservative batch pacing (5 concurrent, 1.5s pause) |
| Large download sizes (forex 24h) | Progress events via existing `data:progress` channel |
| dukascopy-node package maintenance | Package is actively maintained; fallback: fork or reimplement |
| Instrument ID mismatch | Validate against built-in instrument table before API call |

## Related Documents

- Data Source Distribution Strategy (parent)
- DATA_001: Alpaca US Equities Provider (reference implementation)
- Multi-Source Data Provider Interface (IDataProvider)
- Multi-Timeframe Strategy Support

## Action Items

**Implementation:**
- [ ] Install `dukascopy-node` npm dependency
- [ ] Implement `DukascopyProvider` class
- [ ] Register in `DataProviderManager`
- [ ] Test with EUR/USD forex data
- [ ] Test with BTC/USD crypto data
- [ ] Verify aggregation pipeline (1m -> 5m/15m/1h/1d)

**Future Enhancements:**
- [ ] Tick-level base data (`TickToOHLCVStrategy`)
- [ ] Bulk download UI in Data Manager
- [ ] Progress reporting for long downloads
