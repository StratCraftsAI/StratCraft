/**
 * Data Storage Interface - StratCraft Data Plugin Specification
 *
 * Defines the contract for persistent data storage (SQLite).
 * Handles OHLCV data persistence, indexing, and retrieval.
 */

import type {
  OHLCV,
  OHLCVSeries,
  SymbolInfo,
  Interval,
  Timestamp,
  DateString,
} from './market-data';

// =============================================================================
// Storage Configuration
// =============================================================================

/**
 * Storage configuration
 */
export interface StorageConfig {
  // Database path
  dbPath: string;

  // Performance settings
  walMode?: boolean;           // Write-Ahead Logging (default: true)
  cacheSize?: number;          // Page cache size in KB (default: 10000)
  mmapSize?: number;           // Memory-mapped I/O size (default: 30000000000)

  // Maintenance
  autoVacuum?: boolean;        // Auto vacuum (default: true)
  vacuumInterval?: number;     // Vacuum interval in hours (default: 24)

  // Limits
  maxStorageSize?: number;     // Max storage size in bytes (0 = unlimited)
  retentionDays?: number;      // Data retention period (0 = forever)
}

/**
 * Storage statistics
 */
export interface StorageStats {
  dbSizeBytes: number;
  totalBars: number;
  totalSymbols: number;
  oldestData: Timestamp;
  newestData: Timestamp;

  // Per-interval stats
  intervalStats: Map<Interval, IntervalStats>;
}

/**
 * Per-interval statistics
 */
export interface IntervalStats {
  interval: Interval;
  barCount: number;
  symbolCount: number;
  oldestBar: Timestamp;
  newestBar: Timestamp;
  sizeBytes: number;
}

// =============================================================================
// Query Options
// =============================================================================

/**
 * Query options for historical data
 */
export interface StorageQueryOptions {
  symbol: string;
  interval: Interval;

  // Time range (inclusive)
  start?: Timestamp | DateString;
  end?: Timestamp | DateString;

  // Pagination
  limit?: number;
  offset?: number;

  // Ordering
  order?: 'asc' | 'desc';

  // Filtering
  minVolume?: number;
}

/**
 * Query result with metadata
 */
export interface StorageQueryResult {
  data: OHLCV[];
  totalCount: number;          // Total matching records (before limit)
  hasMore: boolean;            // More data available

  // Query metadata
  queryTimeMs: number;
  fromCache: boolean;
}

/**
 * Bulk insert options
 */
export interface BulkInsertOptions {
  // Conflict handling
  onConflict?: 'ignore' | 'replace' | 'error';

  // Performance
  batchSize?: number;          // Records per transaction (default: 1000)

  // Validation
  validate?: boolean;          // Validate data before insert (default: true)
  skipDuplicates?: boolean;    // Skip duplicate timestamps (default: true)
}

/**
 * Bulk insert result
 */
export interface BulkInsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: InsertError[];
  durationMs: number;
}

/**
 * Insert error details
 */
export interface InsertError {
  index: number;
  timestamp: Timestamp;
  error: string;
}

// =============================================================================
// Data Storage Interface
// =============================================================================

/**
 * Data Storage Interface
 *
 * Provides persistent storage for market data using SQLite.
 * Optimized for time-series data with efficient range queries.
 */
export interface DataStorage {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize storage
   * Creates database and tables if not exist
   */
  initialize(config: StorageConfig): Promise<void>;

  /**
   * Close storage
   * Flushes pending writes and closes connection
   */
  close(): Promise<void>;

  /**
   * Check if storage is ready
   */
  isReady(): boolean;

  // ===========================================================================
  // OHLCV Data Operations
  // ===========================================================================

  /**
   * Store OHLCV data
   */
  storeOHLCV(series: OHLCVSeries, options?: BulkInsertOptions): Promise<BulkInsertResult>;

  /**
   * Store single OHLCV bar
   */
  storeBar(symbol: string, interval: Interval, bar: OHLCV): Promise<void>;

  /**
   * Query OHLCV data
   */
  queryOHLCV(options: StorageQueryOptions): Promise<StorageQueryResult>;

  /**
   * Get latest bar for a symbol
   */
  getLatestBar(symbol: string, interval: Interval): Promise<OHLCV | null>;

  /**
   * Get time range for stored data
   */
  getTimeRange(symbol: string, interval: Interval): Promise<TimeRange | null>;

  /**
   * Check if data exists for a time range
   */
  hasData(symbol: string, interval: Interval, start: Timestamp, end: Timestamp): Promise<boolean>;

  /**
   * Find gaps in stored data
   */
  findGaps(
    symbol: string,
    interval: Interval,
    start: Timestamp,
    end: Timestamp
  ): Promise<TimeRange[]>;

  // ===========================================================================
  // Symbol Operations
  // ===========================================================================

  /**
   * Store symbol information
   */
  storeSymbolInfo(info: SymbolInfo): Promise<void>;

  /**
   * Get symbol information
   */
  getSymbolInfo(symbol: string): Promise<SymbolInfo | null>;

  /**
   * List all stored symbols
   */
  listStoredSymbols(options?: ListStoredSymbolsOptions): Promise<string[]>;

  /**
   * Search stored symbols
   */
  searchStoredSymbols(query: string): Promise<SymbolInfo[]>;

  // ===========================================================================
  // Data Management
  // ===========================================================================

  /**
   * Delete data for a symbol
   */
  deleteSymbolData(symbol: string, interval?: Interval): Promise<number>;

  /**
   * Delete data older than specified date
   */
  deleteOldData(before: Timestamp): Promise<number>;

  /**
   * Delete data in a time range
   */
  deleteDataRange(
    symbol: string,
    interval: Interval,
    start: Timestamp,
    end: Timestamp
  ): Promise<number>;

  /**
   * Compact database (VACUUM)
   */
  compact(): Promise<void>;

  /**
   * Optimize database (ANALYZE)
   */
  optimize(): Promise<void>;

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get storage statistics
   */
  getStats(): Promise<StorageStats>;

  /**
   * Get bar count for a symbol
   */
  getBarCount(symbol: string, interval: Interval): Promise<number>;

  // ===========================================================================
  // Import/Export
  // ===========================================================================

  /**
   * Export data to CSV
   */
  exportToCSV(
    symbol: string,
    interval: Interval,
    filePath: string,
    options?: ExportOptions
  ): Promise<ExportResult>;

  /**
   * Import data from CSV
   */
  importFromCSV(
    symbol: string,
    interval: Interval,
    filePath: string,
    options?: ImportOptions
  ): Promise<ImportResult>;

  // ===========================================================================
  // Transactions
  // ===========================================================================

  /**
   * Begin a transaction
   */
  beginTransaction(): Promise<Transaction>;
}

// =============================================================================
// Supporting Types
// =============================================================================

/**
 * Time range
 */
export interface TimeRange {
  start: Timestamp;
  end: Timestamp;
}

/**
 * List stored symbols options
 */
export interface ListStoredSymbolsOptions {
  interval?: Interval;
  hasDataAfter?: Timestamp;
  limit?: number;
  offset?: number;
}

/**
 * Export options
 */
export interface ExportOptions {
  start?: Timestamp;
  end?: Timestamp;
  includeHeader?: boolean;
  delimiter?: string;
  dateFormat?: string;
}

/**
 * Export result
 */
export interface ExportResult {
  rowsExported: number;
  filePath: string;
  sizeBytes: number;
}

/**
 * Import options
 */
export interface ImportOptions {
  hasHeader?: boolean;
  delimiter?: string;
  dateFormat?: string;
  timestampColumn?: string;
  columnMapping?: Record<string, string>;
  onConflict?: 'ignore' | 'replace' | 'error';
}

/**
 * Import result
 */
export interface ImportResult {
  rowsImported: number;
  rowsSkipped: number;
  errors: ImportError[];
}

/**
 * Import error
 */
export interface ImportError {
  line: number;
  error: string;
  data?: string;
}

/**
 * Transaction handle
 */
export interface Transaction {
  /**
   * Commit transaction
   */
  commit(): Promise<void>;

  /**
   * Rollback transaction
   */
  rollback(): Promise<void>;

  /**
   * Execute within transaction
   */
  execute<T>(operation: () => Promise<T>): Promise<T>;
}

// =============================================================================
// Storage Factory
// =============================================================================

/**
 * Create storage instance
 */
export type StorageFactory = (config: StorageConfig) => DataStorage;

// =============================================================================
// Schema Definitions (for reference)
// =============================================================================

/**
 * SQLite schema for OHLCV data
 *
 * Table: ohlcv_data
 * - symbol TEXT NOT NULL
 * - interval TEXT NOT NULL
 * - timestamp INTEGER NOT NULL
 * - open REAL NOT NULL
 * - high REAL NOT NULL
 * - low REAL NOT NULL
 * - close REAL NOT NULL
 * - volume REAL NOT NULL
 * - vwap REAL
 * - trades INTEGER
 * - PRIMARY KEY (symbol, interval, timestamp)
 *
 * Indexes:
 * - CREATE INDEX idx_ohlcv_symbol_interval ON ohlcv_data(symbol, interval)
 * - CREATE INDEX idx_ohlcv_timestamp ON ohlcv_data(timestamp)
 */
export const OHLCV_SCHEMA = `
CREATE TABLE IF NOT EXISTS ohlcv_data (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  vwap REAL,
  trades INTEGER,
  PRIMARY KEY (symbol, interval, timestamp)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_interval
  ON ohlcv_data(symbol, interval);

CREATE INDEX IF NOT EXISTS idx_ohlcv_timestamp
  ON ohlcv_data(timestamp);
`;

/**
 * SQLite schema for symbol info
 *
 * Table: symbols
 * - symbol TEXT PRIMARY KEY
 * - name TEXT NOT NULL
 * - type TEXT NOT NULL
 * - exchange TEXT NOT NULL
 * - currency TEXT NOT NULL
 * - ... (other fields as JSON)
 */
export const SYMBOLS_SCHEMA = `
CREATE TABLE IF NOT EXISTS symbols (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  exchange TEXT NOT NULL,
  currency TEXT NOT NULL,
  metadata TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
`;
