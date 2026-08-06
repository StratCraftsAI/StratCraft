/**
 * ChartSettings - Chart settings panel
 *
 * Sidebar component for configuring chart parameters
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHART_COLORS } from '@shared/constants/colors';

// =============================================================================
// Types
// =============================================================================

interface ChartSettingsProps {
  className?: string;
}

interface IndicatorConfig {
  id: IndicatorId;
  enabled: boolean;
  params: Record<string, number>;
}

// =============================================================================
// Default Indicators
// =============================================================================

type IndicatorId = 'sma' | 'ema' | 'rsi' | 'macd' | 'bb';
type ParamId = 'period' | 'fast' | 'slow' | 'signal' | 'stdDev';
type DrawingToolId = 'line' | 'ray' | 'rect' | 'fib';

const DEFAULT_INDICATORS: IndicatorConfig[] = [
  { id: 'sma', enabled: false, params: { period: 20 } },
  { id: 'ema', enabled: false, params: { period: 12 } },
  { id: 'rsi', enabled: false, params: { period: 14 } },
  { id: 'macd', enabled: false, params: { fast: 12, slow: 26, signal: 9 } },
  { id: 'bb', enabled: false, params: { period: 20, stdDev: 2 } },
];

const DRAWING_TOOLS: DrawingToolId[] = ['line', 'ray', 'rect', 'fib'];

function indicatorLabel(id: IndicatorId, t: (key: string) => string): string {
  switch (id) {
    case 'sma': return t('settings.indicator.sma');
    case 'ema': return t('settings.indicator.ema');
    case 'rsi': return t('settings.indicator.rsi');
    case 'macd': return t('settings.indicator.macd');
    case 'bb': return t('settings.indicator.bb');
  }
}

function paramLabel(id: ParamId, t: (key: string) => string): string {
  switch (id) {
    case 'period': return t('settings.param.period');
    case 'fast': return t('settings.param.fast');
    case 'slow': return t('settings.param.slow');
    case 'signal': return t('settings.param.signal');
    case 'stdDev': return t('settings.param.stdDev');
  }
}

function drawingToolLabel(id: DrawingToolId, t: (key: string) => string): string {
  switch (id) {
    case 'line': return t('settings.drawingTool.line');
    case 'ray': return t('settings.drawingTool.ray');
    case 'rect': return t('settings.drawingTool.rect');
    case 'fib': return t('settings.drawingTool.fib');
  }
}

// =============================================================================
// ChartSettings Component
// =============================================================================

export function ChartSettings({ className }: ChartSettingsProps): JSX.Element {
  const { t } = useTranslation('chart');
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(DEFAULT_INDICATORS);
  const [expandedIndicator, setExpandedIndicator] = useState<string | null>(null);

  const toggleIndicator = (id: string) => {
    setIndicators(prev =>
      prev.map(ind =>
        ind.id === id ? { ...ind, enabled: !ind.enabled } : ind
      )
    );
  };

  const updateParam = (id: string, param: string, value: number) => {
    setIndicators(prev =>
      prev.map(ind =>
        ind.id === id ? { ...ind, params: { ...ind.params, [param]: value } } : ind
      )
    );
  };

  return (
    <div className={`flex flex-col h-full bg-gray-900 text-gray-200 ${className ?? ''}`}>
      {/* Indicators Section */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {t('settings.section.indicators')}
        </h3>

        <div className="space-y-2">
          {indicators.map(indicator => (
            <div key={indicator.id} className="bg-gray-800 rounded-lg overflow-hidden">
              {/* Indicator Header */}
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-700/50"
                onClick={() => setExpandedIndicator(
                  expandedIndicator === indicator.id ? null : indicator.id
                )}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={indicator.enabled}
                    onChange={() => toggleIndicator(indicator.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-600"
                  />
                  <span className="text-sm font-medium">
                    {indicatorLabel(indicator.id, t)}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${
                    expandedIndicator === indicator.id ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Indicator Parameters */}
              {expandedIndicator === indicator.id && (
                <div className="px-3 pb-3 space-y-2 border-t border-gray-700">
                  {Object.entries(indicator.params).map(([param, value]) => (
                    <div key={param} className="flex items-center justify-between mt-2">
                      <label className="text-xs text-gray-400 capitalize">
                        {paramLabel(param as ParamId, t)}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={value}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) updateParam(indicator.id, param, Math.max(1, Math.min(10000, v)));
                        }}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          updateParam(indicator.id, param, Number.isFinite(v) ? Math.max(1, Math.min(10000, v)) : 1);
                        }}
                        className="w-20 px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-right"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700 mx-4" />

      {/* Style Section */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {t('settings.section.style')}
        </h3>

        <div className="space-y-3">
          {/* Chart Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('settings.chartType.label')}</label>
            <select className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded">
              <option value="candles">{t('settings.chartType.option.candlesticks')}</option>
              <option value="hollow">{t('settings.chartType.option.hollowCandles')}</option>
              <option value="ohlc">{t('settings.chartType.option.ohlc')}</option>
              <option value="line">{t('settings.chartType.option.line')}</option>
              <option value="area">{t('settings.chartType.option.area')}</option>
            </select>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('settings.color.up')}</label>
              <input
                type="color"
                defaultValue={CHART_COLORS.PROFIT}
                className="w-full h-8 bg-gray-800 border border-gray-700 rounded cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('settings.color.down')}</label>
              <input
                type="color"
                defaultValue={CHART_COLORS.LOSS}
                className="w-full h-8 bg-gray-800 border border-gray-700 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700 mx-4" />

      {/* Drawing Tools Section */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {t('settings.section.drawingTools')}
        </h3>

        <div className="grid grid-cols-4 gap-2">
          {DRAWING_TOOLS.map(tool => (
            <button
              key={tool}
              className="p-2 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded"
            >
              {drawingToolLabel(tool, t)}
            </button>
          ))}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Apply Button */}
      <div className="p-4 border-t border-gray-700">
        <button className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded">
          {t('settings.actions.apply')}
        </button>
      </div>
    </div>
  );
}

export default ChartSettings;
