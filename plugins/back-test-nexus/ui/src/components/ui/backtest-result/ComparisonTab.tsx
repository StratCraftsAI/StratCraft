/**
 * TICKET_358: Comparison Tab - Multi-result comparison table + equity overlay
 * Extracted from BacktestResultPanel.tsx
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { EquityPoint } from './types';
import { formatCurrency, formatPercent, formatRatio, getColorClass, safeNum } from './format-utils';
import { MAX_RENDER_POINTS, safeMinMax, downsampleLTTB } from './downsample-utils';
import type { ResultTabComponentProps } from './tab-registry';
import { COMPARISON_PALETTE } from '@shared/constants/colors';

// Color palette for multiple strategies -- sourced from centralized design tokens
export const STRATEGY_COLORS = COMPARISON_PALETTE;

export const ComparisonTab: React.FC<ResultTabComponentProps> = ({ results }) => {
  const { t } = useTranslation('backtest');

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-xs">
        {t('resultPanel.comparison.noResults')}
      </div>
    );
  }

  // Comparison metrics table
  const renderComparisonTable = () => (
    <div className="p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-color-terminal-text-muted mb-3">
        {t('resultPanel.comparison.title')}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-color-terminal-border text-left">
              <th className="pb-2 pr-4 font-medium text-color-terminal-text-muted">{t('resultPanel.comparison.metric')}</th>
              {results.map((_, i) => (
                <th key={i} className="pb-2 pr-4 font-medium" style={{ color: STRATEGY_COLORS[i % STRATEGY_COLORS.length] }}>
                  {t('resultPanel.comparison.strategy', { index: i + 1 })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.totalPnl')}</td>
              {results.map((r, i) => (
                <td key={i} className={cn('py-2 pr-4 tabular-nums font-medium', getColorClass(r.metrics.totalPnl))}>
                  {formatCurrency(r.metrics.totalPnl)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.totalReturn')}</td>
              {results.map((r, i) => (
                <td key={i} className={cn('py-2 pr-4 tabular-nums font-medium', getColorClass(r.metrics.totalReturn))}>
                  {formatPercent(r.metrics.totalReturn)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.sharpeRatio')}</td>
              {results.map((r, i) => (
                <td key={i} className="py-2 pr-4 tabular-nums">
                  {formatRatio(r.metrics.sharpeRatio)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.maxDrawdown')}</td>
              {results.map((r, i) => (
                <td key={i} className="py-2 pr-4 tabular-nums text-red-400">
                  {formatPercent(-Math.abs(safeNum(r.metrics.maxDrawdown)))}
                </td>
              ))}
            </tr>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.winRate')}</td>
              {results.map((r, i) => (
                <td key={i} className={cn('py-2 pr-4 tabular-nums', safeNum(r.metrics.winRate) >= 50 ? 'text-green-400' : 'text-yellow-400')}>
                  {formatPercent(r.metrics.winRate)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.totalTrades')}</td>
              {results.map((r, i) => (
                <td key={i} className="py-2 pr-4 tabular-nums">
                  {safeNum(r.metrics.totalTrades)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-color-terminal-border/50">
              <td className="py-2 pr-4 text-color-terminal-text-muted">{t('resultPanel.comparison.profitFactor')}</td>
              {results.map((r, i) => (
                <td key={i} className={cn('py-2 pr-4 tabular-nums', safeNum(r.metrics.profitFactor) >= 1.5 ? 'text-green-400' : safeNum(r.metrics.profitFactor) >= 1 ? 'text-yellow-400' : 'text-red-400')}>
                  {formatRatio(r.metrics.profitFactor)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  // Overlay equity curves
  const renderOverlayEquityCurves = () => {
    const height = 200;
    const width = 100;

    let allEquities: number[] = [];
    results.forEach(r => {
      if (r.equityCurve) {
        allEquities = allEquities.concat(r.equityCurve.filter(p => Number.isFinite(p.equity)).map(p => p.equity));
      }
    });

    if (allEquities.length === 0) {
      return (
        <div className="flex items-center justify-center h-40 text-color-terminal-text-muted text-xs">
          {t('resultPanel.charts.noEquityData')}
        </div>
      );
    }

    const { min: rawOverlayMin, max: rawOverlayMax } = safeMinMax(allEquities, v => v);
    const minEquity = rawOverlayMin * 0.98;
    const maxEquity = rawOverlayMax * 1.02;
    const range = maxEquity - minEquity || 1;

    return (
      <div className="p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-color-terminal-text-muted mb-3">
          {t('resultPanel.comparison.equityOverlay')}
        </div>
        <div className="border border-color-terminal-border rounded bg-color-terminal-panel/30" style={{ height }}>
          <svg viewBox={`0 0 ${width} 100`} className="w-full h-full" preserveAspectRatio="none">
            {results.map((r, resultIdx) => {
              const validCurve = (r.equityCurve || []).filter(p => Number.isFinite(p.equity));
              if (validCurve.length < 2) return null;

              const renderCurve = downsampleLTTB(validCurve, MAX_RENDER_POINTS, p => p.equity);
              const overlayIndices = new Map<EquityPoint, number>();
              for (let i = 0; i < validCurve.length; i++) overlayIndices.set(validCurve[i], i);

              const points = renderCurve.map((point) => {
                const origIdx = overlayIndices.get(point) ?? 0;
                const x = (origIdx / (validCurve.length - 1)) * width;
                const y = 100 - ((point.equity - minEquity) / range) * 100;
                return `${x},${y}`;
              }).join(' ');

              return (
                <polyline
                  key={resultIdx}
                  fill="none"
                  stroke={STRATEGY_COLORS[resultIdx % STRATEGY_COLORS.length]}
                  strokeWidth="0.4"
                  points={points}
                />
              );
            })}
          </svg>
        </div>
        {/* Legend */}
        <div className="flex gap-4 mt-2">
          {results.map((_, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px]">
              <div className="w-3 h-0.5" style={{ backgroundColor: STRATEGY_COLORS[i % STRATEGY_COLORS.length] }} />
              <span className="text-color-terminal-text-muted">{t('resultPanel.comparison.strategy', { index: i + 1 })}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-y-auto h-full">
      {renderComparisonTable()}
      {renderOverlayEquityCurves()}
    </div>
  );
};
