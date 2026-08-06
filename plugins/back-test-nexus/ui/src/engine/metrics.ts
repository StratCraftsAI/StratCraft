/**
 * Performance Metrics Calculator
 *
 * Calculates comprehensive performance metrics for backtest results.
 */

import type {
  BacktestConfig,
  Trade,
  EquityPoint,
  PerformanceMetrics,
  MonthlyReturn,
} from '../types';

// =============================================================================
// Constants
// =============================================================================

const TRADING_DAYS_PER_YEAR = 252;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// =============================================================================
// Metrics Calculator
// =============================================================================

export class MetricsCalculator {
  private config: BacktestConfig;

  constructor(config: BacktestConfig) {
    this.config = config;
  }

  /**
   * Calculate all performance metrics
   */
  calculate(
    trades: Trade[],
    equityCurve: EquityPoint[],
    totalBars: number
  ): PerformanceMetrics {
    if (equityCurve.length === 0) {
      return this.emptyMetrics();
    }

    const initialEquity = this.config.initialCapital;
    const finalEquity = equityCurve[equityCurve.length - 1].equity;
    const returns = this.calculateReturns(equityCurve);

    // Calculate metrics
    const returnMetrics = this.calculateReturnMetrics(initialEquity, finalEquity, equityCurve);
    const riskMetrics = this.calculateRiskMetrics(returns, equityCurve);
    const drawdownMetrics = this.calculateDrawdownMetrics(equityCurve);
    const tradeMetrics = this.calculateTradeMetrics(trades);
    const exposureMetrics = this.calculateExposureMetrics(equityCurve, totalBars);

    return {
      ...returnMetrics,
      ...riskMetrics,
      ...drawdownMetrics,
      ...tradeMetrics,
      ...exposureMetrics,
    };
  }

  /**
   * Calculate daily returns from equity curve
   */
  private calculateReturns(equityCurve: EquityPoint[]): number[] {
    const returns: number[] = [];

    for (let i = 1; i < equityCurve.length; i++) {
      const prevEquity = equityCurve[i - 1].equity;
      const currEquity = equityCurve[i].equity;
      if (prevEquity > 0) {
        returns.push((currEquity - prevEquity) / prevEquity);
      }
    }

    return returns;
  }

  /**
   * Calculate return metrics
   */
  private calculateReturnMetrics(
    initialEquity: number,
    finalEquity: number,
    equityCurve: EquityPoint[]
  ): Pick<PerformanceMetrics, 'totalReturn' | 'totalReturnPercent' | 'annualizedReturn' | 'cagr'> {
    const totalReturn = finalEquity - initialEquity;
    const totalReturnPercent = (totalReturn / initialEquity) * 100;

    // Calculate time period
    const startTime = equityCurve[0].timestamp;
    const endTime = equityCurve[equityCurve.length - 1].timestamp;
    const daysElapsed = (endTime - startTime) / MILLISECONDS_PER_DAY;
    const yearsElapsed = daysElapsed / 365;

    // CAGR = (Final / Initial)^(1/years) - 1
    let cagr = 0;
    if (yearsElapsed > 0 && finalEquity > 0 && initialEquity > 0) {
      cagr = (Math.pow(finalEquity / initialEquity, 1 / yearsElapsed) - 1) * 100;
    }

    // Annualized return (simple)
    const annualizedReturn = yearsElapsed > 0 ? totalReturnPercent / yearsElapsed : totalReturnPercent;

    return {
      totalReturn,
      totalReturnPercent,
      annualizedReturn,
      cagr,
    };
  }

  /**
   * Calculate risk metrics
   */
  private calculateRiskMetrics(
    returns: number[],
    equityCurve: EquityPoint[]
  ): Pick<PerformanceMetrics, 'volatility' | 'sharpeRatio' | 'sortinoRatio' | 'calmarRatio'> {
    if (returns.length === 0) {
      return { volatility: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0 };
    }

    // Daily volatility
    const dailyVolatility = this.standardDeviation(returns);
    const volatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;

    // Mean daily return
    const meanDailyReturn = this.mean(returns);
    const annualizedMeanReturn = meanDailyReturn * TRADING_DAYS_PER_YEAR;

    // Daily risk-free rate
    const dailyRiskFree = this.config.riskFreeRate / TRADING_DAYS_PER_YEAR;

    // Sharpe Ratio = (Return - RiskFree) / Volatility
    let sharpeRatio = 0;
    if (dailyVolatility > 0) {
      const excessReturn = annualizedMeanReturn - this.config.riskFreeRate;
      sharpeRatio = excessReturn / (volatility / 100);
    }

    // Sortino Ratio - uses downside deviation
    const negativeReturns = returns.filter(r => r < dailyRiskFree);
    const downsideDeviation = negativeReturns.length > 0
      ? this.standardDeviation(negativeReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR)
      : 0;

    let sortinoRatio = 0;
    if (downsideDeviation > 0) {
      const excessReturn = annualizedMeanReturn - this.config.riskFreeRate;
      sortinoRatio = excessReturn / downsideDeviation;
    }

    // Calmar Ratio = CAGR / Max Drawdown
    const maxDrawdownPercent = Math.max(...equityCurve.map(p => p.drawdownPercent));
    let calmarRatio = 0;
    if (maxDrawdownPercent > 0) {
      const cagr = (Math.pow(
        equityCurve[equityCurve.length - 1].equity / this.config.initialCapital,
        TRADING_DAYS_PER_YEAR / equityCurve.length
      ) - 1) * 100;
      calmarRatio = cagr / maxDrawdownPercent;
    }

    return { volatility, sharpeRatio, sortinoRatio, calmarRatio };
  }

  /**
   * Calculate drawdown metrics
   */
  private calculateDrawdownMetrics(
    equityCurve: EquityPoint[]
  ): Pick<PerformanceMetrics, 'maxDrawdown' | 'maxDrawdownPercent' | 'maxDrawdownDuration' | 'avgDrawdown'> {
    if (equityCurve.length === 0) {
      return { maxDrawdown: 0, maxDrawdownPercent: 0, maxDrawdownDuration: 0, avgDrawdown: 0 };
    }

    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let maxDrawdownDuration = 0;
    let currentDrawdownStart = 0;
    let inDrawdown = false;
    let totalDrawdown = 0;
    let drawdownCount = 0;

    for (let i = 0; i < equityCurve.length; i++) {
      const point = equityCurve[i];

      if (point.drawdown > maxDrawdown) {
        maxDrawdown = point.drawdown;
      }
      if (point.drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = point.drawdownPercent;
      }

      // Track drawdown duration
      if (point.drawdownPercent > 0) {
        if (!inDrawdown) {
          inDrawdown = true;
          currentDrawdownStart = point.timestamp;
        }
        totalDrawdown += point.drawdownPercent;
        drawdownCount++;
      } else {
        if (inDrawdown) {
          const duration = (point.timestamp - currentDrawdownStart) / MILLISECONDS_PER_DAY;
          if (duration > maxDrawdownDuration) {
            maxDrawdownDuration = duration;
          }
          inDrawdown = false;
        }
      }
    }

    // Check if still in drawdown at end
    if (inDrawdown) {
      const lastPoint = equityCurve[equityCurve.length - 1];
      const duration = (lastPoint.timestamp - currentDrawdownStart) / MILLISECONDS_PER_DAY;
      if (duration > maxDrawdownDuration) {
        maxDrawdownDuration = duration;
      }
    }

    const avgDrawdown = drawdownCount > 0 ? totalDrawdown / drawdownCount : 0;

    return { maxDrawdown, maxDrawdownPercent, maxDrawdownDuration, avgDrawdown };
  }

  /**
   * Calculate trade metrics
   */
  private calculateTradeMetrics(
    trades: Trade[]
  ): Pick<PerformanceMetrics,
    | 'totalTrades' | 'winningTrades' | 'losingTrades' | 'winRate'
    | 'avgWin' | 'avgLoss' | 'avgWinPercent' | 'avgLossPercent'
    | 'profitFactor' | 'payoffRatio' | 'expectancy'
    | 'totalCommission' | 'totalSlippage'
  > {
    // Filter to closing trades (those with P&L)
    const closingTrades = trades.filter(t => t.pnl !== undefined);
    const totalTrades = closingTrades.length;

    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        profitFactor: 0,
        payoffRatio: 0,
        expectancy: 0,
        totalCommission: trades.reduce((sum, t) => sum + t.commission, 0),
        totalSlippage: trades.reduce((sum, t) => sum + t.slippage, 0),
      };
    }

    const winningTrades = closingTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = closingTrades.filter(t => (t.pnl || 0) < 0);

    const winCount = winningTrades.length;
    const loseCount = losingTrades.length;
    const winRate = (winCount / totalTrades) * 100;

    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const avgWin = winCount > 0 ? totalWins / winCount : 0;
    const avgLoss = loseCount > 0 ? totalLosses / loseCount : 0;

    const avgWinPercent = winCount > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0) / winCount
      : 0;
    const avgLossPercent = loseCount > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0) / loseCount)
      : 0;

    // Profit Factor = Gross Profits / Gross Losses
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Payoff Ratio = Avg Win / Avg Loss
    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    // Expectancy = (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
    const winRateDecimal = winRate / 100;
    const expectancy = (winRateDecimal * avgWin) - ((1 - winRateDecimal) * avgLoss);

    const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
    const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

    return {
      totalTrades,
      winningTrades: winCount,
      losingTrades: loseCount,
      winRate,
      avgWin,
      avgLoss,
      avgWinPercent,
      avgLossPercent,
      profitFactor,
      payoffRatio,
      expectancy,
      totalCommission,
      totalSlippage,
    };
  }

  /**
   * Calculate exposure metrics
   */
  private calculateExposureMetrics(
    equityCurve: EquityPoint[],
    _totalBars: number
  ): Pick<PerformanceMetrics, 'avgExposure' | 'maxExposure' | 'timeInMarket'> {
    if (equityCurve.length === 0) {
      return { avgExposure: 0, maxExposure: 0, timeInMarket: 0 };
    }

    let totalExposure = 0;
    let maxExposure = 0;
    let barsInMarket = 0;

    for (const point of equityCurve) {
      const exposure = point.equity > 0 ? (point.positionValue / point.equity) * 100 : 0;
      totalExposure += exposure;
      if (exposure > maxExposure) {
        maxExposure = exposure;
      }
      if (point.positionValue > 0) {
        barsInMarket++;
      }
    }

    const avgExposure = totalExposure / equityCurve.length;
    const timeInMarket = (barsInMarket / equityCurve.length) * 100;

    return { avgExposure, maxExposure, timeInMarket };
  }

  /**
   * Calculate monthly returns
   */
  calculateMonthlyReturns(equityCurve: EquityPoint[]): MonthlyReturn[] {
    if (equityCurve.length === 0) return [];

    const monthlyReturns: MonthlyReturn[] = [];
    const monthlyEquity = new Map<string, { start: number; end: number }>();

    for (const point of equityCurve) {
      const date = new Date(point.timestamp);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;

      if (!monthlyEquity.has(key)) {
        monthlyEquity.set(key, { start: point.equity, end: point.equity });
      } else {
        monthlyEquity.get(key)!.end = point.equity;
      }
    }

    for (const [key, { start, end }] of monthlyEquity) {
      const [year, month] = key.split('-').map(Number);
      const returnAmount = end - start;
      const returnPercent = start > 0 ? (returnAmount / start) * 100 : 0;

      monthlyReturns.push({
        year,
        month,
        return: returnAmount,
        returnPercent,
      });
    }

    return monthlyReturns.sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month
    );
  }

  // ===========================================================================
  // Utility Functions
  // ===========================================================================

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private standardDeviation(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.mean(values);
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  private emptyMetrics(): PerformanceMetrics {
    return {
      totalReturn: 0,
      totalReturnPercent: 0,
      annualizedReturn: 0,
      cagr: 0,
      volatility: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      maxDrawdownDuration: 0,
      avgDrawdown: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      profitFactor: 0,
      payoffRatio: 0,
      expectancy: 0,
      avgExposure: 0,
      maxExposure: 0,
      timeInMarket: 0,
      totalCommission: 0,
      totalSlippage: 0,
    };
  }
}
