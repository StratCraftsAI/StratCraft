/**
 * PerformanceOverviewChart - Aggregate backtest performance visualization
 * 
 * Placeholder for chart integration (recharts or visx)
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PERFORMANCE_CHART_COLORS } from '@shared/constants/colors';

type TimeRange = '30D' | '90D' | '1Y';

interface PerformanceOverviewChartProps {
  className?: string;
}

export const PerformanceOverviewChart: React.FC<PerformanceOverviewChartProps> = ({
  className
}) => {
  const { t } = useTranslation('ui');
  const [selectedRange, setSelectedRange] = useState<TimeRange>('30D');

  const ranges: TimeRange[] = ['30D', '90D', '1Y'];

  return (
    <div className={cn(
      'bg-color-terminal-panel border border-color-terminal-border rounded-lg p-4 shadow-lg h-full flex flex-col',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-color-terminal-text-secondary">
            {t('strategy.performanceChart.title')}
          </h3>
          <p className="text-[8px] text-color-terminal-text-muted mt-0.5">
            {t('strategy.performanceChart.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          {ranges.map((range) => (
            <button
              key={range}
              onClick={() => setSelectedRange(range)}
              className={cn(
                'px-2 py-1 text-[8px] rounded font-bold transition-colors',
                selectedRange === range
                  ? 'bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal'
                  : 'text-color-terminal-text-muted hover:bg-white/5'
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Area - Placeholder */}
      <div className="flex-1 relative min-h-[200px]">
        <div className="absolute inset-0 flex flex-col items-center justify-center 
                        text-color-terminal-text-muted">
          <LineChart className="w-16 h-16 opacity-20 mb-3" />
          <p className="text-xs">{t('strategy.performanceChart.chartPending')}</p>
          <p className="text-[8px] mt-1">
            {t('strategy.performanceChart.chartPendingHint')}
          </p>
        </div>
        
        {/* Future: Integrate recharts or visx here */}
        {/* <ResponsiveContainer width="100%" height="100%">
          <LineChart data={performanceData}>
            <Line type="monotone" dataKey="value" stroke={PERFORMANCE_CHART_COLORS.LINE_STROKE} />
          </LineChart>
        </ResponsiveContainer> */}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-color-terminal-border">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-color-terminal-accent-teal rounded-full" />
          <span className="text-[8px] text-color-terminal-text-muted">
            {t('strategy.performanceChart.winRate')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-color-terminal-accent-gold rounded-full" />
          <span className="text-[8px] text-color-terminal-text-muted">
            {t('strategy.performanceChart.sharpeRatio')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-blue-400 rounded-full" />
          <span className="text-[8px] text-color-terminal-text-muted">
            {t('strategy.performanceChart.totalReturn')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default PerformanceOverviewChart;
