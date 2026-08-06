# PLUGIN_Exit Card ACTION Row Data Gap

**Status**: Open
**Date**: 2026-02-08
**Related**: , PLUGIN_TICKET_013

## Problem

After  migration and PLUGIN_TICKET_013 UI changes are applied, Exit Factory cards display only **CONDITION + TRIGGER** rows, missing the **ACTION** (exit component) row.

### Screenshot Evidence

- `test/image09.png` - Upper half: Signal Factory + Exit Factory overview
- `test/image10.png` - Lower half: Exit Factory card shows CONDITION + TRIGGER only, no ACTION row

### Root Cause Analysis

 migration adds `usage_type` column with `DEFAULT 'signal'`. All pre-existing `signal_source_registry` records:

1. Receive `usage_type = 'signal'` (migration default)
2. Retain their original `exit_*` field values (may be NULL or populated)
3. No records have `usage_type = 'exit'`

When user opens Exit Factory picker (`usageType='exit'` filter), one of two scenarios:

- **Scenario A**: No `usage_type = 'exit'` records exist yet -> picker shows empty list -> user cannot add exits
- **Scenario B**: User re-exported a backtest after migration, but the backtest had no exit strategy -> only `usage_type = 'signal'` record created, no exit record

In both cases, if an exit card appears (e.g., from a saved config loaded before migration), its `exit_algorithm_name` is NULL, so `SignalChip` correctly omits the ACTION row per conditional rendering:

```tsx
{exit && (
  <ComponentRow label="Action" ... />
)}
```

## Expected Behavior

Exit Factory cards selected via `usageType='exit'` picker should display all three rows:

| Row | Label | Data Source |
|-----|-------|-------------|
| 1 | CONDITION | `analysis_algorithm_name` + `analysis_timeframe` |
| 2 | TRIGGER | `entry_algorithm_name` + `entry_timeframe` |
| 3 | ACTION | `exit_algorithm_name` + `exit_timeframe` |

## Resolution Path

To see the complete 3-row exit card, the user must:

1. Go to Strategy Builder
2. Create/run a backtest **with an exit strategy** configured
3. Export to Quant Lab

The  export handler will then create two records:
- `usage_type = 'signal'` (analysis + entry, exit_* = NULL)
- `usage_type = 'exit'` (analysis + entry + exit, all populated)

The exit picker will find the `usage_type = 'exit'` record, and the card will render all three rows.

## Verification Checklist

- [ ] Export a backtest WITH exit strategy from Strategy Builder
- [ ] Confirm two records created in `signal_source_registry` (one signal, one exit)
- [ ] Open Alpha Factory -> Add Exit -> picker shows exit source
- [ ] Exit card displays CONDITION + TRIGGER + ACTION (3 rows)
- [ ] ACTION row shows exit algorithm name + timeframe dropdown
