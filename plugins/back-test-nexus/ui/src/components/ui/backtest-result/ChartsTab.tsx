/**
 * TICKET_358: Charts Tab - Equity Curve + K-Line dual chart
 * Extracted from BacktestResultPanel.tsx
 */

import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { getCandleColor, isCandleProcessed } from '../../../utils/chart-utils';
import { formatNumber } from '@shared/utils/format-locale';
import { CHART_COLORS, SEMANTIC_COLORS } from '@shared/constants/colors';
import type { ExecutorResult, EquityPoint, Candle, ExecutorTrade } from './types';
import { formatPercent } from './format-utils';
import { MAX_RENDER_POINTS, safeMinMax, downsampleOHLC, downsampleLTTB } from './downsample-utils';
import { SpinnerIcon, CheckmarkIcon, CancelledIcon } from './icons';
import type { ResultTabComponentProps } from './tab-registry';

// -----------------------------------------------------------------------------
// Single Case Charts (Dual-Chart: Equity + K-Line) - TICKET_151_1
// -----------------------------------------------------------------------------

interface SingleCaseChartsProps {
  equityCurve: EquityPoint[];
  candles: Candle[];
  trades: ExecutorTrade[];
  /** TICKET_231: Number of bars processed for gray-to-color transition */
  processedBars?: number;
  /** TICKET_231: Total bars in backtest */
  backtestTotalBars?: number;
  /** TICKET_234_3: Whether backtest is currently executing */
  isExecuting?: boolean;
  /** TICKET_374: Whether backtest was cancelled */
  isCancelled?: boolean;
  /** TICKET_401: Executor progress (0-100) for progressive chart rendering */
  executorProgress?: number;
  /** TICKET_1225 P5: epoch-ms of the first next() bar (warmup end marker). */
  warmupEndTimestamp?: number;
}

const SingleCaseCharts: React.FC<SingleCaseChartsProps> = ({
  equityCurve,
  candles,
  trades,
  processedBars = 0,
  backtestTotalBars = 0,
  isExecuting = false,
  isCancelled = false,
  executorProgress = 0,
  warmupEndTimestamp,
}) => {
  const { t } = useTranslation('backtest');

  // TICKET_401: Use executorProgress (Tab percentage, 0-100) to gate progressive rendering
  const isBacktestInProgress = isExecuting && executorProgress > 0 && executorProgress < 100;

  // Equity curve chart dimensions
  const equityHeight = 180;
  const klineHeight = 220;

  // Equity curve rendering
  const renderEquityCurve = () => {
    // TICKET_234_3: Show status indicator when no equity data
    // TICKET_374: Show cancelled indicator when backtest was cancelled
    if (!equityCurve || equityCurve.length === 0) {
      if (isCancelled) {
        return (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <CancelledIcon className="w-8 h-8 text-red-400" />
            <span className="text-xs text-red-400 font-mono uppercase tracking-wider">
              {t('resultPanel.status.cancelled')}
            </span>
          </div>
        );
      }
      if (isExecuting) {
        return (
          <div className="flex items-center justify-center h-full">
            <SpinnerIcon className="w-8 h-8 text-color-terminal-accent-teal" />
          </div>
        );
      } else {
        return (
          <div className="flex items-center justify-center h-full">
            <CheckmarkIcon className="w-8 h-8 text-color-terminal-accent-gold" />
          </div>
        );
      }
    }

    // TICKET_154: Filter out invalid equity values (NaN, Infinity, overflow)
    const validEquityCurve = equityCurve.filter(p =>
      Number.isFinite(p.equity) && Math.abs(p.equity) < 1e15
    );

    // TICKET_401: Limit equity display to executorProgress percentage
    const displayLimit = isBacktestInProgress
      ? Math.max(2, Math.floor((executorProgress / 100) * validEquityCurve.length))
      : validEquityCurve.length;
    const displayEquityCurve = validEquityCurve.slice(0, displayLimit);

    // TICKET_155: Need at least 2 points to render a line
    if (displayEquityCurve.length < 2) {
      return (
        <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-xs">
          {t('resultPanel.charts.processing', { count: displayEquityCurve.length })}
        </div>
      );
    }

    // TICKET_317: Loop-based min/max to avoid stack overflow on large datasets
    const { min: rawMin, max: rawMax } = safeMinMax(displayEquityCurve, p => p.equity);
    const minEquity = rawMin * 0.98;
    const maxEquity = rawMax * 1.02;
    const range = maxEquity - minEquity || 1;

    const width = 100;
    const height = 100;
    // TICKET_231: Use candles.length as X-axis reference to sync with K-LINE chart
    const totalXPoints = candles?.length || displayEquityCurve.length;

    // TICKET_317: Downsample equity curve for SVG rendering
    const renderCurve = downsampleLTTB(displayEquityCurve, MAX_RENDER_POINTS, p => p.equity);
    const originalIndices = new Map<EquityPoint, number>();
    for (let i = 0; i < displayEquityCurve.length; i++) originalIndices.set(displayEquityCurve[i], i);

    const equityPoints = renderCurve.map((point) => {
      const origIdx = originalIndices.get(point) ?? 0;
      const x = (origIdx / (totalXPoints - 1)) * width;
      const y = height - ((point.equity - minEquity) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    const firstOrigIdx = originalIndices.get(renderCurve[0]) ?? 0;
    const lastOrigIdx = originalIndices.get(renderCurve[renderCurve.length - 1]) ?? (displayEquityCurve.length - 1);
    const firstX = (firstOrigIdx / (totalXPoints - 1)) * width;
    const lastX = (lastOrigIdx / (totalXPoints - 1)) * width;
    // TICKET_399_1: Area fill spans only the equity data range (firstX to lastX),
    // preventing visual collapse when equity covers less than full chart width.
    const areaPath = `M ${firstX},${height} ` + renderCurve.map((point) => {
      const origIdx = originalIndices.get(point) ?? 0;
      const x = (origIdx / (totalXPoints - 1)) * width;
      const y = height - ((point.equity - minEquity) / range) * height;
      return `L ${x},${y}`;
    }).join(' ') + ` L ${lastX},${height} Z`;

    const startEquity = displayEquityCurve[0]?.equity || 0;
    const endEquity = displayEquityCurve[displayEquityCurve.length - 1]?.equity || 0;
    const pnl = endEquity - startEquity;
    const color = pnl >= 0 ? CHART_COLORS.EQUITY_PROFIT : CHART_COLORS.EQUITY_LOSS;

    // TICKET_1225 P5: compute warmup marker X position from timestamp
    let warmupMarkerX: number | undefined;
    if (warmupEndTimestamp && warmupEndTimestamp > 0 && displayEquityCurve.length > 1) {
      // Find the equity curve point closest to warmupEndTimestamp
      let warmupIdx = 0;
      for (let i = 0; i < displayEquityCurve.length; i++) {
        if (displayEquityCurve[i].timestamp >= warmupEndTimestamp) {
          warmupIdx = i;
          break;
        }
      }
      if (warmupIdx > 0 && warmupIdx < displayEquityCurve.length - 1) {
        warmupMarkerX = (warmupIdx / (totalXPoints - 1)) * width;
      }
    }

    return (
      <>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-color-terminal-border/50">
          <span className="text-[10px] font-medium uppercase tracking-wider text-color-terminal-text-muted">
            {t('resultPanel.charts.equityCurve')}
          </span>
          <span className={cn('text-xs tabular-nums font-medium', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            ${formatNumber(endEquity, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({formatPercent(startEquity > 0 ? (pnl / startEquity) * 100 : 0)})
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: equityHeight - 32 }} preserveAspectRatio="none">
          <defs>
            <linearGradient id="equityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#equityGrad)" />
          <polyline fill="none" stroke={color} strokeWidth="0.3" points={equityPoints} />
          {/* TICKET_1225 P5: warmup end vertical marker */}
          {warmupMarkerX !== undefined && (
            <line
              x1={warmupMarkerX} y1={0} x2={warmupMarkerX} y2={height}
              stroke={SEMANTIC_COLORS.INFO || '#60a5fa'}
              strokeWidth="0.2"
              strokeDasharray="1,1"
              opacity={0.6}
            />
          )}
        </svg>
      </>
    );
  };

  // K-line chart rendering
  const renderKLineChart = () => {
    if (!candles || candles.length === 0) {
      // TICKET_374: Show cancelled indicator when backtest was cancelled
      if (isCancelled) {
        return (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <CancelledIcon className="w-8 h-8 text-red-400" />
            <span className="text-xs text-red-400 font-mono uppercase tracking-wider">
              {t('resultPanel.status.cancelled', 'Cancelled')}
            </span>
          </div>
        );
      }
      if (isExecuting) {
        return (
          <div className="flex items-center justify-center h-full">
            <SpinnerIcon className="w-8 h-8 text-color-terminal-accent-teal" />
          </div>
        );
      }
      return (
        <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-xs">
          {t('resultPanel.charts.noKlineData')}
        </div>
      );
    }

    // TICKET_401: K-line shows all candles from the start (gray for unprocessed),
    // color transition driven by executorProgress percentage
    const progressBars = isBacktestInProgress
      ? Math.floor((executorProgress / 100) * candles.length)
      : candles.length;

    const viewWidth = 100;
    const viewHeight = 100;
    const margin = { top: 5, bottom: 15 };
    const chartHeight = viewHeight - margin.top - margin.bottom;

    const { min: rawMinPrice } = safeMinMax(candles, c => c.low);
    const { max: rawMaxHigh } = safeMinMax(candles, c => c.high);
    const minPrice = rawMinPrice * 0.998;
    const maxPrice = rawMaxHigh * 1.002;
    const priceRange = maxPrice - minPrice || 1;

    const renderCandles = downsampleOHLC(candles, MAX_RENDER_POINTS);

    const candleWidth = viewWidth / renderCandles.length;
    const bodyWidth = candleWidth * 0.7;

    const priceToY = (price: number) => margin.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

    return (
      <>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-color-terminal-border/50">
          <span className="text-[10px] font-medium uppercase tracking-wider text-color-terminal-text-muted">
            {t('resultPanel.charts.klineChart')}
          </span>
          <span className="text-[10px] text-color-terminal-text-muted tabular-nums">
            {t('resultPanel.charts.bars', { count: candles.length })}
          </span>
        </div>
        <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} className="w-full" style={{ height: klineHeight - 32 }} preserveAspectRatio="none">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((ratio, i) => (
            <line
              key={i}
              x1={0}
              x2={viewWidth}
              y1={margin.top + chartHeight * ratio}
              y2={margin.top + chartHeight * ratio}
              stroke={CHART_COLORS.GRID}
              strokeOpacity={0.3}
              strokeDasharray="0.5,1"
            />
          ))}

          {/* Candles - TICKET_317: Render downsampled candles */}
          {renderCandles.map((candle, i) => {
            const x = i * candleWidth + candleWidth / 2;
            const isUp = candle.close >= candle.open;
            const bucketRatio = candles.length / renderCandles.length;
            const origIdx = Math.floor(i * bucketRatio);
            const isProcessed = !isExecuting || isCandleProcessed(origIdx, progressBars, candles.length);
            const color = getCandleColor(isUp, isProcessed);
            const bodyTop = priceToY(Math.max(candle.open, candle.close));
            const bodyBottom = priceToY(Math.min(candle.open, candle.close));
            const bodyH = Math.max(0.3, bodyBottom - bodyTop);

            return (
              <g key={i}>
                <line
                  x1={x}
                  x2={x}
                  y1={priceToY(candle.high)}
                  y2={priceToY(candle.low)}
                  stroke={color}
                  strokeWidth={0.1}
                />
                <rect
                  x={x - bodyWidth / 2}
                  y={bodyTop}
                  width={bodyWidth}
                  height={bodyH}
                  fill={color}
                />
              </g>
            );
          })}

          {/* Trade markers */}
          {trades
            .filter((_, idx) => idx % Math.max(1, Math.ceil(trades.length / 50)) === 0)
            .slice(0, 50)
            .map((trade, i) => {
            const tradeTime = trade.entryTime;
            const origCandleIndex = candles.findIndex((c, idx) =>
              c.timestamp <= tradeTime && (idx === candles.length - 1 || candles[idx + 1].timestamp > tradeTime)
            );
            if (origCandleIndex < 0) return null;

            const dsIndex = Math.floor(origCandleIndex / (candles.length / renderCandles.length));
            const x = Math.min(dsIndex, renderCandles.length - 1) * candleWidth + candleWidth / 2;
            const y = priceToY(trade.entryPrice);
            const isBuy = trade.side.toLowerCase().includes('buy');

            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={0.8}
                fill={isBuy ? SEMANTIC_COLORS.SUCCESS : SEMANTIC_COLORS.ERROR}
                stroke={SEMANTIC_COLORS.WHITE}
                strokeWidth={0.15}
              />
            );
          })}

          {/* Price labels */}
          <text x={viewWidth - 1} y={margin.top + 2} className="text-[2px] fill-color-terminal-text-muted" textAnchor="end">
            {maxPrice.toFixed(0)}
          </text>
          <text x={viewWidth - 1} y={viewHeight - margin.bottom - 1} className="text-[2px] fill-color-terminal-text-muted" textAnchor="end">
            {minPrice.toFixed(0)}
          </text>
        </svg>
      </>
    );
  };

  return (
    <div className="p-3 space-y-3">
      {/* Equity Curve */}
      <div className="border border-color-terminal-border rounded bg-color-terminal-panel/30" style={{ height: equityHeight }}>
        {renderEquityCurve()}
      </div>

      {/* K-Line Chart */}
      <div className="border border-color-terminal-border rounded bg-color-terminal-panel/30" style={{ height: klineHeight }}>
        {renderKLineChart()}
      </div>

      {/* Summary */}
      <div className="text-[10px] text-color-terminal-text-muted flex justify-between">
        <span>{t('resultPanel.summary.equity', { count: equityCurve?.length || 0 })}</span>
        <span>{t('resultPanel.summary.candles', { count: candles?.length || 0 })}</span>
        <span>{t('resultPanel.summary.trades', { count: trades?.length || 0 })}</span>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// TICKET_151_1: Charts Tab with Multi-Case Vertical Stacking
// -----------------------------------------------------------------------------

export const ChartsTab: React.FC<ResultTabComponentProps> = ({
  results,
  currentCaseIndex,
  isExecuting,
  isCancelled,
  totalCases = 0,
  scrollToCaseRef,
  processedBars = 0,
  backtestTotalBars = 0,
  executorProgress = 0,
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

  // Single case: render without case header
  if (casesToRender === 1) {
    return (
      <SingleCaseCharts
        equityCurve={results[0]?.equityCurve || []}
        candles={results[0]?.candles || []}
        trades={results[0]?.trades || []}
        processedBars={processedBars}
        backtestTotalBars={backtestTotalBars}
        isExecuting={isExecuting}
        isCancelled={isCancelled}
        executorProgress={executorProgress}
        warmupEndTimestamp={results[0]?.warmupEndTimestamp}
      />
    );
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
            </div>

            {/* Charts for this case */}
            {hasResult ? (
              <SingleCaseCharts
                equityCurve={result.equityCurve}
                candles={result.candles || []}
                trades={result.trades}
                processedBars={processedBars}
                backtestTotalBars={backtestTotalBars}
                isExecuting={isCurrentCase}
                executorProgress={executorProgress}
                warmupEndTimestamp={result.warmupEndTimestamp}
              />
            ) : (
              <div className="flex items-center justify-center h-96 text-color-terminal-text-muted text-xs">
                {isCurrentCase ? t('resultPanel.status.collectingData') : t('resultPanel.status.waiting')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
