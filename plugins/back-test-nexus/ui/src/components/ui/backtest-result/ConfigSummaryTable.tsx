/**
 * ConfigSummaryTable Component
 *
 * TICKET_378: Displays backtest configuration summary as a compact table
 * above the result charts. Shows data source, symbol, date range,
 * capital, order size, and workflow algorithms.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { BacktestConfigSummary, WorkflowTimeframes, FeedBarCountEntry } from './types';
import { formatNumber, getIntlLocale } from '@shared/utils/format-locale';

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

export interface ConfigSummaryTableProps {
  config: BacktestConfigSummary;
  workflowTimeframes?: WorkflowTimeframes;
  /** TICKET_1225 P5: per-feed bar counts from the engine result. */
  feedBarCounts?: FeedBarCountEntry[];
  /** TICKET_1225 P5: epoch-ms of the first next() bar (warmup end). */
  warmupEndTimestamp?: number;
  className?: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const formatCapital = (value: number): string => {
  return `$${formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const formatOrderSize = (size: number, unit: string, t: (key: string, opts?: Record<string, unknown>) => string): string => {
  if (unit === 'percent') return `${size}%`;
  if (unit === 'cash') return `$${size}`;
  return t('configSummary.sharesUnit', { size });
};

const labelClass = 'text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-muted';
const valueClass = 'text-[11px] text-color-terminal-text tabular-nums';

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const ConfigSummaryTable: React.FC<ConfigSummaryTableProps> = ({
  config,
  workflowTimeframes,
  feedBarCounts,
  warmupEndTimestamp,
  className,
}) => {
  const { t } = useTranslation('backtest');

  // TICKET_1225 P5: format warmup end timestamp as a date string
  const warmupEndLabel = warmupEndTimestamp && warmupEndTimestamp > 0
    ? new Date(warmupEndTimestamp).toISOString().slice(0, 10)
    : undefined;

  return (
    <div className={cn(
      'border border-color-terminal-border rounded bg-color-terminal-panel/30 px-4 py-2.5',
      className,
    )}>
      <table className="w-full text-left border-collapse">
        <tbody>
          {/* Row 1: Data Source + Symbol */}
          <tr>
            <td className={cn(labelClass, 'pr-3 py-0.5 w-[100px]')}>{t('configSummary.dataSource')}</td>
            <td className={cn(valueClass, 'pr-6 py-0.5')}>{config.dataSource}</td>
            <td className={cn(labelClass, 'pr-3 py-0.5 w-[100px]')}>{t('configSummary.symbol')}</td>
            <td className={cn(valueClass, 'py-0.5')}>{config.symbol}</td>
          </tr>
          {/* Row 2: Date Range */}
          <tr>
            <td className={cn(labelClass, 'pr-3 py-0.5')}>{t('configSummary.startDate')}</td>
            <td className={cn(valueClass, 'pr-6 py-0.5')}>{config.startDate}</td>
            <td className={cn(labelClass, 'pr-3 py-0.5')}>{t('configSummary.endDate')}</td>
            <td className={cn(valueClass, 'py-0.5')}>{config.endDate}</td>
          </tr>
          {/* Row 3: Capital + Order Size */}
          <tr>
            <td className={cn(labelClass, 'pr-3 py-0.5')}>{t('configSummary.capital')}</td>
            <td className={cn(valueClass, 'pr-6 py-0.5')}>{formatCapital(config.initialCapital)}</td>
            <td className={cn(labelClass, 'pr-3 py-0.5')}>{t('configSummary.orderSize')}</td>
            <td className={cn(valueClass, 'py-0.5')}>
              {formatOrderSize(config.orderSize, config.orderSizeUnit, t)}
              {config.confidenceWeightedSizing && (
                <span className="ml-2 text-[9px] text-color-terminal-accent-primary opacity-70">
                  [{t('configSummary.confidenceWeighted')}]
                </span>
              )}
            </td>
          </tr>
          {/* TICKET_1225 P5: Warmup effective date */}
          {warmupEndLabel && (
            <tr>
              <td className={cn(labelClass, 'pr-3 py-0.5')}>{t('configSummary.tradingEffective', 'TRADING EFFECTIVE')}</td>
              <td colSpan={3} className={cn(valueClass, 'py-0.5')}>
                <span className="text-color-terminal-accent-teal">{warmupEndLabel}</span>
              </td>
            </tr>
          )}
          {/* TICKET_1225 P5: Per-feed bar counts */}
          {feedBarCounts && feedBarCounts.length > 1 && (
            <tr>
              <td className={cn(labelClass, 'pr-3 py-0.5')}>{t('configSummary.feedBars', 'FEED BARS')}</td>
              <td colSpan={3} className={cn(valueClass, 'py-0.5')}>
                {feedBarCounts.map((entry, idx) => (
                  <React.Fragment key={entry.index}>
                    {idx > 0 && <span className="mx-1.5 text-color-terminal-border">|</span>}
                    <span className="font-bold text-color-terminal-text">
                      {entry.interval?.toUpperCase() || `feed${entry.index}`}
                    </span>
                    <span className="ml-1 text-color-terminal-text-muted">
                      {entry.bars.toLocaleString(getIntlLocale())} {t('resultPanel.bars', 'bars')}
                    </span>
                  </React.Fragment>
                ))}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ConfigSummaryTable;
