/**
 * TICKET_358: Trades Tab - Trade list table
 * Extracted from BacktestResultPanel.tsx
 */

import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { ExecutorTrade } from './types';
import { formatCurrency, formatDate, getColorClass, safeNum } from './format-utils';
import type { ResultTabComponentProps } from './tab-registry';

// Single case trades table
const SingleCaseTrades: React.FC<{ trades: ExecutorTrade[] }> = ({ trades }) => {
  const { t } = useTranslation('backtest');
  return (
    <div className="p-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-color-terminal-border text-left">
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted">{t('resultPanel.tradesTable.index')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted">{t('resultPanel.tradesTable.entryTime')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted">{t('resultPanel.tradesTable.exitTime')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted">{t('resultPanel.tradesTable.side')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted text-right">{t('resultPanel.tradesTable.entry')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted text-right">{t('resultPanel.tradesTable.exit')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted text-right">{t('resultPanel.tradesTable.qty')}</th>
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted text-right">{t('resultPanel.tradesTable.pnl')}</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 100).map((trade, index) => (
              <tr key={index} className="border-b border-color-terminal-border/50 hover:bg-color-terminal-surface/30">
                <td className="py-2 pr-4 text-color-terminal-text-muted">{index + 1}</td>
                <td className="py-2 pr-4 text-color-terminal-text tabular-nums">{formatDate(safeNum(trade.entryTime))}</td>
                <td className="py-2 pr-4 text-color-terminal-text tabular-nums">{formatDate(safeNum(trade.exitTime))}</td>
                <td className={cn('py-2 pr-4 font-medium', trade.side === 'BUY' ? 'text-green-400' : 'text-red-400')}>
                  {trade.side || '-'}
                </td>
                <td className="py-2 pr-4 text-right text-color-terminal-text tabular-nums">
                  ${safeNum(trade.entryPrice).toFixed(2)}
                </td>
                <td className="py-2 pr-4 text-right text-color-terminal-text tabular-nums">
                  ${safeNum(trade.exitPrice).toFixed(2)}
                </td>
                <td className="py-2 pr-4 text-right text-color-terminal-text tabular-nums">
                  {safeNum(trade.quantity).toFixed(4)}
                </td>
                <td className={cn('py-2 pr-4 text-right font-medium tabular-nums', getColorClass(trade.pnl))}>
                  {formatCurrency(trade.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades.length > 100 && (
          <div className="mt-2 text-xs text-color-terminal-text-muted">
            {t('resultPanel.tradesTable.showingOf', { shown: 100, total: trades.length })}
          </div>
        )}
        {trades.length === 0 && (
          <div className="py-8 text-center text-xs text-color-terminal-text-muted">
            {t('resultPanel.tradesTable.noTrades')}
          </div>
        )}
      </div>
    </div>
  );
};

export const TradesTab: React.FC<ResultTabComponentProps> = ({
  results,
  currentCaseIndex,
  isExecuting,
  totalCases = 0,
  scrollToCaseRef,
}) => {
  const { t } = useTranslation('backtest');
  const containerRef = useRef<HTMLDivElement>(null);
  const caseRefs = useRef<(HTMLDivElement | null)[]>([]);

  const casesToRender = isExecuting && totalCases > 0 ? totalCases : results.length;

  useEffect(() => {
    if (currentCaseIndex && currentCaseIndex > 0 && isExecuting) {
      const targetRef = caseRefs.current[currentCaseIndex - 1];
      targetRef?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentCaseIndex, isExecuting]);

  useEffect(() => {
    if (scrollToCaseRef) {
      scrollToCaseRef.current = (index: number) => {
        caseRefs.current[index]?.scrollIntoView({ behavior: 'smooth' });
      };
    }
  }, [scrollToCaseRef]);

  if (casesToRender === 0) {
    return (
      <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-xs">
        {t('resultPanel.status.noResults')}
      </div>
    );
  }

  // Single case and not executing multi-case: render without case header
  if (casesToRender === 1 && !isExecuting) {
    return <SingleCaseTrades trades={results[0]?.trades || []} />;
  }

  // Multiple cases: vertical stacking with case headers
  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      {Array.from({ length: casesToRender }).map((_, index) => {
        const result = results[index];
        const hasResult = !!result;
        const isCurrentCase = isExecuting && currentCaseIndex === index + 1;

        return (
          <div
            key={index}
            ref={el => caseRefs.current[index] = el}
            className="min-h-full border-b border-color-terminal-border last:border-b-0"
          >
            {/* Case Header */}
            <div className="px-4 py-2 bg-color-terminal-panel/50 border-b border-color-terminal-border sticky top-0 z-10">
              <span className={cn(
                'text-xs font-bold uppercase',
                hasResult ? 'text-green-400' : isCurrentCase ? 'text-yellow-400' : 'text-color-terminal-text-secondary'
              )}>
                {t('resultPanel.status.case', { index: index + 1 })}
                {isCurrentCase && t('resultPanel.status.testing')}
              </span>
              {hasResult && result.metrics && (
                <span className={cn(
                  'ml-3 text-xs tabular-nums',
                  result.metrics.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'
                )}>
                  {result.metrics.totalPnl >= 0 ? '+' : ''}{result.metrics.totalPnl?.toFixed(2) || '0.00'}
                </span>
              )}
              {hasResult && (
                <span className="ml-3 text-xs text-color-terminal-text-muted">
                  {t('resultPanel.status.tradesCount', { count: result.trades?.length || 0 })}
                </span>
              )}
            </div>

            {/* Trades for this case */}
            {hasResult ? (
              <SingleCaseTrades trades={result.trades} />
            ) : (
              <div className="flex items-center justify-center h-48 text-color-terminal-text-muted text-xs">
                {isCurrentCase ? t('resultPanel.status.collectingData') : t('resultPanel.status.waiting')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
