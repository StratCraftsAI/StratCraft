/**
 * ProviderRow Component
 *
 * One row inside a ProviderRowList: a primary provider/market select,
 * an optional subset select (hidden when subsetOptions is empty), an
 * inline warnings slot, a symbol-count chip, and a remove button.
 *
 * i18n-agnostic: all user-visible strings are caller-resolved props
 * (matches the existing 077 atom pattern -- AccessGate.title etc.).
 *
 * No internal state for value/subset/symbols. No IPC, no store, no
 * window.electronAPI. All async resolution lives in the caller.
 *
 * @see TICKET_077_28 - ProviderRow / ProviderRowList common control
 * @see TICKET_077    - StratCraftsAI UI Component Library
 */

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SelectDropdown, type SelectOption } from './SelectDropdown';

export interface ProviderRowProps {
  /** Stable key for the currently selected primary option. */
  value: string;
  /** Optional secondary key (yfinance subset, ibkr asset class, ...). `null`
   *  when the primary option has no subset dimension. */
  subset: string | null;

  /** Primary options (already filtered by caller for already-used /
   *  BYOK-missing / etc.). */
  primaryOptions: ReadonlyArray<SelectOption<string>>;
  /** Subset options. Pass [] when the primary has no subset dimension;
   *  the row hides the second select entirely. */
  subsetOptions: ReadonlyArray<SelectOption<string>>;

  /** Resolved symbol set for the current (primary, subset) pair. Used
   *  only to render the right-aligned `{n} symbols` chip. Empty -> no
   *  chip (covers in-flight async resolves). Row never computes this. */
  symbols: ReadonlyArray<string>;

  onPrimaryChange: (next: string) => void;
  onSubsetChange: (next: string) => void;
  onRemove: () => void;

  /** Caller-resolved strings (077 primitives don't call useTranslation). */
  primaryPlaceholder?: string;
  subsetPlaceholder?: string;
  removeRowLabel: string;
  /** Caller-supplied formatter (locale-correct, plural-aware). Not called
   *  when symbols.length === 0. */
  symbolCountFormatter: (count: number) => string;

  /** Optional inline warning slot rendered under the row (text only;
   *  must NOT inject affordances). */
  inlineRowWarnings?: React.ReactNode;

  /** TICKET_077_29: optional Layer-3 (slice) control rendered inline
   *  between the subset select and the symbol-count chip. When omitted,
   *  no slice control appears (legacy 077_28 DOM preserved). The host
   *  list (ProviderRowList) builds the UniverseSliceSelector node and
   *  passes it down here; the row does NOT own slice state. */
  sliceSelector?: React.ReactNode;

  disabled?: boolean;

  /** testid base. Internals expose:
   *   `<base>-primary-select`, `<base>-subset-select`,
   *   `<base>-remove`, `<base>-symbol-count`. */
  testIdBase: string;
}

export const ProviderRow: React.FC<ProviderRowProps> = ({
  value,
  subset,
  primaryOptions,
  subsetOptions,
  symbols,
  onPrimaryChange,
  onSubsetChange,
  onRemove,
  primaryPlaceholder,
  subsetPlaceholder,
  removeRowLabel,
  symbolCountFormatter,
  inlineRowWarnings,
  sliceSelector,
  disabled = false,
  testIdBase,
}) => {
  const hasSubset = subsetOptions.length > 0;
  const symbolCount = symbols.length;

  return (
    <div data-testid={testIdBase} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={cn('flex-1', !hasSubset && 'min-w-0')}>
          <SelectDropdown
            value={value}
            onChange={onPrimaryChange}
            options={primaryOptions}
            placeholder={primaryPlaceholder}
            disabled={disabled}
            testId={`${testIdBase}-primary-select`}
            maxHeight={160}
          />
        </div>

        {hasSubset && (
          <div className="flex-1 min-w-0">
            <SelectDropdown
              value={subset ?? ''}
              onChange={onSubsetChange}
              options={subsetOptions}
              placeholder={subsetPlaceholder}
              disabled={disabled}
              testId={`${testIdBase}-subset-select`}
            />
          </div>
        )}

        {sliceSelector}

        {symbolCount > 0 && (
          <span
            data-testid={`${testIdBase}-symbol-count`}
            className="text-[11px] text-color-terminal-text-secondary whitespace-nowrap"
          >
            {symbolCountFormatter(symbolCount)}
          </span>
        )}

        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeRowLabel}
          title={removeRowLabel}
          data-testid={`${testIdBase}-remove`}
          className={cn(
            'p-1 rounded text-color-terminal-text-secondary',
            'hover:text-color-terminal-text hover:bg-color-terminal-surface',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {inlineRowWarnings && (
        <div className="text-[11px] text-color-terminal-text-secondary">
          {inlineRowWarnings}
        </div>
      )}
    </div>
  );
};
