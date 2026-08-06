# PLUGIN_Alpha Factory Date Range Auto-Populate

## Status: OPEN
## Priority: HIGH
## Related: _COMPONENT8, , PLUGIN_TICKET_018

---

## Problem

In Alpha Factory's `DataConfigPanel`, after selecting a **data source** and then a **symbol**, the **start date** and **end date** fields do not auto-populate for certain providers.

**Root Cause**: The current `handleSymbolSelect` (line 199, `DataConfigPanel.tsx`) only implements **Phase 1** date extraction (parsing `startTime`/`endTime` from the search result object). It is missing **Phase 2** - the fallback API call to `getSymbolDateRange` when the search result does not contain date fields.

The `ProviderSymbolInfo` interface defines `startTime` and `endTime` as **optional** fields. Some providers may not return these fields in their `searchSymbols` response, leaving dates empty.

**Reference Implementation**: `BacktestDataConfigPanel.tsx` (lines 613-641) correctly implements both phases and works for all 5 data sources.

---

## Current State (Alpha Factory DataConfigPanel)

**File**: `plugins/quant-lab-plugin/ui/quant-lab-nexus/src/components/DataConfigPanel.tsx`

```typescript
// Line 199-213: Only Phase 1 - no fallback
const handleSymbolSelect = useCallback((result: SymbolSearchResult) => {
  const updates: Partial<DataConfig> = { symbol: result.symbol };
  if (result.startTime) {
    const d = result.startTime.split(' ')[0];
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) updates.startDate = d;
  }
  if (result.endTime) {
    const d = result.endTime.split(' ')[0];
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) updates.endDate = d;
  }
  onChange({ ...value, ...updates });
  setQuery(result.symbol);
  setShowResults(false);
  setHighlightedIndex(-1);
}, [value, onChange]);
```

**Missing**: Phase 2 `getSymbolDateRange` fallback API call.

---

## Target State (Reference: BacktestDataConfigPanel)

**File**: `plugins/back-test-nexus/ui/src/components/ui/BacktestDataConfigPanel.tsx`

```typescript
// Lines 609-641: Phase 1 + Phase 2
onChange({ ...value, ...updates }); // Phase 1: immediate update

// Phase 2: fallback if dates missing
if (!updates.startDate || !updates.endDate) {
  try {
    const api = (window as any).electronAPI;
    if (api?.data?.getSymbolDateRange) {
      const dateRange = await api.data.getSymbolDateRange(result.symbol, value.dataSource);
      // ... parse and update dates
    }
  } catch (error) {
    console.warn('[BacktestDataConfigPanel] Failed to fetch symbol date range:', error);
  }
}
```

---

## 5 Data Sources to Support

| # | Provider | ID | Asset Types | Auth Required |
|---|----------|----|-------------|---------------|
| 1 | Yahoo Finance | `yfinance` | stock, etf, index | No |
| 2 | Alpaca | `alpaca` | stock, etf | Yes |
| 3 | Dukascopy | `dukascopy` | forex | No |
| 4 | CCXT | `ccxt` | crypto | No |
| 5 | BaoStock | `baostock` | stock, index | No |

---

## Implementation

### Step 1: Add Phase 2 fallback to `handleSymbolSelect`

In `DataConfigPanel.tsx`, modify `handleSymbolSelect` to:

1. Make the callback `async`
2. After Phase 1 date extraction, check if dates are still missing
3. If missing, call `getSymbolDateRange` API with `(symbol, dataSource)`
4. Parse response and update dates via `onChange`
5. Non-fatal error handling (user can manually input dates)

### Step 2: API Access

The required API is already exposed in the preload layer:

```typescript
// preload/index.ts
data: {
  getSymbolDateRange: (symbol: string, provider?: string) =>
    ipcRenderer.invoke('data:getSymbolDateRange', symbol, provider),
}
```

The plugin accesses this via `window.electronAPI.data.getSymbolDateRange`.

---

## Acceptance Criteria

- [ ] Selecting a symbol auto-populates start/end dates for all 5 data sources
- [ ] Phase 1 (search result dates) works when provider returns dates
- [ ] Phase 2 (fallback API) triggers when Phase 1 dates are missing
- [ ] Symbol selection remains non-blocking (dates fetch in background)
- [ ] API failure does not block symbol selection (non-fatal)
- [ ] Matches BacktestDataConfigPanel behavior exactly
