/**
 * Data Provider Interface - StratCraft Data Plugin Specification
 *
 * Defines the contract for data source adapters.
 * All data providers (Yahoo, Binance, CSV, etc.) MUST implement this interface.
 */

import type {
  SymbolInfo,
  OHLCV,
  OHLCVSeries,
  Quote,
  TradeTick,
  OrderBook,
  Interval,
  DataRequest,
  DataResponse,
  DataEvent,
  DataEventType,
  SubscriptionHandle,
  ConnectionStatus,
  Timestamp,
  AssetType,
  Exchange,
} from './market-data';

// =============================================================================
// Provider Metadata
// =============================================================================

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  // Data types supported
  historicalOHLCV: boolean;
  realtimeQuotes: boolean;
  realtimeTrades: boolean;
  orderBook: boolean;

  // Intervals supported
  intervals: Interval[];

  // Asset types supported
  assetTypes: AssetType[];

  // Exchanges/markets supported
  exchanges: Exchange[];

  // Features
  adjustedPrices: boolean;     // Supports split/dividend adjustments
  extendedHours: boolean;      // Supports pre/post market data
  symbolSearch: boolean;       // Supports symbol search
  fundamentals: boolean;       // Supports fundamental data

  // Limits
  maxSymbolsPerRequest?: number;
  maxBarsPerRequest?: number;
  rateLimit?: RateLimitInfo;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  requestsPerMinute: number;
  requestsPerDay?: number;
  weight?: number;             // Request weight (for weighted limits)
}

/**
 * Provider status
 */
export interface ProviderStatus {
  connected: boolean;
  authenticated: boolean;
  latency?: number;            // Last ping latency (ms)
  lastError?: string;
  rateLimit?: {
    remaining: number;
    resetAt: Timestamp;
  };
}

/**
 * Provider metadata
 */
export interface ProviderInfo {
  id: string;                  // Unique provider ID (e.g., "yahoo", "binance")
  name: string;                // Display name
  description?: string;
  website?: string;
  logo?: string;

  // Authentication
  requiresAuth: boolean;
  authType?: 'apiKey' | 'oauth' | 'none';

  // Capabilities
  capabilities: ProviderCapabilities;

  // Pricing
  free: boolean;
  pricingUrl?: string;
}

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Base provider configuration
 */
export interface ProviderConfig {
  enabled: boolean;
  priority?: number;           // Lower = higher priority (for fallback)

  // Authentication
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;

  // Connection
  baseUrl?: string;            // Override default API URL
  timeout?: number;            // Request timeout (ms)
  retries?: number;            // Retry count

  // Rate limiting
  rateLimitOverride?: number;  // Override default rate limit

  // Proxy
  proxy?: ProxyConfig;
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  host: string;
  port: number;
  protocol?: 'http' | 'https' | 'socks5';
  auth?: {
    username: string;
    password: string;
  };
}

// =============================================================================
// Data Provider Interface
// =============================================================================

/**
 * Data Provider Interface
 *
 * All data source adapters MUST implement this interface.
 * The interface is designed for:
 * - Consistent API across different data sources
 * - Easy testing and mocking
 * - Fallback chain support
 */
export interface DataProvider {
  // ===========================================================================
  // Metadata
  // ===========================================================================

  /**
   * Get provider information
   */
  getInfo(): ProviderInfo;

  /**
   * Get current provider status
   */
  getStatus(): Promise<ProviderStatus>;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize the provider
   * Called once when the provider is first used
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Shutdown the provider
   * Called when the application is closing or provider is disabled
   */
  shutdown(): Promise<void>;

  /**
   * Check if provider is ready
   */
  isReady(): boolean;

  // ===========================================================================
  // Symbol Operations
  // ===========================================================================

  /**
   * Search for symbols
   */
  searchSymbols(query: string, options?: SymbolSearchOptions): Promise<SymbolInfo[]>;

  /**
   * Get symbol information
   */
  getSymbolInfo(symbol: string): Promise<DataResponse<SymbolInfo>>;

  /**
   * Get all available symbols (may be paginated)
   */
  listSymbols(options?: ListSymbolsOptions): Promise<SymbolInfo[]>;

  /**
   * Validate if a symbol exists
   */
  validateSymbol(symbol: string): Promise<boolean>;

  // ===========================================================================
  // Historical Data
  // ===========================================================================

  /**
   * Fetch historical OHLCV data
   */
  getHistoricalData(request: DataRequest): Promise<DataResponse<OHLCVSeries>>;

  /**
   * Fetch historical data for multiple symbols
   */
  getHistoricalDataBatch?(
    symbols: string[],
    request: Omit<DataRequest, 'symbol'>
  ): Promise<Map<string, DataResponse<OHLCVSeries>>>;

  // ===========================================================================
  // Real-time Data
  // ===========================================================================

  /**
   * Get current quote
   */
  getQuote(symbol: string): Promise<DataResponse<Quote>>;

  /**
   * Get quotes for multiple symbols
   */
  getQuotes(symbols: string[]): Promise<Map<string, DataResponse<Quote>>>;

  /**
   * Subscribe to real-time data
   */
  subscribe(
    symbol: string,
    types: DataEventType[],
    onData: (event: DataEvent) => void,
    options?: SubscribeOptions
  ): Promise<SubscriptionHandle>;

  /**
   * Subscribe to multiple symbols
   */
  subscribeBatch?(
    symbols: string[],
    types: DataEventType[],
    onData: (event: DataEvent) => void,
    options?: SubscribeOptions
  ): Promise<SubscriptionHandle[]>;

  /**
   * Unsubscribe from all subscriptions
   */
  unsubscribeAll(): Promise<void>;

  // ===========================================================================
  // Order Book (optional)
  // ===========================================================================

  /**
   * Get order book snapshot
   */
  getOrderBook?(symbol: string, depth?: number): Promise<DataResponse<OrderBook>>;

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Ping the provider (health check)
   */
  ping(): Promise<number>;     // Returns latency in ms

  /**
   * Get supported intervals for a symbol
   */
  getSupportedIntervals(symbol: string): Interval[];
}

// =============================================================================
// Operation Options
// =============================================================================

/**
 * Symbol search options
 */
export interface SymbolSearchOptions {
  limit?: number;
  type?: AssetType;
  exchange?: Exchange;
}

/**
 * List symbols options
 */
export interface ListSymbolsOptions {
  type?: AssetType;
  exchange?: Exchange;
  cursor?: string;             // Pagination cursor
  limit?: number;
}

/**
 * Subscribe options
 */
export interface SubscribeOptions {
  interval?: Interval;         // For bar subscriptions
  depth?: number;              // For order book subscriptions
  throttle?: number;           // Throttle updates (ms)
}

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Provider factory function type
 */
export type ProviderFactory = (config: ProviderConfig) => DataProvider;

/**
 * Provider registry entry
 */
export interface ProviderRegistryEntry {
  id: string;
  info: ProviderInfo;
  factory: ProviderFactory;
}

// =============================================================================
// Abstract Base Provider (optional helper)
// =============================================================================

/**
 * Base provider implementation with common utilities
 * Providers can extend this class for convenience
 */
export abstract class BaseDataProvider implements DataProvider {
  protected config: ProviderConfig | null = null;
  protected ready = false;

  abstract getInfo(): ProviderInfo;
  abstract getStatus(): Promise<ProviderStatus>;
  abstract searchSymbols(query: string, options?: SymbolSearchOptions): Promise<SymbolInfo[]>;
  abstract getSymbolInfo(symbol: string): Promise<DataResponse<SymbolInfo>>;
  abstract listSymbols(options?: ListSymbolsOptions): Promise<SymbolInfo[]>;
  abstract getHistoricalData(request: DataRequest): Promise<DataResponse<OHLCVSeries>>;
  abstract getQuote(symbol: string): Promise<DataResponse<Quote>>;
  abstract getQuotes(symbols: string[]): Promise<Map<string, DataResponse<Quote>>>;
  abstract subscribe(
    symbol: string,
    types: DataEventType[],
    onData: (event: DataEvent) => void,
    options?: SubscribeOptions
  ): Promise<SubscriptionHandle>;
  abstract unsubscribeAll(): Promise<void>;
  abstract ping(): Promise<number>;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.ready = true;
  }

  async shutdown(): Promise<void> {
    await this.unsubscribeAll();
    this.ready = false;
    this.config = null;
  }

  isReady(): boolean {
    return this.ready;
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    const response = await this.getSymbolInfo(symbol);
    return response.success;
  }

  getSupportedIntervals(_symbol: string): Interval[] {
    return this.getInfo().capabilities.intervals;
  }
}

// =============================================================================
// Provider Manager Interface
// =============================================================================

/**
 * Provider Manager - manages multiple data providers
 *
 * Features:
 * - Provider registration and lifecycle
 * - Fallback chain (try provider A, fallback to B)
 * - Load balancing
 * - Caching layer integration
 */
export interface DataProviderManager {
  /**
   * Register a provider
   */
  registerProvider(entry: ProviderRegistryEntry): void;

  /**
   * Get registered provider
   */
  getProvider(id: string): DataProvider | undefined;

  /**
   * Get all registered providers
   */
  getAllProviders(): DataProvider[];

  /**
   * Set provider priority (for fallback chain)
   */
  setProviderPriority(id: string, priority: number): void;

  /**
   * Enable/disable provider
   */
  setProviderEnabled(id: string, enabled: boolean): void;

  /**
   * Fetch data with fallback
   * Tries providers in priority order until one succeeds
   */
  fetchWithFallback<T>(
    operation: (provider: DataProvider) => Promise<DataResponse<T>>
  ): Promise<DataResponse<T>>;

  /**
   * Get the best available provider for a symbol
   */
  getBestProvider(symbol: string): DataProvider | undefined;
}
