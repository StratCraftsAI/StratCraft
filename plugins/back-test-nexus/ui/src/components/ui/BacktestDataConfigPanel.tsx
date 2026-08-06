/**
 * BacktestDataConfigPanel Component (Component 8)
 *
 * Data source and configuration panel for Zone C variable content area.
 * Displays 3 rows of backtest configuration inputs:
 * - Row 1: Data Source + Symbol Search
 * - Row 2: Start Date + End Date
 * - Row 3: Initial Capital + Order Size + Unit
 *
 * IMPORTANT: This component does NOT include the Execute button (Zone D).
 * TICKET_248: Timeframe moved to stage-level in WorkflowRowSelector.
 *
 * @see TICKET_077_COMPONENT8 - BacktestDataConfigPanel Design
 * @see TICKET_248 - Stage-Level Timeframe Selector
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { getDateFormatHint } from '@shared/utils/format-locale';
import { THEME_COLORS, SEMANTIC_COLORS, STATUS_PLATE_COLORS } from '@shared/constants/colors';

// PLUGIN_TICKET_018: Types and components from Tier 0 data-plugin
import { DataSourceSelectField, DEFAULT_DATA_SOURCE } from '@plugins/data-plugin/index';
import type { DataSourceOption, SymbolSearchResult, TimeframeOption } from '@plugins/data-plugin/index';

// Re-export shared types for backward compatibility
export type { DataSourceOption, SymbolSearchResult, TimeframeOption };

// =============================================================================
// Types
// =============================================================================

export type OrderSizeUnit = 'cash' | 'percent' | 'shares';

export interface BacktestDataConfig {
  // Row 1
  symbol: string;
  dataSource: string;

  // Row 2
  startDate: string;
  endDate: string;
  /** @deprecated TICKET_248: Timeframe moved to stage-level in WorkflowRowSelector */
  timeframe?: TimeframeOption;

  // Row 3
  initialCapital: number;
  orderSize: number;
  orderSizeUnit: OrderSizeUnit;

  // TICKET_1130 Phase 3: confidence-weighted sizing toggle
  confidenceWeightedSizing?: boolean;
}

export interface BacktestDataConfigPanelProps {
  /** Current configuration value */
  value: BacktestDataConfig;

  /** Callback when configuration changes */
  onChange: (config: BacktestDataConfig) => void;

  /** Available data sources */
  dataSources?: DataSourceOption[];

  /** Symbol search callback -- TICKET_641_10: returns wrapped response with truncation metadata */
  onSymbolSearch?: (query: string) => Promise<{
    results: SymbolSearchResult[];
    totalCount: number;
    truncated: boolean;
  }>;

  /** Field-level validation errors */
  errors?: Partial<Record<keyof BacktestDataConfig, string>>;

  /** Disable all inputs */
  disabled?: boolean;

  /** Additional class names */
  className?: string;

  /** TICKET_293: Whether user is currently authenticated */
  isAuthenticated?: boolean;

  /** TICKET_305: Max lookback constraints per interval from current provider */
  maxLookback?: Record<string, string>;

  /** TICKET_305 Phase 3: Most restrictive lookback in days across selected timeframes */
  mostRestrictivelookbackBars?: number;
}

// =============================================================================
// Constants
// =============================================================================

// Order unit options are generated with translations in the component
// TICKET_248: Timeframe options removed - now set at stage-level in WorkflowRowSelector

const DEFAULT_ORDER_SIZE_UNIT: OrderSizeUnit = 'percent';

// =============================================================================
// Helper Components
// =============================================================================

interface InputFieldProps {
  label: string;
  type?: 'text' | 'number' | 'date';
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

const InputField: React.FC<InputFieldProps> = ({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  disabled,
  min,
  max,
  step,
  className,
}) => {
  const clampOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (type === 'number' && min !== undefined && max !== undefined) {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) {
        onChange(String(Math.max(min, Math.min(max, v))));
        return;
      }
    }
    onChange(e.target.value);
  };

  const clampOnBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (type !== 'number') return;
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) {
      onChange(String(min ?? 0));
    } else if (min !== undefined && max !== undefined) {
      onChange(String(Math.max(min, Math.min(max, v))));
    } else if (min !== undefined) {
      onChange(String(Math.max(min, v)));
    }
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-[10px] uppercase tracking-wider text-color-terminal-text-muted terminal-mono">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={clampOnChange}
        onBlur={clampOnBlur}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        className={cn(
          'h-9 px-3 rounded border text-sm terminal-mono placeholder-color-terminal-text-muted',
          'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary focus:border-color-terminal-accent-primary',
          'transition-colors',
          error && 'border-red-500',
          disabled && 'opacity-50 cursor-not-allowed',
          !error && 'border-color-terminal-border'
        )}
        style={{
          backgroundColor: THEME_COLORS.INPUT_BG,
          borderColor: error ? SEMANTIC_COLORS.ERROR : THEME_COLORS.INPUT_BORDER,
          color: THEME_COLORS.INPUT_TEXT,
        }}
      />
      {error && (
        <span className="text-[10px] text-red-500 terminal-mono">{error}</span>
      )}
    </div>
  );
};

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  error?: string;
  disabled?: boolean;
  className?: string;
}

const SelectField: React.FC<SelectFieldProps> = ({
  label,
  value,
  onChange,
  options,
  error,
  disabled,
  className,
}) => {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-[10px] uppercase tracking-wider text-color-terminal-text-muted terminal-mono">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          'h-9 px-3 rounded border text-sm terminal-mono',
          'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary focus:border-color-terminal-accent-primary',
          'transition-colors',
          error && 'border-red-500',
          disabled && 'opacity-50 cursor-not-allowed',
          !error && 'border-color-terminal-border'
        )}
        style={{
          backgroundColor: THEME_COLORS.INPUT_BG,
          borderColor: error ? SEMANTIC_COLORS.ERROR : THEME_COLORS.INPUT_BORDER,
          color: THEME_COLORS.INPUT_TEXT,
        }}
      >
        {options.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            style={{ color: opt.disabled ? THEME_COLORS.GRAY_500 : THEME_COLORS.INPUT_TEXT }}
          >
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[10px] text-red-500 terminal-mono">{error}</span>
      )}
    </div>
  );
};

interface SymbolSearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSearch?: (query: string) => Promise<{
    results: SymbolSearchResult[];
    totalCount: number;
    truncated: boolean;
  }>;
  /** Callback when a symbol is selected from search results */
  onSelect?: (result: SymbolSearchResult) => void;
  /** TICKET_331: Clear cached results when search context changes */
  dataSource?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

const SymbolSearchField: React.FC<SymbolSearchFieldProps> = ({
  label,
  value,
  onChange,
  onSearch,
  onSelect,
  dataSource,
  error,
  disabled,
  className,
  placeholder,
}) => {
  const { t } = useTranslation('backtest');
  
  // Use provided placeholder or fall back to translation
  const resolvedPlaceholder = placeholder ?? t('backtestDataConfig.placeholderSearchSymbol');
  
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // TICKET_641_10: Truncation metadata from search response
  const [truncationInfo, setTruncationInfo] = useState<{ totalCount: number; truncated: boolean } | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const requestIdRef = React.useRef(0);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  // TICKET_331: Clear cached search results when data source changes
  useEffect(() => {
    setSearchResults([]);
    setShowResults(false);
  }, [dataSource]);

  // TICKET_316: Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // TICKET_316: Debounce (300ms) + Sequence ID to fix race condition
  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);

      // Increment to invalidate any in-flight request
      const currentId = ++requestIdRef.current;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (!onSearch || q.length < 2) {
        setSearchResults([]);
        setShowResults(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      debounceTimerRef.current = setTimeout(async () => {
        try {
          // TICKET_641_10: Unwrap { results, totalCount, truncated } response
          const response = await onSearch(q);
          // Discard if a newer request was issued while awaiting
          if (currentId !== requestIdRef.current) return;
          setSearchResults(response.results);
          setTruncationInfo({ totalCount: response.totalCount, truncated: response.truncated });
          setShowResults(response.results.length > 0);
          setHighlightedIndex(-1);
        } catch (err) {
          if (currentId !== requestIdRef.current) return;
          console.error('[E:BACKTEST:SYMBOL_SEARCH_FAILED] Symbol search failed:', err);
          setSearchResults([]);
          setTruncationInfo(null);
        } finally {
          if (currentId === requestIdRef.current) {
            setIsSearching(false);
          }
        }
      }, 300);
    },
    [onSearch]
  );

  const handleSelectResult = (result: SymbolSearchResult) => {
    onChange(result.symbol);
    setQuery(result.symbol);
    setShowResults(false);
    setHighlightedIndex(-1);
    onSelect?.(result);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev < searchResults.length - 1 ? prev + 1 : 0;
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : searchResults.length - 1;
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        handleSelectResult(searchResults[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowResults(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className={cn('flex flex-col gap-1 relative', className)}>
      <label className="text-[10px] uppercase tracking-wider text-color-terminal-text-muted terminal-mono">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { setTimeout(() => setShowResults(false), 200); setHighlightedIndex(-1); }}
          onFocus={() => {
            if (query.length >= 2) {
              if (searchResults.length > 0) {
                setShowResults(true);
              } else {
                // TICKET_331: Re-search when cache was invalidated by data source switch
                handleSearch(query);
              }
            }
          }}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          className={cn(
            'w-full h-9 px-3 pr-8 rounded border text-sm terminal-mono placeholder-color-terminal-text-muted',
            'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary focus:border-color-terminal-accent-primary',
            'transition-colors',
            error && 'border-red-500',
            disabled && 'opacity-50 cursor-not-allowed',
            !error && 'border-color-terminal-border'
          )}
          style={{
            backgroundColor: THEME_COLORS.INPUT_BG,
            borderColor: error ? SEMANTIC_COLORS.ERROR : THEME_COLORS.INPUT_BORDER,
            color: THEME_COLORS.INPUT_TEXT,
          }}
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-color-terminal-accent-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && searchResults.length > 0 && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto z-10 rounded border shadow-lg"
          style={{
            backgroundColor: THEME_COLORS.INPUT_BG,
            borderColor: THEME_COLORS.INPUT_BORDER,
          }}
        >
          {searchResults.map((result, idx) => (
            <button
              key={idx}
              onClick={() => handleSelectResult(result)}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className="w-full px-3 py-2 text-left transition-colors"
              style={{
                backgroundColor: idx === highlightedIndex ? 'rgba(100, 255, 218, 0.15)' : undefined,
                borderLeft: idx === highlightedIndex ? `3px solid ${STATUS_PLATE_COLORS.TESTING}` : '3px solid transparent',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-color-terminal-accent-primary terminal-mono">
                  {result.symbol}
                </span>
                {result.exchange && (
                  <span className="text-[10px] text-color-terminal-text-muted terminal-mono">
                    {result.exchange}
                  </span>
                )}
              </div>
              {result.name && (
                <div className="text-xs text-color-terminal-text-muted terminal-mono truncate">
                  {result.name}
                </div>
              )}
            </button>
          ))}
          {/* TICKET_641_10: Truncation hint */}
          {truncationInfo?.truncated && (
            <div className="px-3 py-1.5 text-[10px] text-color-terminal-text-muted terminal-mono border-t"
                 style={{ borderColor: THEME_COLORS.INPUT_BORDER }}>
              {t('config.searchTruncated', {
                count: searchResults.length,
                total: truncationInfo.totalCount,
              })}
            </div>
          )}
        </div>
      )}

      {error && (
        <span className="text-[10px] text-red-500 terminal-mono">{error}</span>
      )}
    </div>
  );
};

interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  className?: string;
}

const ToggleField: React.FC<ToggleFieldProps> = ({
  label,
  checked,
  onChange,
  description,
  disabled,
  className,
}) => {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        style={{
          backgroundColor: checked ? SEMANTIC_COLORS.SUCCESS : THEME_COLORS.INPUT_BORDER,
        }}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full shadow transform transition-transform',
          )}
          style={{
            backgroundColor: THEME_COLORS.INPUT_TEXT,
            transform: checked ? 'translateX(16px)' : 'translateX(0px)',
          }}
        />
      </button>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-color-terminal-text-muted terminal-mono">
          {label}
        </span>
        {description && (
          <span className="text-[10px] text-color-terminal-text-muted/60 terminal-mono">
            {description}
          </span>
        )}
      </div>
    </div>
  );
};

interface CompoundInputProps {
  label: string;
  value: number;
  unit: OrderSizeUnit;
  onValueChange: (value: number) => void;
  onUnitChange: (unit: OrderSizeUnit) => void;
  units: { value: OrderSizeUnit; label: string }[];
  error?: string;
  disabled?: boolean;
  className?: string;
}

const CompoundInput: React.FC<CompoundInputProps> = ({
  label,
  value,
  unit,
  onValueChange,
  onUnitChange,
  units,
  error,
  disabled,
  className,
}) => {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-[10px] uppercase tracking-wider text-color-terminal-text-muted terminal-mono">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            const maxVal = unit === 'percent' ? 100 : 100_000_000;
            if (Number.isFinite(v)) onValueChange(Math.max(0, Math.min(maxVal, v)));
          }}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            const maxVal = unit === 'percent' ? 100 : 100_000_000;
            onValueChange(Number.isFinite(v) ? Math.max(0, Math.min(maxVal, v)) : 0);
          }}
          disabled={disabled}
          min={0}
          max={unit === 'percent' ? 100 : 100_000_000}
          step={unit === 'percent' ? 1 : 0.01}
          className={cn(
            'flex-1 h-9 px-3 rounded border text-sm terminal-mono',
            'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary focus:border-color-terminal-accent-primary',
            'transition-colors',
            error && 'border-red-500',
            disabled && 'opacity-50 cursor-not-allowed',
            !error && 'border-color-terminal-border'
          )}
          style={{
            backgroundColor: THEME_COLORS.INPUT_BG,
            borderColor: error ? SEMANTIC_COLORS.ERROR : THEME_COLORS.INPUT_BORDER,
            color: THEME_COLORS.INPUT_TEXT,
          }}
        />
        <select
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as OrderSizeUnit)}
          disabled={disabled}
          className={cn(
            'w-24 h-9 px-2 rounded border text-sm terminal-mono',
            'focus:outline-none focus:ring-1 focus:ring-color-terminal-accent-primary focus:border-color-terminal-accent-primary',
            'transition-colors',
            error && 'border-red-500',
            disabled && 'opacity-50 cursor-not-allowed',
            !error && 'border-color-terminal-border'
          )}
          style={{
            backgroundColor: THEME_COLORS.INPUT_BG,
            borderColor: error ? SEMANTIC_COLORS.ERROR : THEME_COLORS.INPUT_BORDER,
            color: THEME_COLORS.INPUT_TEXT,
          }}
        >
          {units.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <span className="text-[10px] text-red-500 terminal-mono">{error}</span>
      )}
    </div>
  );
};

// =============================================================================
// BacktestDataConfigPanel Component
// =============================================================================

export const BacktestDataConfigPanel: React.FC<BacktestDataConfigPanelProps> = ({
  value,
  onChange,
  dataSources = [],
  onSymbolSearch,
  errors = {},
  disabled = false,
  className,
  isAuthenticated = false,
  maxLookback,
  mostRestrictivelookbackBars,
}) => {
  const { t } = useTranslation('backtest');

  // TICKET_248: timeframeOptions removed - timeframe now set at stage-level in WorkflowRowSelector

  // TICKET_305 Phase 3: Real-time lookback warning
  const lookbackWarning = useMemo(() => {
    if (!mostRestrictivelookbackBars || !value.startDate || !value.endDate) return null;
    const startMs = new Date(value.startDate).getTime();
    const endMs = new Date(value.endDate).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return null;
    const selectedDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));
    if (selectedDays <= mostRestrictivelookbackBars) return null;
    return t('validation.lookbackWarning', { selected: selectedDays, max: mostRestrictivelookbackBars });
  }, [mostRestrictivelookbackBars, value.startDate, value.endDate]);

  // Generate order size unit options with translations
  const orderSizeUnits = useMemo(() => [
    { value: 'cash' as OrderSizeUnit, label: t('orderUnits.cash') },
    { value: 'percent' as OrderSizeUnit, label: t('orderUnits.percent') },
    { value: 'shares' as OrderSizeUnit, label: t('orderUnits.shares') },
  ], [t]);

  // Handlers
  const handleChange = (field: keyof BacktestDataConfig, newValue: unknown) => {
    onChange({ ...value, [field]: newValue });
  };

  // TICKET_314: Cascading reset - clear dependent fields when data source changes
  const handleDataSourceChange = useCallback((newDataSource: string) => {
    if (newDataSource === value.dataSource) return;
    onChange({
      ...value,
      dataSource: newDataSource,
      symbol: '',
      startDate: '',
      endDate: '',
    });
  }, [value, onChange]);

  /**
   * Handle symbol selection from search results.
   * Auto-populate startDate and endDate from backend data availability.
   * TICKET_143: Include symbol in updates to avoid race condition with stale closure.
   * TICKET_305 Phase 2: If dates not in search result, call getSymbolDateRange API.
   */
  const handleSymbolSelect = useCallback(async (result: SymbolSearchResult) => {
    const updates: Partial<BacktestDataConfig> = {
      symbol: result.symbol,
    };

    // Parse startTime: "2005-02-13 13:00:00" -> "2005-02-13"
    if (result.startTime) {
      const startDate = result.startTime.split(' ')[0];
      if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        updates.startDate = startDate;
      }
    }

    // Parse endTime: "2024-10-08 13:00:00" -> "2024-10-08"
    if (result.endTime) {
      const endDate = result.endTime.split(' ')[0];
      if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        updates.endDate = endDate;
      }
    }

    // TICKET_305 Phase 2: Update symbol immediately (non-blocking)
    onChange({ ...value, ...updates });

    // If dates not available from search result, fetch via separate API call
    if (!updates.startDate || !updates.endDate) {
      try {
        const api = (window as any).electronAPI;
        if (api?.data?.getSymbolDateRange) {
          const dateRange = await api.data.getSymbolDateRange(result.symbol, value.dataSource);
          const dateUpdates: Partial<BacktestDataConfig> = {};

          if (dateRange?.startTime && !updates.startDate) {
            const sd = dateRange.startTime.split(' ')[0];
            if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) {
              dateUpdates.startDate = sd;
            }
          }
          if (dateRange?.endTime && !updates.endDate) {
            const ed = dateRange.endTime.split(' ')[0];
            if (ed && /^\d{4}-\d{2}-\d{2}$/.test(ed)) {
              dateUpdates.endDate = ed;
            }
          }

          if (Object.keys(dateUpdates).length > 0) {
            onChange({ ...value, ...updates, ...dateUpdates });
          }
        }
      } catch (error) {
        // Non-fatal: user can manually set dates
        console.warn('[W:BACKTEST:SYMBOL_DATE_RANGE_FAILED] [BacktestDataConfigPanel] Failed to fetch symbol date range:', error);
      }
    }
  }, [value, onChange]);

  return (
    <div className={cn('backtest-data-config-panel', className)}>
      {/* Title */}
      <h2 className="text-sm font-bold terminal-mono uppercase tracking-widest text-color-terminal-accent-gold mb-4">
        {t('config.title')}
      </h2>

      <div className="space-y-4">
        {/* Row 1: Data Source + Symbol Search */}
        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <DataSourceSelectField
              label={t('config.dataSource')}
              value={value.dataSource || DEFAULT_DATA_SOURCE}
              onChange={handleDataSourceChange}
              dataSources={dataSources}
              isAuthenticated={isAuthenticated}
              error={errors.dataSource}
              disabled={disabled}
            />
          </div>
          <SymbolSearchField
            label={t('config.symbol')}
            value={value.symbol}
            onChange={(v) => handleChange('symbol', v)}
            onSearch={onSymbolSearch}
            onSelect={handleSymbolSelect}
            dataSource={value.dataSource}
            error={errors.symbol}
            disabled={disabled}
            placeholder={value.dataSource === 'baostock' ? '600...' : t('config.searchSymbol')}
          />
        </div>

        {/* Row 2: Start Date + End Date (TICKET_248: Timeframe moved to stage-level) */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label={`${t('config.startDate')} (${getDateFormatHint()})`}
            type="date"
            value={value.startDate}
            onChange={(v) => handleChange('startDate', v)}
            error={errors.startDate}
            disabled={disabled}
          />
          <InputField
            label={`${t('config.endDate')} (${getDateFormatHint()})`}
            type="date"
            value={value.endDate}
            onChange={(v) => handleChange('endDate', v)}
            error={errors.endDate}
            disabled={disabled}
          />
        </div>
        {/* TICKET_305: Max lookback hint per interval */}
        {maxLookback && Object.keys(maxLookback).length > 0 && (
          <div className="text-[10px] text-color-terminal-text/50 terminal-mono mt-1">
            {Object.entries(maxLookback).map(([tf, lb]) => `${tf}:${lb}`).join(' | ')}
          </div>
        )}
        {/* TICKET_305 Phase 3: Amber lookback warning */}
        {lookbackWarning && (
          <div className="text-[10px] text-amber-400 terminal-mono mt-1">
            {lookbackWarning}
          </div>
        )}

        {/* Row 3: Initial Capital + Order Size */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label={t('config.initialCapital')}
            type="number"
            value={value.initialCapital}
            onChange={(v) => handleChange('initialCapital', parseFloat(v) || 0)}
            placeholder={t('backtestDataConfig.placeholderInitialCapital')}
            error={errors.initialCapital}
            disabled={disabled}
            min={0}
            max={100_000_000}
            step={100}
          />
          <CompoundInput
            label={t('config.orderSize')}
            value={value.orderSize}
            unit={value.orderSizeUnit || DEFAULT_ORDER_SIZE_UNIT}
            onValueChange={(v) => handleChange('orderSize', v)}
            onUnitChange={(u) => handleChange('orderSizeUnit', u)}
            units={orderSizeUnits}
            error={errors.orderSize}
            disabled={disabled}
          />
        </div>

        {/* Row 4: Confidence-weighted sizing toggle (TICKET_1130 Phase 3) */}
        <div className="flex items-center">
          <ToggleField
            label={t('config.confidenceWeightedSizing')}
            checked={value.confidenceWeightedSizing ?? false}
            onChange={(v) => handleChange('confidenceWeightedSizing', v)}
            description={t('config.confidenceWeightedSizingHint')}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
};

export default BacktestDataConfigPanel;
