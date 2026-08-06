/**
 * Market Data Types - StratCraft Data Plugin Specification
 *
 * Core data structures for market data representation.
 * All data plugins MUST use these types for interoperability.
 */

// =============================================================================
// Time and Interval
// =============================================================================

/**
 * Unix timestamp in milliseconds
 */
export type Timestamp = number;

/**
 * ISO 8601 date string (YYYY-MM-DD)
 */
export type DateString = string;

/**
 * ISO 8601 datetime string (YYYY-MM-DDTHH:mm:ss.sssZ)
 */
export type DateTimeString = string;

/**
 * Data interval/timeframe
 */
export type Interval =
  | '1s' | '5s' | '15s' | '30s'           // Seconds
  | '1m' | '3m' | '5m' | '15m' | '30m'    // Minutes
  | '1h' | '2h' | '4h' | '6h' | '12h'     // Hours
  | '1d' | '3d'                            // Days
  | '1w'                                   // Week
  | '1M';                                  // Month

/**
 * Interval metadata
 */
export interface IntervalInfo {
  value: Interval;
  label: string;
  seconds: number;
}

/**
 * Standard interval definitions
 */
export const INTERVALS: Record<Interval, IntervalInfo> = {
  '1s':  { value: '1s',  label: '1 Second',   seconds: 1 },
  '5s':  { value: '5s',  label: '5 Seconds',  seconds: 5 },
  '15s': { value: '15s', label: '15 Seconds', seconds: 15 },
  '30s': { value: '30s', label: '30 Seconds', seconds: 30 },
  '1m':  { value: '1m',  label: '1 Minute',   seconds: 60 },
  '3m':  { value: '3m',  label: '3 Minutes',  seconds: 180 },
  '5m':  { value: '5m',  label: '5 Minutes',  seconds: 300 },
  '15m': { value: '15m', label: '15 Minutes', seconds: 900 },
  '30m': { value: '30m', label: '30 Minutes', seconds: 1800 },
  '1h':  { value: '1h',  label: '1 Hour',     seconds: 3600 },
  '2h':  { value: '2h',  label: '2 Hours',    seconds: 7200 },
  '4h':  { value: '4h',  label: '4 Hours',    seconds: 14400 },
  '6h':  { value: '6h',  label: '6 Hours',    seconds: 21600 },
  '12h': { value: '12h', label: '12 Hours',   seconds: 43200 },
  '1d':  { value: '1d',  label: '1 Day',      seconds: 86400 },
  '3d':  { value: '3d',  label: '3 Days',     seconds: 259200 },
  '1w':  { value: '1w',  label: '1 Week',     seconds: 604800 },
  '1M':  { value: '1M',  label: '1 Month',    seconds: 2592000 },
};

// =============================================================================
// Symbol and Market
// =============================================================================

/**
 * Asset type
 */
export type AssetType =
  | 'stock'       // Stocks/Equities
  | 'etf'         // Exchange-Traded Funds
  | 'index'       // Market Indices
  | 'forex'       // Foreign Exchange
  | 'crypto'      // Cryptocurrency
  | 'futures'     // Futures Contracts
  | 'options'     // Options Contracts
  | 'bond'        // Bonds
  | 'commodity';  // Commodities

/**
 * Market/Exchange identifier
 */
export type Exchange =
  | 'NYSE' | 'NASDAQ' | 'AMEX'           // US Stocks
  | 'SSE' | 'SZSE' | 'HKEX'              // China/HK
  | 'TSE' | 'OSE'                         // Japan
  | 'LSE' | 'XETRA' | 'EURONEXT'         // Europe
  | 'BINANCE' | 'COINBASE' | 'KRAKEN'    // Crypto
  | 'CME' | 'NYMEX' | 'COMEX'            // Futures
  | 'FOREX'                               // FX
  | 'OTHER';

/**
 * Symbol information
 */
export interface SymbolInfo {
  symbol: string;              // Trading symbol (e.g., "AAPL", "BTC-USD")
  name: string;                // Full name (e.g., "Apple Inc.")
  type: AssetType;             // Asset type
  exchange: Exchange;          // Primary exchange
  currency: string;            // Quote currency (e.g., "USD", "CNY")
  timezone?: string;           // Exchange timezone

  // Trading specifications
  pricePrecision?: number;     // Price decimal places
  volumePrecision?: number;    // Volume decimal places
  minOrderSize?: number;       // Minimum order size
  tickSize?: number;           // Minimum price movement

  // Additional metadata
  sector?: string;             // Industry sector
  industry?: string;           // Specific industry
  description?: string;        // Symbol description
  logo?: string;               // Logo URL

  // Status
  tradable?: boolean;          // Currently tradable
  marginable?: boolean;        // Available for margin
  shortable?: boolean;         // Available for shorting
}

// =============================================================================
// OHLCV Data (Candlestick/Bar)
// =============================================================================

/**
 * OHLCV bar data - the fundamental market data structure
 */
export interface OHLCV {
  timestamp: Timestamp;        // Bar open time (ms)
  open: number;                // Open price
  high: number;                // High price
  low: number;                 // Low price
  close: number;               // Close price
  volume: number;              // Trading volume

  // Optional extended fields
  vwap?: number;               // Volume-weighted average price
  trades?: number;             // Number of trades
  turnover?: number;           // Trading turnover (value)
}

/**
 * Extended OHLCV with additional metadata
 */
export interface OHLCVExtended extends OHLCV {
  symbol: string;              // Symbol
  interval: Interval;          // Data interval

  // Adjustment info
  adjustedClose?: number;      // Adjusted close (for splits/dividends)
  splitFactor?: number;        // Split adjustment factor
  dividendFactor?: number;     // Dividend adjustment factor

  // Data quality
  complete?: boolean;          // Is bar complete (vs partial)
  source?: string;             // Data source identifier
}

/**
 * OHLCV data series with metadata
 */
export interface OHLCVSeries {
  symbol: string;
  interval: Interval;
  data: OHLCV[];

  // Time range
  start: Timestamp;
  end: Timestamp;

  // Metadata
  timezone?: string;
  adjusted?: boolean;          // Price adjusted for splits/dividends
  source?: string;
  fetchedAt?: Timestamp;
}

// =============================================================================
// Quote Data (Level 1)
// =============================================================================

/**
 * Real-time quote data (best bid/ask)
 */
export interface Quote {
  symbol: string;
  timestamp: Timestamp;

  // Best bid/ask
  bid: number;                 // Best bid price
  bidSize: number;             // Bid size/volume
  ask: number;                 // Best ask price
  askSize: number;             // Ask size/volume

  // Last trade
  last: number;                // Last traded price
  lastSize?: number;           // Last trade size

  // Session info
  open?: number;               // Session open
  high?: number;               // Session high
  low?: number;                // Session low
  close?: number;              // Previous close
  volume?: number;             // Session volume

  // Change
  change?: number;             // Price change
  changePercent?: number;      // Change percentage
}

// =============================================================================
// Tick Data (Trade & Quote)
// =============================================================================

/**
 * Individual trade tick
 */
export interface TradeTick {
  symbol: string;
  timestamp: Timestamp;
  price: number;
  size: number;

  // Trade conditions
  side?: 'buy' | 'sell' | 'unknown';
  exchange?: string;
  tradeId?: string;
  conditions?: string[];       // Trade condition codes
}

/**
 * Quote tick (bid/ask update)
 */
export interface QuoteTick {
  symbol: string;
  timestamp: Timestamp;

  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;

  exchange?: string;
}

/**
 * Combined tick (trade or quote)
 */
export type Tick =
  | ({ type: 'trade' } & TradeTick)
  | ({ type: 'quote' } & QuoteTick);

// =============================================================================
// Order Book (Level 2)
// =============================================================================

/**
 * Order book price level
 */
export interface OrderBookLevel {
  price: number;
  size: number;
  orders?: number;             // Number of orders at this level
}

/**
 * Order book snapshot
 */
export interface OrderBook {
  symbol: string;
  timestamp: Timestamp;

  bids: OrderBookLevel[];      // Sorted descending by price
  asks: OrderBookLevel[];      // Sorted ascending by price

  // Metadata
  depth?: number;              // Number of levels
  exchange?: string;
}

// =============================================================================
// Data Request/Response
// =============================================================================

/**
 * Historical data request
 */
export interface DataRequest {
  symbol: string;
  interval: Interval;

  // Time range (one of the following)
  start?: Timestamp | DateString;
  end?: Timestamp | DateString;
  limit?: number;              // Max bars to return

  // Options
  adjusted?: boolean;          // Apply adjustments
  includeExtended?: boolean;   // Include extended hours
}

/**
 * Data response wrapper
 */
export interface DataResponse<T> {
  success: boolean;
  data?: T;
  error?: DataError;

  // Metadata
  source?: string;
  cached?: boolean;
  fetchedAt?: Timestamp;
}

/**
 * Data error
 */
export interface DataError {
  code: DataErrorCode;
  message: string;
  details?: unknown;
}

export type DataErrorCode =
  | 'SYMBOL_NOT_FOUND'
  | 'INVALID_INTERVAL'
  | 'INVALID_TIME_RANGE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'NO_DATA'
  | 'UNAUTHORIZED'
  | 'UNKNOWN_ERROR';

// =============================================================================
// Data Events (for subscriptions)
// =============================================================================

/**
 * Data event types
 */
export type DataEventType =
  | 'bar'           // New OHLCV bar
  | 'bar:update'    // Bar update (incomplete bar)
  | 'quote'         // Quote update
  | 'trade'         // Trade tick
  | 'orderbook'     // Order book update
  | 'status';       // Connection status

/**
 * Data event payload
 */
export interface DataEvent {
  type: DataEventType;
  symbol: string;
  timestamp: Timestamp;
  data: OHLCV | Quote | TradeTick | OrderBook | ConnectionStatus;
}

/**
 * Connection status
 */
export interface ConnectionStatus {
  connected: boolean;
  provider: string;
  latency?: number;
  message?: string;
}

// =============================================================================
// Subscription
// =============================================================================

/**
 * Subscription request
 */
export interface Subscription {
  id: string;
  symbol: string;
  types: DataEventType[];
  interval?: Interval;         // For bar subscriptions

  // Callbacks
  onData: (event: DataEvent) => void;
  onError?: (error: DataError) => void;
  onStatus?: (status: ConnectionStatus) => void;
}

/**
 * Subscription handle
 */
export interface SubscriptionHandle {
  id: string;
  symbol: string;
  unsubscribe: () => void;
  isActive: () => boolean;
}
