/**
 * WatchlistConfigPanel Component
 *
 * Watchlist configuration panel for Market Observer page.
 * Includes symbols input, timeframe selector, and data source selector.
 * Used in Zone C of Market Observer page (page35).
 *
 * @see TICKET_077_1 - Page Hierarchy (page35)
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d,
} from '@StratCraft/types';
import { cn } from '../../lib/utils';
import { THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WatchlistData {
  symbols: string[];
  timeframe: string;
  dataSource: string;
}

export interface TimeframeOption {
  value: string;
  label: string;
}

export interface DataSourceOption {
  value: string;
  label: string;
}

export interface WatchlistConfigPanelProps {
  /** Component title */
  title?: string;
  /** Current watchlist data */
  value: WatchlistData;
  /** Callback when watchlist data changes */
  onChange: (data: WatchlistData) => void;
  /** Timeframe options */
  timeframeOptions?: TimeframeOption[];
  /** Data source options */
  dataSourceOptions?: DataSourceOption[];
  /** Symbol input placeholder */
  symbolPlaceholder?: string;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_TITLE = 'WATCHLIST CONFIGURATION';

const DEFAULT_TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { value: INTERVAL_1m, label: '1M' },
  { value: INTERVAL_5m, label: '5M' },
  { value: INTERVAL_15m, label: '15M' },
  { value: INTERVAL_1h, label: '1H' },
  { value: INTERVAL_4h, label: '4H' },
  { value: INTERVAL_1d, label: '1D' },
];

// -----------------------------------------------------------------------------
// WatchlistConfigPanel Component
// -----------------------------------------------------------------------------

export const WatchlistConfigPanel: React.FC<WatchlistConfigPanelProps> = ({
  title,
  value,
  onChange,
  timeframeOptions = DEFAULT_TIMEFRAME_OPTIONS,
  dataSourceOptions = [],
  symbolPlaceholder,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [symbolInput, setSymbolInput] = useState('');
  const componentTitle = title || t('ui.watchlistConfig.title');
  const placeholderText = symbolPlaceholder || t('ui.watchlistConfig.symbolPlaceholder');

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleAddSymbol = useCallback(() => {
    const symbol = symbolInput.trim().toUpperCase();
    if (symbol && !value.symbols.includes(symbol)) {
      onChange({
        ...value,
        symbols: [...value.symbols, symbol],
      });
      setSymbolInput('');
    }
  }, [symbolInput, value, onChange]);

  const handleRemoveSymbol = useCallback((symbol: string) => {
    onChange({
      ...value,
      symbols: value.symbols.filter(s => s !== symbol),
    });
  }, [value, onChange]);

  const handleTimeframeChange = useCallback((timeframe: string) => {
    onChange({ ...value, timeframe });
  }, [value, onChange]);

  const handleDataSourceChange = useCallback((dataSource: string) => {
    onChange({ ...value, dataSource });
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSymbol();
    }
  }, [handleAddSymbol]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={cn('watchlist-config-panel', className)}>
      {/* Panel Container */}
      <div className="p-4 border border-color-terminal-border rounded-lg bg-color-terminal-panel/20">
        {/* Title */}
        <h3 className="text-xs font-bold uppercase tracking-wider text-color-terminal-accent-teal mb-4">
          {componentTitle}
        </h3>

        {/* Symbols Section */}
        <div className="mb-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-2 block">
            {t('ui.watchlistConfig.symbols')}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              className="flex-1 px-3 py-2 text-xs terminal-mono border rounded focus:outline-none focus:border-color-terminal-accent-teal"
              style={{
                backgroundColor: THEME_COLORS.INPUT_BG,
                borderColor: THEME_COLORS.INPUT_BORDER,
                color: THEME_COLORS.INPUT_TEXT,
              }}
            />
            <button
              onClick={handleAddSymbol}
              disabled={!symbolInput.trim()}
              className={cn(
                'px-4 py-2 text-xs font-bold uppercase border rounded transition-all',
                symbolInput.trim()
                  ? 'border-color-terminal-accent-teal text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/10'
                  : 'border-color-terminal-border text-color-terminal-text-muted cursor-not-allowed'
              )}
            >
              {t('ui.watchlistConfig.add')}
            </button>
          </div>

          {/* Symbol Tags */}
          {value.symbols.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {value.symbols.map((symbol) => (
                <span
                  key={symbol}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal rounded border border-color-terminal-accent-teal/30"
                >
                  {symbol}
                  <button
                    onClick={() => handleRemoveSymbol(symbol)}
                    className="hover:text-red-400 transition-colors"
                    aria-label={t('ui.watchlistConfig.removeSymbolAria', { symbol })}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Timeframe & Data Source Row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Timeframe */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-2 block">
              {t('ui.watchlistConfig.timeframe')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {timeframeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleTimeframeChange(opt.value)}
                  className={cn(
                    'min-w-[36px] px-2.5 py-1.5 text-[10px] font-bold uppercase border rounded transition-all',
                    value.timeframe === opt.value
                      ? 'border-color-terminal-accent-gold bg-color-terminal-accent-gold/20 text-color-terminal-accent-gold'
                      : 'border-color-terminal-border text-color-terminal-text-muted hover:border-color-terminal-accent-gold/50 hover:text-color-terminal-text-secondary'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Data Source */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary mb-2 block">
              {t('ui.watchlistConfig.dataSource')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {dataSourceOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleDataSourceChange(opt.value)}
                  className={cn(
                    'px-3 py-1.5 text-[10px] font-bold uppercase border rounded transition-all',
                    value.dataSource === opt.value
                      ? 'border-color-terminal-accent-purple bg-color-terminal-accent-purple/20 text-color-terminal-accent-purple'
                      : 'border-color-terminal-border text-color-terminal-text-muted hover:border-color-terminal-accent-purple/50 hover:text-color-terminal-text-secondary'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WatchlistConfigPanel;
