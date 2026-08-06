/**
 * Backtest Engine
 *
 * Main engine that orchestrates backtesting execution.
 */

import type { OHLCVSeries, Timestamp } from '@shared/types';
import { DEFAULT_INITIAL_CAPITAL, DEFAULT_COMMISSION_RATE } from '@shared/constants/trading';
import { safeForEach } from '@shared/utils/safe-emit';
import type {
  BacktestConfig,
  BacktestRequest,
  BacktestResult,
  BacktestEvent,
  BacktestEventType,
  Strategy,
} from '../types';
import i18n from 'i18next';
import { PortfolioManager, resetIdCounters } from './portfolio';
import { StrategyExecutor, getStrategy, builtInStrategies } from './executor';
import { MetricsCalculator } from './metrics';

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: DEFAULT_INITIAL_CAPITAL,
  currency: 'USD',
  commission: DEFAULT_COMMISSION_RATE,
  slippage: 0.0001,
  marginRate: 1.0,
  riskFreeRate: 0.02,
  fillModel: 'close',
  allowPartialFills: false,
  checkVolume: true,
  maxVolumePercent: 0.1,
  maxPositionSize: 0.2,
  maxDrawdown: 0.25,
  stopOnMaxDrawdown: false,
};

// =============================================================================
// Backtest Engine
// =============================================================================

export type BacktestEventHandler = (event: BacktestEvent) => void;

export class BacktestEngine {
  private config: BacktestConfig;
  private strategies: Map<string, Strategy> = new Map();
  private eventHandlers: Set<BacktestEventHandler> = new Set();
  private running = false;
  private shouldStop = false;

  constructor(config?: Partial<BacktestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Register built-in strategies
    for (const strategy of builtInStrategies) {
      this.registerStrategy(strategy);
    }
  }

  // ===========================================================================
  // Strategy Management
  // ===========================================================================

  /**
   * Register a trading strategy
   */
  registerStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Get registered strategy
   */
  getStrategy(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Subscribe to backtest events
   */
  onEvent(handler: BacktestEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(type: BacktestEventType, data?: unknown): void {
    const event: BacktestEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    safeForEach(this.eventHandlers, '[E:BACKTEST:EVENT_HANDLER_ERROR] Backtest event handler error:', event);
  }

  // ===========================================================================
  // Backtest Execution
  // ===========================================================================

  /**
   * Run a backtest
   */
  async run(request: BacktestRequest, data: OHLCVSeries): Promise<BacktestResult> {
    if (this.running) {
      throw new Error(i18n.t('errors.backtestAlreadyRunning', { ns: 'backtest' }));
    }

    this.running = true;
    this.shouldStop = false;
    const startedAt = Date.now();

    // Merge config
    const config = { ...this.config, ...request.config };

    // Get strategy
    const strategy = this.strategies.get(request.strategyId);
    if (!strategy) {
      this.running = false;
      throw new Error(`Strategy not found: ${request.strategyId}`);
    }

    // Initialize components
    resetIdCounters();
    const portfolio = new PortfolioManager(config);
    const executor = new StrategyExecutor(strategy, portfolio, request.strategyParams);
    const metricsCalculator = new MetricsCalculator(config);

    this.emit('started', { request, config });

    try {
      // Filter data to requested range
      const bars = this.filterDataRange(data, request.startDate, request.endDate);

      if (bars.length === 0) {
        throw new Error(i18n.t('engine.noDataInRange', { ns: 'backtest' }));
      }

      // Initialize strategy
      executor.init(bars, request.symbol);

      // Main backtest loop
      for (let i = 0; i < bars.length; i++) {
        if (this.shouldStop) {
          this.emit('stopped');
          break;
        }

        const bar = bars[i];

        // Execute strategy
        const { signals, trades } = executor.execute(bar, i, bars, request.symbol);

        // Emit events
        if (signals.length > 0) {
          this.emit('signal', { barIndex: i, signals });
        }
        if (trades.length > 0) {
          this.emit('trade', { barIndex: i, trades });
        }

        // Progress update (every 10%)
        if (i % Math.max(1, Math.floor(bars.length / 10)) === 0) {
          this.emit('progress', {
            currentBar: i,
            totalBars: bars.length,
            percent: (i / bars.length) * 100,
            currentDate: new Date(bar.timestamp).toISOString().split('T')[0],
          });
        }

        // Check max drawdown
        if (config.stopOnMaxDrawdown) {
          const { percent } = portfolio.getCurrentDrawdown();
          if (percent >= config.maxDrawdown * 100) {
            this.emit('stopped', { reason: i18n.t('errors.maxDrawdownReached', { ns: 'backtest' }) });
            break;
          }
        }
      }

      // Finalize
      executor.end(bars, request.symbol);

      // Calculate metrics
      const trades = portfolio.getTrades();
      const equityCurve = portfolio.getEquityCurve();
      const metrics = metricsCalculator.calculate(trades, equityCurve, bars.length);
      const monthlyReturns = metricsCalculator.calculateMonthlyReturns(equityCurve);

      // Build result
      const completedAt = Date.now();
      const currentPrices = new Map([[request.symbol, bars[bars.length - 1].close]]);

      const result: BacktestResult = {
        request,
        config,
        status: this.shouldStop ? 'stopped' : 'completed',
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        dataStart: bars[0].timestamp,
        dataEnd: bars[bars.length - 1].timestamp,
        totalBars: bars.length,
        metrics,
        trades,
        equityCurve,
        monthlyReturns,
        orders: portfolio.getOrders(),
        finalEquity: portfolio.getEquity(currentPrices),
        finalCash: portfolio.getCash(),
        finalPositions: Array.from(portfolio.getPositions().values()),
      };

      this.emit('completed', { result });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { error: errorMessage });

      return {
        request,
        config,
        status: 'error',
        error: errorMessage,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        dataStart: 0,
        dataEnd: 0,
        totalBars: 0,
        metrics: metricsCalculator.calculate([], [], 0),
        trades: [],
        equityCurve: [],
        monthlyReturns: [],
        orders: [],
        finalEquity: config.initialCapital,
        finalCash: config.initialCapital,
        finalPositions: [],
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Stop running backtest
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Check if backtest is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ===========================================================================
  // Optimization
  // ===========================================================================

  /**
   * Run parameter optimization (grid search)
   */
  async optimize(
    request: BacktestRequest,
    data: OHLCVSeries,
    paramRanges: Array<{ name: string; values: unknown[] }>,
    metric: keyof BacktestResult['metrics'] = 'sharpeRatio'
  ): Promise<{
    bestParams: Record<string, unknown>;
    bestMetric: number;
    results: Array<{ params: Record<string, unknown>; metric: number }>;
  }> {
    const combinations = this.generateParamCombinations(paramRanges);
    const results: Array<{ params: Record<string, unknown>; metric: number; result: BacktestResult }> = [];

    let bestParams: Record<string, unknown> = {};
    let bestMetric = -Infinity;

    for (let i = 0; i < combinations.length; i++) {
      const params = combinations[i];

      const testRequest = {
        ...request,
        strategyParams: { ...request.strategyParams, ...params },
      };

      const result = await this.run(testRequest, data);

      const metricValue = result.metrics[metric] as number;
      results.push({ params, metric: metricValue, result });

      if (metricValue > bestMetric) {
        bestMetric = metricValue;
        bestParams = params;
      }

      // Emit progress
      this.emit('progress', {
        currentBar: i + 1,
        totalBars: combinations.length,
        percent: ((i + 1) / combinations.length) * 100,
        currentDate: `Combination ${i + 1}/${combinations.length}`,
      });
    }

    return {
      bestParams,
      bestMetric,
      results: results.map(r => ({ params: r.params, metric: r.metric })),
    };
  }

  /**
   * Generate all parameter combinations
   */
  private generateParamCombinations(
    paramRanges: Array<{ name: string; values: unknown[] }>
  ): Record<string, unknown>[] {
    if (paramRanges.length === 0) return [{}];

    const [first, ...rest] = paramRanges;
    const restCombinations = this.generateParamCombinations(rest);

    const combinations: Record<string, unknown>[] = [];
    for (const value of first.values) {
      for (const restCombo of restCombinations) {
        combinations.push({ [first.name]: value, ...restCombo });
      }
    }

    return combinations;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Filter data to requested date range
   */
  private filterDataRange(
    data: OHLCVSeries,
    startDate: string,
    endDate: string
  ): typeof data.data {
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1; // End of day

    return data.data.filter(bar =>
      bar.timestamp >= startTs && bar.timestamp <= endTs
    );
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<BacktestConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): BacktestConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Export
// =============================================================================

export { DEFAULT_CONFIG };
