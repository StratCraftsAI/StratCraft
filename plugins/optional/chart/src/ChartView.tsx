/**
 * ChartView - Main chart view component
 *
 * Uses Lightweight Charts to render candlestick charts
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, ColorType } from 'lightweight-charts';
import type { CandleData, ChartConfig } from './types';
import { CHART_COLORS } from '@shared/constants/colors';
import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m,
  INTERVAL_1h, INTERVAL_4h, INTERVAL_1d, INTERVAL_1w,
} from '@StratCraft/types';

// =============================================================================
// Props
// =============================================================================

interface ChartViewProps {
  className?: string;
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: ChartConfig = {
  symbol: 'AAPL',
  interval: INTERVAL_1d,
  showVolume: true,
  showGrid: true,
  candleStyle: 'candles',
};

// =============================================================================
// ChartView Component
// =============================================================================

export function ChartView({ className }: ChartViewProps): JSX.Element {
  const { t } = useTranslation('chart');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);

  // ===========================================================================
  // Chart Initialization
  // ===========================================================================

  useEffect(() => {
    if (!containerRef.current) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: CHART_COLORS.TEXT,
      },
      grid: {
        vertLines: { color: config.showGrid ? CHART_COLORS.GRID : 'transparent' },
        horzLines: { color: config.showGrid ? CHART_COLORS.GRID : 'transparent' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.GRID,
      },
      timeScale: {
        borderColor: CHART_COLORS.GRID,
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Create candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: CHART_COLORS.PROFIT,
      downColor: CHART_COLORS.LOSS,
      borderUpColor: CHART_COLORS.PROFIT,
      borderDownColor: CHART_COLORS.LOSS,
      wickUpColor: CHART_COLORS.PROFIT,
      wickDownColor: CHART_COLORS.LOSS,
    });

    // Create volume series
    const volumeSeries = chart.addHistogramSeries({
      color: CHART_COLORS.VOLUME,
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Responsive resize
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [config.showGrid]);

  // ===========================================================================
  // Data Loading
  // ===========================================================================

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Get market data via electronAPI
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);

      let data: CandleData[];

      if (window.electronAPI?.getMarketData) {
        data = await window.electronAPI.getMarketData({
          symbol: config.symbol,
          interval: config.interval,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        }) as CandleData[];
      } else {
        // Mock data for development
        data = generateMockData(startDate, endDate);
      }

      // Convert to Lightweight Charts format
      const candleData: CandlestickData[] = data.map(d => ({
        time: (new Date(d.timestamp).getTime() / 1000) as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

      const volumeData: HistogramData[] = data.map(d => ({
        time: (new Date(d.timestamp).getTime() / 1000) as any,
        value: d.volume,
        color: d.close >= d.open ? CHART_COLORS.PROFIT_ALPHA : CHART_COLORS.LOSS_ALPHA,
      }));

      candleSeriesRef.current?.setData(candleData);
      if (config.showVolume) {
        volumeSeriesRef.current?.setData(volumeData);
      }

      chartRef.current?.timeScale().fitContent();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('view.error.loadData'));
    } finally {
      setLoading(false);
    }
  }, [config.symbol, config.interval, config.showVolume, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ===========================================================================
  // Load Symbols
  // ===========================================================================

  useEffect(() => {
    async function loadSymbols() {
      if (window.electronAPI?.getSymbols) {
        const list = await window.electronAPI.getSymbols();
        setSymbols(list);
      } else {
        setSymbols(['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'BTC-USD', 'ETH-USD']);
      }
    }
    loadSymbols();
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-4 p-2 border-b border-gray-700 bg-gray-900/50">
        {/* Symbol Selector */}
        <select
          value={config.symbol}
          onChange={(e) => setConfig({ ...config, symbol: e.target.value })}
          className="bg-gray-800 text-white px-3 py-1.5 rounded text-sm border border-gray-700"
        >
          {symbols.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Interval Selector */}
        <select
          value={config.interval}
          onChange={(e) => setConfig({ ...config, interval: e.target.value })}
          className="bg-gray-800 text-white px-3 py-1.5 rounded text-sm border border-gray-700"
        >
          <option value={INTERVAL_1m}>1m</option>
          <option value={INTERVAL_5m}>5m</option>
          <option value={INTERVAL_15m}>15m</option>
          <option value={INTERVAL_1h}>1H</option>
          <option value={INTERVAL_4h}>4H</option>
          <option value={INTERVAL_1d}>1D</option>
          <option value={INTERVAL_1w}>1W</option>
        </select>

        {/* Volume Toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={config.showVolume}
            onChange={(e) => setConfig({ ...config, showVolume: e.target.checked })}
            className="rounded"
          />
          {t('view.toggle.volume')}
        </label>

        {/* Grid Toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={config.showGrid}
            onChange={(e) => setConfig({ ...config, showGrid: e.target.checked })}
            className="rounded"
          />
          {t('view.toggle.grid')}
        </label>

        {/* Refresh Button */}
        <button
          onClick={loadData}
          disabled={loading}
          className="ml-auto px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded text-sm"
        >
          {loading ? t('view.loading') : t('view.refresh')}
        </button>
      </div>

      {/* Chart Container */}
      <div className="flex-1 relative">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
            <div className="text-red-400 text-center">
              <p className="text-lg font-medium">{t('view.error.chart')}</p>
              <p className="text-sm mt-1">{error}</p>
              <button
                onClick={loadData}
                className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
              >
                {t('view.retry')}
              </button>
            </div>
          </div>
        )}

        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
            <div className="text-gray-400">{t('view.loadingChartData')}</div>
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}

// =============================================================================
// Mock Data Generator
// =============================================================================

function generateMockData(startDate: Date, endDate: Date): CandleData[] {
  const data: CandleData[] = [];
  let currentDate = new Date(startDate);
  let price = 150;

  while (currentDate <= endDate) {
    const change = (Math.random() - 0.5) * 10;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 3;
    const low = Math.min(open, close) - Math.random() * 3;

    data.push({
      timestamp: currentDate.getTime(),
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 10000000) + 1000000,
    });

    price = close;
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
  }

  return data;
}

// =============================================================================
// Type Augmentation
// =============================================================================

declare global {
  interface Window {
    electronAPI?: {
      getMarketData: (params: {
        symbol: string;
        interval: string;
        start: string;
        end: string;
      }) => Promise<CandleData[]>;
      getSymbols: () => Promise<string[]>;
    };
  }
}

// =============================================================================
// Export
// =============================================================================

export default ChartView;
