# DATA_003: CCXT Crypto Provider

**Status**: Discussion
**Priority**: High
**Parent**:  (Data Source Distribution Strategy)

## Goal

Implement CCXTProvider for cryptocurrency OHLCV data via `IDataProvider` interface. Zero-authentication data source using `ccxt` npm package with Binance as default exchange.

## Strategic Value

CCXT fills the crypto gap in the provider matrix:
- **Crypto primary source** -- no existing provider covers crypto with minute-level data
- **Zero friction** -- no API key required for public OHLCV endpoints
- **111+ exchanges** -- Binance, Bybit, OKX, Kraken, Coinbase, etc.
- **24/7 market** -- continuous data, no market hours gaps
- **Largest algo trading community** -- 35k+ GitHub stars, most popular crypto trading library

## Decisions

### 1. API Call Pattern: ccxt npm -- DECIDED

**Decision: Use `ccxt` npm package (TypeScript-native)**

CCXT is the de facto standard library for crypto exchange connectivity. Ships with TypeScript `.d.ts` types. Public OHLCV method (`fetchOHLCV`) requires no API key on major exchanges.

```
CCXTProvider.queryOHLCV()
    -> exchange.fetchOHLCV(symbol, timeframe, since, limit)
    -> returns [timestamp, open, high, low, close, volume][]
    -> map to OHLCVRow[]
```

### 2. Default Exchange: Binance -- DECIDED

**Decision: Binance as default exchange**

| Exchange | Candle Limit | Timeframes | History Depth | Public Access |
|---|---|---|---|---|
| **Binance** | 1000/request | 16 (1s to 1M) | 2017+ | Yes |
| Bybit | 200/request | 13 | 2019+ | Yes |
| OKX | 300/request | 14 | 2019+ | Yes |
| Kraken | 720/request | 9 | 2013+ | Yes |

Binance: highest liquidity, deepest history, most symbols, largest candle limit per request. Future enhancement: user-selectable exchange.

### 3. Multi-Timeframe Strategy: Native Mode -- DECIDED

**Decision: Native mode (no local aggregation)**

Unlike Alpaca/Dukascopy (aggregate mode with `baseInterval: '1m'`), CCXT exchanges natively support all common timeframes. Each `fetchOHLCV(symbol, '1h', ...)` returns server-side aggregated candles directly.

**Rationale:**
- Exchange servers have tick-level data for accurate aggregation
- Crypto 24/7 market: 1m data = 525,600 bars/year (unnecessarily large download)
- Fetching 1h or 1d directly is orders of magnitude faster
- Same pattern as YFinance (native mode, library handles timeframes)

```typescript
capabilities: {
  baseInterval: undefined,         // native mode -- no local aggregation
  aggregationStrategy: undefined,  // not needed
}
```

### 4. Data Flow: On-Demand -- DECIDED

**Decision: On-Demand (same as all other providers, reuse existing pipeline)**

Existing `data:ensure` + `ParquetCacheService` pipeline handles:
- First request -> CCXT fetchOHLCV -> OHLCVRow[] -> write Parquet cache
- Subsequent requests -> local Parquet (offline)

No new IPC channels required.

### 5. Symbol Format: CCXT Unified -- DECIDED

**Decision: Use CCXT unified symbol format directly**

CCXT uses `BASE/QUOTE` format across all exchanges: `BTC/USDT`, `ETH/USDT`, `SOL/USDT`.

```
User sees:    BTC/USDT, ETH/USDT, SOL/USDT
Internal ID:  BTC/USDT, ETH/USDT, SOL/USDT  (same -- no translation needed)
```

### 6. Symbol Search: loadMarkets + Local Filter -- DECIDED

**Decision: Cache exchange markets, filter locally**

```typescript
await exchange.loadMarkets();          // cached after first call
const results = exchange.symbols
  .filter(s => s.includes(query.toUpperCase()))
  .slice(0, limit);
```

No network request per search -- `loadMarkets()` caches complete symbol list on first call.

### 7. Authentication: None -- DECIDED

**Decision: No authentication required**

```typescript
capabilities: {
  requiresAuth: false,
}
```

Public OHLCV endpoints on Binance (and most exchanges) require no API key.

### 8. Date Range Detection: Probe -- DECIDED

**Decision: 2-request boundary probe (same pattern as Alpaca)**

```typescript
async getSymbolDateRange(symbol: string) {
  // Request 1: earliest bar (since = far past, limit = 1)
  const earliest = await exchange.fetchOHLCV(symbol, '1d', exchange.parse8601('2015-01-01T00:00:00Z'), 1);

  // Request 2: latest bar (no since, limit = 1, descending not guaranteed -- use recent window)
  const latest = await exchange.fetchOHLCV(symbol, '1d', undefined, 1);

  return {
    startTime: earliest[0] ? new Date(earliest[0][0]).toISOString().split('T')[0] : null,
    endTime: latest[0] ? new Date(latest[0][0]).toISOString().split('T')[0] : null,
  };
}
```

### 9. Pagination: since-based Loop -- DECIDED

**Decision: Standard CCXT pagination with since parameter**

```typescript
async function fetchAllOHLCV(exchange, symbol, timeframe, since, limit = 1000) {
  const allCandles = [];
  let cursor = since;

  while (true) {
    const candles = await exchange.fetchOHLCV(symbol, timeframe, cursor, limit);
    if (candles.length === 0) break;

    allCandles.push(...candles);
    cursor = candles[candles.length - 1][0] + 1;  // +1ms avoid duplicate

    if (candles.length < limit) break;
    // enableRateLimit handles throttling automatically
  }

  return allCandles;
}
```

### 10. Rate Limiting: Built-in -- DECIDED

**Decision: Use CCXT built-in rate limiter**

```typescript
const exchange = new ccxt.binance({
  enableRateLimit: true,  // automatic request throttling
});
```

No manual pacing needed. CCXT handles per-exchange rate limits internally.

## Reuse Analysis

### 100% Reuse (No Changes)

| Component | File | Reason |
|-----------|------|--------|
| IDataProvider interface | `data-providers/types.ts` | Universal contract |
| ParquetCacheService | `parquet-cache-service.ts` | Provider-isolated cache paths |
| IPC data handlers | `ipc/data-handlers.ts` | All channels provider-agnostic |
| Preload API | `preload/index.ts` | No new channels needed |
| BacktestDataConfigPanel | Plugin UI | Auto-discovers via `listProviders` |

### Not Used (Native Mode)

| Component | File | Reason |
|-----------|------|--------|
| StandardOHLCVStrategy | `aggregation/strategies/` | Native mode -- exchange handles timeframes |
| AggregationService | `aggregation/` | Not needed for native mode providers |

### Minimal Changes (1-2 Lines)

| Component | File | Change |
|-----------|------|--------|
| Provider Manager | `provider-manager.ts` | Add `instance.register(new CCXTProvider())` |

### New Implementation

| Component | File | LOC Estimate |
|-----------|------|-------------|
| CCXTProvider | `data-providers/ccxt-provider.ts` | ~250 lines |
| npm dependency | `package.json` | `ccxt` |

## Download Capacity Analysis

### Crypto 1-Minute Data (BTC/USDT, 1 Year)

| Parameter | Value |
|-----------|-------|
| Trading hours per day | 24 (24/7 market) |
| Days per year | 365 |
| 1m bars per day | 1,440 |
| **Total 1m bars (1 year)** | **~525,600** |

### Binance API Limits

| Parameter | Value |
|-----------|-------|
| Max candles per request | 1,000 |
| Rate limit | 1,200 requests/min (20/sec) |
| History depth | ~2017+ (exchange-dependent) |

### Download Time Estimation (1m, 1 year)

```
Pagination:  525,600 / 1,000 = ~526 requests
Rate limit:  526 / 20 req/sec = ~26 seconds (theoretical minimum)
With network latency: ~1-2 minutes per symbol
```

### Why Native Mode is Better for Crypto

```
Multi-timeframe backtest needing [1m, 5m, 1h, 1d]:

Aggregate mode (hypothetical):
  - Download ALL 1m data: 525,600 bars -> ~526 requests -> ~2 min
  - Then aggregate locally to 5m, 1h, 1d

Native mode (chosen):
  - Fetch 1m: 525,600 bars -> ~526 requests -> ~2 min
  - Fetch 5m: 105,120 bars -> ~106 requests -> ~5 sec
  - Fetch 1h: 8,760 bars -> ~9 requests -> ~0.5 sec
  - Fetch 1d: 365 bars -> ~1 request -> instant

Higher timeframes are dramatically cheaper in native mode.
If user only needs 1h backtest, download is 9 requests vs 526.
```

## Interval Mapping

| QuantNexus | CCXT / Binance |
|---|---|
| 1m | 1m |
| 5m | 5m |
| 15m | 15m |
| 30m | 30m |
| 1h | 1h |
| 4h | 4h |
| 1d | 1d |

Note: CCXT timeframe strings match QuantNexus conventions. No mapping needed.

## CCXTProvider Implementation Sketch

```typescript
export class CCXTProvider implements IDataProvider {
  readonly id = 'ccxt';
  readonly name = 'CCXT Crypto (Free)';
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['crypto'],
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
    requiresAuth: false,
    supportsSearch: true,
    // Native mode -- no baseInterval, no aggregationStrategy
  };

  private exchange: ccxt.Exchange | null = null;

  private async getExchange(): Promise<ccxt.Exchange> {
    if (!this.exchange) {
      this.exchange = new ccxt.binance({ enableRateLimit: true });
      await this.exchange.loadMarkets();
    }
    return this.exchange;
  }

  async queryOHLCV(symbol, interval, startDate, endDate): Promise<OHLCVRow[]> {
    const exchange = await this.getExchange();
    const since = exchange.parse8601(startDate);
    const endMs = exchange.parse8601(endDate);
    const allCandles = [];
    let cursor = since;

    while (cursor < endMs) {
      const candles = await exchange.fetchOHLCV(symbol, interval, cursor, 1000);
      if (candles.length === 0) break;

      for (const [ts, o, h, l, c, v] of candles) {
        if (ts > endMs) break;
        allCandles.push({ timestamp: Math.floor(ts / 1000), open: o, high: h, low: l, close: c, volume: v });
      }

      cursor = candles[candles.length - 1][0] + 1;
      if (candles.length < 1000) break;
    }

    return allCandles;
  }

  async searchSymbols(query, limit): Promise<ProviderSymbolInfo[]> {
    const exchange = await this.getExchange();
    const upper = query.toUpperCase();
    return exchange.symbols
      .filter(s => s.includes(upper))
      .slice(0, limit || 20)
      .map(s => ({
        symbol: s,
        name: s,
        type: 'crypto',
        exchange: 'binance',
      }));
  }

  async checkConnection(): Promise<ProviderConnectionStatus> {
    try {
      const exchange = await this.getExchange();
      const start = Date.now();
      await exchange.fetchOHLCV('BTC/USDT', '1d', undefined, 1);
      return { connected: true, latency: Date.now() - start };
    } catch {
      return { connected: false };
    }
  }

  async getSymbolDateRange(symbol): Promise<{ startTime, endTime }> {
    const exchange = await this.getExchange();
    const earliest = await exchange.fetchOHLCV(symbol, '1d', exchange.parse8601('2015-01-01T00:00:00Z'), 1);
    const latest = await exchange.fetchOHLCV(symbol, '1d', undefined, 1);
    return {
      startTime: earliest[0] ? new Date(earliest[0][0]).toISOString().split('T')[0] : null,
      endTime: latest[0] ? new Date(latest[0][0]).toISOString().split('T')[0] : null,
    };
  }
}
```

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Binance geo-blocking (some regions) | Future: user-selectable exchange via config |
| Exchange API changes | CCXT library abstracts exchange specifics; updates via npm |
| Rate limiting under heavy use | `enableRateLimit: true` handles automatically |
| Symbol delisting | `searchSymbols` reflects current exchange listings |
| Large 1m downloads (24/7 market) | Native mode avoids unnecessary 1m fetch for higher timeframes |

## Related Documents

- Data Source Distribution Strategy (parent)
- DATA_001: Alpaca US Equities Provider (reference implementation)
- DATA_002: Dukascopy Forex Provider (reference implementation)
- Multi-Source Data Provider Interface (IDataProvider)
- Multi-Timeframe Strategy Support

## Action Items

**Implementation:**
- [ ] Install `ccxt` npm dependency
- [ ] Implement `CCXTProvider` class
- [ ] Register in `DataProviderManager`
- [ ] Test with BTC/USDT 1m data
- [ ] Test with ETH/USDT 1h data
- [ ] Verify native mode multi-timeframe fetch
- [ ] Verify symbol search functionality
- [ ] Verify connection check

**Future Enhancements:**
- [ ] User-selectable exchange (Bybit, OKX, Kraken, etc.)
- [ ] Exchange-specific configuration (API keys for higher rate limits)
- [ ] Futures/perpetual market support
- [ ] Bulk download UI in Data Manager
