/**
 * Data Cache Interface - StratCraft Data Plugin Specification
 *
 * Defines the contract for in-memory data caching.
 * Provides fast access to frequently used market data.
 */

import type {
  OHLCV,
  OHLCVSeries,
  Quote,
  SymbolInfo,
  Interval,
  Timestamp,
} from './market-data';

// =============================================================================
// Cache Configuration
// =============================================================================

/**
 * Cache configuration
 */
export interface CacheConfig {
  // Size limits
  maxMemoryMB?: number;        // Max memory usage (default: 256)
  maxEntries?: number;         // Max cache entries (default: 10000)

  // TTL settings (in milliseconds)
  defaultTTL?: number;         // Default TTL (default: 5 minutes)
  quoteTTL?: number;           // Quote data TTL (default: 1 second)
  ohlcvTTL?: number;           // OHLCV data TTL (default: 1 minute)
  symbolTTL?: number;          // Symbol info TTL (default: 1 hour)

  // Eviction
  evictionPolicy?: EvictionPolicy;

  // Persistence
  persistOnShutdown?: boolean; // Save cache to disk on shutdown
  persistPath?: string;        // Path for cache persistence
}

/**
 * Cache eviction policy
 */
export type EvictionPolicy =
  | 'lru'          // Least Recently Used (default)
  | 'lfu'          // Least Frequently Used
  | 'fifo'         // First In First Out
  | 'ttl';         // TTL-based only

/**
 * Cache statistics
 */
export interface CacheStats {
  // Usage
  entries: number;
  memoryUsedBytes: number;
  memoryMaxBytes: number;

  // Hit/miss rates
  hits: number;
  misses: number;
  hitRate: number;             // hits / (hits + misses)

  // Operations
  sets: number;
  deletes: number;
  evictions: number;

  // Age
  oldestEntry: Timestamp;
  newestEntry: Timestamp;
}

// =============================================================================
// Cache Entry
// =============================================================================

/**
 * Cache entry metadata
 */
export interface CacheEntryMeta {
  key: string;
  createdAt: Timestamp;
  accessedAt: Timestamp;
  expiresAt: Timestamp;
  accessCount: number;
  sizeBytes: number;
}

/**
 * Cache entry with data
 */
export interface CacheEntry<T> {
  data: T;
  meta: CacheEntryMeta;
}

// =============================================================================
// Cache Key Builders
// =============================================================================

/**
 * Standard cache key format
 */
export type CacheKeyType =
  | 'quote'        // quote:{symbol}
  | 'ohlcv'        // ohlcv:{symbol}:{interval}:{start}:{end}
  | 'symbol'       // symbol:{symbol}
  | 'search'       // search:{query}
  | 'custom';      // custom:{key}

/**
 * Build cache key for quotes
 */
export function buildQuoteKey(symbol: string): string {
  return `quote:${symbol}`;
}

/**
 * Build cache key for OHLCV data
 */
export function buildOHLCVKey(
  symbol: string,
  interval: Interval,
  start: Timestamp,
  end: Timestamp
): string {
  return `ohlcv:${symbol}:${interval}:${start}:${end}`;
}

/**
 * Build cache key for symbol info
 */
export function buildSymbolKey(symbol: string): string {
  return `symbol:${symbol}`;
}

/**
 * Build cache key for search results
 */
export function buildSearchKey(query: string): string {
  return `search:${query.toLowerCase()}`;
}

// =============================================================================
// Data Cache Interface
// =============================================================================

/**
 * Data Cache Interface
 *
 * Provides in-memory caching for market data.
 * Features:
 * - Type-safe cache operations
 * - TTL-based expiration
 * - LRU/LFU eviction
 * - Memory limits
 */
export interface DataCache {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize cache
   */
  initialize(config: CacheConfig): Promise<void>;

  /**
   * Shutdown cache
   */
  shutdown(): Promise<void>;

  // ===========================================================================
  // Generic Operations
  // ===========================================================================

  /**
   * Get cached value
   */
  get<T>(key: string): T | undefined;

  /**
   * Set cached value
   */
  set<T>(key: string, value: T, ttl?: number): void;

  /**
   * Check if key exists (and not expired)
   */
  has(key: string): boolean;

  /**
   * Delete cached value
   */
  delete(key: string): boolean;

  /**
   * Clear all cache entries
   */
  clear(): void;

  /**
   * Get all keys matching pattern
   */
  keys(pattern?: string): string[];

  // ===========================================================================
  // Typed Operations - Quotes
  // ===========================================================================

  /**
   * Get cached quote
   */
  getQuote(symbol: string): Quote | undefined;

  /**
   * Set cached quote
   */
  setQuote(symbol: string, quote: Quote): void;

  /**
   * Get multiple quotes
   */
  getQuotes(symbols: string[]): Map<string, Quote>;

  /**
   * Set multiple quotes
   */
  setQuotes(quotes: Map<string, Quote>): void;

  // ===========================================================================
  // Typed Operations - OHLCV
  // ===========================================================================

  /**
   * Get cached OHLCV series
   */
  getOHLCV(
    symbol: string,
    interval: Interval,
    start: Timestamp,
    end: Timestamp
  ): OHLCVSeries | undefined;

  /**
   * Set cached OHLCV series
   */
  setOHLCV(series: OHLCVSeries): void;

  /**
   * Get cached bars within a range
   * Returns partial data if available
   */
  getOHLCVPartial(
    symbol: string,
    interval: Interval,
    start: Timestamp,
    end: Timestamp
  ): PartialCacheResult<OHLCVSeries>;

  /**
   * Append bar to cached series
   */
  appendBar(symbol: string, interval: Interval, bar: OHLCV): void;

  /**
   * Update latest bar in cached series
   */
  updateLatestBar(symbol: string, interval: Interval, bar: OHLCV): void;

  // ===========================================================================
  // Typed Operations - Symbols
  // ===========================================================================

  /**
   * Get cached symbol info
   */
  getSymbolInfo(symbol: string): SymbolInfo | undefined;

  /**
   * Set cached symbol info
   */
  setSymbolInfo(info: SymbolInfo): void;

  /**
   * Get cached search results
   */
  getSearchResults(query: string): SymbolInfo[] | undefined;

  /**
   * Set cached search results
   */
  setSearchResults(query: string, results: SymbolInfo[]): void;

  // ===========================================================================
  // Invalidation
  // ===========================================================================

  /**
   * Invalidate all cache entries for a symbol
   */
  invalidateSymbol(symbol: string): void;

  /**
   * Invalidate all quotes
   */
  invalidateQuotes(): void;

  /**
   * Invalidate OHLCV data for a symbol
   */
  invalidateOHLCV(symbol: string, interval?: Interval): void;

  /**
   * Invalidate expired entries
   */
  invalidateExpired(): number;

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;

  /**
   * Get entry metadata
   */
  getEntryMeta(key: string): CacheEntryMeta | undefined;

  // ===========================================================================
  // Persistence
  // ===========================================================================

  /**
   * Save cache to disk
   */
  persist?(): Promise<void>;

  /**
   * Load cache from disk
   */
  restore?(): Promise<void>;
}

// =============================================================================
// Partial Cache Result
// =============================================================================

/**
 * Result for partial cache hits
 */
export interface PartialCacheResult<T> {
  /**
   * Cache hit type
   */
  hit: 'full' | 'partial' | 'miss';

  /**
   * Cached data (if any)
   */
  data?: T;

  /**
   * Missing time ranges (if partial hit)
   */
  missingRanges?: Array<{
    start: Timestamp;
    end: Timestamp;
  }>;
}

// =============================================================================
// Cache Decorator
// =============================================================================

/**
 * Cache decorator options
 */
export interface CacheDecoratorOptions {
  key: string | ((...args: unknown[]) => string);
  ttl?: number;
  condition?: (...args: unknown[]) => boolean;
}

/**
 * Create a cached version of a function
 */
export function withCache<T extends (...args: unknown[]) => Promise<unknown>>(
  cache: DataCache,
  fn: T,
  options: CacheDecoratorOptions
): T {
  return (async (...args: unknown[]) => {
    const key = typeof options.key === 'function'
      ? options.key(...args)
      : options.key;

    // Check condition
    if (options.condition && !options.condition(...args)) {
      return fn(...args);
    }

    // Check cache
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Execute and cache
    const result = await fn(...args);
    cache.set(key, result, options.ttl);
    return result;
  }) as T;
}

// =============================================================================
// Cache Factory
// =============================================================================

/**
 * Create cache instance
 */
export type CacheFactory = (config: CacheConfig) => DataCache;

// =============================================================================
// Memory Cache Implementation Hints
// =============================================================================

/**
 * LRU Cache node (for implementation reference)
 */
export interface LRUNode<T> {
  key: string;
  value: T;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
  expiresAt: Timestamp;
  sizeBytes: number;
}

/**
 * Estimate object size in bytes
 */
export function estimateSize(obj: unknown): number {
  const seen = new WeakSet();

  function sizeOf(value: unknown): number {
    if (value === null || value === undefined) return 0;

    const type = typeof value;

    if (type === 'boolean') return 4;
    if (type === 'number') return 8;
    if (type === 'string') return (value as string).length * 2;

    if (type === 'object') {
      if (seen.has(value as object)) return 0;
      seen.add(value as object);

      if (Array.isArray(value)) {
        return value.reduce((acc, item) => acc + sizeOf(item), 0);
      }

      return Object.entries(value as Record<string, unknown>).reduce(
        (acc, [key, val]) => acc + key.length * 2 + sizeOf(val),
        0
      );
    }

    return 0;
  }

  return sizeOf(obj);
}
