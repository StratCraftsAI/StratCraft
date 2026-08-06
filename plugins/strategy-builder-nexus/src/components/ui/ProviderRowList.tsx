/**
 * ProviderRowList Component
 *
 * Multi-row data-source / market picker. Renders one ProviderRow per
 * entry plus an "+ Add data source" / "+ Add market" affordance and an
 * optional total-symbols footer.
 *
 * i18n-agnostic: caller passes resolved strings (addRowLabel,
 * removeRowLabel, addRowDisabledReason) and formatters
 * (symbolCountFormatter, totalSymbolsFormatter). Matches the existing
 * 077 atom pattern.
 *
 * No IPC, no store, no window.electronAPI. The list does NOT trigger
 * symbol resolves; the caller does, and pushes resolved symbols into
 * `rows` via onRowsChange.
 *
 * Add-row default: picks the first non-disabled option from
 * buildPrimaryOptions(rows.length). Refuses silently and disables the
 * button when none exist; the addRowDisabledReason tooltip explains why.
 *
 * Remove-row: emits onRowsChange with the row at index removed. Empty
 * list is a valid state -- the list does NOT auto-add a first row.
 *
 * @see TICKET_077_28 - ProviderRow / ProviderRowList common control
 * @see TICKET_077    - StratCraftsAI UI Component Library
 */

import React, { useCallback } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ProviderRow } from './ProviderRow';
import type { SelectOption } from './SelectDropdown';
import {
  UniverseSliceSelector,
  type RankingMetricId,
  type UniverseSliceSpec,
} from './UniverseSliceSelector';

export interface ProviderRowEntry {
  value: string;
  subset: string | null;
  /** TICKET_077_29: `null` = use full universe (Layer 3 OFF); non-null =
   *  apply this slice to the (value, subset) universe. The caller's
   *  `resolveSymbolsFor` is responsible for honouring it (and for handing
   *  the spec to the data layer for as-of-aware resolution). */
  slice?: UniverseSliceSpec | null;
  symbols: ReadonlyArray<string>;
}

/** TICKET_077_29: caller-supplied per-row slice config. The list calls
 *  this once per row when `buildSliceConfig` is provided; returning
 *  `rankingMetricOptions: []` hides the selector for that row only. */
export interface ProviderRowSliceConfig {
  rankingMetricOptions: ReadonlyArray<SelectOption<RankingMetricId>>;
  defaultSpec: UniverseSliceSpec;
  topNMin?: number;
  topNMax?: number;
}

export interface ProviderRowListProps {
  rows: ReadonlyArray<ProviderRowEntry>;
  onRowsChange: (next: ProviderRowEntry[]) => void;

  /** Build the primary options for a given row index. Caller knows which
   *  options are "already used" by the other rows, BYOK-missing, etc. */
  buildPrimaryOptions: (rowIndex: number) => ReadonlyArray<SelectOption<string>>;

  /** Build the subset options for a given row index given its current
   *  primary value. Return [] when the primary has no subset dimension;
   *  the row will hide the second select. */
  buildSubsetOptions: (
    rowIndex: number,
    primaryValue: string,
  ) => ReadonlyArray<SelectOption<string>>;

  /** Synchronous symbol resolve. Caller returns [] for an in-flight
   *  async resolve and updates `rows` once it lands. The list does NOT
   *  trigger the resolve. */
  resolveSymbolsFor: (entry: ProviderRowEntry) => ReadonlyArray<string>;

  /** Per-row inline warning slot (text only). */
  renderRowWarnings?: (rowIndex: number, entry: ProviderRowEntry) => React.ReactNode;

  /** Resolved string ("+ Add data source" / "+ Add market"). */
  addRowLabel: string;
  /** Tooltip when no options remain. */
  addRowDisabledReason?: string;
  /** Resolved string ("Remove row"). */
  removeRowLabel: string;

  /** Caller-supplied formatters (locale-correct, plural-aware). The row
   *  hides the chip entirely when count === 0; symbolCountFormatter is
   *  not called in that case. */
  symbolCountFormatter: (count: number) => string;
  totalSymbolsFormatter: (count: number) => string;

  /** Hide the total-symbols footer. Default true. */
  showTotalSymbols?: boolean;

  /** TICKET_077_29: opt-in slice (Layer 3) config builder. Returning
   *  `{ rankingMetricOptions: [] }` for a row hides the selector for
   *  that row only. When the prop itself is omitted, no row renders
   *  any selector -- full backward compatibility with 077_28. */
  buildSliceConfig?: (
    rowIndex: number,
    entry: ProviderRowEntry,
  ) => ProviderRowSliceConfig;

  /** TICKET_077_29: caller-resolved slice control strings. Required only
   *  when `buildSliceConfig` is set (the selector itself never falls
   *  back; if the caller wires the slice axis on, it must wire the
   *  strings). */
  sliceToggleOnLabel?: string;
  sliceTopNLabel?: string;
  sliceRankingMetricLabel?: string;
  sliceFullUniverseLabel?: string;

  disabled?: boolean;
  testIdBase: string;
}

export const ProviderRowList: React.FC<ProviderRowListProps> = ({
  rows,
  onRowsChange,
  buildPrimaryOptions,
  buildSubsetOptions,
  resolveSymbolsFor,
  renderRowWarnings,
  addRowLabel,
  addRowDisabledReason,
  removeRowLabel,
  symbolCountFormatter,
  totalSymbolsFormatter,
  showTotalSymbols = true,
  buildSliceConfig,
  sliceToggleOnLabel,
  sliceTopNLabel,
  sliceRankingMetricLabel,
  sliceFullUniverseLabel,
  disabled = false,
  testIdBase,
}) => {
  const handlePrimaryChange = useCallback(
    (rowIndex: number, nextValue: string) => {
      const next = rows.map((r, i) => {
        if (i !== rowIndex) return { ...r };
        const subsetOpts = buildSubsetOptions(rowIndex, nextValue);
        const nextSubset =
          subsetOpts.length === 0
            ? null
            : subsetOpts.find(o => o.value === r.subset && !o.disabled)
              ? r.subset
              : subsetOpts.find(o => !o.disabled)?.value ?? null;
        // TICKET_077_29: provider change invalidates per-(provider,subset)
        // slice spec (different ranking-metric registry). Drop to null;
        // the user re-enables slice for the new (provider, subset) pair.
        const candidate: ProviderRowEntry = {
          value: nextValue,
          subset: nextSubset,
          slice: null,
          symbols: [],
        };
        return { ...candidate, symbols: resolveSymbolsFor(candidate) };
      });
      onRowsChange(next);
    },
    [rows, buildSubsetOptions, resolveSymbolsFor, onRowsChange],
  );

  const handleSubsetChange = useCallback(
    (rowIndex: number, nextSubset: string) => {
      const next = rows.map((r, i) => {
        if (i !== rowIndex) return { ...r };
        // TICKET_077_29: subset change invalidates slice (different
        // (provider, subset) pair -> different ranking-metric registry).
        const candidate: ProviderRowEntry = {
          value: r.value,
          subset: nextSubset,
          slice: null,
          symbols: [],
        };
        return { ...candidate, symbols: resolveSymbolsFor(candidate) };
      });
      onRowsChange(next);
    },
    [rows, resolveSymbolsFor, onRowsChange],
  );

  const handleSliceChange = useCallback(
    (rowIndex: number, nextSlice: UniverseSliceSpec | null) => {
      const next = rows.map((r, i) => {
        if (i !== rowIndex) return { ...r };
        const candidate: ProviderRowEntry = {
          value: r.value,
          subset: r.subset,
          slice: nextSlice,
          symbols: [],
        };
        return { ...candidate, symbols: resolveSymbolsFor(candidate) };
      });
      onRowsChange(next);
    },
    [rows, resolveSymbolsFor, onRowsChange],
  );

  const handleRemove = useCallback(
    (rowIndex: number) => {
      const next = rows.filter((_, i) => i !== rowIndex).map(r => ({ ...r }));
      onRowsChange(next);
    },
    [rows, onRowsChange],
  );

  const addRowOptions = buildPrimaryOptions(rows.length);
  const firstAddable = addRowOptions.find(o => !o.disabled);
  const canAdd = !disabled && firstAddable !== undefined;

  const handleAdd = useCallback(() => {
    if (!firstAddable) return;
    const subsetOpts = buildSubsetOptions(rows.length, firstAddable.value);
    const nextSubset =
      subsetOpts.length === 0
        ? null
        : subsetOpts.find(o => !o.disabled)?.value ?? null;
    const candidate: ProviderRowEntry = {
      value: firstAddable.value,
      subset: nextSubset,
      slice: null,
      symbols: [],
    };
    const symbols = resolveSymbolsFor(candidate);
    onRowsChange([...rows.map(r => ({ ...r })), { ...candidate, symbols }]);
  }, [firstAddable, rows, buildSubsetOptions, resolveSymbolsFor, onRowsChange]);

  const totalSymbols = rows.reduce(
    (sum, r) => sum + resolveSymbolsFor(r).length,
    0,
  );

  return (
    <div data-testid={testIdBase} className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const sliceCfg = buildSliceConfig?.(i, row);
        const sliceNode =
          sliceCfg && sliceCfg.rankingMetricOptions.length > 0 ? (
            <UniverseSliceSelector
              value={row.slice ?? null}
              rankingMetricOptions={sliceCfg.rankingMetricOptions}
              defaultSpec={sliceCfg.defaultSpec}
              topNMin={sliceCfg.topNMin}
              topNMax={sliceCfg.topNMax}
              onChange={next => handleSliceChange(i, next)}
              toggleOnLabel={sliceToggleOnLabel ?? ''}
              topNLabel={sliceTopNLabel ?? ''}
              rankingMetricLabel={sliceRankingMetricLabel ?? ''}
              fullUniverseLabel={sliceFullUniverseLabel ?? ''}
              disabled={disabled}
              testIdBase={`${testIdBase}-row-${i}-slice`}
            />
          ) : undefined;
        return (
          <ProviderRow
            key={`${testIdBase}-row-${i}`}
            value={row.value}
            subset={row.subset}
            primaryOptions={buildPrimaryOptions(i)}
            subsetOptions={buildSubsetOptions(i, row.value)}
            symbols={row.symbols}
            onPrimaryChange={next => handlePrimaryChange(i, next)}
            onSubsetChange={next => handleSubsetChange(i, next)}
            onRemove={() => handleRemove(i)}
            removeRowLabel={removeRowLabel}
            symbolCountFormatter={symbolCountFormatter}
            inlineRowWarnings={renderRowWarnings?.(i, row)}
            sliceSelector={sliceNode}
            disabled={disabled}
            testIdBase={`${testIdBase}-row-${i}`}
          />
        );
      })}

      <button
        type="button"
        onClick={handleAdd}
        disabled={!canAdd}
        title={!canAdd ? addRowDisabledReason : undefined}
        data-testid={`${testIdBase}-add`}
        className={cn(
          'self-start flex items-center gap-1 px-2 py-1 text-[13px]',
          'border border-color-terminal-border rounded',
          'bg-color-terminal-surface text-color-terminal-text',
          'hover:border-color-terminal-accent-teal',
          'transition-colors duration-200',
          !canAdd && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Plus className="w-3 h-3" />
        <span>{addRowLabel}</span>
      </button>

      {showTotalSymbols && (
        <div
          data-testid={`${testIdBase}-total-symbols`}
          className="text-[11px] text-color-terminal-text-secondary"
        >
          {totalSymbolsFormatter(totalSymbols)}
        </div>
      )}
    </div>
  );
};
