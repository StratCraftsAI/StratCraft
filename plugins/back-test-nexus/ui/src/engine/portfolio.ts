/**
 * Portfolio Manager
 *
 * Manages positions, orders, and cash for backtesting.
 */

import type { OHLCV, Timestamp } from '@shared/types';
import type {
  BacktestConfig,
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  Trade,
  Position,
  Signal,
  EquityPoint,
} from '../types';
import i18n from 'i18next';

// =============================================================================
// ID Generator
// =============================================================================

let orderIdCounter = 0;
let tradeIdCounter = 0;

function generateOrderId(): string {
  return `ORD-${++orderIdCounter}`;
}

function generateTradeId(): string {
  return `TRD-${++tradeIdCounter}`;
}

export function resetIdCounters(): void {
  orderIdCounter = 0;
  tradeIdCounter = 0;
}

// =============================================================================
// Portfolio Manager
// =============================================================================

export class PortfolioManager {
  private config: BacktestConfig;
  private cash: number;
  private positions: Map<string, Position> = new Map();
  private orders: Order[] = [];
  private pendingOrders: Order[] = [];
  private trades: Trade[] = [];
  private equityCurve: EquityPoint[] = [];

  // Tracking
  private peakEquity: number;
  private currentDrawdown: number = 0;
  private currentDrawdownPercent: number = 0;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.cash = config.initialCapital;
    this.peakEquity = config.initialCapital;
  }

  // ===========================================================================
  // State Getters
  // ===========================================================================

  getCash(): number {
    return this.cash;
  }

  getPositions(): Map<string, Position> {
    return new Map(this.positions);
  }

  getPosition(symbol: string): Position | null {
    return this.positions.get(symbol) || null;
  }

  getOrders(): Order[] {
    return [...this.orders];
  }

  getPendingOrders(): Order[] {
    return [...this.pendingOrders];
  }

  getTrades(): Trade[] {
    return [...this.trades];
  }

  getEquityCurve(): EquityPoint[] {
    return [...this.equityCurve];
  }

  /**
   * Calculate total equity (cash + positions value)
   */
  getEquity(currentPrices: Map<string, number>): number {
    let positionValue = 0;

    for (const [symbol, position] of this.positions) {
      const price = currentPrices.get(symbol) || position.avgPrice;
      positionValue += Math.abs(position.quantity) * price;
    }

    return this.cash + positionValue;
  }

  /**
   * Calculate position value
   */
  getPositionValue(currentPrices: Map<string, number>): number {
    let value = 0;

    for (const [symbol, position] of this.positions) {
      const price = currentPrices.get(symbol) || position.avgPrice;
      value += Math.abs(position.quantity) * price;
    }

    return value;
  }

  // ===========================================================================
  // Order Management
  // ===========================================================================

  /**
   * Submit a new order from signal
   */
  submitOrder(signal: Signal, barIndex: number): Order {
    const order: Order = {
      id: generateOrderId(),
      symbol: signal.symbol,
      side: signal.side,
      type: signal.type,
      quantity: signal.quantity || 0,
      price: signal.price,
      stopPrice: signal.stopPrice,
      status: 'pending',
      filledQuantity: 0,
      avgFillPrice: 0,
      commission: 0,
      createdAt: signal.timestamp,
      tag: signal.tag,
    };

    // Calculate quantity if not specified
    if (order.quantity === 0) {
      order.quantity = this.calculateOrderQuantity(signal, barIndex);
    }

    // Validate order
    const validation = this.validateOrder(order);
    if (!validation.valid) {
      order.status = 'rejected';
      this.orders.push(order);
      return order;
    }

    order.status = 'submitted';
    this.pendingOrders.push(order);
    this.orders.push(order);

    return order;
  }

  /**
   * Calculate order quantity based on position sizing
   */
  private calculateOrderQuantity(signal: Signal, _barIndex: number): number {
    const position = this.positions.get(signal.symbol);

    // If closing position, use position quantity
    if (position) {
      if (signal.side === 'sell' && position.quantity > 0) {
        return position.quantity;
      }
      if (signal.side === 'buy' && position.quantity < 0) {
        return Math.abs(position.quantity);
      }
    }

    // Default: use max position size from config
    const equity = this.cash; // Simplified - should use total equity
    const maxValue = equity * this.config.maxPositionSize;
    const price = signal.price || 100; // Fallback price

    return Math.floor(maxValue / price);
  }

  /**
   * Validate order before submission
   */
  private validateOrder(order: Order): { valid: boolean; reason?: string } {
    // Check sufficient funds for buy
    if (order.side === 'buy') {
      const requiredCash = order.quantity * (order.price || 0) * (1 + this.config.commission);
      if (requiredCash > this.cash * this.config.marginRate) {
        return { valid: false, reason: i18n.t('engine.insufficientFunds', { ns: 'backtest' }) };
      }
    }

    // Check position for sell
    if (order.side === 'sell') {
      const position = this.positions.get(order.symbol);
      if (!position && !this.config.marginRate) {
        return { valid: false, reason: i18n.t('engine.noPositionToSell', { ns: 'backtest' }) };
      }
    }

    return { valid: true };
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string): boolean {
    const orderIndex = this.pendingOrders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return false;

    const order = this.pendingOrders[orderIndex];
    order.status = 'cancelled';
    order.cancelledAt = Date.now();
    this.pendingOrders.splice(orderIndex, 1);

    return true;
  }

  /**
   * Cancel all pending orders
   */
  cancelAllOrders(): void {
    for (const order of this.pendingOrders) {
      order.status = 'cancelled';
      order.cancelledAt = Date.now();
    }
    this.pendingOrders = [];
  }

  // ===========================================================================
  // Order Execution
  // ===========================================================================

  /**
   * Process pending orders against current bar
   */
  processOrders(bar: OHLCV, barIndex: number): Trade[] {
    const executedTrades: Trade[] = [];
    const remainingOrders: Order[] = [];

    for (const order of this.pendingOrders) {
      const fillResult = this.tryFillOrder(order, bar, barIndex);

      if (fillResult.filled) {
        const trade = this.createTrade(order, fillResult, barIndex);
        this.applyTrade(trade, bar.timestamp);
        executedTrades.push(trade);
        this.trades.push(trade);
      } else if (fillResult.expired) {
        order.status = 'expired';
      } else {
        remainingOrders.push(order);
      }
    }

    this.pendingOrders = remainingOrders;
    return executedTrades;
  }

  /**
   * Try to fill an order
   */
  private tryFillOrder(
    order: Order,
    bar: OHLCV,
    _barIndex: number
  ): { filled: boolean; price: number; quantity: number; expired: boolean } {
    let fillPrice = 0;
    let canFill = false;

    switch (order.type) {
      case 'market':
        // Fill at close or configured fill model
        fillPrice = this.getMarketFillPrice(bar);
        canFill = true;
        break;

      case 'limit':
        if (order.price) {
          if (order.side === 'buy' && bar.low <= order.price) {
            fillPrice = Math.min(order.price, bar.high);
            canFill = true;
          } else if (order.side === 'sell' && bar.high >= order.price) {
            fillPrice = Math.max(order.price, bar.low);
            canFill = true;
          }
        }
        break;

      case 'stop':
        if (order.stopPrice) {
          if (order.side === 'buy' && bar.high >= order.stopPrice) {
            fillPrice = Math.max(order.stopPrice, bar.open);
            canFill = true;
          } else if (order.side === 'sell' && bar.low <= order.stopPrice) {
            fillPrice = Math.min(order.stopPrice, bar.open);
            canFill = true;
          }
        }
        break;

      case 'stop_limit':
        // Simplified: treat as stop for now
        if (order.stopPrice) {
          if (order.side === 'buy' && bar.high >= order.stopPrice) {
            fillPrice = order.price || order.stopPrice;
            canFill = bar.low <= fillPrice;
          } else if (order.side === 'sell' && bar.low <= order.stopPrice) {
            fillPrice = order.price || order.stopPrice;
            canFill = bar.high >= fillPrice;
          }
        }
        break;
    }

    // Apply slippage
    if (canFill) {
      fillPrice = this.applySlippage(fillPrice, order.side);
    }

    // Check volume constraints
    if (canFill && this.config.checkVolume) {
      const maxQuantity = bar.volume * this.config.maxVolumePercent;
      if (order.quantity > maxQuantity) {
        if (this.config.allowPartialFills) {
          return {
            filled: true,
            price: fillPrice,
            quantity: Math.floor(maxQuantity),
            expired: false,
          };
        } else {
          canFill = false;
        }
      }
    }

    return {
      filled: canFill,
      price: fillPrice,
      quantity: order.quantity,
      expired: false,
    };
  }

  /**
   * Get market order fill price based on fill model
   */
  private getMarketFillPrice(bar: OHLCV): number {
    switch (this.config.fillModel) {
      case 'close':
        return bar.close;
      case 'next_open':
        return bar.open; // Simplified - should use next bar's open
      case 'vwap':
        return bar.vwap || (bar.high + bar.low + bar.close) / 3;
      default:
        return bar.close;
    }
  }

  /**
   * Apply slippage to fill price
   */
  private applySlippage(price: number, side: OrderSide): number {
    const slippage = price * this.config.slippage;
    return side === 'buy' ? price + slippage : price - slippage;
  }

  /**
   * Create trade from filled order
   */
  private createTrade(
    order: Order,
    fillResult: { price: number; quantity: number },
    barIndex: number
  ): Trade {
    const quantity = fillResult.quantity;
    const price = fillResult.price;
    const value = quantity * price;
    const commission = value * this.config.commission;
    const slippage = order.type === 'market' ? value * this.config.slippage : 0;

    // Update order
    order.filledQuantity = quantity;
    order.avgFillPrice = price;
    order.commission = commission;
    order.status = quantity === order.quantity ? 'filled' : 'partial';
    order.filledAt = Date.now();

    // Calculate P&L for closing trades
    const position = this.positions.get(order.symbol);
    let pnl: number | undefined;
    let pnlPercent: number | undefined;

    if (position) {
      const isClosing = (order.side === 'sell' && position.quantity > 0) ||
                        (order.side === 'buy' && position.quantity < 0);
      if (isClosing) {
        const closeQuantity = Math.min(quantity, Math.abs(position.quantity));
        pnl = (price - position.avgPrice) * closeQuantity * (position.quantity > 0 ? 1 : -1);
        pnl -= commission; // Subtract commission
        pnlPercent = pnl / (position.avgPrice * closeQuantity) * 100;
      }
    }

    return {
      id: generateTradeId(),
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity,
      price,
      commission,
      slippage,
      timestamp: order.filledAt!,
      barIndex,
      pnl,
      pnlPercent,
      tag: order.tag,
    };
  }

  /**
   * Apply trade to portfolio
   */
  private applyTrade(trade: Trade, timestamp: Timestamp): void {
    const { symbol, side, quantity, price, commission } = trade;
    const value = quantity * price;

    // Update cash
    if (side === 'buy') {
      this.cash -= value + commission;
    } else {
      this.cash += value - commission;
    }

    // Update position
    let position = this.positions.get(symbol);

    if (!position) {
      position = {
        symbol,
        quantity: 0,
        avgPrice: 0,
        marketValue: 0,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        realizedPnl: 0,
        openedAt: timestamp,
        lastUpdatedAt: timestamp,
      };
      this.positions.set(symbol, position);
    }

    const oldQuantity = position.quantity;
    const newQuantity = side === 'buy'
      ? oldQuantity + quantity
      : oldQuantity - quantity;

    // Calculate new average price
    if (Math.sign(newQuantity) !== Math.sign(oldQuantity) && oldQuantity !== 0) {
      // Position flipped - reset avg price
      position.avgPrice = price;
      if (trade.pnl !== undefined) {
        position.realizedPnl += trade.pnl;
      }
    } else if (Math.abs(newQuantity) > Math.abs(oldQuantity)) {
      // Adding to position
      const totalValue = Math.abs(oldQuantity) * position.avgPrice + quantity * price;
      position.avgPrice = totalValue / Math.abs(newQuantity);
    } else if (Math.abs(newQuantity) < Math.abs(oldQuantity)) {
      // Reducing position - track realized P&L
      if (trade.pnl !== undefined) {
        position.realizedPnl += trade.pnl;
      }
    }

    position.quantity = newQuantity;
    position.marketValue = Math.abs(newQuantity) * price;
    position.lastUpdatedAt = timestamp;

    // Remove position if closed
    if (newQuantity === 0) {
      this.positions.delete(symbol);
    }
  }

  // ===========================================================================
  // Position Updates
  // ===========================================================================

  /**
   * Update position values with current prices
   */
  updatePositions(currentPrices: Map<string, number>): void {
    for (const [symbol, position] of this.positions) {
      const price = currentPrices.get(symbol);
      if (price) {
        position.marketValue = Math.abs(position.quantity) * price;
        position.unrealizedPnl = (price - position.avgPrice) * position.quantity;
        position.unrealizedPnlPercent = (position.unrealizedPnl / (position.avgPrice * Math.abs(position.quantity))) * 100;
      }
    }
  }

  // ===========================================================================
  // Equity Tracking
  // ===========================================================================

  /**
   * Record equity point
   */
  recordEquity(timestamp: Timestamp, barIndex: number, currentPrices: Map<string, number>): void {
    const equity = this.getEquity(currentPrices);
    const positionValue = this.getPositionValue(currentPrices);

    // Update peak and drawdown
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
      this.currentDrawdown = 0;
      this.currentDrawdownPercent = 0;
    } else {
      this.currentDrawdown = this.peakEquity - equity;
      this.currentDrawdownPercent = (this.currentDrawdown / this.peakEquity) * 100;
    }

    this.equityCurve.push({
      timestamp,
      barIndex,
      equity,
      cash: this.cash,
      positionValue,
      drawdown: this.currentDrawdown,
      drawdownPercent: this.currentDrawdownPercent,
    });
  }

  /**
   * Get current drawdown
   */
  getCurrentDrawdown(): { amount: number; percent: number } {
    return {
      amount: this.currentDrawdown,
      percent: this.currentDrawdownPercent,
    };
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  /**
   * Reset portfolio to initial state
   */
  reset(): void {
    this.cash = this.config.initialCapital;
    this.positions.clear();
    this.orders = [];
    this.pendingOrders = [];
    this.trades = [];
    this.equityCurve = [];
    this.peakEquity = this.config.initialCapital;
    this.currentDrawdown = 0;
    this.currentDrawdownPercent = 0;
    resetIdCounters();
  }
}
