/**
 * UniverseSliceSelector Component
 *
 * Layer-3 (slice) axis for ProviderRow (TICKET_077_28). Orthogonal to
 * provider (Layer 1) and subset (Layer 2): "how much of the resolved
 * universe do I actually want". Carries `{ topN, rankingMetric }` intent;
 * does NOT resolve symbols and does NOT branch on backtest-vs-live mode
 * (as-of / survivorship-free resolution is the data layer's contract --
 * TICKET_292).
 *
 * Pure controlled component. No internal state for `value`. Toggling ON
 * emits `onChange(defaultSpec)`; toggling OFF emits `onChange(null)`.
 *
 * Hide-on-empty: when `rankingMetricOptions.length === 0` the primitive
 * returns null (the provider does not support slicing in this
 * configuration). The parent (ProviderRow) is responsible for not
 * allocating space.
 *
 * No IPC, no store, no registry lookups. Caller hands in opaque strings
 * and numbers.
 *
 * @see TICKET_077_29 - UniverseSliceSelector common control
 * @see TICKET_077_28 - ProviderRow / ProviderRowList host primitive
 * @see TICKET_077    - StratCraftsAI UI Component Library
 */

import React, { useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SelectDropdown, type SelectOption } from './SelectDropdown';

/** Caller's domain ranking metric. Opaque string to the primitive. */
export type RankingMetricId = string;

export interface UniverseSliceSpec {
  topN: number;
  rankingMetric: RankingMetricId;
}

export interface UniverseSliceSelectorProps {
  /** Current slice spec. `null` = "use the full universe" (toggle OFF). */
  value: UniverseSliceSpec | null;

  /** Ranking metrics valid for this row's `(provider, subset)` pair. Empty
   *  array is a contract signal: the primitive renders nothing. The parent
   *  MUST keep `value === null` in that case (caller-side guard). */
  rankingMetricOptions: ReadonlyArray<SelectOption<RankingMetricId>>;

  /** Default spec used when the user toggles the selector ON for the
   *  first time. Caller-supplied per (provider, subset); the primitive
   *  does NOT hard-code defaults. */
  defaultSpec: UniverseSliceSpec;

  /** Bounds for the topN input. `min` defaults to 1. `max` may be
   *  `Infinity` when the caller does not know the universe size. The
   *  primitive does NOT clip or clamp -- it surfaces `aria-invalid` when
   *  the value is out of range and emits the raw number. */
  topNMin?: number;
  topNMax?: number;

  onChange: (next: UniverseSliceSpec | null) => void;

  /** Caller-resolved strings (077 primitives don't call useTranslation).
   *  Mapped 1:1 to the four i18n keys in the ticket's Behaviour
   *  invariant #7. */
  toggleOnLabel: string;
  topNLabel: string;
  rankingMetricLabel: string;
  fullUniverseLabel: string;

  disabled?: boolean;

  /** testid base. Internals expose stable suffixes:
   *   `<base>-slice-toggle`, `<base>-topn-input`, `<base>-metric-select`. */
  testIdBase: string;
}

export const UniverseSliceSelector: React.FC<UniverseSliceSelectorProps> = ({
  value,
  rankingMetricOptions,
  defaultSpec,
  topNMin = 1,
  topNMax,
  onChange,
  toggleOnLabel,
  topNLabel,
  rankingMetricLabel,
  fullUniverseLabel,
  disabled = false,
  testIdBase,
}) => {
  const handleToggleOn = useCallback(() => {
    onChange(defaultSpec);
  }, [onChange, defaultSpec]);

  const handleToggleOff = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const handleTopNChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (value === null) return;
      const raw = e.target.value;
      if (raw === '') { onChange({ ...value, topN: Number.NaN }); return; }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      onChange({ ...value, topN: parsed });
    },
    [onChange, value],
  );

  const handleTopNBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      if (value === null) return;
      const parsed = Number(e.target.value);
      if (!Number.isFinite(parsed)) return;
      onChange({ ...value, topN: parsed });
    },
    [onChange, value],
  );

  const handleMetricChange = useCallback(
    (next: RankingMetricId) => {
      if (value === null) return;
      onChange({ ...value, rankingMetric: next });
    },
    [onChange, value],
  );

  if (rankingMetricOptions.length === 0) {
    return null;
  }

  if (value === null) {
    return (
      <button
        type="button"
        onClick={handleToggleOn}
        disabled={disabled}
        aria-pressed={false}
        title={fullUniverseLabel}
        data-testid={`${testIdBase}-slice-toggle`}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-[12px] whitespace-nowrap',
          'border border-color-terminal-border rounded',
          'bg-color-terminal-surface text-color-terminal-text-secondary',
          'hover:border-color-terminal-accent-teal hover:text-color-terminal-text',
          'transition-colors duration-200',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span>+ {toggleOnLabel}</span>
      </button>
    );
  }

  const topNOutOfRange =
    Number.isNaN(value.topN) ||
    value.topN < topNMin ||
    (topNMax !== undefined && value.topN > topNMax);

  return (
    <div
      data-testid={testIdBase}
      className="flex items-center gap-1"
    >
      <input
        type="number"
        min={topNMin}
        max={Number.isFinite(topNMax) ? topNMax : undefined}
        value={Number.isNaN(value.topN) ? '' : value.topN}
        onChange={handleTopNChange}
        onBlur={handleTopNBlur}
        disabled={disabled}
        aria-label={topNLabel}
        aria-invalid={topNOutOfRange || undefined}
        data-testid={`${testIdBase}-topn-input`}
        className={cn(
          'w-[64px] px-2 py-1 text-center',
          'border border-color-terminal-border rounded',
          'bg-color-terminal-surface text-color-terminal-text',
          'font-mono text-[12px]',
          'focus:outline-none focus:border-color-terminal-accent-teal',
          'transition-colors duration-200',
          topNOutOfRange && 'border-color-terminal-accent-red',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      />
      <div className="min-w-[140px]">
        <SelectDropdown
          value={value.rankingMetric}
          onChange={handleMetricChange}
          options={rankingMetricOptions}
          placeholder={rankingMetricLabel}
          disabled={disabled}
          testId={`${testIdBase}-metric-select`}
        />
      </div>
      <button
        type="button"
        onClick={handleToggleOff}
        disabled={disabled}
        aria-pressed={true}
        aria-label={fullUniverseLabel}
        title={fullUniverseLabel}
        data-testid={`${testIdBase}-slice-toggle`}
        className={cn(
          'p-1 rounded text-color-terminal-text-secondary',
          'hover:text-color-terminal-text hover:bg-color-terminal-surface',
          'transition-colors duration-200',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
