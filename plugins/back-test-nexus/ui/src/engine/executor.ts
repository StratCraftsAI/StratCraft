/**
 * Strategy Executor
 *
 * Executes trading strategies against historical data.
 */

import type { OHLCV, Timestamp } from '@shared/types';
import type {
  Strategy,
  StrategyContext,
  Signal,
  Order,
  Trade,
  Position,
  OrderOptions,
  OrderSide,
} from '../types';
import i18n from 'i18next';
import { PortfolioManager } from './portfolio';

// =============================================================================
// Strategy Executor
// =============================================================================

export class StrategyExecutor {
  private strategy: Strategy;
  private portfolio: PortfolioManager;
  private params: Record<string, unknown>;
  private logs: string[] = [];

  constructor(
    strategy: Strategy,
    portfolio: PortfolioManager,
    params?: Record<string, unknown>
  ) {
    this.strategy = strategy;
    this.portfolio = portfolio;
    this.params = this.initializeParams(params);
  }

  /**
   * Initialize strategy parameters with defaults
   */
  private initializeParams(userParams?: Record<string, unknown>): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const param of this.strategy.params) {
      params[param.name] = userParams?.[param.name] ?? param.default;
    }

    return params;
  }

  /**
   * Execute strategy initialization
   */
  init(bars: OHLCV[], symbol: string): void {
    if (!this.strategy.init) return;

    const ctx = this.createContext(bars[0], 0, bars, symbol);
    this.strategy.init(ctx);
  }

  /**
   * Execute strategy for a single bar
   */
  execute(
    bar: OHLCV,
    barIndex: number,
    bars: OHLCV[],
    symbol: string
  ): { signals: Signal[]; trades: Trade[] } {
    // Process pending orders first
    const currentPrices = new Map([[symbol, bar.close]]);
    const trades = this.portfolio.processOrders(bar, barIndex);

    // Notify strategy of filled orders
    if (trades.length > 0 && this.strategy.onOrderFilled) {
      const ctx = this.createContext(bar, barIndex, bars, symbol);
      for (const trade of trades) {
        const order = this.portfolio.getOrders().find(o => o.id === trade.orderId);
        if (order) {
          this.strategy.onOrderFilled(ctx, order, trade);
        }
      }
    }

    // Update positions with current prices
    this.portfolio.updatePositions(currentPrices);

    // Execute strategy
    const ctx = this.createContext(bar, barIndex, bars, symbol);
    const result = this.strategy.onBar(ctx);

    // Process signals
    const signals: Signal[] = [];
    if (result) {
      const signalArray = Array.isArray(result) ? result : [result];
      for (const signal of signalArray) {
        signals.push(signal);
        this.portfolio.submitOrder(signal, barIndex);
      }
    }

    // Record equity
    this.portfolio.recordEquity(bar.timestamp, barIndex, currentPrices);

    return { signals, trades };
  }

  /**
   * Execute strategy end callback
   */
  end(bars: OHLCV[], symbol: string): void {
    if (!this.strategy.onEnd) return;

    const lastBar = bars[bars.length - 1];
    const ctx = this.createContext(lastBar, bars.length - 1, bars, symbol);
    this.strategy.onEnd(ctx);
  }

  /**
   * Get logs
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  // ===========================================================================
  // Context Creation
  // ===========================================================================

  /**
   * Create strategy context
   */
  private createContext(
    bar: OHLCV,
    barIndex: number,
    bars: OHLCV[],
    symbol: string
  ): StrategyContext {
    const currentPrices = new Map([[symbol, bar.close]]);

    return {
      // Current state
      bar,
      barIndex,
      timestamp: bar.timestamp,
      symbol,

      // Historical data
      bars: bars.slice(0, barIndex + 1),
      lookback: (n: number) => bars.slice(Math.max(0, barIndex - n + 1), barIndex + 1),

      // Portfolio state
      equity: this.portfolio.getEquity(currentPrices),
      cash: this.portfolio.getCash(),
      position: this.portfolio.getPosition(symbol),
      positions: this.portfolio.getPositions(),
      orders: this.portfolio.getPendingOrders(),

      // Actions
      buy: (quantity?: number, options?: OrderOptions) =>
        this.createSignal(symbol, 'buy', bar.timestamp, quantity, options),
      sell: (quantity?: number, options?: OrderOptions) =>
        this.createSignal(symbol, 'sell', bar.timestamp, quantity, options),
      close: (options?: OrderOptions) =>
        this.createCloseSignal(symbol, bar.timestamp, options),
      cancel: (orderId: string) => this.portfolio.cancelOrder(orderId),
      cancelAll: () => this.portfolio.cancelAllOrders(),

      // Utilities
      log: (message: string) => this.log(bar.timestamp, message),
      getParam: <T>(name: string, defaultValue: T) =>
        (this.params[name] as T) ?? defaultValue,
    };
  }

  /**
   * Create trading signal
   */
  private createSignal(
    symbol: string,
    side: OrderSide,
    timestamp: Timestamp,
    quantity?: number,
    options?: OrderOptions
  ): Signal {
    return {
      symbol,
      side,
      type: options?.type || 'market',
      quantity,
      price: options?.price,
      stopPrice: options?.stopPrice,
      stopLoss: options?.stopLoss,
      takeProfit: options?.takeProfit,
      tag: options?.tag,
      timestamp,
    };
  }

  /**
   * Create close position signal
   */
  private createCloseSignal(
    symbol: string,
    timestamp: Timestamp,
    options?: OrderOptions
  ): Signal | null {
    const position = this.portfolio.getPosition(symbol);
    if (!position || position.quantity === 0) {
      return null;
    }

    const side: OrderSide = position.quantity > 0 ? 'sell' : 'buy';
    const quantity = Math.abs(position.quantity);

    return {
      symbol,
      side,
      type: options?.type || 'market',
      quantity,
      price: options?.price,
      stopPrice: options?.stopPrice,
      tag: options?.tag || 'close',
      timestamp,
    };
  }

  /**
   * Log message
   */
  private log(timestamp: Timestamp, message: string): void {
    const date = new Date(timestamp).toISOString();
    this.logs.push(`[${date}] ${message}`);
  }
}

// =============================================================================
// Built-in Strategies
// =============================================================================

/**
 * Simple Moving Average Crossover Strategy
 */
export const SMACrossoverStrategy: Strategy = {
  id: 'sma-crossover',
  get name() { return i18n.t('engine.strategies.smaCrossover.name', { ns: 'backtest' }); },
  get description() { return i18n.t('engine.strategies.smaCrossover.description', { ns: 'backtest' }); },
  version: '1.0.0',

  params: [
    { name: 'fastPeriod', type: 'number', default: 10, min: 2, max: 50, get description() { return i18n.t('engine.strategies.smaCrossover.fastPeriod', { ns: 'backtest' }); } },
    { name: 'slowPeriod', type: 'number', default: 20, min: 5, max: 200, get description() { return i18n.t('engine.strategies.smaCrossover.slowPeriod', { ns: 'backtest' }); } },
  ],

  onBar(ctx: StrategyContext): Signal | void {
    const fastPeriod = ctx.getParam<number>('fastPeriod', 10);
    const slowPeriod = ctx.getParam<number>('slowPeriod', 20);

    // Need enough bars
    if (ctx.barIndex < slowPeriod) return;

    // Calculate SMAs
    const fastSMA = calculateSMA(ctx.bars, fastPeriod);
    const slowSMA = calculateSMA(ctx.bars, slowPeriod);

    // Previous SMAs
    const prevBars = ctx.bars.slice(0, -1);
    const prevFastSMA = calculateSMA(prevBars, fastPeriod);
    const prevSlowSMA = calculateSMA(prevBars, slowPeriod);

    // Check for crossover
    const crossedAbove = prevFastSMA <= prevSlowSMA && fastSMA > slowSMA;
    const crossedBelow = prevFastSMA >= prevSlowSMA && fastSMA < slowSMA;

    if (crossedAbove && !ctx.position) {
      ctx.log(`Buy signal: Fast SMA (${fastSMA.toFixed(2)}) crossed above Slow SMA (${slowSMA.toFixed(2)})`);
      return ctx.buy();
    }

    if (crossedBelow && ctx.position && ctx.position.quantity > 0) {
      ctx.log(`Sell signal: Fast SMA (${fastSMA.toFixed(2)}) crossed below Slow SMA (${slowSMA.toFixed(2)})`);
      return ctx.close() as any;
    }
  },
};

/**
 * RSI Mean Reversion Strategy
 */
export const RSIMeanReversionStrategy: Strategy = {
  id: 'rsi-mean-reversion',
  get name() { return i18n.t('engine.strategies.rsiMeanReversion.name', { ns: 'backtest' }); },
  get description() { return i18n.t('engine.strategies.rsiMeanReversion.description', { ns: 'backtest' }); },
  version: '1.0.0',

  params: [
    { name: 'period', type: 'number', default: 14, min: 2, max: 50, get description() { return i18n.t('engine.strategies.rsiMeanReversion.period', { ns: 'backtest' }); } },
    { name: 'oversold', type: 'number', default: 30, min: 10, max: 40, get description() { return i18n.t('engine.strategies.rsiMeanReversion.oversold', { ns: 'backtest' }); } },
    { name: 'overbought', type: 'number', default: 70, min: 60, max: 90, get description() { return i18n.t('engine.strategies.rsiMeanReversion.overbought', { ns: 'backtest' }); } },
  ],

  onBar(ctx: StrategyContext): Signal | void {
    const period = ctx.getParam<number>('period', 14);
    const oversold = ctx.getParam<number>('oversold', 30);
    const overbought = ctx.getParam<number>('overbought', 70);

    if (ctx.barIndex < period) return;

    const rsi = calculateRSI(ctx.bars, period);

    if (rsi < oversold && !ctx.position) {
      ctx.log(`Buy signal: RSI (${rsi.toFixed(2)}) below oversold (${oversold})`);
      return ctx.buy();
    }

    if (rsi > overbought && ctx.position && ctx.position.quantity > 0) {
      ctx.log(`Sell signal: RSI (${rsi.toFixed(2)}) above overbought (${overbought})`);
      return ctx.close() as any;
    }
  },
};

// =============================================================================
// Indicator Helpers
// =============================================================================

function calculateSMA(bars: OHLCV[], period: number): number {
  if (bars.length < period) return 0;

  const slice = bars.slice(-period);
  const sum = slice.reduce((acc, bar) => acc + bar.close, 0);
  return sum / period;
}

function calculateRSI(bars: OHLCV[], period: number): number {
  if (bars.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = bars.length - period; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// =============================================================================
// Strategy Registry
// =============================================================================

export const builtInStrategies: Strategy[] = [
  SMACrossoverStrategy,
  RSIMeanReversionStrategy,
];

export function getStrategy(id: string): Strategy | undefined {
  return builtInStrategies.find(s => s.id === id);
}
