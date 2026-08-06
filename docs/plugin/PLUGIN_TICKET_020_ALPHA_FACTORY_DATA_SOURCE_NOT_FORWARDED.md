# PLUGIN_Alpha Factory Data Source Provider Not Forwarded

## Status: COMPLETE

## Problem

When selecting Dukascopy (or any non-default provider) on the Alpha Factory page,
the backtest fails with:

```
No data found for 1d in the specified range
```

## Root Cause

`useAlphaFactoryBacktest.ts` collects `dataConfig.dataSource` from the UI
(e.g. `'dukascopy'`) but never forwards it as the `provider` parameter when
calling `api.data.ensure()` or `api.data.ensureMultiTimeframe()`.

```typescript
// BUG: provider field missing
const dataResult = await api.data.ensure({
  symbol: dataConfig.symbol,
  startDate: dataConfig.startDate,
  endDate: dataConfig.endDate,
  interval: primaryTimeframe,
  // dataConfig.dataSource NOT forwarded
});
```

`DataStorageService` then falls back to `getDefaultProvider()` (first registered
provider), which is not the user-selected provider. That provider either lacks
auth credentials or does not have data for the requested symbol, returning 0 rows.

## Fix

Forward `dataConfig.dataSource` as `provider` in both `ensure` and
`ensureMultiTimeframe` calls inside `useAlphaFactoryBacktest.ts`.

## Verification

Tested with Dukascopy provider, symbol `euraed`, timeframes `[1d, 1h]`:

```
[DataStorage] Ensuring multi-timeframe: euraed, [1d, 1h]
[DukascopyProvider] Querying euraed d1 2026-02-12 - 2026-02-14
[DukascopyProvider] Total bars received: 2 for euraed d1
[DataStorage] Data ready: .../euraed_1d_2024-09-16_2026-02-13.parquet, rows: 441
[DukascopyProvider] Querying euraed h1 2026-02-12 - 2026-02-14
[DukascopyProvider] Total bars received: 45 for euraed h1
[DataStorage] Data ready: .../euraed_1h_2024-09-16_2026-02-13.parquet, rows: 8361
[DataStorage] Multi-timeframe ready: 1d, 1h
```

Backtest executor ran successfully on 8361 bars.

## Status: COMPLETED

## Files Changed

- `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/hooks/useAlphaFactoryBacktest.ts`
