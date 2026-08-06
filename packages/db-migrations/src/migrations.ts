/**
 * EMBEDDED_MIGRATIONS + the version-controlled migration engine -- the SINGLE
 * SOURCE OF TRUTH for the StratCraft SQLite schema (TICKET_1289_1 F1).
 *
 * Extracted verbatim from apps/desktop/.../migration-manager.ts so BOTH the
 * Electron main process and the standalone MCP server drive the exact same
 * migration array through the exact same apply loop. Version skew between the
 * two hosts is therefore structurally impossible (TICKET_854 -- one engine,
 * one array).
 *
 * Host-agnostic by construction:
 *  - the engine + migration bodies operate on the `MigrationDb` handle
 *    interface, never on a concrete driver -- the package carries no
 *    better-sqlite3 runtime dependency;
 *  - the few app-specific helpers the bodies reference (`dbLog`,
 *    `getEvalParquetRoot`, `computePackageCalendarRatios`, and the
 *    data-quality DDL) resolve through the installed MigrationHost (host.ts),
 *    so every migration body below is verbatim from the original file. The one
 *    exception is the v112 `data_quality_event` DDL: the original bare
 *    identifier `DATA_QUALITY_EVENT_TABLE_DDL` is now `getDataQualityEventTableDdl()`
 *    (the DDL string is host-supplied, not known at module-load time).
 *
 * The `MigrationManager.migrate()` apply loop matches the original semantics
 * exactly (filter version > current, run in version order, ONE outer
 * transaction over the whole pending batch, per-migration schema_version
 * insert, post-commit hooks after the transaction commits) -- with ONE
 * addition: the outer transaction is now `.immediate` and is preceded by a
 * busy_timeout + a locked re-read of the current version, so two hosts racing
 * a fresh DB serialize and one no-ops (TICKET_1289_1 AC7).
 */
import {
  PROVIDER_YFINANCE, PROVIDER_ALPACA, PROVIDER_CCXT,
  PROVIDER_DUKASCOPY,
} from '@StratCraft/types';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Migration, MigrationDb } from './types';
import {
  dbLog,
  getEvalParquetRoot,
  computePackageCalendarRatios,
  getDataQualityEventTableDdl,
} from './host';

/**
 * TICKET_1289_1 AC7: how long the loser of a concurrent first-start waits for
 * the RESERVED write lock before failing `SQLITE_BUSY`. Sized well above the
 * wall-clock of applying the full pending batch on a cold machine (the winner
 * holds the lock only for that batch), so the loser reliably waits it out and
 * then no-ops. NOT a timeout-as-solution (TICKET_855): the lock is the
 * mechanism; this is the bounded wait for it.
 */
export const MIGRATION_LOCK_BUSY_TIMEOUT_MS = 120_000;

const EMBEDDED_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: `
CREATE TABLE nona_algorithms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  file_path TEXT,
  strategy_name TEXT,
  description TEXT,
  strategy_type INTEGER DEFAULT 0 CHECK(strategy_type BETWEEN 0 AND 9),
  classification_metadata TEXT,
  record_type TEXT DEFAULT 'strategy' CHECK(record_type IN ('indicator', 'strategy')),
  category TEXT,
  metadata TEXT,
  pnl TEXT DEFAULT '0.00',
  user_id TEXT,
  is_system INTEGER DEFAULT 0 CHECK(is_system IN (0, 1)),
  status INTEGER DEFAULT 1 CHECK(status IN (0, 1)),
  activate INTEGER DEFAULT 1 CHECK(activate IN (0, 1)),
  create_time TEXT NOT NULL DEFAULT (datetime('now')),
  update_time TEXT NOT NULL DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'local' CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT,
  local_only INTEGER DEFAULT 0 CHECK(local_only IN (0, 1))
);
CREATE INDEX idx_nona_algorithms_user_id ON nona_algorithms(user_id);
CREATE INDEX idx_nona_algorithms_strategy_type ON nona_algorithms(strategy_type);
CREATE INDEX idx_nona_algorithms_status ON nona_algorithms(status);
CREATE INDEX idx_nona_algorithms_is_system ON nona_algorithms(is_system);
CREATE INDEX idx_nona_algorithms_create_time ON nona_algorithms(create_time);

CREATE TABLE nona_factors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factor_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'custom' CHECK(source IN ('library', 'mined', 'custom')),
  category TEXT NOT NULL,
  formula TEXT,
  code TEXT,
  params TEXT,
  ic REAL, icir REAL, rank_ic REAL, rank_icir REAL, sharpe REAL, max_drawdown REAL,
  symbols_validated TEXT, symbol_results TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'testing')),
  user_id TEXT, mining_task_id TEXT, file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  sync_status TEXT DEFAULT 'local' CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT
);
CREATE INDEX idx_nona_factors_source ON nona_factors(source);
CREATE INDEX idx_nona_factors_category ON nona_factors(category);
CREATE INDEX idx_nona_factors_user_id ON nona_factors(user_id);
CREATE INDEX idx_nona_factors_status ON nona_factors(status);

CREATE TABLE nona_backtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  initial_capital TEXT NOT NULL,
  final_capital TEXT NOT NULL,
  total_return TEXT NOT NULL,
  sharpe_ratio REAL, max_drawdown REAL, win_rate REAL,
  total_trades INTEGER, winning_trades INTEGER, losing_trades INTEGER,
  equity_curve TEXT, trade_log TEXT,
  execution_time_ms INTEGER, data_points_count INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(strategy_id) REFERENCES nona_algorithms(id) ON DELETE CASCADE
);
CREATE INDEX idx_nona_backtest_results_strategy_id ON nona_backtest_results(strategy_id);
CREATE INDEX idx_nona_backtest_results_symbol ON nona_backtest_results(symbol);
`,
    down: `
DROP TABLE IF EXISTS nona_backtest_results;
DROP TABLE IF EXISTS nona_factors;
DROP TABLE IF EXISTS nona_algorithms;
`,
  },
  {
    version: 2,
    name: 'add algorithm fields',
    up: `
ALTER TABLE nona_algorithms ADD COLUMN strategy_rules TEXT;
ALTER TABLE nona_algorithms ADD COLUMN prompt_template TEXT;
`,
    down: `-- SQLite DROP COLUMN requires table rebuild, skipped`,
  },
  {
    version: 3,
    name: 'add versioning and registry',
    up: `
ALTER TABLE nona_algorithms ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE nona_factors ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE nona_backtest_results ADD COLUMN version INTEGER DEFAULT 1;

CREATE TABLE plugin_registry (
  plugin_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  display_name TEXT,
  hub_contributes TEXT,
  hub_consumes TEXT,
  status TEXT DEFAULT 'active',
  installed_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_plugin_registry_status ON plugin_registry(status);
`,
    down: `DROP TABLE IF EXISTS plugin_registry;`,
  },
  {
    version: 4,
    name: 'file sharing hub',
    up: `
CREATE TABLE hub_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('strategy', 'data', 'report', 'config', 'cache')),
  mime_type TEXT,
  size INTEGER NOT NULL,
  storage_type TEXT NOT NULL CHECK(storage_type IN ('blob', 'external')),
  content BLOB,
  external_path TEXT,
  checksum TEXT,
  description TEXT,
  tags TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  version INTEGER DEFAULT 1
);
CREATE INDEX idx_hub_files_type ON hub_files(type);
CREATE INDEX idx_hub_files_created_by ON hub_files(created_by);
CREATE INDEX idx_hub_files_storage_type ON hub_files(storage_type);
`,
    down: `DROP TABLE IF EXISTS hub_files;`,
  },
  {
    version: 5,
    name: 'backtest engine tables',
    up: `
-- TICKET_118 Phase 3: Backtest Engine Shared Tables
-- See: TICKET_118_SHARED_TABLES_DESIGN.md
-- Reason: Multi-plugin access (backtest-nexus + future analysis plugins)

-- Task lifecycle management (shared: other plugins may query task status)
CREATE TABLE IF NOT EXISTS backtest_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  test_cases TEXT,
  ws_token TEXT,
  status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  project_name TEXT DEFAULT 'DefaultProject',
  start_time TEXT,
  end_time TEXT,
  timeframe TEXT,
  initial_capital REAL,
  order_size_value REAL,
  order_size_unit TEXT,
  result TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_backtest_tasks_task_id ON backtest_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_backtest_tasks_user_id ON backtest_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_tasks_status ON backtest_tasks(status);

-- Strategy execution results (shared: analysis plugins may need detailed results)
CREATE TABLE IF NOT EXISTS strategy_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  strategy_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  strategy_type TEXT DEFAULT 'backtest',
  entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  initial_value REAL NOT NULL,
  final_value REAL NOT NULL,
  returns REAL NOT NULL,
  profit_loss REAL NOT NULL,
  profit_loss_pct REAL NOT NULL,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  status TEXT DEFAULT 'COMPLETED',
  parameters TEXT,
  metrics TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (strategy_id) REFERENCES nona_algorithms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_trade_id ON strategy_runs(trade_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_task_id ON strategy_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_strategy_id ON strategy_runs(strategy_id);

-- Individual trade records (shared: trade analysis plugins may need granular data)
CREATE TABLE IF NOT EXISTS trade_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  strategy_type TEXT,
  entry_time DATETIME,
  exit_time DATETIME,
  direction TEXT CHECK(direction IN ('long', 'short', 'long', 'short', NULL)),
  pnl REAL,
  trade_size REAL,
  entry_price REAL,
  exit_price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES strategy_runs(trade_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trade_records_trade_id ON trade_records(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_records_task_id ON trade_records(task_id);
CREATE INDEX IF NOT EXISTS idx_trade_records_entry_time ON trade_records(entry_time);
`,
    down: `
DROP TABLE IF EXISTS trade_records;
DROP TABLE IF EXISTS strategy_runs;
DROP TABLE IF EXISTS backtest_tasks;
`,
  },
  {
    version: 6,
    name: 'desktop backtest results',
    up: `
-- TICKET_153: Desktop backtest result persistence
-- Standalone table for V3 executor results (independent of nona_algorithms)
CREATE TABLE desktop_backtest_results (
  task_id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  initial_capital REAL NOT NULL,
  final_capital REAL NOT NULL,
  total_pnl REAL,
  total_return REAL,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  max_drawdown REAL,
  win_rate REAL,
  profit_factor REAL,
  total_trades INTEGER,
  winning_trades INTEGER,
  losing_trades INTEGER,
  trades_json TEXT,
  equity_curve_json TEXT,
  execution_time_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_desktop_backtest_symbol ON desktop_backtest_results(symbol);
CREATE INDEX idx_desktop_backtest_created ON desktop_backtest_results(created_at);
`,
    down: `DROP TABLE IF EXISTS desktop_backtest_results;`,
  },
  {
    version: 7,
    name: 'remove deprecated tables',
    up: `
-- TICKET_156: Remove deprecated tables from V1/Plugin architecture
-- These tables are not used in V3 Executor architecture
-- Verified: All tables have 0 records (2025-01-20)

-- V1 Legacy (never used, FK constraint incompatible with V3)
DROP TABLE IF EXISTS nona_backtest_results;

-- Plugin Layer (gRPC service deprecated in V3)
-- Must drop in order due to FK constraints
DROP TABLE IF EXISTS trade_records;
DROP TABLE IF EXISTS strategy_runs;
DROP TABLE IF EXISTS backtest_tasks;
`,
    down: `
-- Rollback: Recreate tables (empty, no data to restore)
-- Note: This is simplified schema for rollback only

CREATE TABLE IF NOT EXISTS backtest_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategy_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  strategy_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  pnl REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nona_backtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`,
  },
  {
    version: 8,
    name: 'add order size columns',
    up: `
-- TICKET_153: Add order size configuration to backtest results
ALTER TABLE desktop_backtest_results ADD COLUMN order_size REAL;
ALTER TABLE desktop_backtest_results ADD COLUMN order_size_unit TEXT;
`,
    down: `-- SQLite DROP COLUMN requires table rebuild, skipped`,
  },
  {
    version: 9,
    name: 'extend strategy type range',
    up: `
-- TICKET_207: Extend strategy_type range for Kronos types (11, 12)
-- SQLite requires table rebuild to modify CHECK constraint

-- Step 1: Create new table with extended CHECK constraint
CREATE TABLE nona_algorithms_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  file_path TEXT,
  strategy_name TEXT,
  description TEXT,
  strategy_type INTEGER DEFAULT 0 CHECK(strategy_type BETWEEN 0 AND 15),
  classification_metadata TEXT,
  record_type TEXT DEFAULT 'strategy' CHECK(record_type IN ('indicator', 'strategy')),
  category TEXT,
  metadata TEXT,
  pnl TEXT DEFAULT '0.00',
  user_id TEXT,
  is_system INTEGER DEFAULT 0 CHECK(is_system IN (0, 1)),
  status INTEGER DEFAULT 1 CHECK(status IN (0, 1)),
  activate INTEGER DEFAULT 1 CHECK(activate IN (0, 1)),
  create_time TEXT NOT NULL DEFAULT (datetime('now')),
  update_time TEXT NOT NULL DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'local' CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT,
  local_only INTEGER DEFAULT 0 CHECK(local_only IN (0, 1)),
  strategy_rules TEXT,
  prompt_template TEXT,
  version INTEGER DEFAULT 1
);

-- Step 2: Copy data from old table
INSERT INTO nona_algorithms_new SELECT * FROM nona_algorithms;

-- Step 3: Drop old table and indexes
DROP INDEX IF EXISTS idx_nona_algorithms_create_time;
DROP INDEX IF EXISTS idx_nona_algorithms_is_system;
DROP INDEX IF EXISTS idx_nona_algorithms_status;
DROP INDEX IF EXISTS idx_nona_algorithms_strategy_type;
DROP INDEX IF EXISTS idx_nona_algorithms_user_id;
DROP TABLE nona_algorithms;

-- Step 4: Rename new table
ALTER TABLE nona_algorithms_new RENAME TO nona_algorithms;

-- Step 5: Recreate indexes
CREATE INDEX idx_nona_algorithms_user_id ON nona_algorithms(user_id);
CREATE INDEX idx_nona_algorithms_strategy_type ON nona_algorithms(strategy_type);
CREATE INDEX idx_nona_algorithms_status ON nona_algorithms(status);
CREATE INDEX idx_nona_algorithms_is_system ON nona_algorithms(is_system);
CREATE INDEX idx_nona_algorithms_create_time ON nona_algorithms(create_time);
`,
    down: `-- Rollback not supported: would lose data with strategy_type > 9`,
  },
  {
    version: 10,
    name: 'ai conversations',
    up: `
-- TICKET_077_19: AI Strategy Studio Conversations
-- Creates tables for AI conversation persistence

CREATE TABLE nona_ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Strategy',
  preview TEXT,
  message_count INTEGER DEFAULT 0,
  token_usage INTEGER DEFAULT 0,
  token_limit INTEGER DEFAULT 128000,
  strategy_rules TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_nona_ai_conversations_user_id ON nona_ai_conversations(user_id);
CREATE INDEX idx_nona_ai_conversations_status ON nona_ai_conversations(status);
CREATE INDEX idx_nona_ai_conversations_updated_at ON nona_ai_conversations(updated_at);

CREATE TRIGGER trigger_nona_ai_conversations_updated_at
AFTER UPDATE ON nona_ai_conversations
FOR EACH ROW
BEGIN
  UPDATE nona_ai_conversations
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;

CREATE TABLE nona_ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(conversation_id) REFERENCES nona_ai_conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_nona_ai_messages_conversation_id ON nona_ai_messages(conversation_id);
CREATE INDEX idx_nona_ai_messages_type ON nona_ai_messages(type);
CREATE INDEX idx_nona_ai_messages_created_at ON nona_ai_messages(created_at);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_ai_messages_created_at;
DROP INDEX IF EXISTS idx_nona_ai_messages_type;
DROP INDEX IF EXISTS idx_nona_ai_messages_conversation_id;
DROP TABLE IF EXISTS nona_ai_messages;

DROP TRIGGER IF EXISTS trigger_nona_ai_conversations_updated_at;
DROP INDEX IF EXISTS idx_nona_ai_conversations_updated_at;
DROP INDEX IF EXISTS idx_nona_ai_conversations_status;
DROP INDEX IF EXISTS idx_nona_ai_conversations_user_id;
DROP TABLE IF EXISTS nona_ai_conversations;
`,
  },
  {
    version: 11,
    name: 'signal source registry',
    up: `
-- TICKET_264: Signal Source Registry for Quant Lab integration
-- Stores complete workflow configurations (Analysis + Entry + Exit) as Signal Sources

CREATE TABLE signal_source_registry (
    -- Metadata
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'workflow',
    exported_at TEXT NOT NULL,

    -- Analysis Component (Required)
    analysis_algorithm_id TEXT NOT NULL,
    analysis_algorithm_name TEXT NOT NULL,
    analysis_algorithm_code TEXT NOT NULL,
    analysis_base_class TEXT NOT NULL,
    analysis_timeframe TEXT NOT NULL,
    analysis_parameters TEXT,

    -- Entry Component (Required)
    entry_algorithm_id TEXT NOT NULL,
    entry_algorithm_name TEXT NOT NULL,
    entry_algorithm_code TEXT NOT NULL,
    entry_base_class TEXT NOT NULL,
    entry_timeframe TEXT NOT NULL,
    entry_parameters TEXT,

    -- Exit Component (Optional)
    exit_algorithm_id TEXT,
    exit_algorithm_name TEXT,
    exit_algorithm_code TEXT,
    exit_base_class TEXT,
    exit_timeframe TEXT,
    exit_parameters TEXT,

    -- Backtest Metrics (Reference)
    backtest_sharpe REAL,
    backtest_max_drawdown REAL,
    backtest_win_rate REAL,
    backtest_total_trades INTEGER,
    backtest_profit_factor REAL,

    -- Original Backtest Config
    symbol TEXT,
    date_range_start TEXT,
    date_range_end TEXT,

    -- Extensibility
    metadata TEXT
);

CREATE INDEX idx_signal_source_name ON signal_source_registry(name);
CREATE INDEX idx_signal_source_exported_at ON signal_source_registry(exported_at);
CREATE INDEX idx_signal_source_type ON signal_source_registry(source_type);
`,
    down: `
DROP INDEX IF EXISTS idx_signal_source_type;
DROP INDEX IF EXISTS idx_signal_source_exported_at;
DROP INDEX IF EXISTS idx_signal_source_name;
DROP TABLE IF EXISTS signal_source_registry;
`,
  },

  // PLUGIN_TICKET_011: Alpha Factory configuration persistence
  {
    version: 12,
    name: 'PLUGIN_TICKET_011: Alpha Factory configuration persistence',
    up: `
CREATE TABLE alpha_factory_config (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    signal_method TEXT NOT NULL DEFAULT 'sharpe_weighted',
    lookback INTEGER NOT NULL DEFAULT 60,
    signals TEXT NOT NULL DEFAULT '[]',
    exit_method TEXT NOT NULL DEFAULT 'any',
    exits TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_alpha_factory_updated ON alpha_factory_config(updated_at DESC);
`,
    down: `
DROP INDEX IF EXISTS idx_alpha_factory_updated;
DROP TABLE IF EXISTS alpha_factory_config;
`,
  },

  // TICKET_273: Signal vs Exit source type differentiation
  {
    version: 13,
    name: 'TICKET_273: Add usage_type to signal_source_registry',
    up: `
ALTER TABLE signal_source_registry ADD COLUMN usage_type TEXT NOT NULL DEFAULT 'signal';
CREATE INDEX idx_signal_source_usage_type ON signal_source_registry(usage_type);
`,
    down: `
DROP INDEX IF EXISTS idx_signal_source_usage_type;
ALTER TABLE signal_source_registry DROP COLUMN usage_type;
`,
  },

  // TICKET_276: Factor layer columns for Alpha Factory config
  {
    version: 14,
    name: 'TICKET_276: Add factor columns to alpha_factory_config',
    up: `
ALTER TABLE alpha_factory_config ADD COLUMN factors TEXT NOT NULL DEFAULT '[]';
ALTER TABLE alpha_factory_config ADD COLUMN factor_method TEXT NOT NULL DEFAULT 'equal_weight';
ALTER TABLE alpha_factory_config ADD COLUMN factor_lookback INTEGER NOT NULL DEFAULT 60;
`,
    down: `-- SQLite DROP COLUMN requires table rebuild, skipped`,
  },

  // TICKET_279: Expand nona_factors source CHECK for backend values
  {
    version: 15,
    name: 'TICKET_279: Expand nona_factors source CHECK for backend values',
    up: `
CREATE TABLE nona_factors_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factor_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'custom'
    CHECK(source IN ('library', 'alpha158', 'alpha101', 'talib', 'mined', 'custom')),
  category TEXT NOT NULL,
  formula TEXT,
  code TEXT,
  params TEXT,
  ic REAL, icir REAL, rank_ic REAL,
  rank_icir REAL, sharpe REAL, max_drawdown REAL,
  symbols_validated TEXT,
  symbol_results TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'inactive', 'testing')),
  user_id TEXT,
  mining_task_id TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  sync_status TEXT DEFAULT 'local'
    CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT,
  version INTEGER DEFAULT 1
);
INSERT INTO nona_factors_new SELECT * FROM nona_factors;
DROP TABLE nona_factors;
ALTER TABLE nona_factors_new RENAME TO nona_factors;
CREATE INDEX idx_nona_factors_source ON nona_factors(source);
CREATE INDEX idx_nona_factors_category ON nona_factors(category);
CREATE INDEX idx_nona_factors_user_id ON nona_factors(user_id);
CREATE INDEX idx_nona_factors_status ON nona_factors(status);
`,
    down: `-- Reverse migration not needed; old values still valid in expanded constraint`,
  },

  // TICKET_281: Add factor_type column to nona_factors
  {
    version: 16,
    name: 'TICKET_281: Add factor_type to nona_factors',
    up: `ALTER TABLE nona_factors ADD COLUMN factor_type TEXT NOT NULL DEFAULT 'time_series' CHECK(factor_type IN ('time_series', 'cross_sectional'));`,
    down: `-- SQLite DROP COLUMN requires table rebuild, skipped`,
  },

  // TICKET_285: Add translation_status, qlib_expr, cs_pipeline to nona_factors
  {
    version: 17,
    name: 'TICKET_285: Add cs_pipeline fields to nona_factors',
    up: [
      `ALTER TABLE nona_factors ADD COLUMN translation_status TEXT;`,
      `ALTER TABLE nona_factors ADD COLUMN qlib_expr TEXT;`,
      `ALTER TABLE nona_factors ADD COLUMN cs_pipeline TEXT;`,
    ].join('\n'),
    down: `-- SQLite DROP COLUMN requires table rebuild, skipped`,
  },

  // TICKET_286/287: Factor Engine Registry
  {
    version: 18,
    name: 'TICKET_286: Factor engine registry table',
    up: [
      `CREATE TABLE IF NOT EXISTS factor_engine_registry (
  engine_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  python_package TEXT,
  factor_count INTEGER NOT NULL DEFAULT 0,
  examples TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  installed INTEGER NOT NULL DEFAULT 0,
  version TEXT,
  installed_at TEXT
);`,
      `INSERT OR IGNORE INTO factor_engine_registry (engine_id, display_name, description, python_package, factor_count, examples, builtin, installed, version)
VALUES
  ('alpha158', 'Alpha158', 'Qlib Alpha158 factor library - rolling statistics on OHLCV', NULL, 58, 'Mean($close, 5), Std($close, 10)', 1, 1, '1.0.0'),
  ('alpha101', 'Alpha101', 'WorldQuant Alpha101 formulaic alphas - cross-sectional and time-series', NULL, 101, 'Alpha#001, Alpha#006', 1, 1, '1.0.0'),
  ('talib', 'TA-Lib', 'Technical analysis library via pandas-ta - 158 indicators', 'pandas-ta', 158, 'RSI(14), MACD(12,26,9)', 0, 0, '1.0.0');`,
    ].join('\n'),
    down: `DROP TABLE IF EXISTS factor_engine_registry;`,
  },
  {
    version: 19,
    name: 'TICKET_290: Cleanup orphaned factors from uninstalled engines',
    up: `DELETE FROM nona_factors WHERE source IN (
  SELECT engine_id FROM factor_engine_registry WHERE installed = 0
);`,
    down: `-- No reversal: orphaned rows were data corruption from legacy FACTOR_SYNC bug`,
  },

  // TICKET_329: Incremental download segment tracking
  {
    version: 20,
    name: 'TICKET_329: Data cache segments for incremental download',
    up: `
CREATE TABLE data_cache_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  provider TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dcs_lookup ON data_cache_segments(symbol, interval, provider);
CREATE INDEX idx_dcs_range ON data_cache_segments(symbol, interval, provider, start_date, end_date);
`,
    down: `
DROP INDEX IF EXISTS idx_dcs_range;
DROP INDEX IF EXISTS idx_dcs_lookup;
DROP TABLE IF EXISTS data_cache_segments;
`,
  },
  {
    version: 21,
    name: 'TICKET_345: Download queue persistence for checkpoint resume',
    up: `
CREATE TABLE download_queue (
  task_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT 'Queued',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dq_status ON download_queue(status);
`,
    down: `
DROP INDEX IF EXISTS idx_dq_status;
DROP TABLE IF EXISTS download_queue;
`,
  },

  // TICKET_346: Segment status for chunk vs merged distinction
  {
    version: 22,
    name: 'TICKET_346: Add status column to data_cache_segments',
    up: `
ALTER TABLE data_cache_segments ADD COLUMN status TEXT NOT NULL DEFAULT 'merged';
CREATE INDEX idx_dcs_status ON data_cache_segments(status);
`,
    down: `
DROP INDEX IF EXISTS idx_dcs_status;
-- SQLite DROP COLUMN requires table rebuild, skipped
`,
  },

  // TICKET_345: Chunk-index checkpoint for resumable downloads
  {
    version: 23,
    name: 'TICKET_345: Add chunk-index columns to download_queue',
    up: `
ALTER TABLE download_queue ADD COLUMN total_chunks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_queue ADD COLUMN completed_chunks INTEGER NOT NULL DEFAULT 0;
`,
    down: `
-- SQLite DROP COLUMN requires table rebuild, skipped
`,
  },
  {
    version: 24,
    name: 'TICKET_360 GAP-2: Add candles_json to backtest results',
    up: `
ALTER TABLE desktop_backtest_results ADD COLUMN candles_json TEXT;
`,
    down: `
-- SQLite DROP COLUMN requires table rebuild, skipped
`,
  },
  {
    version: 25,
    name: 'TICKET_360 GAP-3: Open tabs persistence across app restart',
    up: `
CREATE TABLE desktop_open_tabs (
  task_id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES desktop_backtest_results(task_id) ON DELETE CASCADE
);
`,
    down: `DROP TABLE IF EXISTS desktop_open_tabs;`,
  },

  // TICKET_362: Single-File Append data cache redesign
  {
    version: 26,
    name: 'TICKET_362: Single-file append data cache (replaces segments)',
    up: `
CREATE TABLE data_cache_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  interval      TEXT NOT NULL,
  provider      TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  first_timestamp INTEGER NOT NULL,
  last_timestamp  INTEGER NOT NULL,
  row_count     INTEGER NOT NULL,
  source_type   TEXT NOT NULL DEFAULT 'base',
  base_file_id  INTEGER,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, interval, provider)
);
CREATE INDEX idx_dcf_lookup ON data_cache_files(symbol, interval, provider);
DROP TABLE IF EXISTS data_cache_segments;
`,
    down: `
DROP INDEX IF EXISTS idx_dcf_lookup;
DROP TABLE IF EXISTS data_cache_files;
`,
  },

  // TICKET_363: Store parquet data_path for candle re-fetch after restart
  {
    version: 27,
    name: 'TICKET_363: Add data_path column to backtest results',
    up: `ALTER TABLE desktop_backtest_results ADD COLUMN data_path TEXT;`,
    down: `-- SQLite cannot drop columns`,
  },

  // TICKET_371: Cancelled/failed task persistence across app restart
  {
    version: 28,
    name: 'TICKET_371: Backtest task history for terminal-state tasks',
    up: `
CREATE TABLE IF NOT EXISTS desktop_backtest_task_history (
  task_id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','failed','cancelled')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX idx_task_history_status ON desktop_backtest_task_history(status);
CREATE INDEX idx_task_history_finished ON desktop_backtest_task_history(finished_at DESC);
`,
    down: `
DROP INDEX IF EXISTS idx_task_history_finished;
DROP INDEX IF EXISTS idx_task_history_status;
DROP TABLE IF EXISTS desktop_backtest_task_history;
`,
  },

  // TICKET_351_P2: Unified data download queue with priority and coalescing
  {
    version: 29,
    name: 'TICKET_351_P2: Download queue priority, caller, and multi-timeframe support',
    up: `
ALTER TABLE download_queue ADD COLUMN priority TEXT NOT NULL DEFAULT 'background';
ALTER TABLE download_queue ADD COLUMN caller_id TEXT NOT NULL DEFAULT 'data-manager';
ALTER TABLE download_queue ADD COLUMN waiting_since INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_queue ADD COLUMN timeframes TEXT;
`,
    down: `
-- SQLite DROP COLUMN requires table rebuild, skipped
`,
  },

  // TICKET_437 + TICKET_448: Deduplicate then add unique constraint
  {
    version: 30,
    name: 'TICKET_437: Unique constraint on strategy_name + user_id',
    up: `
-- TICKET_448: Remove duplicate (strategy_name, user_id) rows, keep highest id
DELETE FROM nona_algorithms
WHERE id NOT IN (
  SELECT MAX(id)
  FROM nona_algorithms
  GROUP BY strategy_name, user_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nona_algorithms_name_user
  ON nona_algorithms(strategy_name, user_id);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_algorithms_name_user;
`,
  },
  {
    version: 31,
    name: 'TICKET_498: Add dry run info columns to backtest results',
    up: `
ALTER TABLE desktop_backtest_results ADD COLUMN is_dry_run INTEGER DEFAULT 0;
ALTER TABLE desktop_backtest_results ADD COLUMN dry_run_info_json TEXT;
`,
    down: `
-- SQLite does not support DROP COLUMN before 3.35.0; safe no-op
`,
  },

  // TICKET_546: Strategy Audit Scoring System
  {
    version: 32,
    name: 'TICKET_546: Strategy audit scoring table',
    up: `
CREATE TABLE IF NOT EXISTS strategy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  algorithm_id INTEGER NOT NULL,
  signal_source TEXT NOT NULL,
  regime TEXT,
  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,

  d1_completeness REAL NOT NULL,
  d2_similarity REAL NOT NULL,
  d3_indicator_fit REAL NOT NULL,
  d4_code_quality REAL NOT NULL,
  d5_robustness REAL NOT NULL,

  overall_score REAL NOT NULL,
  star_rating INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),

  audit_detail TEXT NOT NULL DEFAULT '{}',

  code_hash TEXT NOT NULL,
  ast_fingerprint TEXT NOT NULL,

  create_time TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (algorithm_id) REFERENCES nona_algorithms(id) ON DELETE CASCADE
);

CREATE INDEX idx_strategy_audit_algorithm_id ON strategy_audit(algorithm_id);
CREATE INDEX idx_strategy_audit_signal_source ON strategy_audit(signal_source);
CREATE INDEX idx_strategy_audit_model ON strategy_audit(llm_provider, llm_model);
CREATE INDEX idx_strategy_audit_code_hash ON strategy_audit(code_hash);
CREATE INDEX idx_strategy_audit_star ON strategy_audit(star_rating);
`,
    down: `
DROP TABLE IF EXISTS strategy_audit;
`,
  },

  // TICKET_580_6: Soft-Delete / Recycle Bin (30-Day Retention)
  {
    version: 33,
    name: 'TICKET_580_6: Soft-delete columns for recycle bin',
    up: `
ALTER TABLE nona_algorithms ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE signal_source_registry ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE nona_ai_conversations ADD COLUMN deleted_at TEXT DEFAULT NULL;

CREATE INDEX idx_algorithms_deleted_at ON nona_algorithms(deleted_at);
CREATE INDEX idx_signal_source_deleted_at ON signal_source_registry(deleted_at);
CREATE INDEX idx_conversations_deleted_at ON nona_ai_conversations(deleted_at);

-- Backfill: set deleted_at for already soft-deleted conversations
UPDATE nona_ai_conversations SET deleted_at = datetime('now') WHERE status = 'deleted';
`,
    down: `
DROP INDEX IF EXISTS idx_conversations_deleted_at;
DROP INDEX IF EXISTS idx_signal_source_deleted_at;
DROP INDEX IF EXISTS idx_algorithms_deleted_at;
-- SQLite DROP COLUMN requires table rebuild, skipped for rollback safety
`,
  },

  // TICKET_605: Signal Generator tables (bundled CCXT Signal Generator)
  // DEPRECATED (TICKET_632_2): Signal Generator extracted to StratCraft-ccxt. Migration retained for backward compatibility.
  {
    version: 34,
    name: 'signal_generator_tables',
    up: `
-- Signal history: records every signal emitted by the signal engine
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  strategy_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  qty REAL,
  price REAL,
  confidence REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'executed', 'skipped', 'expired', 'failed')),
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_strategy_id ON signals(strategy_id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);

-- Signal audit: tracks all actions taken on signals (execute, skip, status changes)
CREATE TABLE IF NOT EXISTS signal_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  details TEXT,
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_signal_audit_signal_id ON signal_audit(signal_id);
`,
    down: `
DROP INDEX IF EXISTS idx_signal_audit_signal_id;
DROP TABLE IF EXISTS signal_audit;
DROP INDEX IF EXISTS idx_signals_created_at;
DROP INDEX IF EXISTS idx_signals_status;
DROP INDEX IF EXISTS idx_signals_symbol;
DROP INDEX IF EXISTS idx_signals_strategy_id;
DROP TABLE IF EXISTS signals;
`,
  },

  // TICKET_612: Saved Strategy Table Normalization
  // Replaces wide signal_source_registry with normalized saved_strategies + saved_strategy_components
  {
    version: 35,
    name: 'TICKET_612: Saved strategy table normalization',
    up: `
-- Step 1: Create normalized tables
CREATE TABLE saved_strategies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'workflow',
    saved_at TEXT NOT NULL,
    backtest_sharpe REAL,
    backtest_max_drawdown REAL,
    backtest_win_rate REAL,
    backtest_total_trades INTEGER,
    backtest_profit_factor REAL,
    symbol TEXT,
    date_range_start TEXT,
    date_range_end TEXT,
    metadata TEXT,
    deleted_at TEXT DEFAULT NULL
);

CREATE INDEX idx_saved_strategies_name ON saved_strategies(name);
CREATE INDEX idx_saved_strategies_saved_at ON saved_strategies(saved_at);
CREATE INDEX idx_saved_strategies_source_type ON saved_strategies(source_type);
CREATE INDEX idx_saved_strategies_deleted_at ON saved_strategies(deleted_at);

CREATE TABLE saved_strategy_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id TEXT NOT NULL,
    role TEXT NOT NULL,
    algorithm_id TEXT,
    algorithm_name TEXT NOT NULL,
    algorithm_code TEXT,
    base_class TEXT,
    timeframe TEXT,
    parameters TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(strategy_id) REFERENCES saved_strategies(id) ON DELETE CASCADE
);

CREATE INDEX idx_ssc_strategy_id ON saved_strategy_components(strategy_id);
CREATE INDEX idx_ssc_role ON saved_strategy_components(role);

-- Step 2: Migrate data from signal_source_registry
-- Group by (name, exported_at) to deduplicate signal+exit pair records

-- Insert parent records (deduplicated: one per unique strategy)
INSERT INTO saved_strategies (id, name, description, source_type, saved_at,
    backtest_sharpe, backtest_max_drawdown, backtest_win_rate,
    backtest_total_trades, backtest_profit_factor,
    symbol, date_range_start, date_range_end, metadata, deleted_at)
SELECT
    MIN(id), name, MIN(description), source_type, exported_at,
    MAX(backtest_sharpe), MAX(backtest_max_drawdown), MAX(backtest_win_rate),
    MAX(backtest_total_trades), MAX(backtest_profit_factor),
    MAX(symbol), MAX(date_range_start), MAX(date_range_end),
    MAX(metadata), MAX(deleted_at)
FROM signal_source_registry
GROUP BY name, exported_at;

-- Insert analysis components
INSERT INTO saved_strategy_components (strategy_id, role, algorithm_id, algorithm_name,
    algorithm_code, base_class, timeframe, parameters, sort_order)
SELECT ss.id, 'analysis', ssr.analysis_algorithm_id, ssr.analysis_algorithm_name,
    ssr.analysis_algorithm_code, ssr.analysis_base_class, ssr.analysis_timeframe,
    ssr.analysis_parameters, 0
FROM signal_source_registry ssr
JOIN saved_strategies ss ON ss.name = ssr.name AND ss.saved_at = ssr.exported_at
WHERE ssr.analysis_algorithm_name IS NOT NULL
GROUP BY ss.id;

-- Insert entry components
INSERT INTO saved_strategy_components (strategy_id, role, algorithm_id, algorithm_name,
    algorithm_code, base_class, timeframe, parameters, sort_order)
SELECT ss.id, 'entry', ssr.entry_algorithm_id, ssr.entry_algorithm_name,
    ssr.entry_algorithm_code, ssr.entry_base_class, ssr.entry_timeframe,
    ssr.entry_parameters, 1
FROM signal_source_registry ssr
JOIN saved_strategies ss ON ss.name = ssr.name AND ss.saved_at = ssr.exported_at
WHERE ssr.entry_algorithm_name IS NOT NULL
GROUP BY ss.id;

-- Insert exit components (only from records that have exit data)
INSERT INTO saved_strategy_components (strategy_id, role, algorithm_id, algorithm_name,
    algorithm_code, base_class, timeframe, parameters, sort_order)
SELECT ss.id, 'exit', ssr.exit_algorithm_id, ssr.exit_algorithm_name,
    ssr.exit_algorithm_code, ssr.exit_base_class, ssr.exit_timeframe,
    ssr.exit_parameters, 2
FROM signal_source_registry ssr
JOIN saved_strategies ss ON ss.name = ssr.name AND ss.saved_at = ssr.exported_at
WHERE ssr.exit_algorithm_name IS NOT NULL
GROUP BY ss.id;

-- Step 3: Drop old table and indexes
DROP INDEX IF EXISTS idx_signal_source_name;
DROP INDEX IF EXISTS idx_signal_source_exported_at;
DROP INDEX IF EXISTS idx_signal_source_type;
DROP INDEX IF EXISTS idx_signal_source_usage_type;
DROP INDEX IF EXISTS idx_signal_source_deleted_at;
DROP TABLE IF EXISTS signal_source_registry;
`,
    down: `
-- Recreate signal_source_registry with wide format
CREATE TABLE signal_source_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'workflow',
    exported_at TEXT NOT NULL,
    analysis_algorithm_id TEXT NOT NULL,
    analysis_algorithm_name TEXT NOT NULL,
    analysis_algorithm_code TEXT NOT NULL,
    analysis_base_class TEXT NOT NULL,
    analysis_timeframe TEXT NOT NULL,
    analysis_parameters TEXT,
    entry_algorithm_id TEXT NOT NULL,
    entry_algorithm_name TEXT NOT NULL,
    entry_algorithm_code TEXT NOT NULL,
    entry_base_class TEXT NOT NULL,
    entry_timeframe TEXT NOT NULL,
    entry_parameters TEXT,
    exit_algorithm_id TEXT,
    exit_algorithm_name TEXT,
    exit_algorithm_code TEXT,
    exit_base_class TEXT,
    exit_timeframe TEXT,
    exit_parameters TEXT,
    backtest_sharpe REAL,
    backtest_max_drawdown REAL,
    backtest_win_rate REAL,
    backtest_total_trades INTEGER,
    backtest_profit_factor REAL,
    symbol TEXT,
    date_range_start TEXT,
    date_range_end TEXT,
    metadata TEXT,
    usage_type TEXT NOT NULL DEFAULT 'signal',
    deleted_at TEXT DEFAULT NULL
);

CREATE INDEX idx_signal_source_name ON signal_source_registry(name);
CREATE INDEX idx_signal_source_exported_at ON signal_source_registry(exported_at);
CREATE INDEX idx_signal_source_type ON signal_source_registry(source_type);
CREATE INDEX idx_signal_source_usage_type ON signal_source_registry(usage_type);
CREATE INDEX idx_signal_source_deleted_at ON signal_source_registry(deleted_at);

-- Reverse-pivot: signal records (analysis + entry)
INSERT INTO signal_source_registry (
    id, name, description, source_type, exported_at, usage_type,
    analysis_algorithm_id, analysis_algorithm_name, analysis_algorithm_code,
    analysis_base_class, analysis_timeframe, analysis_parameters,
    entry_algorithm_id, entry_algorithm_name, entry_algorithm_code,
    entry_base_class, entry_timeframe, entry_parameters,
    backtest_sharpe, backtest_max_drawdown, backtest_win_rate,
    backtest_total_trades, backtest_profit_factor,
    symbol, date_range_start, date_range_end, metadata, deleted_at
)
SELECT
    ss.id, ss.name, ss.description, ss.source_type, ss.saved_at, 'signal',
    ac.algorithm_id, ac.algorithm_name, ac.algorithm_code,
    ac.base_class, ac.timeframe, ac.parameters,
    ec.algorithm_id, ec.algorithm_name, ec.algorithm_code,
    ec.base_class, ec.timeframe, ec.parameters,
    ss.backtest_sharpe, ss.backtest_max_drawdown, ss.backtest_win_rate,
    ss.backtest_total_trades, ss.backtest_profit_factor,
    ss.symbol, ss.date_range_start, ss.date_range_end, ss.metadata, ss.deleted_at
FROM saved_strategies ss
LEFT JOIN saved_strategy_components ac ON ac.strategy_id = ss.id AND ac.role = 'analysis'
LEFT JOIN saved_strategy_components ec ON ec.strategy_id = ss.id AND ec.role = 'entry';

-- Drop normalized tables
DROP TABLE IF EXISTS saved_strategy_components;
DROP TABLE IF EXISTS saved_strategies;
`,
  },

  // TICKET_613: Signal Engine schema - widen strategy_id to TEXT, add strategy_type
  // DEPRECATED (TICKET_632_2): Signal Generator extracted to StratCraft-ccxt. Migration retained for backward compatibility.
  {
    version: 36,
    name: 'TICKET_613: Signal engine strategy_id widening and strategy_type',
    up: `
-- Rename-copy pattern: signals -> signals_old, create new, copy, drop old
ALTER TABLE signals RENAME TO signals_old;

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  strategy_type TEXT NOT NULL DEFAULT 'algorithm'
    CHECK(strategy_type IN ('algorithm', 'saved')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  qty REAL,
  price REAL,
  confidence REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'executed', 'skipped', 'expired', 'failed')),
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

-- Migrate existing data: CAST strategy_id to TEXT, default strategy_type to 'algorithm'
INSERT INTO signals (id, strategy_id, strategy_type, symbol, side, qty, price,
  confidence, reason, status, executed_at, created_at, metadata)
SELECT id, CAST(strategy_id AS TEXT), 'algorithm', symbol, side, qty, price,
  confidence, reason, status, executed_at, created_at, metadata
FROM signals_old;

DROP TABLE signals_old;

CREATE INDEX idx_signals_strategy_id ON signals(strategy_id);
CREATE INDEX idx_signals_strategy_type ON signals(strategy_type);
CREATE INDEX idx_signals_symbol ON signals(symbol);
CREATE INDEX idx_signals_status ON signals(status);
CREATE INDEX idx_signals_created_at ON signals(created_at);
`,
    down: `
-- Reverse: recreate signals with INTEGER strategy_id
ALTER TABLE signals RENAME TO signals_new;

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  strategy_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  qty REAL,
  price REAL,
  confidence REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'executed', 'skipped', 'expired', 'failed')),
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

INSERT INTO signals (id, strategy_id, symbol, side, qty, price,
  confidence, reason, status, executed_at, created_at, metadata)
SELECT id, CAST(strategy_id AS INTEGER), symbol, side, qty, price,
  confidence, reason, status, executed_at, created_at, metadata
FROM signals_new
WHERE strategy_type = 'algorithm';

DROP TABLE signals_new;

CREATE INDEX idx_signals_strategy_id ON signals(strategy_id);
CREATE INDEX idx_signals_symbol ON signals(symbol);
CREATE INDEX idx_signals_status ON signals(status);
CREATE INDEX idx_signals_created_at ON signals(created_at);
`,
  },

  // NONABT_TICKET_011: C++ strategy compilation lifecycle
  {
    version: 37,
    name: 'NONABT_TICKET_011: C++ strategy compilation status',
    up: `
ALTER TABLE nona_algorithms ADD COLUMN compile_status TEXT DEFAULT 'pending'
  CHECK(compile_status IN ('pending', 'success', 'error'));
ALTER TABLE nona_algorithms ADD COLUMN compile_error TEXT DEFAULT NULL;
ALTER TABLE nona_algorithms ADD COLUMN compile_hash TEXT DEFAULT NULL;
ALTER TABLE nona_algorithms ADD COLUMN compile_artifact_path TEXT DEFAULT NULL;
ALTER TABLE nona_algorithms ADD COLUMN compiled_at INTEGER DEFAULT NULL;

CREATE INDEX idx_nona_algorithms_compile_status ON nona_algorithms(compile_status);
CREATE INDEX idx_nona_algorithms_compile_hash ON nona_algorithms(compile_hash);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_algorithms_compile_hash;
DROP INDEX IF EXISTS idx_nona_algorithms_compile_status;
-- SQLite DROP COLUMN requires table rebuild, skipped for rollback safety
`,
  },

  // TICKET_641_8: Algorithm audit status tracking
  {
    version: 38,
    name: 'TICKET_641_8: audit_status column for nona_algorithms',
    up: `
ALTER TABLE nona_algorithms ADD COLUMN audit_status TEXT DEFAULT NULL
  CHECK(audit_status IN ('pending', 'completed', 'failed', 'skipped'));

CREATE INDEX idx_nona_algorithms_audit_status ON nona_algorithms(audit_status);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_algorithms_audit_status;
-- SQLite DROP COLUMN requires table rebuild, skipped for rollback safety
`,
  },

  {
    version: 39,
    name: 'TICKET_650_P4: backend_validation_report column for nona_algorithms',
    up: `
ALTER TABLE nona_algorithms ADD COLUMN backend_validation_report TEXT DEFAULT NULL;
`,
    down: `
-- SQLite DROP COLUMN requires table rebuild, skipped for rollback safety
`,
  },

  // TICKET_560_2: Startup Check Audit Persistence
  {
    version: 40,
    name: 'TICKET_560_2: Startup audit persistence table',
    up: `
CREATE TABLE startup_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,

  -- Migration-561 results
  migration_561_status TEXT CHECK(migration_561_status IN ('skipped','fresh_install','migrated','error')),
  migration_561_dirs_copied INTEGER DEFAULT 0,
  migration_561_files_copied INTEGER DEFAULT 0,
  migration_561_files_skipped INTEGER DEFAULT 0,
  migration_561_error TEXT,

  -- Database init
  db_schema_version INTEGER,
  db_migrations_applied INTEGER DEFAULT 0,
  db_integrity_ok INTEGER DEFAULT 1,
  db_recovery_attempted INTEGER DEFAULT 0,

  -- Plugin discovery
  plugins_discovered INTEGER DEFAULT 0,
  plugins_loaded INTEGER DEFAULT 0,
  plugins_failed TEXT,

  -- Environment
  python_path TEXT,
  executor_available INTEGER DEFAULT 0,
  node_version TEXT,
  electron_version TEXT,
  platform TEXT,

  -- Timing
  startup_duration_ms INTEGER,
  phase_durations TEXT,

  -- Overall
  status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success','warning','error')),
  warnings TEXT,

  create_time TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_startup_audit_session ON startup_audit(session_id);
CREATE INDEX idx_startup_audit_status ON startup_audit(status);
CREATE INDEX idx_startup_audit_time ON startup_audit(create_time DESC);
`,
    down: `
DROP INDEX IF EXISTS idx_startup_audit_time;
DROP INDEX IF EXISTS idx_startup_audit_status;
DROP INDEX IF EXISTS idx_startup_audit_session;
DROP TABLE IF EXISTS startup_audit;
`,
  },

  // TICKET_762 Step 1: Dedicated nona_signal table for batch-generated discovery signals
  // Mirrors nona_algorithms head schema (post v9 rebuild + v33/v37/v38/v39 ALTERs) exactly.
  // Indexes mirror nona_algorithms 1:1 with `idx_nona_signal_` prefix.
  // No FK between the two tables -- they are peers. Sibling child tables
  // (strategy_runs_signal / strategy_audit_signal) and read-side views land in a later step.
  {
    version: 41,
    name: 'TICKET_762: Create nona_signal table mirroring nona_algorithms',
    up: `
CREATE TABLE IF NOT EXISTS nona_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  file_path TEXT,
  strategy_name TEXT,
  description TEXT,
  strategy_type INTEGER DEFAULT 0 CHECK(strategy_type BETWEEN 0 AND 15),
  classification_metadata TEXT,
  record_type TEXT DEFAULT 'strategy' CHECK(record_type IN ('indicator', 'strategy')),
  category TEXT,
  metadata TEXT,
  pnl TEXT DEFAULT '0.00',
  user_id TEXT,
  is_system INTEGER DEFAULT 0 CHECK(is_system IN (0, 1)),
  status INTEGER DEFAULT 1 CHECK(status IN (0, 1)),
  activate INTEGER DEFAULT 1 CHECK(activate IN (0, 1)),
  create_time TEXT NOT NULL DEFAULT (datetime('now')),
  update_time TEXT NOT NULL DEFAULT (datetime('now')),
  sync_status TEXT DEFAULT 'local' CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT,
  local_only INTEGER DEFAULT 0 CHECK(local_only IN (0, 1)),
  strategy_rules TEXT,
  prompt_template TEXT,
  version INTEGER DEFAULT 1,
  deleted_at TEXT DEFAULT NULL,
  compile_status TEXT DEFAULT 'pending'
    CHECK(compile_status IN ('pending', 'success', 'error')),
  compile_error TEXT DEFAULT NULL,
  compile_hash TEXT DEFAULT NULL,
  compile_artifact_path TEXT DEFAULT NULL,
  compiled_at INTEGER DEFAULT NULL,
  audit_status TEXT DEFAULT NULL
    CHECK(audit_status IN ('pending', 'completed', 'failed', 'skipped')),
  backend_validation_report TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_nona_signal_user_id ON nona_signal(user_id);
CREATE INDEX IF NOT EXISTS idx_nona_signal_strategy_type ON nona_signal(strategy_type);
CREATE INDEX IF NOT EXISTS idx_nona_signal_status ON nona_signal(status);
CREATE INDEX IF NOT EXISTS idx_nona_signal_is_system ON nona_signal(is_system);
CREATE INDEX IF NOT EXISTS idx_nona_signal_create_time ON nona_signal(create_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nona_signal_name_user
  ON nona_signal(strategy_name, user_id);
CREATE INDEX IF NOT EXISTS idx_nona_signal_deleted_at ON nona_signal(deleted_at);
CREATE INDEX IF NOT EXISTS idx_nona_signal_compile_status ON nona_signal(compile_status);
CREATE INDEX IF NOT EXISTS idx_nona_signal_compile_hash ON nona_signal(compile_hash);
CREATE INDEX IF NOT EXISTS idx_nona_signal_audit_status ON nona_signal(audit_status);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_signal_audit_status;
DROP INDEX IF EXISTS idx_nona_signal_compile_hash;
DROP INDEX IF EXISTS idx_nona_signal_compile_status;
DROP INDEX IF EXISTS idx_nona_signal_deleted_at;
DROP INDEX IF EXISTS idx_nona_signal_name_user;
DROP INDEX IF EXISTS idx_nona_signal_create_time;
DROP INDEX IF EXISTS idx_nona_signal_is_system;
DROP INDEX IF EXISTS idx_nona_signal_status;
DROP INDEX IF EXISTS idx_nona_signal_strategy_type;
DROP INDEX IF EXISTS idx_nona_signal_user_id;
DROP TABLE IF EXISTS nona_signal;
`,
  },

  // TICKET_762 Steps 5-7: Sibling child tables, read-side views, and backfill.
  //
  // Schema half (sibling tables + views) always runs and is idempotent.
  // strategy_runs_signal mirrors the v5 strategy_runs schema with FK ->
  // nona_signal(id); the parent strategy_runs table was dropped in v7
  // (TICKET_156) so this table is created for future reinstatement and to
  // honour the symmetric design (every parent in nona_signal owns its own
  // children). Live FK enforcement applies via nona_signal only.
  //
  // strategy_audit_signal mirrors the v32 strategy_audit schema with FK ->
  // nona_signal(id) ON DELETE CASCADE. This is the live half: TICKET_761
  // writes audit rows for every discovery insert.
  //
  // Read-side views: v_strategy_audit_all (UNION of strategy_audit +
  // strategy_audit_signal) and v_algorithms_all (UNION of nona_algorithms +
  // nona_signal, with deleted_at filter). Each row carries a parent_kind
  // discriminator so consumers can filter when they need one pool only.
  // v_strategy_runs_all is deliberately NOT created because the
  // strategy_runs parent table does not exist in the live schema; consumers
  // that need run history should read strategy_runs_signal directly when
  // (and if) parent strategy_runs is reinstated.
  //
  // Data half (preflight + backfill): a strict no-op on databases with zero
  // discovery rows. When discovery rows exist, preflight emits a structured
  // dry-run report (N parents, M audit rows), then the SQL body moves
  // parent rows nona_algorithms -> nona_signal preserving id, moves matching
  // strategy_audit rows to strategy_audit_signal, and DELETEs the moved
  // parent rows from nona_algorithms. The entire migration runs in a single
  // outer transaction (migrate() wraps it), so any failure rolls back.
  {
    version: 42,
    name: 'TICKET_762: Sibling tables, read-side views, and backfill discovery rows',
    preflight: (db) => {
      const discoveryCount = db.prepare(`
        SELECT COUNT(*) AS n
        FROM nona_algorithms
        WHERE record_type = 'indicator'
          AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery'
      `).get() as { n: number };
      if (discoveryCount.n === 0) {
        dbLog.info('[TICKET_762] Dry-run: no discovery rows in nona_algorithms; backfill is a no-op.');
        return;
      }
      const auditCount = db.prepare(`
        SELECT COUNT(*) AS n
        FROM strategy_audit sa
        WHERE sa.algorithm_id IN (
          SELECT id FROM nona_algorithms
          WHERE record_type = 'indicator'
            AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery'
        )
      `).get() as { n: number };
      dbLog.info(
        `[TICKET_762] Dry-run report: ${discoveryCount.n} discovery parent rows in nona_algorithms ` +
        `will move to nona_signal; ${auditCount.n} strategy_audit rows will move to strategy_audit_signal. ` +
        `Proceeding inside a single transaction; failure will roll back.`
      );
    },
    up: `
-- Sibling child tables (always created, idempotent)

CREATE TABLE IF NOT EXISTS strategy_runs_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  strategy_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  strategy_type TEXT DEFAULT 'backtest',
  entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  initial_value REAL NOT NULL,
  final_value REAL NOT NULL,
  returns REAL NOT NULL,
  profit_loss REAL NOT NULL,
  profit_loss_pct REAL NOT NULL,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  status TEXT DEFAULT 'COMPLETED',
  parameters TEXT,
  metrics TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (strategy_id) REFERENCES nona_signal(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_signal_trade_id ON strategy_runs_signal(trade_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_signal_task_id ON strategy_runs_signal(task_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_signal_strategy_id ON strategy_runs_signal(strategy_id);

CREATE TABLE IF NOT EXISTS strategy_audit_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  algorithm_id INTEGER NOT NULL,
  signal_source TEXT NOT NULL,
  regime TEXT,
  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,

  d1_completeness REAL NOT NULL,
  d2_similarity REAL NOT NULL,
  d3_indicator_fit REAL NOT NULL,
  d4_code_quality REAL NOT NULL,
  d5_robustness REAL NOT NULL,

  overall_score REAL NOT NULL,
  star_rating INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),

  audit_detail TEXT NOT NULL DEFAULT '{}',

  code_hash TEXT NOT NULL,
  ast_fingerprint TEXT NOT NULL,

  create_time TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (algorithm_id) REFERENCES nona_signal(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_algorithm_id ON strategy_audit_signal(algorithm_id);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_signal_source ON strategy_audit_signal(signal_source);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_model ON strategy_audit_signal(llm_provider, llm_model);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_code_hash ON strategy_audit_signal(code_hash);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_star ON strategy_audit_signal(star_rating);

-- Read-side views (UNION-based, parent_kind discriminator)

DROP VIEW IF EXISTS v_strategy_audit_all;
CREATE VIEW v_strategy_audit_all AS
  SELECT *, 'algorithm' AS parent_kind FROM strategy_audit
  UNION ALL
  SELECT *, 'signal'    AS parent_kind FROM strategy_audit_signal;

DROP VIEW IF EXISTS v_algorithms_all;
CREATE VIEW v_algorithms_all AS
  SELECT *, 'algorithm' AS parent_kind FROM nona_algorithms WHERE deleted_at IS NULL
  UNION ALL
  SELECT *, 'signal'    AS parent_kind FROM nona_signal      WHERE deleted_at IS NULL;

-- Backfill (no-op when zero discovery rows; otherwise moves rows atomically)

INSERT INTO nona_signal (
  id, code, file_path, strategy_name, description, strategy_type,
  classification_metadata, record_type, category, metadata, pnl, user_id,
  is_system, status, activate, create_time, update_time, sync_status,
  last_sync_time, local_only, strategy_rules, prompt_template, version,
  deleted_at, compile_status, compile_error, compile_hash,
  compile_artifact_path, compiled_at, audit_status, backend_validation_report
)
SELECT
  id, code, file_path, strategy_name, description, strategy_type,
  classification_metadata, record_type, category, metadata, pnl, user_id,
  is_system, status, activate, create_time, update_time, sync_status,
  last_sync_time, local_only, strategy_rules, prompt_template, version,
  deleted_at, compile_status, compile_error, compile_hash,
  compile_artifact_path, compiled_at, audit_status, backend_validation_report
FROM nona_algorithms
WHERE record_type = 'indicator'
  AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery';

INSERT INTO strategy_audit_signal (
  algorithm_id, signal_source, regime, llm_provider, llm_model,
  d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
  overall_score, star_rating, audit_detail, code_hash, ast_fingerprint, create_time
)
SELECT
  sa.algorithm_id, sa.signal_source, sa.regime, sa.llm_provider, sa.llm_model,
  sa.d1_completeness, sa.d2_similarity, sa.d3_indicator_fit, sa.d4_code_quality, sa.d5_robustness,
  sa.overall_score, sa.star_rating, sa.audit_detail, sa.code_hash, sa.ast_fingerprint, sa.create_time
FROM strategy_audit sa
WHERE sa.algorithm_id IN (
  SELECT id FROM nona_algorithms
  WHERE record_type = 'indicator'
    AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery'
);

DELETE FROM strategy_audit
WHERE algorithm_id IN (
  SELECT id FROM nona_algorithms
  WHERE record_type = 'indicator'
    AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery'
);

DELETE FROM nona_algorithms
WHERE record_type = 'indicator'
  AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery';
`,
    down: `
DROP VIEW IF EXISTS v_algorithms_all;
DROP VIEW IF EXISTS v_strategy_audit_all;

DROP INDEX IF EXISTS idx_strategy_audit_signal_star;
DROP INDEX IF EXISTS idx_strategy_audit_signal_code_hash;
DROP INDEX IF EXISTS idx_strategy_audit_signal_model;
DROP INDEX IF EXISTS idx_strategy_audit_signal_signal_source;
DROP INDEX IF EXISTS idx_strategy_audit_signal_algorithm_id;
DROP TABLE IF EXISTS strategy_audit_signal;

DROP INDEX IF EXISTS idx_strategy_runs_signal_strategy_id;
DROP INDEX IF EXISTS idx_strategy_runs_signal_task_id;
DROP INDEX IF EXISTS idx_strategy_runs_signal_trade_id;
DROP TABLE IF EXISTS strategy_runs_signal;
`,
  },

  // TICKET_741 / TICKET_767: persist Signal Discovery run history across restarts.
  // snapshot_json holds the TICKET_766 DiscoveryRunSnapshot (NULL for in-flight rows
  // or when serialization fails -- consumer must degrade to metadata-only).
  {
    version: 43,
    name: 'TICKET_741: desktop_discovery_run_history table',
    up: `
CREATE TABLE IF NOT EXISTS desktop_discovery_run_history (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL,
  saturation_level TEXT NOT NULL DEFAULT 'green',
  signal_count INTEGER NOT NULL DEFAULT 0,
  signal_name TEXT,
  config_signal_layer TEXT NOT NULL,
  config_categories_json TEXT,
  config_hypotheses_count INTEGER NOT NULL,
  config_batch_size INTEGER NOT NULL,
  snapshot_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discovery_run_created ON desktop_discovery_run_history(created_at DESC);
`,
    down: `
DROP INDEX IF EXISTS idx_discovery_run_created;
DROP TABLE IF EXISTS desktop_discovery_run_history;
`,
  },

  // TICKET_773: Heal databases where v43's slot was applied before commit
  // fcde48ce rewrote it to include snapshot_json. Affected DBs have v43 in
  // schema_version but the table lacks the column, so saveRunHistory fails
  // with "no column named snapshot_json". Idempotent: a no-op on DBs
  // provisioned after 2026-05-15 (column already present) or freshly
  // initialized from the current v43 definition.
  {
    version: 44,
    name: 'TICKET_773: Heal desktop_discovery_run_history.snapshot_json column',
    up: (db: MigrationDb) => {
      const cols = db
        .prepare(`PRAGMA table_info(desktop_discovery_run_history)`)
        .all() as Array<{ name: string }>;
      if (cols.some(c => c.name === 'snapshot_json')) {
        dbLog.info(
          '[Migration v44] snapshot_json column already present, no-op'
        );
        return;
      }
      dbLog.info(
        '[Migration v44] Adding missing snapshot_json column to desktop_discovery_run_history'
      );
      db.exec(
        `ALTER TABLE desktop_discovery_run_history ADD COLUMN snapshot_json TEXT`
      );
    },
    // Intentional no-op: refusing to DROP COLUMN preserves TICKET_766
    // snapshot data on healed DBs. Manual rollback is possible but never
    // automatic.
    down: `-- TICKET_773: no-op down to protect snapshot_json data on healed DBs`,
  },

  // TICKET_776: Heal databases where v42's slot was applied before commit
  // fcde48ce rewrote its `up` body to create the discovery sibling tables.
  // Affected DBs (any installed between the original v42 WIP landing on
  // 2026-05-12 and fcde48ce on 2026-05-15) have v42 stamped in
  // schema_version but lack `strategy_audit_signal`, `strategy_runs_signal`,
  // and the v_strategy_audit_all / v_algorithms_all views, which causes
  // `signal-source:list-discovered` (v3-handlers.ts:1513) to throw
  // "no such table: strategy_audit_signal" and the Alpha Factory Discovered
  // tab to fail. AuditService.insertAudit() hits the same error on every
  // Round 4 persist. v45 is schema-only and idempotent: the table/index DDL
  // is verbatim from v42, and views are recreated via DROP+CREATE.
  // Backfill is intentionally NOT re-run -- the WIP slot that stamped v42
  // on 2026-05-12 already moved nona_algorithms -> nona_signal rows, and
  // the source rows were deleted by that same migration, so re-running it
  // on a healed DB would either no-op or be incorrect.
  {
    version: 45,
    name: 'TICKET_776: Heal missing strategy_audit_signal / strategy_runs_signal tables and views',
    up: (db: MigrationDb) => {
      const hasTable = (name: string): boolean => {
        const row = db
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
          .get(name) as { name?: string } | undefined;
        return !!row?.name;
      };

      if (hasTable('strategy_audit_signal') && hasTable('strategy_runs_signal')) {
        dbLog.info('[Migration v45] sibling tables already present, schema half no-op');
      } else {
        dbLog.info(
          '[Migration v45] Healing missing sibling tables (strategy_audit_signal / strategy_runs_signal)'
        );
        db.exec(`
CREATE TABLE IF NOT EXISTS strategy_runs_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  strategy_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  strategy_type TEXT DEFAULT 'backtest',
  entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  initial_value REAL NOT NULL,
  final_value REAL NOT NULL,
  returns REAL NOT NULL,
  profit_loss REAL NOT NULL,
  profit_loss_pct REAL NOT NULL,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  status TEXT DEFAULT 'COMPLETED',
  parameters TEXT,
  metrics TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (strategy_id) REFERENCES nona_signal(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_signal_trade_id ON strategy_runs_signal(trade_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_signal_task_id ON strategy_runs_signal(task_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_signal_strategy_id ON strategy_runs_signal(strategy_id);

CREATE TABLE IF NOT EXISTS strategy_audit_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  algorithm_id INTEGER NOT NULL,
  signal_source TEXT NOT NULL,
  regime TEXT,
  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,

  d1_completeness REAL NOT NULL,
  d2_similarity REAL NOT NULL,
  d3_indicator_fit REAL NOT NULL,
  d4_code_quality REAL NOT NULL,
  d5_robustness REAL NOT NULL,

  overall_score REAL NOT NULL,
  star_rating INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),

  audit_detail TEXT NOT NULL DEFAULT '{}',

  code_hash TEXT NOT NULL,
  ast_fingerprint TEXT NOT NULL,

  create_time TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (algorithm_id) REFERENCES nona_signal(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_algorithm_id ON strategy_audit_signal(algorithm_id);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_signal_source ON strategy_audit_signal(signal_source);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_model ON strategy_audit_signal(llm_provider, llm_model);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_code_hash ON strategy_audit_signal(code_hash);
CREATE INDEX IF NOT EXISTS idx_strategy_audit_signal_star ON strategy_audit_signal(star_rating);
        `);
      }

      // Views are cheap to recreate; do it unconditionally so that DBs
      // whose v42 ran the schema half but produced a stale view definition
      // (or no view at all) end up with the same shape as a fresh DB.
      dbLog.info('[Migration v45] Recreating v_strategy_audit_all / v_algorithms_all views');
      db.exec(`
DROP VIEW IF EXISTS v_strategy_audit_all;
CREATE VIEW v_strategy_audit_all AS
  SELECT *, 'algorithm' AS parent_kind FROM strategy_audit
  UNION ALL
  SELECT *, 'signal'    AS parent_kind FROM strategy_audit_signal;

DROP VIEW IF EXISTS v_algorithms_all;
CREATE VIEW v_algorithms_all AS
  SELECT *, 'algorithm' AS parent_kind FROM nona_algorithms WHERE deleted_at IS NULL
  UNION ALL
  SELECT *, 'signal'    AS parent_kind FROM nona_signal      WHERE deleted_at IS NULL;
      `);
    },
    // No-op down: refusing to DROP the healed tables protects any audit
    // rows written after the heal. Matches TICKET_773's protective stance.
    down: `-- TICKET_776: no-op down to protect audit data on healed DBs`,
  },

  // TICKET_783_3: cached_stats_json column on nona_signal.
  //
  // Carries the Bayesian prior the Alpha Factory combinator's aggregator
  // (combine_entries, TICKET_783_1/3) needs to weight signals by historical
  // Sharpe. Populated by the Discovery Round-3 persistence path
  // (TICKET_783_3 Step C). NULL is a valid value: the aggregator treats it
  // as "no prior" and leans on the runtime rolling-PnL estimator. Shape:
  //
  //   {
  //     "schema_version": 1,
  //     "lifetime_sharpe": 1.42,
  //     "lifetime_n_trades": 87,
  //     "lifetime_n_bars": 1260,
  //     "last_updated_at": "2026-05-17T12:34:56Z",
  //     "source": "discovery_round_3"
  //   }
  //
  // workflow chips reuse the existing saved_strategy_components.parameters
  // JSON (key: cached_stats) -- no migration needed for that path; see
  // TICKET_783_3 design.
  {
    version: 46,
    name: 'TICKET_783_3: Add cached_stats_json column on nona_signal',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('nona_signal', 'cached_stats_json')) {
        dbLog.info('[Migration v46] Adding cached_stats_json column to nona_signal');
        db.exec(`ALTER TABLE nona_signal ADD COLUMN cached_stats_json TEXT DEFAULT NULL`);
      } else {
        dbLog.info('[Migration v46] cached_stats_json already present, schema half no-op');
      }
    },
    // SQLite 3.35+ supports DROP COLUMN; the repo's minimum verified at v42.
    down: `ALTER TABLE nona_signal DROP COLUMN cached_stats_json;`,
  },
  {
    version: 47,
    name: 'TICKET_196_6_1: signal_scoreboard table for Scoreboard persistence',
    up: (db: MigrationDb) => {
      const hasTable = (name: string): boolean => {
        const rows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .all(name) as Array<{ name?: string }>;
        return rows.length > 0;
      };

      if (!hasTable('signal_scoreboard')) {
        dbLog.info('[Migration v47] Creating signal_scoreboard table');
        db.exec(`
          CREATE TABLE signal_scoreboard (
            algo_id      TEXT    NOT NULL,
            computed_at  INTEGER NOT NULL,
            window_bars  INTEGER NOT NULL,
            mode         TEXT    NOT NULL,
            score        REAL,
            sharpe_long  REAL,
            sharpe_short REAL,
            hit_rate     REAL,
            trades       INTEGER,
            PRIMARY KEY (algo_id, mode, computed_at)
          );
          CREATE INDEX IF NOT EXISTS idx_scoreboard_algo_mode
            ON signal_scoreboard(algo_id, mode, computed_at DESC);
        `);
      } else {
        dbLog.info('[Migration v47] signal_scoreboard already present, no-op');
      }
    },
    down: `
      DROP INDEX IF EXISTS idx_scoreboard_algo_mode;
      DROP TABLE IF EXISTS signal_scoreboard;
    `,
  },
  // TICKET_196_6_2: PIT extension of signal_scoreboard. A single nullable
  // INTEGER column recording the unix-ms timestamp at which honest forward
  // observation began for a signal. NULL is the correct semantic for
  // backtest rows and for rows written before forward-tracking infra
  // existed -- a row cannot retroactively claim a forward-test start time.
  // Consumers (live alt-data writer in TICKET_196_7_7 and the Scoreboard
  // batch job) land in follow-up tickets; this migration adds the column
  // with zero callers at land-time, matching the v46 precedent.
  {
    version: 48,
    name: 'TICKET_196_6_2: Add forward_test_started_at column on signal_scoreboard',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('signal_scoreboard', 'forward_test_started_at')) {
        dbLog.info('[Migration v48] Adding forward_test_started_at column to signal_scoreboard');
        db.exec(`ALTER TABLE signal_scoreboard ADD COLUMN forward_test_started_at INTEGER`);
      } else {
        dbLog.info('[Migration v48] forward_test_started_at already present, no-op');
      }
    },
    down: `ALTER TABLE signal_scoreboard DROP COLUMN forward_test_started_at;`,
  },

  // TICKET_196_6_3: Heal v_algorithms_all and v_strategy_audit_all so they
  // survive future ALTER TABLE ... DROP/ADD COLUMN migrations.
  //
  // v42 (TICKET_762) and v45 (TICKET_776) defined both views with `SELECT *`
  // over a UNION ALL of two tables. At the time, the two sides had identical
  // column shapes, so the views were well-formed. v46 (TICKET_783_3) added
  // `cached_stats_json` to `nona_signal` only -- by design, the Bayesian
  // prior is signal-specific and must not exist on `nona_algorithms`. After
  // v46, the two UNION ALL sides of v_algorithms_all have different column
  // counts. SQLite tolerates this at view-creation and SELECT time (column
  // lists are re-resolved lazily), but raises
  //   "SELECTs to the left and right of UNION ALL do not have the same
  //    number of result columns"
  // whenever the schema walks every view -- which happens on any
  // `ALTER TABLE ... DROP COLUMN` or `ADD COLUMN` against any table. This
  // blocks the down path of v48 and every future column-ALTER migration.
  //
  // Fix: drop both views and recreate them with explicit intersection column
  // lists. For v_algorithms_all the intersection is the 31 columns shared by
  // `nona_algorithms` and `nona_signal` (v41 created `nona_signal` to mirror
  // `nona_algorithms` at v40; only v46 has diverged the shape since, and
  // only on `nona_signal`'s side). For v_strategy_audit_all the intersection
  // is the 17 columns shared by `strategy_audit` (v32) and
  // `strategy_audit_signal` (v42); the two tables have not diverged.
  //
  // Column lists are hardcoded, not computed at runtime, so the migration is
  // deterministic. Future shared-column ALTERs on these tables will require
  // a follow-up view-heal migration -- the column will exist on both
  // underlying tables, but consumers of the view will not see it until the
  // view is rebuilt with the extended projection.
  //
  // `cached_stats_json` (signal-only, v46) is intentionally NOT projected by
  // v_algorithms_all; callers that need it must query `nona_signal` directly.
  //
  // Forward-only: the down path is a comment-only no-op because rolling back
  // to the pre-v49 `SELECT *` definitions would re-introduce the latent bug.
  // Matches the protective-down precedent from v45 (TICKET_776).
  {
    version: 49,
    name: 'TICKET_196_6_3: Heal v_algorithms_all and v_strategy_audit_all -- explicit columns over UNION ALL',
    up: `
DROP VIEW IF EXISTS v_algorithms_all;
CREATE VIEW v_algorithms_all AS
  SELECT
    id, code, file_path, strategy_name, description, strategy_type,
    classification_metadata, record_type, category, metadata, pnl, user_id,
    is_system, status, activate, create_time, update_time, sync_status,
    last_sync_time, local_only, strategy_rules, prompt_template, version,
    deleted_at, compile_status, compile_error, compile_hash,
    compile_artifact_path, compiled_at, audit_status, backend_validation_report,
    'algorithm' AS parent_kind
  FROM nona_algorithms
  WHERE deleted_at IS NULL
  UNION ALL
  SELECT
    id, code, file_path, strategy_name, description, strategy_type,
    classification_metadata, record_type, category, metadata, pnl, user_id,
    is_system, status, activate, create_time, update_time, sync_status,
    last_sync_time, local_only, strategy_rules, prompt_template, version,
    deleted_at, compile_status, compile_error, compile_hash,
    compile_artifact_path, compiled_at, audit_status, backend_validation_report,
    'signal' AS parent_kind
  FROM nona_signal
  WHERE deleted_at IS NULL;

DROP VIEW IF EXISTS v_strategy_audit_all;
CREATE VIEW v_strategy_audit_all AS
  SELECT
    id, algorithm_id, signal_source, regime, llm_provider, llm_model,
    d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
    overall_score, star_rating, audit_detail, code_hash, ast_fingerprint, create_time,
    'algorithm' AS parent_kind
  FROM strategy_audit
  UNION ALL
  SELECT
    id, algorithm_id, signal_source, regime, llm_provider, llm_model,
    d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
    overall_score, star_rating, audit_detail, code_hash, ast_fingerprint, create_time,
    'signal' AS parent_kind
  FROM strategy_audit_signal;
`,
    down: `-- TICKET_196_6_3: no-op down -- pre-v49 view definitions (SELECT *) are the bug being healed; refusing to restore them.`,
  },

  // TICKET_568_5_1 Phase 1: widen nona_factors.source CHECK to admit
  // alternative-data categories (macro / sentiment / fund_flow / on_chain).
  // SQLite cannot ALTER a CHECK in place, so the constraint change requires a
  // full table rebuild: create _new with the widened CHECK + every column the
  // table currently has after v15-v17 (factor_type, translation_status,
  // qlib_expr, cs_pipeline), copy data column-by-column (NOT `SELECT *`, so
  // a future column add cannot silently break the rebuild), swap, recreate
  // indexes.
  //
  // Down path: rebuild with the v15 CHECK and an integrity preflight. The
  // preflight raises if any row carries one of the new four source values --
  // a silent DELETE would lose user data and a silent CHECK reject on INSERT
  // is the same surprise. Operators that want to roll back must first
  // migrate or delete the alt-source rows.
  //
  // v_algorithms_all / v_strategy_audit_all do NOT project nona_factors
  // columns (checked v49 view definitions); no view-heal needed here.
  {
    version: 50,
    name: 'TICKET_568_5_1: Widen nona_factors.source CHECK for Layer 3 alt-data categories',
    up: `
CREATE TABLE nona_factors_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factor_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'custom'
    CHECK(source IN ('library', 'alpha158', 'alpha101', 'talib', 'mined', 'custom', 'macro', 'sentiment', 'fund_flow', 'on_chain')),
  category TEXT NOT NULL,
  formula TEXT,
  code TEXT,
  params TEXT,
  ic REAL, icir REAL, rank_ic REAL,
  rank_icir REAL, sharpe REAL, max_drawdown REAL,
  symbols_validated TEXT,
  symbol_results TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'inactive', 'testing')),
  user_id TEXT,
  mining_task_id TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  sync_status TEXT DEFAULT 'local'
    CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT,
  version INTEGER DEFAULT 1,
  factor_type TEXT NOT NULL DEFAULT 'time_series' CHECK(factor_type IN ('time_series', 'cross_sectional')),
  translation_status TEXT,
  qlib_expr TEXT,
  cs_pipeline TEXT
);
INSERT INTO nona_factors_new (
  id, factor_id, name, description, source, category, formula, code, params,
  ic, icir, rank_ic, rank_icir, sharpe, max_drawdown,
  symbols_validated, symbol_results, status, user_id, mining_task_id, file_path,
  created_at, updated_at, sync_status, last_sync_time, version,
  factor_type, translation_status, qlib_expr, cs_pipeline
)
SELECT
  id, factor_id, name, description, source, category, formula, code, params,
  ic, icir, rank_ic, rank_icir, sharpe, max_drawdown,
  symbols_validated, symbol_results, status, user_id, mining_task_id, file_path,
  created_at, updated_at, sync_status, last_sync_time, version,
  factor_type, translation_status, qlib_expr, cs_pipeline
FROM nona_factors;
DROP TABLE nona_factors;
ALTER TABLE nona_factors_new RENAME TO nona_factors;
CREATE INDEX idx_nona_factors_source ON nona_factors(source);
CREATE INDEX idx_nona_factors_category ON nona_factors(category);
CREATE INDEX idx_nona_factors_user_id ON nona_factors(user_id);
CREATE INDEX idx_nona_factors_status ON nona_factors(status);
`,
    down: `
-- Refuse to roll back if any row uses one of the new alt-data source values.
-- A silent DELETE would lose data; a silent CHECK reject on rebuild would
-- abort the migration mid-flight. Fail loud with a SELECT that raises via
-- divide-by-zero when offending rows exist (SQLite has no RAISE outside of
-- triggers in plain DDL). Operators must clear or migrate the rows first.
SELECT CASE
  WHEN (SELECT COUNT(*) FROM nona_factors
        WHERE source IN ('macro', 'sentiment', 'fund_flow', 'on_chain')) > 0
  THEN 1 / 0
  ELSE 0
END;

CREATE TABLE nona_factors_old (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factor_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'custom'
    CHECK(source IN ('library', 'alpha158', 'alpha101', 'talib', 'mined', 'custom')),
  category TEXT NOT NULL,
  formula TEXT,
  code TEXT,
  params TEXT,
  ic REAL, icir REAL, rank_ic REAL,
  rank_icir REAL, sharpe REAL, max_drawdown REAL,
  symbols_validated TEXT,
  symbol_results TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'inactive', 'testing')),
  user_id TEXT,
  mining_task_id TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  sync_status TEXT DEFAULT 'local'
    CHECK(sync_status IN ('local', 'synced', 'conflict')),
  last_sync_time TEXT,
  version INTEGER DEFAULT 1,
  factor_type TEXT NOT NULL DEFAULT 'time_series' CHECK(factor_type IN ('time_series', 'cross_sectional')),
  translation_status TEXT,
  qlib_expr TEXT,
  cs_pipeline TEXT
);
INSERT INTO nona_factors_old (
  id, factor_id, name, description, source, category, formula, code, params,
  ic, icir, rank_ic, rank_icir, sharpe, max_drawdown,
  symbols_validated, symbol_results, status, user_id, mining_task_id, file_path,
  created_at, updated_at, sync_status, last_sync_time, version,
  factor_type, translation_status, qlib_expr, cs_pipeline
)
SELECT
  id, factor_id, name, description, source, category, formula, code, params,
  ic, icir, rank_ic, rank_icir, sharpe, max_drawdown,
  symbols_validated, symbol_results, status, user_id, mining_task_id, file_path,
  created_at, updated_at, sync_status, last_sync_time, version,
  factor_type, translation_status, qlib_expr, cs_pipeline
FROM nona_factors;
DROP TABLE nona_factors;
ALTER TABLE nona_factors_old RENAME TO nona_factors;
CREATE INDEX idx_nona_factors_source ON nona_factors(source);
CREATE INDEX idx_nona_factors_category ON nona_factors(category);
CREATE INDEX idx_nona_factors_user_id ON nona_factors(user_id);
CREATE INDEX idx_nona_factors_status ON nona_factors(status);
`,
  },

  // TICKET_196_7_0_2 (covered by TICKET_196_7_6_3 S6): add `artifact_path` to
  // nona_signal so v2 signal-source artifacts (HMM/n-gram/ML/factor) can be
  // located on disk for live-runtime deploy. v1 signals leave the column NULL.
  //
  // Imperative + PRAGMA-guarded (same pattern as v46 cached_stats_json) so a
  // partially-migrated dev DB is safe to re-run. v_algorithms_all (v49) does
  // NOT project this column, so no view rebuild is required.
  {
    version: 51,
    name: 'TICKET_196_7_0_2: Add artifact_path column on nona_signal',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('nona_signal', 'artifact_path')) {
        dbLog.info('[Migration v51] Adding artifact_path column to nona_signal');
        db.exec(`ALTER TABLE nona_signal ADD COLUMN artifact_path TEXT DEFAULT NULL`);
      } else {
        dbLog.info('[Migration v51] artifact_path already present, schema half no-op');
      }
    },
    // SQLite 3.35+ supports DROP COLUMN; minimum verified at v42 / v46.
    down: `ALTER TABLE nona_signal DROP COLUMN artifact_path;`,
  },

  // TICKET_196_7_7 P4.1: alt_data_history -- row-per-(provider, series,
  // event_time, knowledge_time) persistence for alt-data time-series rows
  // emitted by IAlternativeDataProvider.startLiveStream().
  //
  // Why this table is necessary:
  //   The live alt-data flow (TICKET_196_7_7 P2.2, in the StratCraft-ccxt
  //   plugin host) pipes AlternativeFactorRow values straight into the C++
  //   live engine's stdin and discards them after delivery. The desktop main
  //   process has no record of what FRED / Marketaux / COT / Binance Funding
  //   actually published over the live observation window. The Scoreboard
  //   live-IC writer (this ticket, P4.1) needs that record to replay the
  //   reducer over the same data window and compute the live IC vs a
  //   reference asset's forward returns. Without persistence we can only
  //   trust the plugin's emitted score, which we have no audit trail for.
  //
  // Schema decisions:
  //   * Primary key (provider_id, series_id, event_time, knowledge_time,
  //     vintage_id). vintage_id is `NOT NULL DEFAULT ''` because SQLite
  //     does not allow expressions like COALESCE() inside PRIMARY KEY
  //     column lists, and SQLite UNIQUE/PK semantics treat NULL as
  //     distinct -- a nullable vintage column would let row duplicates
  //     leak in for providers without ALFRED-style archives. The
  //     empty-string sentinel collapses "no vintage" into a single
  //     identity. ALFRED rows carry a real vintage_id (e.g. '2026-05-13'),
  //     so the same (event_time, knowledge_time) pair may legitimately
  //     repeat across vintages -- each is then a distinct fact.
  //   * symbol is TEXT NULL because most macro series are market-wide
  //     (matches AlternativeFactorRow.symbol?). category preserved so the
  //     v_alt_data_recent read-side does not need to JOIN nona_factors.
  //   * value is REAL -- AlternativeFactorRow.value is JS number; sentiment
  //     scores arrive as floats from Marketaux, macro values as floats from
  //     FRED. No price discipline applies here; alt-data values are not
  //     prices.
  //   * captured_at is unix-ms wall clock at INSERT time, distinct from
  //     knowledge_time (provider-reported moment the value became knowable).
  //     captured_at exists for audit (e.g., detecting clock drift between
  //     provider and host) and never participates in scoring math.
  //
  // Forward-only: down DROPs the table. Re-applying loses historical
  // observations -- by design, this is data we never had before.
  {
    version: 52,
    name: 'TICKET_196_7_7: alt_data_history persistence for live IC replay',
    up: (db: MigrationDb) => {
      const hasTable = (name: string): boolean => {
        const rows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .all(name) as Array<{ name?: string }>;
        return rows.length > 0;
      };

      if (!hasTable('alt_data_history')) {
        dbLog.info('[Migration v52] Creating alt_data_history table');
        db.exec(`
          CREATE TABLE alt_data_history (
            provider_id    TEXT    NOT NULL,
            series_id      TEXT    NOT NULL,
            category       TEXT    NOT NULL,
            symbol         TEXT,
            event_time     TEXT    NOT NULL,
            knowledge_time TEXT    NOT NULL,
            value          REAL    NOT NULL,
            vintage_id     TEXT    NOT NULL DEFAULT '',
            captured_at    INTEGER NOT NULL,
            PRIMARY KEY (provider_id, series_id, event_time, knowledge_time, vintage_id)
          );
          CREATE INDEX IF NOT EXISTS idx_alt_data_history_lookup
            ON alt_data_history(provider_id, series_id, knowledge_time);
        `);
      } else {
        dbLog.info('[Migration v52] alt_data_history already present, no-op');
      }
    },
    down: `
      DROP INDEX IF EXISTS idx_alt_data_history_lookup;
      DROP TABLE IF EXISTS alt_data_history;
    `,
  },

  // TICKET_196_7_5_2_1 P6: Tag signal_scoreboard rows with the universe they
  // were trained on, plus the per-symbol breakdown that produced the
  // trade-weighted aggregate.
  //
  // Plan filename refers to "migration v51" / "v52" -- those slots were taken
  // by TICKET_196_7_0_2 (v51) and TICKET_196_7_7 (v52) before this phase
  // landed, so the same schema change goes in at the next free version.
  //
  // Columns:
  //   * universe_id  -- nullable TEXT. Pre-universe rows leave this NULL;
  //     the read path surfaces NULL untouched (semantically "legacy /
  //     single-asset sweep written before universe mode existed"). Universe
  //     mode populates it with the curated D8 universe ID (e.g.
  //     'sp500_top50') or 'custom:<hash>' for user-defined lists.
  //   * symbol_breakdown -- nullable TEXT holding the JSON array of
  //     { symbol, score, sharpe_long, trades } per-symbol contributions
  //     that fed the universe-aggregated scalar metrics already stored on
  //     the row. Stored as JSON-in-TEXT (not normalized into a child
  //     table) because: (a) it is always written and read together with
  //     the parent row; (b) row counts are bounded by D2 (universe size
  //     cap N<=50); (c) the read path does not need to JOIN or aggregate
  //     across breakdown rows. Pre-universe rows leave this NULL; the
  //     read path returns [] for callers convenience.
  //
  // Index:
  //   idx_scoreboard_universe on (universe_id) for the Scoreboard UI's
  //   "filter by universe" use case. Composite with mode is overkill at
  //   v1 -- the cardinality of (universe_id, mode) pairs is bounded by
  //   |curated universes| * 2 (tool_sweep_hmm + tool_sweep_ngram).
  //
  // PRAGMA-guarded idempotent up (same pattern as v48 forward_test_started_at).
  // Down drops columns + index. SQLite 3.35+ supports DROP COLUMN; verified
  // since v42.
  {
    version: 53,
    name: 'TICKET_196_7_5_2_1: Add universe_id + symbol_breakdown columns on signal_scoreboard',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };
      const hasIndex = (name: string): boolean => {
        const rows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
          .all(name) as Array<{ name?: string }>;
        return rows.length > 0;
      };

      if (!hasColumn('signal_scoreboard', 'universe_id')) {
        dbLog.info('[Migration v53] Adding universe_id column to signal_scoreboard');
        db.exec(`ALTER TABLE signal_scoreboard ADD COLUMN universe_id TEXT`);
      } else {
        dbLog.info('[Migration v53] universe_id already present, schema half no-op');
      }

      if (!hasColumn('signal_scoreboard', 'symbol_breakdown')) {
        dbLog.info('[Migration v53] Adding symbol_breakdown column to signal_scoreboard');
        db.exec(`ALTER TABLE signal_scoreboard ADD COLUMN symbol_breakdown TEXT`);
      } else {
        dbLog.info('[Migration v53] symbol_breakdown already present, schema half no-op');
      }

      if (!hasIndex('idx_scoreboard_universe')) {
        dbLog.info('[Migration v53] Creating idx_scoreboard_universe index');
        db.exec(`CREATE INDEX idx_scoreboard_universe ON signal_scoreboard(universe_id)`);
      } else {
        dbLog.info('[Migration v53] idx_scoreboard_universe already present, no-op');
      }
    },
    down: `
      DROP INDEX IF EXISTS idx_scoreboard_universe;
      ALTER TABLE signal_scoreboard DROP COLUMN symbol_breakdown;
      ALTER TABLE signal_scoreboard DROP COLUMN universe_id;
    `,
  },

  // ============================================================
  // TICKET_804: Signal lineage skeleton -- introduce nona_signal_definition
  // (the recipe: template + params + universe + provider) and signal_run
  // (one row per execution). Lineage starts at v54 by design: pre-v54
  // nona_signal rows are NOT backfilled (see ticket section 3.2 -- the
  // legacy metadata JSON lacks the structured recipe fields).
  // ============================================================
  {
    version: 54,
    name: 'TICKET_804: signal lineage skeleton (nona_signal_definition + signal_run); lineage starts at v54, pre-v54 nona_signal rows not migrated by design (see ticket section 3.2)',
    up: `
      CREATE TABLE IF NOT EXISTS nona_signal_definition (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id            TEXT NOT NULL,
        template_id        TEXT NOT NULL,
        params_canonical   TEXT NOT NULL,
        universe_id        TEXT,
        normalization      TEXT,
        provider           TEXT,
        observable         TEXT,
        training_window    TEXT,
        fingerprint        TEXT NOT NULL,
        code_version       TEXT NOT NULL DEFAULT 'v0',
        signal_source      TEXT NOT NULL,
        category           TEXT,
        display_name       TEXT,
        created_at         INTEGER NOT NULL,
        deleted_at         INTEGER DEFAULT NULL,
        UNIQUE (user_id, fingerprint, code_version)
      );

      CREATE INDEX IF NOT EXISTS idx_signal_definition_user        ON nona_signal_definition(user_id);
      CREATE INDEX IF NOT EXISTS idx_signal_definition_template    ON nona_signal_definition(template_id);
      CREATE INDEX IF NOT EXISTS idx_signal_definition_universe    ON nona_signal_definition(universe_id);
      CREATE INDEX IF NOT EXISTS idx_signal_definition_fingerprint ON nona_signal_definition(fingerprint);

      CREATE TABLE IF NOT EXISTS signal_run (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        definition_id         INTEGER NOT NULL REFERENCES nona_signal_definition(id) ON DELETE CASCADE,
        user_id               TEXT NOT NULL,
        run_seq               INTEGER NOT NULL,
        data_snapshot_id      TEXT NOT NULL,
        data_window_start     INTEGER,
        data_window_end       INTEGER,
        bars_manifest_path    TEXT,
        signal_code           TEXT,
        artifact_path         TEXT,
        score                 REAL,
        metrics_json          TEXT,
        session_id            TEXT,
        status                TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','failed','superseded')),
        error_message         TEXT,
        cached_from_run_id    INTEGER REFERENCES signal_run(id) ON DELETE SET NULL,
        cost_saved_seconds    REAL,
        replication_index     INTEGER NOT NULL DEFAULT 0,
        replication_count     INTEGER NOT NULL DEFAULT 1,
        replication_group_id  TEXT,
        created_at            INTEGER NOT NULL,
        deleted_at            INTEGER DEFAULT NULL,
        UNIQUE (definition_id, run_seq)
      );

      CREATE INDEX IF NOT EXISTS idx_signal_run_definition          ON signal_run(definition_id, run_seq DESC);
      CREATE INDEX IF NOT EXISTS idx_signal_run_user                ON signal_run(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_signal_run_snapshot            ON signal_run(data_snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_signal_run_replication_group   ON signal_run(replication_group_id);
      CREATE INDEX IF NOT EXISTS idx_signal_run_definition_snapshot ON signal_run(definition_id, data_snapshot_id, replication_index);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_run_definition_snapshot;
      DROP INDEX IF EXISTS idx_signal_run_replication_group;
      DROP INDEX IF EXISTS idx_signal_run_snapshot;
      DROP INDEX IF EXISTS idx_signal_run_user;
      DROP INDEX IF EXISTS idx_signal_run_definition;
      DROP TABLE IF EXISTS signal_run;

      DROP INDEX IF EXISTS idx_signal_definition_fingerprint;
      DROP INDEX IF EXISTS idx_signal_definition_universe;
      DROP INDEX IF EXISTS idx_signal_definition_template;
      DROP INDEX IF EXISTS idx_signal_definition_user;
      DROP TABLE IF EXISTS nona_signal_definition;
    `,
  },

  // ============================================================
  // TICKET_804_1: Structured IS/OOS / embargo / walk-forward
  // columns on signal_run (S1, migration v55).
  // ============================================================
  {
    version: 55,
    name: 'TICKET_804_1: structured IS/OOS + walk-forward + data_snapshot_json on signal_run; defaults (walk_forward_folds=5, embargo_bars=5) match policy from ticket section 3.3',
    up: `
      ALTER TABLE signal_run ADD COLUMN is_window_start    INTEGER;
      ALTER TABLE signal_run ADD COLUMN is_window_end      INTEGER;
      ALTER TABLE signal_run ADD COLUMN oos_window_start   INTEGER;
      ALTER TABLE signal_run ADD COLUMN oos_window_end     INTEGER;
      ALTER TABLE signal_run ADD COLUMN embargo_bars       INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE signal_run ADD COLUMN walk_forward_folds INTEGER NOT NULL DEFAULT 5;
      ALTER TABLE signal_run ADD COLUMN wf_fold_index      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE signal_run ADD COLUMN data_snapshot_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE signal_run ADD COLUMN research_mode      TEXT NOT NULL DEFAULT 'walk_forward_purged'
        CHECK(research_mode IN ('walk_forward_purged','single_split','curve_fit','legacy_unspecified'));

      CREATE INDEX IF NOT EXISTS idx_signal_run_oos_window ON signal_run(oos_window_start, oos_window_end);
      CREATE INDEX IF NOT EXISTS idx_signal_run_wf_fold    ON signal_run(definition_id, wf_fold_index);

      -- Backfill legacy rows: IS window equals the flat data_window, no OOS,
      -- research_mode='legacy_unspecified', WF=1. See ticket section 3.4.
      UPDATE signal_run
         SET is_window_start    = data_window_start,
             is_window_end      = data_window_end,
             walk_forward_folds = 1,
             research_mode      = 'legacy_unspecified'
       WHERE data_snapshot_json = '{}'
         AND is_window_start IS NULL;
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_run_wf_fold;
      DROP INDEX IF EXISTS idx_signal_run_oos_window;
      -- SQLite ALTER TABLE DROP COLUMN supported >= 3.35; assume modern SQLite.
      ALTER TABLE signal_run DROP COLUMN research_mode;
      ALTER TABLE signal_run DROP COLUMN data_snapshot_json;
      ALTER TABLE signal_run DROP COLUMN wf_fold_index;
      ALTER TABLE signal_run DROP COLUMN walk_forward_folds;
      ALTER TABLE signal_run DROP COLUMN embargo_bars;
      ALTER TABLE signal_run DROP COLUMN oos_window_end;
      ALTER TABLE signal_run DROP COLUMN oos_window_start;
      ALTER TABLE signal_run DROP COLUMN is_window_end;
      ALTER TABLE signal_run DROP COLUMN is_window_start;
    `,
  },

  // ============================================================
  // TICKET_804_2: Structured OOS statistics columns on signal_run
  // (S1, migration v56). Per-row stats + group-aggregate rollup
  // columns + statistical_verdict + supporting indexes.
  // ============================================================
  {
    version: 56,
    name: 'TICKET_804_2: structured OOS statistics on signal_run (per-row + denormalised group-aggregate columns + verdict + indexes); legacy rows stay NULL / insufficient_data',
    up: `
      -- Per-(fold, replication) row statistics:
      ALTER TABLE signal_run ADD COLUMN is_sharpe             REAL;
      ALTER TABLE signal_run ADD COLUMN oos_sharpe            REAL;
      ALTER TABLE signal_run ADD COLUMN is_hit_rate           REAL;
      ALTER TABLE signal_run ADD COLUMN oos_hit_rate          REAL;
      ALTER TABLE signal_run ADD COLUMN is_trades             INTEGER;
      ALTER TABLE signal_run ADD COLUMN oos_trades            INTEGER;
      ALTER TABLE signal_run ADD COLUMN t_statistic           REAL;
      ALTER TABLE signal_run ADD COLUMN p_value               REAL;
      ALTER TABLE signal_run ADD COLUMN p_value_bh_adjusted   REAL;
      ALTER TABLE signal_run ADD COLUMN effect_size           REAL;
      ALTER TABLE signal_run ADD COLUMN deflated_sharpe_ratio REAL;

      -- Group-aggregate over (definition_id, replication_group_id):
      ALTER TABLE signal_run ADD COLUMN oos_sharpe_mean   REAL;
      ALTER TABLE signal_run ADD COLUMN oos_sharpe_stddev REAL;
      ALTER TABLE signal_run ADD COLUMN oos_sharpe_min    REAL;
      ALTER TABLE signal_run ADD COLUMN group_member_count INTEGER;

      ALTER TABLE signal_run ADD COLUMN statistical_verdict TEXT
        CHECK(statistical_verdict IN ('significant','marginal','not_significant','insufficient_data'));

      CREATE INDEX IF NOT EXISTS idx_signal_run_oos_sharpe      ON signal_run(oos_sharpe DESC);
      CREATE INDEX IF NOT EXISTS idx_signal_run_oos_sharpe_mean ON signal_run(oos_sharpe_mean DESC);
      CREATE INDEX IF NOT EXISTS idx_signal_run_bh_pvalue       ON signal_run(p_value_bh_adjusted ASC)
        WHERE statistical_verdict = 'significant';
      CREATE INDEX IF NOT EXISTS idx_signal_run_verdict         ON signal_run(statistical_verdict);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_run_verdict;
      DROP INDEX IF EXISTS idx_signal_run_bh_pvalue;
      DROP INDEX IF EXISTS idx_signal_run_oos_sharpe_mean;
      DROP INDEX IF EXISTS idx_signal_run_oos_sharpe;
      ALTER TABLE signal_run DROP COLUMN statistical_verdict;
      ALTER TABLE signal_run DROP COLUMN group_member_count;
      ALTER TABLE signal_run DROP COLUMN oos_sharpe_min;
      ALTER TABLE signal_run DROP COLUMN oos_sharpe_stddev;
      ALTER TABLE signal_run DROP COLUMN oos_sharpe_mean;
      ALTER TABLE signal_run DROP COLUMN deflated_sharpe_ratio;
      ALTER TABLE signal_run DROP COLUMN effect_size;
      ALTER TABLE signal_run DROP COLUMN p_value_bh_adjusted;
      ALTER TABLE signal_run DROP COLUMN p_value;
      ALTER TABLE signal_run DROP COLUMN t_statistic;
      ALTER TABLE signal_run DROP COLUMN oos_trades;
      ALTER TABLE signal_run DROP COLUMN is_trades;
      ALTER TABLE signal_run DROP COLUMN oos_hit_rate;
      ALTER TABLE signal_run DROP COLUMN is_hit_rate;
      ALTER TABLE signal_run DROP COLUMN oos_sharpe;
      ALTER TABLE signal_run DROP COLUMN is_sharpe;
    `,
  },

  // ============================================================
  // TICKET_804_3: signal_definition_rollup VIEW (S1, v57).
  // stddev / latest_oos_sharpe / historical_median are computed in
  // the Node read path (ticket Q4): SQLite forbids outer references
  // in correlated LIMIT/OFFSET, and pushing median into Node also
  // keeps the threshold logic centralised in shared/constants.
  // ============================================================
  {
    version: 57,
    name: 'TICKET_804_3: signal_definition_rollup VIEW -- per-definition aggregates over signal_run (run_count, significant_runs, mean/min/max oos_sharpe, first/last_run_at). stddev / latest_oos_sharpe / historical_median computed in the Node read path (ticket Q4): SQLite forbids outer references in correlated LIMIT/OFFSET, and pushing median into Node also keeps the threshold logic out of the schema.',
    up: `
      DROP VIEW IF EXISTS signal_definition_rollup;
      CREATE VIEW signal_definition_rollup AS
      SELECT
        d.id                                AS definition_id,
        d.user_id                           AS user_id,
        d.template_id                       AS template_id,
        d.universe_id                       AS universe_id,
        d.fingerprint                       AS fingerprint,
        d.display_name                      AS display_name,
        COUNT(r.id)                         AS run_count,
        SUM(CASE WHEN r.statistical_verdict = 'significant' THEN 1 ELSE 0 END) AS significant_runs,
        AVG(r.oos_sharpe)                   AS mean_oos_sharpe,
        MIN(r.oos_sharpe)                   AS min_oos_sharpe,
        MAX(r.oos_sharpe)                   AS max_oos_sharpe,
        MIN(r.created_at)                   AS first_run_at,
        MAX(r.created_at)                   AS last_run_at
      FROM nona_signal_definition d
      LEFT JOIN signal_run r
        ON r.definition_id = d.id
       AND r.status = 'ok'
       AND r.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
      GROUP BY d.id;
    `,
    down: `
      DROP VIEW IF EXISTS signal_definition_rollup;
    `,
  },

  // ============================================================
  // TICKET_804_3: family-level BH columns on signal_run (S2, v58).
  // Populated by recomputeFamilyBH service (S4, not in this MR).
  // ============================================================
  {
    version: 58,
    name: 'TICKET_804_3: family-level BH columns on signal_run (p_value_bh_family_adjusted, statistical_verdict_family); populated by recomputeFamilyBH service in a follow-up step',
    up: `
      ALTER TABLE signal_run ADD COLUMN p_value_bh_family_adjusted REAL;
      ALTER TABLE signal_run ADD COLUMN statistical_verdict_family TEXT
        CHECK(statistical_verdict_family IN ('significant','marginal','not_significant','insufficient_data'));
    `,
    down: `
      ALTER TABLE signal_run DROP COLUMN statistical_verdict_family;
      ALTER TABLE signal_run DROP COLUMN p_value_bh_family_adjusted;
    `,
  },
  {
    version: 59,
    name: 'TICKET_805_2: plugin_telemetry_state for promo first_run + converted persistence (once-only emit timestamps; UNIX epoch millis to match repo convention)',
    up: `
      CREATE TABLE IF NOT EXISTS plugin_telemetry_state (
        plugin_id TEXT PRIMARY KEY,
        first_run_emitted_at INTEGER,
        install_with_promo_at INTEGER
      );
    `,
    down: `
      DROP TABLE IF EXISTS plugin_telemetry_state;
    `,
  },
  {
    version: 60,
    name: 'TICKET_815: signal_run.code_version for cache-key code-aware invalidation; nullable for legacy rows (NULL never matches a non-null lookup so legacy rows safely fall out of cache after migration)',
    up: `
      ALTER TABLE signal_run ADD COLUMN code_version TEXT;

      -- Extend the cache-lookup index to include code_version. The old
      -- idx_signal_run_definition_snapshot covers (definition_id,
      -- data_snapshot_id, replication_index); the cache hit query now
      -- adds AND code_version = ? to the WHERE clause, so the new
      -- index covers the full predicate and stays index-resident.
      CREATE INDEX IF NOT EXISTS idx_signal_run_cache_lookup
        ON signal_run(definition_id, data_snapshot_id, replication_index, code_version);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_run_cache_lookup;
      -- SQLite cannot drop a column without table rebuild; intentional
      -- no-op on the column itself. A full revert path would require
      -- recreating signal_run without code_version, which is out of
      -- scope for the down migration contract (data preservation wins).
    `,
  },
  // ---------------------------------------------------------------------
  // v61 is reserved for TICKET_824 (canonical_status column) -- intentionally
  // skipped here so TICKET_824 can land independently without renumbering.
  // ---------------------------------------------------------------------
  {
    version: 62,
    name: 'TICKET_827: signal_canonical_score table for per-bar canonical score persistence (Medallion Step 1.5 -- immutable scores keyed by (signal_id, ts); INSERT OR IGNORE semantics enforced at the write path layer)',
    up: `
      CREATE TABLE IF NOT EXISTS signal_canonical_score (
        signal_id   INTEGER NOT NULL,
        ts          INTEGER NOT NULL,
        score       REAL NOT NULL,
        confidence  REAL NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (signal_id, ts),
        FOREIGN KEY (signal_id) REFERENCES nona_signal(id) ON DELETE CASCADE
      );

      -- Hot read path: orchestrator coverage check is
      --   SELECT MIN(ts), MAX(ts), COUNT(*) FROM signal_canonical_score
      --   WHERE signal_id = ?
      -- DESC index serves both the coverage query (MAX scan stops at first
      -- row) and the time-range read (signalId, range.start, range.end).
      CREATE INDEX IF NOT EXISTS idx_canonical_score_signal_ts
        ON signal_canonical_score(signal_id, ts DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_canonical_score_signal_ts;
      DROP TABLE IF EXISTS signal_canonical_score;
    `,
  },
  {
    version: 63,
    name: 'TICKET_823: behavioral_fingerprint + soft-dedup columns on nona_signal (Medallion Step 2 -- identity follows behavior; duplicate_kind tags configurational / behavioral collisions for the combinator instead of hard-blocking insertion)',
    up: `
      ALTER TABLE nona_signal ADD COLUMN behavioral_fingerprint TEXT;
      ALTER TABLE nona_signal ADD COLUMN duplicate_kind TEXT;
      ALTER TABLE nona_signal ADD COLUMN duplicate_of TEXT;
      ALTER TABLE nona_signal ADD COLUMN duplicate_rho REAL;

      -- Behavioral lookup: classifyDuplicate() scans by behavioral_fingerprint
      -- first to short-circuit on exact behavioral matches before falling to
      -- the rho-pairwise pass.
      CREATE INDEX IF NOT EXISTS idx_nona_signal_behavioral_fp
        ON nona_signal(behavioral_fingerprint);

      -- Sibling traversal: combinator (TICKET_825) walks duplicate_of to
      -- group rho >= 0.95 clusters; index keeps that traversal O(log N).
      CREATE INDEX IF NOT EXISTS idx_nona_signal_duplicate_of
        ON nona_signal(duplicate_of);
    `,
    down: `
      DROP INDEX IF EXISTS idx_nona_signal_duplicate_of;
      DROP INDEX IF EXISTS idx_nona_signal_behavioral_fp;
      -- SQLite cannot drop columns without rebuild; intentional no-op on
      -- the columns themselves (data preservation wins over revert symmetry,
      -- matching the v60 down-migration convention).
    `,
  },

  // ============================================================
  // TICKET_843 Phase 3: decompose group_member_count into explicit
  // (fold_count, rep_count) so the renderer's "{{folds}} x {{reps}}"
  // column carries actual fold/rep cardinality instead of a collapsed
  // product. Backfill preserves history-sidebar replay continuity for
  // legacy reps=1 dispatches by setting fold_count = group_member_count,
  // rep_count = 1.
  // ============================================================
  {
    version: 64,
    name: 'TICKET_843 Phase 3: fold_count + rep_count columns on signal_run (rollup-writer populated, additive to group_member_count which stays the source-of-truth row count); backfill fold_count = group_member_count, rep_count = 1 so pre-migration rows replay identically in the Tool Sweep history sidebar',
    up: `
      ALTER TABLE signal_run ADD COLUMN fold_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE signal_run ADD COLUMN rep_count  INTEGER NOT NULL DEFAULT 1;

      -- Backfill: legacy rows had reps=1 hardcoded in dispatch, so the old
      -- group_member_count == fold_count for every multi-fold arm. Preserve
      -- that for history-sidebar replay; rep_count stays at the column
      -- default of 1.
      UPDATE signal_run
         SET fold_count = COALESCE(group_member_count, 1)
       WHERE group_member_count IS NOT NULL;
    `,
    down: `
      ALTER TABLE signal_run DROP COLUMN rep_count;
      ALTER TABLE signal_run DROP COLUMN fold_count;
    `,
  },

  // ============================================================
  // TICKET_844 Phase C: signal_training_coverage table. Records which
  // bars a given (signal_id, bar_interval) has actually been fit on by a
  // prior signal_run. The walker (Phase D) subtracts these ranges from
  // each candidate training window to enforce TICKET_827 Strategy A
  // ("never refit a bar already trained"). Schema decisions are locked
  // by TICKET_844 Phase B signoff:
  //   - signal_id INTEGER (matches signal_canonical_score.signal_id /
  //     nona_signal.id, NOT the TEXT id used by signal_run).
  //   - run_id TEXT, no FK (signal_run is dispatch-scoped and may be
  //     purged for ops reasons; coverage outlives it. Audit-only column).
  //   - bar_interval TEXT required (TICKET_842 identity dimension; same
  //     bar grid as the snapshot id hash).
  //   - PK (signal_id, bar_interval, bar_start_ts) -- the walker's hot
  //     range query is "what bars under signal_id+interval overlap
  //     [candidate.start, candidate.end]?", and the PK order makes that
  //     a pure range scan with no secondary index required.
  //   - No `contiguous` flag column. Contiguity is derivable from the
  //     segment-row layout (1 row = contiguous; >1 = TC2 split case).
  // ============================================================
  {
    version: 65,
    name: 'TICKET_844 Phase C: signal_training_coverage table (records realized trained bar ranges per (signal_id, bar_interval) so the walker can subtract overlap and refuse to refit already-trained bars; PK (signal_id, bar_interval, bar_start_ts) serves the walker range query directly, idx_training_coverage_run keeps audit "which run trained this segment?" cheap)',
    up: `
      CREATE TABLE IF NOT EXISTS signal_training_coverage (
        signal_id     INTEGER NOT NULL,
        run_id        TEXT NOT NULL,
        bar_interval  TEXT NOT NULL,
        bar_start_ts  INTEGER NOT NULL,
        bar_end_ts    INTEGER NOT NULL,
        bar_count     INTEGER NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (signal_id, bar_interval, bar_start_ts),
        FOREIGN KEY (signal_id) REFERENCES nona_signal(id) ON DELETE CASCADE
      );

      -- Audit-only access pattern ("which dispatch trained this segment?").
      -- Walker's primary read path is the PK range scan; this index serves
      -- the rare lineage query that filters by run_id instead.
      CREATE INDEX IF NOT EXISTS idx_training_coverage_run
        ON signal_training_coverage(run_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_training_coverage_run;
      DROP TABLE IF EXISTS signal_training_coverage;
    `,
  },

  // ============================================================
  // TICKET_862_1: verdict_diagnostics_json column on signal_run.
  //
  // Persists the four GROUP-LEVEL gate inputs (group_bh_p,
  // max_abs_effect_size, sum_oos_trades, cv) that group-rollup.ts:418-443
  // uses to assign statistical_verdict but otherwise discards. Without
  // this column the renderer cannot show the per-gate dossier popover
  // (the bleeding-stop for TICKET_862's "why is everything not_significant"
  // UX complaint) because the values cannot be recomputed from per-row
  // signal_run columns alone -- groupBhP is a median, sum_oos_trades is
  // a sum, etc. Per the ticket's Option A: nullable TEXT column carrying
  // a schema-versioned JSON envelope so future fields (TICKET_863 funnel
  // metrics) can extend without DDL churn. Same JSON blob written to
  // every member row of the same group, mirroring how
  // statistical_verdict is duplicated across members today (see
  // group-rollup.ts:489-501). Pre-migration historic rows stay NULL --
  // the renderer falls back to "diagnostics not recorded for this run"
  // (criterion 16) rather than backfilling, since recomputing in a
  // migration introduces drift risk if group-rollup.ts ever changes
  // shape.
  // ============================================================
  {
    version: 66,
    name: 'TICKET_862_1: verdict_diagnostics_json TEXT column on signal_run (schema-versioned JSON envelope persisting the four group-derived gate inputs -- group_bh_p, max_abs_effect_size, sum_oos_trades, cv -- so the renderer can show the per-gate dossier popover without recomputing medians/sums client-side; nullable so pre-migration historic rows stay readable)',
    up: `
      ALTER TABLE signal_run ADD COLUMN verdict_diagnostics_json TEXT;
    `,
    down: `
      ALTER TABLE signal_run DROP COLUMN verdict_diagnostics_json;
    `,
  },

  // ============================================================
  // TICKET_862_2: sweep_mode column on signal_run.
  //
  // Records whether the dispatching session was a `preview` sweep
  // (today's defaults -- 5 folds x 1 rep x 5 bars, statistically
  // underpowered, verdict chip rendered as diagnostic-only) or a
  // `confirmatory` sweep (real experiment intended to clear the
  // marginal / significant gates). The mode is conceptually a
  // SESSION-LEVEL setting -- every signal_run row sharing a
  // session_id MUST carry the same sweep_mode value. We denormalise
  // it onto signal_run because there is no dedicated session
  // metadata table today; TICKET_840 already centralises
  // session_id semantics and is the natural future home for this
  // column. When that table is introduced, sweep_mode moves there
  // and this column becomes either a cache or is dropped. The
  // writer-side invariant is enforced at the dispatch orchestrator
  // (createSweepSession), and a unit test asserts
  // `SELECT DISTINCT sweep_mode FROM signal_run WHERE session_id = ?`
  // returns exactly one row -- any future change that breaks that
  // assertion is the signal that the column has to be lifted out
  // of signal_run.
  //
  // Pre-migration historic rows stay NULL; the renderer treats
  // NULL as "legacy preview" (the default before TICKET_862_2),
  // matching the dispatch-side default for new sessions that
  // omit the mode.
  // ============================================================
  {
    version: 67,
    name: 'TICKET_862_2: sweep_mode TEXT column on signal_run (denormalised session-level Preview vs Confirmatory mode; same value across all rows of one session_id; nullable for pre-migration rows -- FUTURE: move to a dedicated session metadata table when TICKET_840 grows one and drop this column)',
    up: `
      ALTER TABLE signal_run ADD COLUMN sweep_mode TEXT
        CHECK(sweep_mode IS NULL OR sweep_mode IN ('preview', 'confirmatory'));
    `,
    down: `
      ALTER TABLE signal_run DROP COLUMN sweep_mode;
    `,
  },

  // ============================================================
  // TICKET_863_0_7 (Gap #7 in TICKET_863_0 substrate audit):
  // oos_bars_per_fold INTEGER column on signal_run.
  //
  // Required by TICKET_863_1 L1 stationarity gate's min-N
  // refusal -- ADF / KPSS / Ljung-Box / VR tests are statistically
  // meaningless below the per-timeframe `min_n_bars_for_stationarity`
  // floor, and that floor compares against the per-fold OOS bar count.
  // The value is derivable from cv-sizing-contract.planPaths() but was
  // never denormalised; persisting it here means every L1 evaluation is
  // one SELECT, not a re-derivation against a possibly-stale contract.
  //
  // Nullable for pre-migration rows (legacy paths that don't carry the
  // planned-path shape); L1 treats NULL as "unknown -> insufficient_data".
  // ============================================================
  {
    version: 68,
    name: 'TICKET_863_0_7: oos_bars_per_fold INTEGER column on signal_run (per-fold OOS bar count denormalised from cv-sizing-contract.planPaths() so L1 stationarity gate can evaluate min-N refusal in O(1) instead of re-deriving from the planner)',
    up: `
      ALTER TABLE signal_run ADD COLUMN oos_bars_per_fold INTEGER;
    `,
    down: `
      ALTER TABLE signal_run DROP COLUMN oos_bars_per_fold;
    `,
  },

  // ============================================================
  // TICKET_863_1 + TICKET_863_3 substrate: signal_quality_metrics
  // + per-layer verdict columns on signal_run.
  //
  // Per TICKET_863 schema section ("Schema -- separate table, NOT
  // widening signal_run"): metric values live in a normalised
  // key-value-per-metric table so adding a new L1/L2/L3 metric is an
  // INSERT, not a migration. Only the small fixed verdict enums + the
  // terminal-layer label + the dossier-cache JSON are added to
  // signal_run so the renderer can filter / sort without a join.
  //
  // signal_quality_metrics is keyed (signal_run_id, layer, metric_name)
  // so re-running a gate is an INSERT OR REPLACE; metric_value is REAL
  // and nullable (some metrics legitimately produce NaN -> NULL, e.g.
  // KPSS on a degenerate series). FK ON DELETE CASCADE keeps lineage
  // clean when a signal_run row is purged.
  //
  // l2_verdict column is reserved here even though TICKET_863_2 has
  // not landed yet -- adding it as part of the same schema event lets
  // the L2 implementation ticket avoid a second ALTER, and rows stay
  // NULL until L2 starts writing.
  //
  // Shadow-mode contract (TICKET_863 L4 section): l1_verdict /
  // l2_verdict / l3_verdict are computed and persisted, but NEVER
  // gate the BH family scope. group-rollup.ts:248-256's
  // `status = 'ok' AND deleted_at IS NULL` predicate is unchanged --
  // funnel rejection in shadow mode means a verdict label only.
  // ============================================================
  {
    version: 69,
    name: 'TICKET_863 L1/L3 substrate: signal_quality_metrics table (per-arm normalised metric store, additive -- new metrics need an INSERT not an ALTER) + l1_verdict/l2_verdict/l3_verdict/funnel_terminal_layer/funnel_diagnostics columns on signal_run (small fixed enums + dossier-cache JSON for renderer filter/sort without a join; shadow-mode only -- BH family scope at group-rollup.ts:248-256 is unchanged)',
    up: `
      CREATE TABLE IF NOT EXISTS signal_quality_metrics (
        signal_run_id INTEGER NOT NULL,
        layer         TEXT NOT NULL CHECK(layer IN ('L1', 'L2', 'L3')),
        metric_name   TEXT NOT NULL,
        metric_value  REAL,
        computed_at   INTEGER NOT NULL,
        PRIMARY KEY (signal_run_id, layer, metric_name),
        FOREIGN KEY (signal_run_id) REFERENCES signal_run(id) ON DELETE CASCADE
      );

      -- Dossier read path: renderer loads the full L1+L2+L3 metric
      -- vector for one signal_run as a single index scan.
      CREATE INDEX IF NOT EXISTS idx_signal_quality_metrics_run_layer
        ON signal_quality_metrics(signal_run_id, layer);

      ALTER TABLE signal_run ADD COLUMN l1_verdict TEXT
        CHECK(l1_verdict IS NULL OR l1_verdict IN ('pass', 'flag', 'reject', 'insufficient_data'));
      ALTER TABLE signal_run ADD COLUMN l2_verdict TEXT
        CHECK(l2_verdict IS NULL OR l2_verdict IN ('pass', 'flag', 'reject', 'insufficient_data'));
      ALTER TABLE signal_run ADD COLUMN l3_verdict TEXT
        CHECK(l3_verdict IS NULL OR l3_verdict IN ('pass', 'flag', 'reject', 'insufficient_data'));
      ALTER TABLE signal_run ADD COLUMN funnel_terminal_layer TEXT
        CHECK(funnel_terminal_layer IS NULL OR funnel_terminal_layer IN ('L1', 'L2', 'L3', 'L4_BH', 'passed'));
      ALTER TABLE signal_run ADD COLUMN funnel_diagnostics TEXT;
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_quality_metrics_run_layer;
      DROP TABLE IF EXISTS signal_quality_metrics;
      -- SQLite cannot drop columns without rebuild; intentional no-op on
      -- the signal_run columns (matches v60/v63 down-migration convention --
      -- data preservation wins over revert symmetry).
    `,
  },

  // ============================================================
  // TICKET_863_9_A: signal_quality_audit -- stat-axis audit table.
  //
  // Mirror of strategy_audit_signal (v34, see line 1542) but on the
  // STATISTICAL axis. The two tables are joined by algorithm_id at
  // read time (TICKET_863_9_B); they are never merged into a single
  // composite score -- code-axis (star rating) and stat-axis (tier)
  // remain independent so a reader can always tell which axis is
  // saying what.
  //
  // INSERT-only by contract (no UPDATE, no DELETE except FK cascade):
  // reruns, schema_version bumps, and tier-rule changes all append
  // a new row. Readers use the authority-priority rule -- latest
  // confirmatory if any, else latest diagnostic.
  //
  // q1..q4 are NULLABLE by design: L2 predictive-power metrics are
  // staged behind TICKET_863_2_A. Missing substrate must stay NULL,
  // never backfilled with 0 (which would falsely mean "bad").
  //
  // The (algorithm_id, authority, create_time DESC) index supports
  // 863_9_B's latest-by-authority join in a single index scan.
  // ============================================================
  {
    version: 70,
    name: 'TICKET_863_9_A: signal_quality_audit table -- stat-axis mirror of strategy_audit_signal; INSERT-only; q1..q4 nullable until L2 substrate lands (TICKET_863_2_A); joined to strategy_audit_signal via algorithm_id at read time (TICKET_863_9_B), never merged into a composite score',
    up: `
      CREATE TABLE IF NOT EXISTS signal_quality_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        algorithm_id INTEGER NOT NULL,
        signal_run_id INTEGER NOT NULL,

        mode TEXT NOT NULL CHECK (mode IN ('preview', 'confirmatory')),
        authority TEXT NOT NULL CHECK (authority IN ('diagnostic', 'confirmatory')),

        q1_sample_health REAL,
        q2_stationarity REAL,
        q3_predictive_power REAL,
        q4_stability REAL,

        statistical_verdict TEXT NOT NULL CHECK (statistical_verdict IN (
          'significant', 'marginal', 'not_significant', 'insufficient_data'
        )),
        statistical_verdict_score REAL NOT NULL,

        stat_quality_score REAL NOT NULL,

        tier TEXT NOT NULL CHECK (tier IN (
          'unverified', 'noise_shaped', 'weak_researchable', 'confirmed'
        )),

        schema_version INTEGER NOT NULL,
        tier_reason TEXT NOT NULL,
        source_commit_sha TEXT NOT NULL,
        metric_snapshot_json TEXT NOT NULL,

        audit_detail TEXT NOT NULL DEFAULT '{}',
        create_time TEXT NOT NULL DEFAULT (datetime('now')),

        FOREIGN KEY (algorithm_id) REFERENCES nona_signal(id) ON DELETE CASCADE,
        FOREIGN KEY (signal_run_id) REFERENCES signal_run(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_algorithm_id
        ON signal_quality_audit(algorithm_id);
      CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_signal_run_id
        ON signal_quality_audit(signal_run_id);
      CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_tier
        ON signal_quality_audit(tier);
      CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_authority
        ON signal_quality_audit(authority);
      CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_authority_time
        ON signal_quality_audit(algorithm_id, authority, create_time DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_quality_audit_authority_time;
      DROP INDEX IF EXISTS idx_signal_quality_audit_authority;
      DROP INDEX IF EXISTS idx_signal_quality_audit_tier;
      DROP INDEX IF EXISTS idx_signal_quality_audit_signal_run_id;
      DROP INDEX IF EXISTS idx_signal_quality_audit_algorithm_id;
      DROP TABLE IF EXISTS signal_quality_audit;
    `,
  },
  {
    version: 71,
    name: 'TICKET_863_0_2: signal_forward_return table for per-bar r[t+H] persistence aligned to signal_canonical_score; primary key (signal_id, ts) mirrors the score table so the L2 IC join is index-only; horizon_bars stored per-row so heterogeneous horizons across signals stay queryable without a sibling lookup; the trailing H bars of every series are OMITTED (never inserted with shifted values) so missing forward windows surface as JOIN nulls rather than silent lookahead leakage.',
    up: `
      CREATE TABLE IF NOT EXISTS signal_forward_return (
        signal_id     INTEGER NOT NULL,
        ts            INTEGER NOT NULL,
        r_next        REAL    NOT NULL,
        horizon_bars  INTEGER NOT NULL,
        created_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (signal_id, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_signal_forward_return_signal_ts
        ON signal_forward_return(signal_id, ts DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_forward_return_signal_ts;
      DROP TABLE IF EXISTS signal_forward_return;
    `,
  },
  {
    version: 72,
    name: 'TICKET_863_0_5: signal_cv_path table for per-signal planned CPCV / walk-forward path persistence. Stores the exact PlannedPath[] returned by cv-sizing-contract.planPaths() at run-creation time so L3 robustness metrics can ask for OOS subperiod boundaries by signal without re-deriving split geometry. Each row is one path: walk_forward emits N-1 rows per signal (one per fold), single_split emits 1, CPCV emits C(N,k). Bar-space columns (is_start_bar / oos_start_bar / etc.) are relative to data_window_start_ms; ms-space columns are absolute UTC. Contract metadata (scheme / total_segments / test_segments / embargo_bars / horizon_bars / warmup_bars / net_new_bars / total_bars) duplicated per row so any single row is self-describing for the recovery helper without an extra join. test_segment_indices is canonical-JSON [int,...] -- CPCV stores the lex-ordered k-tuple, walk_forward stores [pathIndex+1] (the single segment tested), single_split stores [0]. PK (signal_id, path_index) keys to the same signal_id used by signal_canonical_score / signal_forward_return so the three tables co-key. INSERT OR IGNORE semantics enforced at the writer layer per Strategy A immutability.',
    up: `
      CREATE TABLE IF NOT EXISTS signal_cv_path (
        signal_id              INTEGER NOT NULL,
        path_index             INTEGER NOT NULL,
        total_paths            INTEGER NOT NULL,
        scheme                 TEXT    NOT NULL,
        total_segments         INTEGER NOT NULL,
        test_segments          INTEGER NOT NULL,
        test_segment_indices   TEXT    NOT NULL,
        is_start_bar           INTEGER NOT NULL,
        is_end_bar             INTEGER NOT NULL,
        oos_start_bar          INTEGER NOT NULL,
        oos_end_bar            INTEGER NOT NULL,
        purged_bars            INTEGER NOT NULL,
        is_start_ms            INTEGER,
        is_end_ms              INTEGER,
        oos_start_ms           INTEGER,
        oos_end_ms             INTEGER,
        data_window_start_ms   INTEGER NOT NULL,
        bar_ms                 INTEGER NOT NULL,
        total_bars             INTEGER NOT NULL,
        embargo_bars           INTEGER NOT NULL,
        horizon_bars           INTEGER NOT NULL,
        warmup_bars            INTEGER NOT NULL,
        net_new_bars           INTEGER NOT NULL,
        created_at             INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (signal_id, path_index)
      );
      CREATE INDEX IF NOT EXISTS idx_signal_cv_path_signal
        ON signal_cv_path(signal_id, path_index);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_cv_path_signal;
      DROP TABLE IF EXISTS signal_cv_path;
    `,
  },
  {
    version: 73,
    name: 'TICKET_863_0_6: signal_run_refusal sibling table for arms refused BEFORE a signal_run row exists. Captures the (session_id, dispatch_id, template_id, fingerprint) identity of the refused arm + (reason, message, payload_json, refused_at) so DSR honest trial-population accounting can compute attempted = COUNT(signal_run) + COUNT(signal_run_refusal). Why a sibling table (not widening signal_run.status): signal_run has nine NOT NULL columns (user_id / definition_id / data_snapshot_id / ...) populated by the per-fold dispatch; a refused arm never enters that dispatch and therefore has no honest value for any of them. Loosening the CHECK + nulling those columns would silently break every existing reader. Sibling-table additive risk is bounded to "new readers join in"; old readers see no schema delta. PK (session_id, fingerprint) so reruns of the same dispatch are idempotent (one refusal row per arm per session). dispatch_id denormalised so the coarser dispatch axis is queryable without parsing the session_id slug. payload_json stores the structured failure payload (totalBars / perFoldIsBars / floorRequired / embargoBars / walkForwardFolds for below_min_training_bars; reason-specific shape otherwise) so the renderer dossier can show the same chip data the IPC event carries today. NOTE: "not attempted" arms are NOT stored -- absence-of-row is the representation per the ticket Implementation Notes.',
    up: `
      CREATE TABLE IF NOT EXISTS signal_run_refusal (
        session_id     TEXT    NOT NULL,
        fingerprint    TEXT    NOT NULL,
        dispatch_id    TEXT    NOT NULL,
        template_id    TEXT    NOT NULL,
        reason         TEXT    NOT NULL,
        message        TEXT,
        payload_json   TEXT,
        refused_at     INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (session_id, fingerprint)
      );
      CREATE INDEX IF NOT EXISTS idx_signal_run_refusal_session
        ON signal_run_refusal(session_id);
      CREATE INDEX IF NOT EXISTS idx_signal_run_refusal_dispatch
        ON signal_run_refusal(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_signal_run_refusal_template
        ON signal_run_refusal(template_id, refused_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_run_refusal_template;
      DROP INDEX IF EXISTS idx_signal_run_refusal_dispatch;
      DROP INDEX IF EXISTS idx_signal_run_refusal_session;
      DROP TABLE IF EXISTS signal_run_refusal;
    `,
  },
  {
    version: 74,
    name: 'TICKET_863_0_8: signal_regime_state sidecar table for per-bar HMM regime state persistence. Keyed by (signal_id, ts) where signal_id is the canonical `nona_signal.id` of an HMM regime arm (same key space as signal_canonical_score / signal_forward_return so the L3_3_B regime-conditional IC gate can join (signal_value, r_next) observations from one signal to regime labels from the HMM arm without a second index). `state` is the HMM argmax hidden state (integer in [0, n_states-1]); `posterior` is the posterior mass on that state at this bar. `regime_directions_json` snapshots the {state_id: direction} map at fit time so the renderer can recover semantic regime semantics (bull / sideways / bear) without re-loading the artifact. `regime_directions_source` distinguishes auto-labelled vs user-supplied directions (TICKET_836 lineage). `template_id` + `n_states` denormalised per-row so any single row is self-describing for the L3 lookup path. Writes are immutable (Strategy A) -- re-running an HMM fit with the same fingerprint is a silent no-op so the L3 join sees a stable label series. The trailing WARMUP_BARS prefix and any NaN-posterior rows are OMITTED here (never inserted with a synthetic state) so the L3 gate sees a JOIN-null for "regime unknown for this bar" rather than a fabricated zero. PK (signal_id, ts) co-keys with signal_canonical_score so the planned L3 lookup is a single index probe.',
    up: `
      CREATE TABLE IF NOT EXISTS signal_regime_state (
        signal_id                 INTEGER NOT NULL,
        ts                        INTEGER NOT NULL,
        state                     INTEGER NOT NULL,
        posterior                 REAL    NOT NULL,
        n_states                  INTEGER NOT NULL,
        template_id               TEXT    NOT NULL,
        regime_directions_json    TEXT,
        regime_directions_source  TEXT,
        created_at                INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (signal_id, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_signal_regime_state_signal_ts
        ON signal_regime_state(signal_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_signal_regime_state_template
        ON signal_regime_state(template_id, signal_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_signal_regime_state_template;
      DROP INDEX IF EXISTS idx_signal_regime_state_signal_ts;
      DROP TABLE IF EXISTS signal_regime_state;
    `,
  },
  {
    version: 75,
    name: 'TICKET_196_7_5_3_1: add `symbol` column to signal_canonical_score / signal_forward_return PK so universe-mode arms can fan out per-symbol rows without colliding under INSERT OR IGNORE. Pre-v75 single-symbol rows migrate to `symbol = \'\'` (the explicit arm-aggregate sentinel); universe-mode arms write the manifest symbol verbatim. The C++ factor universe path (TICKET_196_7_5_3 B5/B6) and the Python fit_universe.py path share this schema -- one persistence layer serves both producers. SQLite cannot ALTER PK in place; we use the canonical "new table, copy, drop, rename" pattern inside the migration transaction.',
    up: `
      -- ----- signal_canonical_score: PK (signal_id, ts) -> (signal_id, symbol, ts) -----
      DROP INDEX IF EXISTS idx_canonical_score_signal_ts;
      CREATE TABLE signal_canonical_score__v75 (
        signal_id   INTEGER NOT NULL,
        symbol      TEXT    NOT NULL DEFAULT '',
        ts          INTEGER NOT NULL,
        score       REAL    NOT NULL,
        confidence  REAL    NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (signal_id, symbol, ts),
        FOREIGN KEY (signal_id) REFERENCES nona_signal(id) ON DELETE CASCADE
      );
      INSERT INTO signal_canonical_score__v75
        (signal_id, symbol, ts, score, confidence, created_at)
        SELECT signal_id, '', ts, score, confidence, created_at
        FROM signal_canonical_score;
      DROP TABLE signal_canonical_score;
      ALTER TABLE signal_canonical_score__v75 RENAME TO signal_canonical_score;
      CREATE INDEX IF NOT EXISTS idx_canonical_score_signal_ts
        ON signal_canonical_score(signal_id, symbol, ts DESC);

      -- ----- signal_forward_return: PK (signal_id, ts) -> (signal_id, symbol, ts) -----
      DROP INDEX IF EXISTS idx_signal_forward_return_signal_ts;
      CREATE TABLE signal_forward_return__v75 (
        signal_id     INTEGER NOT NULL,
        symbol        TEXT    NOT NULL DEFAULT '',
        ts            INTEGER NOT NULL,
        r_next        REAL    NOT NULL,
        horizon_bars  INTEGER NOT NULL,
        created_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (signal_id, symbol, ts)
      );
      INSERT INTO signal_forward_return__v75
        (signal_id, symbol, ts, r_next, horizon_bars, created_at)
        SELECT signal_id, '', ts, r_next, horizon_bars, created_at
        FROM signal_forward_return;
      DROP TABLE signal_forward_return;
      ALTER TABLE signal_forward_return__v75 RENAME TO signal_forward_return;
      CREATE INDEX IF NOT EXISTS idx_signal_forward_return_signal_ts
        ON signal_forward_return(signal_id, symbol, ts DESC);
    `,
    down: `
      -- DOWN: drop the symbol column by reversing the new-table pattern.
      -- Any universe-mode rows (symbol != '') would collide on the old PK
      -- (signal_id, ts) -- INSERT OR IGNORE preserves the first-seen row
      -- per (signal_id, ts) deterministically (lex order by symbol).
      DROP INDEX IF EXISTS idx_canonical_score_signal_ts;
      CREATE TABLE signal_canonical_score__pre_v75 (
        signal_id   INTEGER NOT NULL,
        ts          INTEGER NOT NULL,
        score       REAL    NOT NULL,
        confidence  REAL    NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (signal_id, ts),
        FOREIGN KEY (signal_id) REFERENCES nona_signal(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO signal_canonical_score__pre_v75
        (signal_id, ts, score, confidence, created_at)
        SELECT signal_id, ts, score, confidence, created_at
        FROM signal_canonical_score
        ORDER BY signal_id, ts, symbol;
      DROP TABLE signal_canonical_score;
      ALTER TABLE signal_canonical_score__pre_v75 RENAME TO signal_canonical_score;
      CREATE INDEX IF NOT EXISTS idx_canonical_score_signal_ts
        ON signal_canonical_score(signal_id, ts DESC);

      DROP INDEX IF EXISTS idx_signal_forward_return_signal_ts;
      CREATE TABLE signal_forward_return__pre_v75 (
        signal_id     INTEGER NOT NULL,
        ts            INTEGER NOT NULL,
        r_next        REAL    NOT NULL,
        horizon_bars  INTEGER NOT NULL,
        created_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        PRIMARY KEY (signal_id, ts)
      );
      INSERT OR IGNORE INTO signal_forward_return__pre_v75
        (signal_id, ts, r_next, horizon_bars, created_at)
        SELECT signal_id, ts, r_next, horizon_bars, created_at
        FROM signal_forward_return
        ORDER BY signal_id, ts, symbol;
      DROP TABLE signal_forward_return;
      ALTER TABLE signal_forward_return__pre_v75 RENAME TO signal_forward_return;
      CREATE INDEX IF NOT EXISTS idx_signal_forward_return_signal_ts
        ON signal_forward_return(signal_id, ts DESC);
    `,
  },
  {
    version: 76,
    name: 'TICKET_308_1: imported_packages catalog table for BYOD (user-provided) data imports. Each user-imported package (e.g. the TICKET_307 CN A-share MySQL dump) is modeled as its own named data source; this table is its catalog entry. package_name is the PK and is exactly the value written into data_cache_files.provider for every COPY-produced Parquet file of that package -- it is the join key between the catalog and the on-disk inventory (an unregistered file is invisible to the picker). adjust_mode is the load-bearing field: A-share adjustment is a package-level property -- a dump is imported under exactly one of none (unadjusted) / qfq (forward-adjusted) / hfq (backward-adjusted), declared once at import time, NOT inferred and NOT pushed into the per-row OHLCVRow (the TICKET_812 six-field Parquet schema stays untouched -- Gate 1 of the Phase 1 resolution confirmed package-level metadata is the strictly-correct altitude). This is the home that resolves the adjustment-has-no-home open question. source_dialect records the DuckDB ATTACH TYPE the package was read from (mysql/sqlite/postgres) for provenance and re-import. created_at is epoch milliseconds, matching the v74/v75 timestamp convention. This is the ONLY new table the TICKET_308 import introduces; the rest reuses data_cache_files via upsertMetadata.',
    up: `
      CREATE TABLE IF NOT EXISTS imported_packages (
        package_name    TEXT NOT NULL PRIMARY KEY,
        adjust_mode     TEXT NOT NULL CHECK(adjust_mode IN ('none', 'qfq', 'hfq')),
        source_dialect  TEXT NOT NULL CHECK(source_dialect IN ('mysql', 'sqlite', 'postgres')),
        created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
      );
    `,
    down: `
      DROP TABLE IF EXISTS imported_packages;
    `,
  },

  // =========================================================================
  // TICKET_880_5: user_universe + user_universe_symbol + curated seed
  // =========================================================================
  {
    version: 77,
    name: 'TICKET_880_5: Universe Editor. user_universe + user_universe_symbol tables for user-editable symbol subsets. Curated presets (sp500_top50, sp500_top500, crypto_top50, g10_fx, us_sector_etfs) seeded per-provider as regular editable rows -- no "clone to edit" indirection. based_on column records the curated origin for a future "Reset to default" action (not this ticket).',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE TABLE user_universe (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT    NOT NULL,
          provider        TEXT    NOT NULL,
          based_on        TEXT,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_user_universe_name_provider
          ON user_universe(name, provider);

        CREATE TABLE user_universe_symbol (
          universe_id     INTEGER NOT NULL REFERENCES user_universe(id) ON DELETE CASCADE,
          symbol          TEXT    NOT NULL,
          added_at        INTEGER NOT NULL,
          PRIMARY KEY (universe_id, symbol)
        );
      `);

      // Seed curated universes. Frozen snapshot from universes.ts (~2026-06).
      // Once in SQLite these are regular user-editable rows.
      const now = Date.now();

      const SP500_TOP50 = [
        'AAPL','MSFT','NVDA','AMZN','GOOGL','META','GOOG','BRK.B','LLY','AVGO',
        'TSLA','JPM','WMT','V','XOM','UNH','MA','JNJ','PG','COST',
        'ORCL','HD','BAC','ABBV','NFLX','CVX','KO','CRM','TMUS','AMD',
        'MRK','PEP','ADBE','TMO','LIN','CSCO','WFC','ACN','MCD','ABT',
        'DIS','IBM','GE','AXP','NOW','PM','CAT','ISRG','INTU','QCOM',
      ];

      const SP500_500 = [
        'AAPL','MSFT','NVDA','AMZN','GOOGL','META','GOOG','BRK.B','LLY','AVGO',
        'TSLA','JPM','WMT','V','XOM','UNH','MA','JNJ','PG','COST',
        'ORCL','HD','BAC','ABBV','NFLX','CVX','KO','CRM','TMUS','AMD',
        'MRK','PEP','ADBE','TMO','LIN','CSCO','WFC','ACN','MCD','ABT',
        'DIS','IBM','GE','AXP','NOW','PM','CAT','ISRG','INTU','QCOM',
        'TXN','VZ','GS','DHR','BKNG','NEE','RTX','SPGI','T','AMGN',
        'PFE','UBER','LOW','HON','UNP','PGR','AMAT','BLK','SYK','ETN',
        'BSX','COP','C','TJX','VRTX','ADP','MS','GILD','SCHW','BX',
        'MU','LMT','MDT','FI','PLD','REGN','CB','ANET','MMC','DE',
        'ADI','BMY','PANW','SBUX','KLA','MO','SO','ELV','ICE','CME',
        'DUK','SHW','WM','TT','CI','INTC','EQIX','PH','MCK','AON',
        'PNC','CDNS','USB','CL','ITW','SNPS','MSI','CMG','APH','GD',
        'ZTS','NOC','EMR','FCX','TDG','MDLZ','COF','WELL','CVS','MAR',
        'ORLY','CRWD','HCA','BDX','CTAS','ECL','AJG','TGT','CARR','ABNB',
        'NXPI','APD','ROP','RSG','GM','FDX','PCAR','SLB','NSC','DLR',
        'CHTR','OXY','AFL','MET','TFC','AMP','TRV','PSA','SPG','AIG',
        'KMB','GEV','CPRT','O','PAYX','AZO','MNST','NEM','BK','ROST',
        'AEP','D','CMI','KMI','FIS','COR','PSX','KVUE','MPC','FTNT',
        'ALL','HLT','TEL','OKE','GWW','DHI','WMB','F','JCI','SRE',
        'CCI','IDXX','MSCI','AME','CSX','PRU','KR','VLO','IQV','HWM',
        'PCG','A','GIS','PWR','CTVA','YUM','VRSK','OTIS','DAL','EW',
        'KDP','EXC','GEHC','ACGL','CBRE','LHX','EA','FAST','STZ','IR',
        'HES','XEL','RCL','LEN','NUE','ROK','PEG','CTSH','ODFL','IT',
        'VICI','MLM','CCL','KHC','DD','DXCM','EXR','GRMN','EFX','WAB',
        'VMC','TRGP','ED','CAH','HIG','KEYS','EIX','DG','AVB','WEC',
        'MCHP','GLW','ANSS','MTB','EBAY','TTWO','CSGP','XYL','WTW','FANG',
        'BRO','STT','NDAQ','RMD','FITB','DOW','GPN','ON','EQR','TSCO',
        'CHD','PPG','DOV','DFS','AWK','TROW','SYY','HPQ','BR','RJF',
        'ADM','NVR','VLTO','PHM','IRM','HBAN','HUBB','CDW','DTE','PPL',
        'TYL','BIIB','WST','CNP','WDC','FE','EL','STE','ROL','NTAP',
        'ZBH','WY','AEE','RF','MTD','ES','IFF','WAT','PTC','VRSN',
        'STX','TDY','K','CINF','BLDR','CFG','INVH','CMS','LYB','NRG',
        'SBAC','ULTA','LH','CBOE','COO','EXPE','PFG','ATO','ZBRA','BBY',
        'OMC','MAA','CLX','LDOS','DRI','PKG','HOLX','MKC','WRB','BALL',
        'TXT','DGX','EQT','AVY','SWKS','GPC','FDS','NTRS','ARE','J',
        'LUV','AKAM','JBHT','WBD','L','EXPD','ESS','TER','KEY','BG',
        'IP','MAS','CE','VTR','DPZ','POOL','JBL','GEN','PODD','SNA',
        'TPL','AMCR','KIM','HST','SWK','EG','IEX','TRMB','NDSN','DOC',
        'CAG','UDR','LNT','JKHY','BAX','EVRG','VTRS','INCY','RVTY','CF',
        'AES','CPT','SJM','NI','BEN','PNR','REG','ALB','ALLE','FFIV',
        'TAP','MOH','UHS','STLD','HRL','KMX','EPAM','PNW','WYNN','JNPR',
        'AIZ','LKQ','DVA','EMN','CHRW','FOXA','FOX','TFX','GL','APTV',
        'MGM','PAYC','HSIC','CPB','AOS','MKTX','NWSA','NWS','BWA','WBA',
        'CRL','TECH','HAS','RL','MTCH','CZR','MOS','IPG','BXP','HII',
        'PARA','FRT','NCLH','GNRC','DAY','CTLT','APA','MHK','ENPH','SOLV',
        'BBWI','IVZ','LW','CNC','ALGN','DECK','SMCI','KKR','GDDY','PLTR',
        'DELL','VST','ERIE','AXON','TPR','COIN','SW','WSM','LII',
        'CPAY','FSLR','DLTR','BF.B','WTRG','TKO',
        'CSL','AAL','UAL','LVS','BKR','OKTA',
      ];

      const CRYPTO_TOP30_CCXT = [
        'BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT',
        'DOGE/USDT','ADA/USDT','TRX/USDT','AVAX/USDT','LINK/USDT',
        'DOT/USDT','MATIC/USDT','LTC/USDT','BCH/USDT','UNI/USDT',
        'ATOM/USDT','XLM/USDT','NEAR/USDT','APT/USDT','ICP/USDT',
        'FIL/USDT','ARB/USDT','OP/USDT','INJ/USDT','AAVE/USDT',
        'MKR/USDT','IMX/USDT','GRT/USDT','SAND/USDT','AXS/USDT',
      ];

      const G10_FX_YFINANCE = [
        'EURUSD=X','USDJPY=X','GBPUSD=X','USDCHF=X','USDCAD=X',
        'AUDUSD=X','NZDUSD=X','USDSEK=X','USDNOK=X',
      ];

      const G10_FX_DUKASCOPY = [
        'EURUSD','USDJPY','GBPUSD','USDCHF','USDCAD',
        'AUDUSD','NZDUSD','USDSEK','USDNOK',
      ];

      const US_SECTOR_ETFS = [
        'XLC','XLY','XLP','XLE','XLF',
        'XLV','XLI','XLB','XLRE','XLK','XLU',
      ];

      // 9 universe-provider combinations per the design doc table
      const seeds: Array<{ name: string; provider: string; basedOn: string; symbols: string[] }> = [
        { name: 'sp500_top50',    provider: PROVIDER_YFINANCE,  basedOn: 'sp500_top50',    symbols: SP500_TOP50 },
        { name: 'sp500_top50',    provider: PROVIDER_ALPACA,    basedOn: 'sp500_top50',    symbols: SP500_TOP50 },
        { name: 'sp500_top500',   provider: PROVIDER_YFINANCE,  basedOn: 'sp500_top500',   symbols: SP500_500 },
        { name: 'sp500_top500',   provider: PROVIDER_ALPACA,    basedOn: 'sp500_top500',   symbols: SP500_500 },
        { name: 'crypto_top50',   provider: PROVIDER_CCXT,      basedOn: 'crypto_top50',   symbols: CRYPTO_TOP30_CCXT },
        { name: 'g10_fx',         provider: PROVIDER_YFINANCE,  basedOn: 'g10_fx',         symbols: G10_FX_YFINANCE },
        { name: 'g10_fx',         provider: PROVIDER_DUKASCOPY, basedOn: 'g10_fx',         symbols: G10_FX_DUKASCOPY },
        { name: 'us_sector_etfs', provider: PROVIDER_YFINANCE,  basedOn: 'us_sector_etfs', symbols: US_SECTOR_ETFS },
        { name: 'us_sector_etfs', provider: PROVIDER_ALPACA,    basedOn: 'us_sector_etfs', symbols: US_SECTOR_ETFS },
      ];

      const insertUniverse = db.prepare(
        'INSERT INTO user_universe (name, provider, based_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      );
      const insertSymbol = db.prepare(
        'INSERT INTO user_universe_symbol (universe_id, symbol, added_at) VALUES (?, ?, ?)',
      );

      for (const seed of seeds) {
        const info = insertUniverse.run(seed.name, seed.provider, seed.basedOn, now, now);
        const universeId = Number(info.lastInsertRowid);
        for (const symbol of seed.symbols) {
          insertSymbol.run(universeId, symbol, now);
        }
      }

      dbLog.info(`[Migration v77] Seeded ${seeds.length} universes into user_universe`);
    },
    down: `
      DROP TABLE IF EXISTS user_universe_symbol;
      DROP TABLE IF EXISTS user_universe;
    `,
  },

  // =========================================================================
  // TICKET_880_5_11: overselection target_size + candidate pool expansion
  // =========================================================================
  {
    version: 78,
    name: 'TICKET_880_5_11: Universe overselection. Add target_size column to user_universe, expand sp500_top50 to 65 candidates (target_size=50), expand crypto_top50 to 40 candidates (target_size=30).',
    up: (db: MigrationDb) => {
      db.exec('ALTER TABLE user_universe ADD COLUMN target_size INTEGER');

      // sp500_top50: add 15 next-tier-by-market-cap symbols as backup pool,
      // set target_size=50 so runtime quality filter slices to the best 50.
      const SP500_EXTRA_15 = [
        'TXN','VZ','GS','DHR','BKNG','NEE','RTX','SPGI','T','AMGN',
        'PFE','UBER','LOW','HON','UNP',
      ];

      // CRYPTO extra 10 pairs as backup pool for crypto_top50.
      const CRYPTO_EXTRA_10 = [
        'RUNE/USDT','SUI/USDT','SEI/USDT','TIA/USDT','JUP/USDT',
        'WIF/USDT','PENDLE/USDT','STX/USDT','FET/USDT','RNDR/USDT',
      ];

      const now = Date.now();
      const insertSymbol = db.prepare(
        'INSERT OR IGNORE INTO user_universe_symbol (universe_id, symbol, added_at) VALUES (?, ?, ?)',
      );

      // Expand sp500_top50 universes (both yfinance + alpaca providers)
      const sp500Rows = db.prepare(
        "SELECT id FROM user_universe WHERE based_on = 'sp500_top50'",
      ).all() as { id: number }[];
      for (const row of sp500Rows) {
        for (const symbol of SP500_EXTRA_15) {
          insertSymbol.run(row.id, symbol, now);
        }
        db.prepare('UPDATE user_universe SET target_size = 50, updated_at = ? WHERE id = ?')
          .run(now, row.id);
      }

      // Expand crypto_top50 universe (ccxt provider)
      const cryptoRows = db.prepare(
        "SELECT id FROM user_universe WHERE based_on = 'crypto_top50'",
      ).all() as { id: number }[];
      for (const row of cryptoRows) {
        for (const pair of CRYPTO_EXTRA_10) {
          insertSymbol.run(row.id, pair, now);
        }
        db.prepare('UPDATE user_universe SET target_size = 30, updated_at = ? WHERE id = ?')
          .run(now, row.id);
      }

      const sp500Count = sp500Rows.length;
      const cryptoCount = cryptoRows.length;
      dbLog.info(
        `[Migration v78] Overselection: expanded ${sp500Count} sp500_top50 universes ` +
        `(+15 symbols, target_size=50) and ${cryptoCount} crypto_top50 universes ` +
        `(+10 pairs, target_size=30)`,
      );
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_880_5_9_5: trained/requested symbol count columns
  // =========================================================================
  {
    version: 79,
    name: 'TICKET_880_5_9_5: Add trained_symbol_count and requested_symbol_count columns to signal_scoreboard and signal_run',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('signal_scoreboard', 'trained_symbol_count')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN trained_symbol_count INTEGER');
      }
      if (!hasColumn('signal_scoreboard', 'requested_symbol_count')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN requested_symbol_count INTEGER');
      }
      if (!hasColumn('signal_run', 'trained_symbol_count')) {
        db.exec('ALTER TABLE signal_run ADD COLUMN trained_symbol_count INTEGER');
      }
      if (!hasColumn('signal_run', 'requested_symbol_count')) {
        db.exec('ALTER TABLE signal_run ADD COLUMN requested_symbol_count INTEGER');
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_308_2: Expand imported_packages.source_dialect for CSV/Parquet imports
  // =========================================================================
  {
    version: 80,
    name: 'TICKET_308_2: Expand imported_packages.source_dialect CHECK to include csv and parquet. SQLite CHECK constraints cannot be ALTER-ed; recreate the table with the wider constraint while preserving all existing rows.',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE TABLE imported_packages_new (
          package_name    TEXT NOT NULL PRIMARY KEY,
          adjust_mode     TEXT NOT NULL CHECK(adjust_mode IN ('none', 'qfq', 'hfq')),
          source_dialect  TEXT NOT NULL CHECK(source_dialect IN ('mysql', 'sqlite', 'postgres', 'csv', 'parquet')),
          created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
        );
        INSERT INTO imported_packages_new SELECT * FROM imported_packages;
        DROP TABLE imported_packages;
        ALTER TABLE imported_packages_new RENAME TO imported_packages;
      `);
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_308_3_2: Expand imported_packages.source_dialect for DuckDB imports
  // =========================================================================
  {
    version: 81,
    name: 'TICKET_308_3_2: Expand imported_packages.source_dialect CHECK to include duckdb. SQLite CHECK constraints cannot be ALTER-ed; recreate the table with the wider constraint while preserving all existing rows.',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE TABLE imported_packages_new (
          package_name    TEXT NOT NULL PRIMARY KEY,
          adjust_mode     TEXT NOT NULL CHECK(adjust_mode IN ('none', 'qfq', 'hfq')),
          source_dialect  TEXT NOT NULL CHECK(source_dialect IN ('mysql', 'sqlite', 'postgres', 'csv', 'parquet', 'duckdb')),
          created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
        );
        INSERT INTO imported_packages_new SELECT * FROM imported_packages;
        DROP TABLE imported_packages;
        ALTER TABLE imported_packages_new RENAME TO imported_packages;
      `);
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_907_1_1: first-class nona_signal.bar_interval
  // =========================================================================
  {
    version: 82,
    name: 'TICKET_907_1_1: Add nullable bar_interval column to nona_signal and backfill from metadata.bar_interval',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('nona_signal', 'bar_interval')) {
        db.exec('ALTER TABLE nona_signal ADD COLUMN bar_interval TEXT DEFAULT NULL');
      }

      const rows = db
        .prepare(`
          SELECT id, metadata
          FROM nona_signal
          WHERE bar_interval IS NULL
             OR bar_interval = ''
        `)
        .all() as Array<{ id: number; metadata: string | null }>;

      const update = db.prepare(
        `UPDATE nona_signal SET bar_interval = ? WHERE id = ? AND (bar_interval IS NULL OR bar_interval = '')`,
      );
      for (const row of rows) {
        if (!row.metadata) continue;
        try {
          const parsed = JSON.parse(row.metadata) as { bar_interval?: unknown };
          const barInterval =
            typeof parsed.bar_interval === 'string' && parsed.bar_interval.trim().length > 0
              ? parsed.bar_interval.trim()
              : null;
          if (barInterval) {
            update.run(barInterval, row.id);
          }
        } catch {
          // Legacy rows with malformed metadata remain readable with NULL.
        }
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_912 Phase 2: stable run numbering for discovery history
  // =========================================================================
  // TICKET_912 Phase 2: stable run numbering for discovery history
  // =========================================================================
  {
    version: 83,
    name: 'TICKET_912 Phase 2: Add run_number column to desktop_discovery_run_history and backfill with sequential numbers',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('desktop_discovery_run_history', 'run_number')) {
        db.exec('ALTER TABLE desktop_discovery_run_history ADD COLUMN run_number INTEGER DEFAULT NULL');
      }

      // Backfill: assign sequential numbers ordered by created_at ASC so
      // the oldest row gets 1 and the newest gets MAX. Gaps after deletion
      // are intentional (option (b) from the ticket).
      const rows = db
        .prepare(`
          SELECT id FROM desktop_discovery_run_history
          WHERE run_number IS NULL
          ORDER BY created_at ASC
        `)
        .all() as Array<{ id: string }>;
      const update = db.prepare(
        'UPDATE desktop_discovery_run_history SET run_number = ? WHERE id = ?',
      );
      // Start from the current max so we don't collide with rows that
      // already have a number (e.g., if the migration is re-run via healing).
      const maxRow = db
        .prepare('SELECT MAX(run_number) AS mx FROM desktop_discovery_run_history')
        .get() as { mx: number | null } | undefined;
      let seq = (maxRow?.mx ?? 0);
      for (const row of rows) {
        seq += 1;
        update.run(seq, row.id);
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_919_6: promote bar_interval to a first-class column on
  // nona_signal_definition. The fingerprint hash already encodes
  // bar_interval (TICKET_842), but the rollup reader and result table
  // cannot reverse-hash for display. A denormalised column + backfill
  // from signal_run.data_snapshot_json gives the renderer a queryable
  // Timeframe field without breaking the fingerprint contract.
  // =========================================================================
  {
    version: 84,
    name: 'TICKET_919_6: Promote bar_interval to a first-class column on nona_signal_definition + backfill from signal_run.data_snapshot_json',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('nona_signal_definition', 'bar_interval')) {
        db.exec('ALTER TABLE nona_signal_definition ADD COLUMN bar_interval TEXT DEFAULT NULL');
      }
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_signal_definition_bar_interval ' +
        'ON nona_signal_definition(bar_interval)',
      );

      // Backfill: derive bar_interval from any signal_run row that
      // references the definition. data_snapshot_json.data_window.bar_interval
      // is the canonical source (TICKET_804_1 / TICKET_842); we use the
      // newest signal_run per definition so a definition that was first
      // dispatched against malformed JSON gets the corrected later value.
      const defRows = db
        .prepare(
          `SELECT id
             FROM nona_signal_definition
            WHERE bar_interval IS NULL OR bar_interval = ''`,
        )
        .all() as Array<{ id: number }>;

      const pickLatestRunJson = db.prepare(
        `SELECT data_snapshot_json
           FROM signal_run
          WHERE definition_id = ?
          ORDER BY id DESC
          LIMIT 1`,
      );
      const updateDef = db.prepare(
        `UPDATE nona_signal_definition
            SET bar_interval = ?
          WHERE id = ?
            AND (bar_interval IS NULL OR bar_interval = '')`,
      );

      for (const def of defRows) {
        const row = pickLatestRunJson.get(def.id) as
          | { data_snapshot_json: string | null }
          | undefined;
        if (!row?.data_snapshot_json) continue;
        try {
          const parsed = JSON.parse(row.data_snapshot_json) as {
            data_window?: { bar_interval?: unknown };
          };
          const tf = parsed?.data_window?.bar_interval;
          const barInterval =
            typeof tf === 'string' && tf.trim().length > 0 ? tf.trim() : null;
          if (barInterval) {
            updateDef.run(barInterval, def.id);
          }
        } catch {
          // Pre-804_1 rows can carry '{}' as data_snapshot_json; leave
          // bar_interval NULL and let the renderer show '--'.
        }
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_919_9: imported_packages.calendar_padding_ratio_json
  //
  // Self-declared per-interval calendar padding ratio for BYOD packages, so
  // `pullBarsToCalendarMs` stops silently using a 24/7 (ratio=1.0) calendar
  // for 24/5 forex / equity packages and refusing the dispatch with a
  // worst<<required gate. Same shape as the registered provider's
  // `capabilities.calendarPaddingRatio`. SQLite CHECK constraints can't be
  // ALTER-ed, so we use the v80/v81 recreate-with-CHECK pattern. The
  // same-pass back-fill reads `data_cache_files` (the canonical table for
  // per-symbol first_ts/last_ts/row_count, written by upsertMetadata) so
  // existing imports light up without re-import. Intervals with no usable
  // rows (rowCount<=1, reversed span) are OMITTED from the map -- they are
  // NOT fabricated to 1.0; the read path throws with the re-import recovery
  // message (TICKET_857 + TICKET_858).
  // =========================================================================
  {
    version: 85,
    name: 'TICKET_919_9: Add imported_packages.calendar_padding_ratio_json + backfill from data_cache_files',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE TABLE imported_packages_new (
          package_name                TEXT NOT NULL PRIMARY KEY,
          adjust_mode                 TEXT NOT NULL CHECK(adjust_mode IN ('none', 'qfq', 'hfq')),
          source_dialect              TEXT NOT NULL CHECK(source_dialect IN ('mysql', 'sqlite', 'postgres', 'csv', 'parquet', 'duckdb')),
          calendar_padding_ratio_json TEXT NOT NULL DEFAULT '{}',
          created_at                  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
        );
        INSERT INTO imported_packages_new
          (package_name, adjust_mode, source_dialect, created_at)
          SELECT package_name, adjust_mode, source_dialect, created_at FROM imported_packages;
        DROP TABLE imported_packages;
        ALTER TABLE imported_packages_new RENAME TO imported_packages;
      `);

      const packages = db
        .prepare('SELECT package_name FROM imported_packages')
        .all() as Array<{ package_name: string }>;
      const selectFiles = db.prepare(
        `SELECT interval, first_timestamp, last_timestamp, row_count
           FROM data_cache_files
          WHERE provider = ? AND row_count > 1`,
      );
      const updateRatios = db.prepare(
        `UPDATE imported_packages SET calendar_padding_ratio_json = ? WHERE package_name = ?`,
      );

      for (const pkg of packages) {
        const fileRows = selectFiles.all(pkg.package_name) as Array<{
          interval: string;
          first_timestamp: number;
          last_timestamp: number;
          row_count: number;
        }>;
        const ratios = computePackageCalendarRatios(
          fileRows.map((row) => ({
            interval: row.interval,
            firstTimestamp: row.first_timestamp,
            lastTimestamp: row.last_timestamp,
            rowCount: row.row_count,
          })),
        );
        updateRatios.run(JSON.stringify(ratios), pkg.package_name);
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_919_10: imported_packages.archival_cadence
  //
  // The publisher release schedule of an imported package. `Date.now()` is
  // a structurally wrong window-end anchor for any cadence other than
  // `realtime`: a `monthly_archive` package (HistData, Dukascopy month
  // dumps, EOD Historical bundles) over-shoots its true tail by up to ~45
  // calendar days if anchored to wall-clock in the first half of the
  // month, and pyarrow window pushdown then returns 0 rows for the
  // trailing gap. Modelling cadence as a first-class column on
  // `imported_packages` (alongside adjust_mode / source_dialect /
  // calendar_padding_ratio_json) lets the orchestrator's end-anchor
  // helper read one row and floor to the cadence's last published
  // boundary -- no provider-name magic, no per-call-site heuristic.
  //
  // SQLite CHECK constraints cannot be ALTER-ed; recreate-with-CHECK
  // pattern from v80 / v81 / v85. DEFAULT 'snapshot' (NOT
  // 'monthly_archive') protects existing one-shot CSV imports from
  // silently inheriting "wait for next month's archive" semantics. The
  // same-pass back-fill upgrades a package to 'monthly_archive' ONLY when
  // the disk evidence is unambiguous: every row in `data_cache_files` for
  // that package has `last_timestamp <= end-of-last-completed-month` AND
  // no row reaches into the current month. Conservative on purpose --
  // when in doubt, snapshot is the safe and revertible choice.
  // =========================================================================
  {
    version: 86,
    name: 'TICKET_919_10: Add imported_packages.archival_cadence + conservative back-fill (monthly_archive when disk evidence is unambiguous; snapshot otherwise)',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE TABLE imported_packages_new (
          package_name                TEXT NOT NULL PRIMARY KEY,
          adjust_mode                 TEXT NOT NULL CHECK(adjust_mode IN ('none', 'qfq', 'hfq')),
          source_dialect              TEXT NOT NULL CHECK(source_dialect IN ('mysql', 'sqlite', 'postgres', 'csv', 'parquet', 'duckdb')),
          calendar_padding_ratio_json TEXT NOT NULL DEFAULT '{}',
          archival_cadence            TEXT NOT NULL DEFAULT 'snapshot'
            CHECK(archival_cadence IN ('monthly_archive','weekly_archive','daily_eod','snapshot','realtime')),
          created_at                  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
        );
        INSERT INTO imported_packages_new
          (package_name, adjust_mode, source_dialect, calendar_padding_ratio_json, created_at)
          SELECT package_name, adjust_mode, source_dialect, calendar_padding_ratio_json, created_at
            FROM imported_packages;
        DROP TABLE imported_packages;
        ALTER TABLE imported_packages_new RENAME TO imported_packages;
      `);

      // Conservative monthly-archive back-fill. Three conditions a
      // package must satisfy to be upgraded from 'snapshot' default:
      //   (1) it has at least one data_cache_files row (no-op for empty
      //       catalog rows -- can't infer cadence from zero evidence);
      //   (2) MAX(last_timestamp) <= start-of-current-month -- the tail
      //       lies entirely in past months;
      //   (3) MAX(last_timestamp) >= start-of-month - 2 months -- the
      //       tail is recent enough that "monthly archive published
      //       previous-month" is the natural explanation, not "stale
      //       data from 2019". A package whose last bar is years old
      //       is more plausibly a snapshot the user never refreshed
      //       than an active monthly archive.
      // The boundaries are computed in JS (no SQLite date arithmetic
      // dependency); CAST to integer seconds to match the column type.
      const now = new Date();
      const startOfThisMonthSec = Math.floor(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0) / 1000,
      );
      const startTwoMonthsAgoSec = Math.floor(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1, 0, 0, 0) / 1000,
      );

      const candidates = db
        .prepare(
          `SELECT ip.package_name, MAX(dcf.last_timestamp) AS max_last_ts, COUNT(dcf.id) AS file_count
             FROM imported_packages ip
             JOIN data_cache_files dcf
               ON dcf.provider = ip.package_name
            GROUP BY ip.package_name`,
        )
        .all() as Array<{ package_name: string; max_last_ts: number | null; file_count: number }>;

      const upgrade = db.prepare(
        `UPDATE imported_packages SET archival_cadence = 'monthly_archive' WHERE package_name = ?`,
      );

      for (const row of candidates) {
        if (row.file_count <= 0) continue;
        if (row.max_last_ts === null) continue;
        if (row.max_last_ts >= startOfThisMonthSec) continue;          // touches current month -> realtime-ish, leave as snapshot
        if (row.max_last_ts < startTwoMonthsAgoSec) continue;           // too stale to be an active archive
        upgrade.run(row.package_name);
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_927_1_2: nona_signal.market_scope
  //
  // Per-signal market-of-applicability column. Nullable TEXT carrying the
  // canonical MarketScope JSON shape (sorted, deduped JSON array of MarketId
  // strings) defined in packages/types/src/market-scope.ts (TICKET_927_1_1).
  //
  // The column is added NULLABLE for one reason only: legacy rows persisted
  // before TICKET_927_1 carry no scope evidence in any typed column. The
  // backfill script (scripts/backfill_market_scope.py) walks the four-rule
  // ladder (self-tag -> universe sleeves -> coverage inference -> NULL with
  // reason) and writes every resolvable row. New rows are written non-NULL
  // by persistSignal() (TICKET_927_1_2_A). The consumer guard at
  // v3-handlers.ts run-universe entry refuses NULL at run time
  // (TICKET_857 / TICKET_858 fail-fast, defence-in-depth -- NOT the
  // feature path, per TICKET_860).
  //
  // The column is indexed because the signal-lookup statement reads it
  // once per signal per run; with 2000-signal fusion runs an index spares
  // 2000 full-table probes.
  // =========================================================================
  {
    version: 87,
    name: 'TICKET_927_1_2: Add nona_signal.market_scope column (nullable JSON; backfilled by scripts/backfill_market_scope.py; new rows written by persistSignal in TICKET_927_1_2_A)',
    up: `
ALTER TABLE nona_signal ADD COLUMN market_scope TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_nona_signal_market_scope
  ON nona_signal(market_scope);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_signal_market_scope;
-- SQLite has no DROP COLUMN pre-3.35; if rollback is required on an older
-- runtime, rebuild via the standard 12-step ALTER. The backfill itself is
-- reversible (set market_scope = NULL on all rows).
`,
  },

  // =========================================================================
  // TICKET_927_1_2_B: nona_universe -- universe registry with per-sleeve
  // {providerId, marketIds, symbols} attribution.
  //
  // The forensic single source of truth backfill rule #2 of TICKET_927_1_2
  // reads. One row per universe; one entry per construction sleeve. The
  // table is brand new -- it intentionally does NOT carry a flattened
  // `provider` column (ticket section 5 Q2: a flattened `provider` on a
  // pooled universe encodes a lie -- "alpaca even though it includes ccxt
  // + dukascopy"; replaced by `sleeves[*].providerId`).
  //
  // Schema rationale (ticket section 5):
  //   - `id TEXT PRIMARY KEY` -- universes are identified by a string id
  //     written into `nona_signal_definition.universe_id` and
  //     `classification_metadata.universe_id`. Both columns are TEXT today.
  //   - `name TEXT NOT NULL` -- human-readable label (e.g. `sp500_top500`).
  //   - `market_sleeves TEXT NOT NULL` -- canonical JSON: sorted-by-providerId
  //     array of `{ providerId, marketIds, symbols }`. marketIds and symbols
  //     are each sorted-dedup'd within their sleeve.
  //   - `symbols TEXT NOT NULL` -- derived projection (flatten
  //     `sleeves[*].symbols`); Q1: kept alongside for fast reads, updated
  //     atomically with `market_sleeves` in every write.
  //   - `created_at`, `updated_at` -- INTEGER ms-since-epoch (matches the
  //     existing user_universe convention).
  // =========================================================================
  {
    version: 88,
    name: 'TICKET_927_1_2_B: Create nona_universe registry with market_sleeves JSON (per-sleeve {providerId, marketIds, symbols}); single source of truth for TICKET_927_1_2 backfill rule #2',
    up: `
CREATE TABLE IF NOT EXISTS nona_universe (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  market_sleeves  TEXT NOT NULL,
  symbols         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nona_universe_market_sleeves
  ON nona_universe(market_sleeves);
`,
    down: `
DROP INDEX IF EXISTS idx_nona_universe_market_sleeves;
DROP TABLE IF EXISTS nona_universe;
`,
  },

  // TICKET_927_1_4_E: Per-market backtest run persistence.
  //
  // Parent `nona_backtest_run` stores run-level metadata + firm-level summary
  // + data_snapshot_id (TICKET_927_2 provenance). Child `nona_backtest_book`
  // stores one row per MarketId bucket: equity curve (binary blob), metrics,
  // knobs applied, and warnings. Cascade delete ensures no orphan books.
  //
  // Binary blob format for equity_curve_blob: packed Float64Array of
  // [timestamp, grossEquity, netEquity] triples (24 bytes per bar).
  {
    version: 89,
    name: 'TICKET_927_1_4_E: nona_backtest_run + nona_backtest_book tables for per-market persistence',
    up: `
CREATE TABLE nona_backtest_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  run_label TEXT,
  signal_ids TEXT NOT NULL,
  fusion_method TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  data_snapshot_id TEXT NOT NULL,
  firm_sharpe REAL,
  firm_max_drawdown REAL,
  firm_final_equity REAL,
  firm_base_ccy TEXT NOT NULL,
  request_json TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX idx_run_user_created ON nona_backtest_run(user_id, created_at DESC);
CREATE INDEX idx_run_snapshot ON nona_backtest_run(data_snapshot_id);

CREATE TABLE nona_backtest_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES nona_backtest_run(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  execution_interval TEXT NOT NULL,
  symbol_count INTEGER NOT NULL,
  signal_count INTEGER NOT NULL,
  gross_sharpe REAL,
  net_sharpe REAL,
  gross_max_drawdown REAL,
  net_max_drawdown REAL,
  final_equity REAL,
  turnover_avg REAL,
  total_cost_charged REAL,
  bars_count INTEGER,
  regime_signal_id INTEGER,
  regime_gate_count INTEGER,
  cost_json TEXT,
  risk_json TEXT,
  vol_target_json TEXT,
  turnover_control_json TEXT,
  equity_curve_blob BLOB,
  fusion_weights_json TEXT,
  excluded_signals_json TEXT,
  warnings_json TEXT
);
CREATE INDEX idx_book_run ON nona_backtest_book(run_id);
CREATE INDEX idx_book_run_market ON nona_backtest_book(run_id, market_id);
`,
    down: `
DROP INDEX IF EXISTS idx_book_run_market;
DROP INDEX IF EXISTS idx_book_run;
DROP TABLE IF EXISTS nona_backtest_book;
DROP INDEX IF EXISTS idx_run_snapshot;
DROP INDEX IF EXISTS idx_run_user_created;
DROP TABLE IF EXISTS nona_backtest_run;
`,
  },
  // ============================================================
  // TICKET_935_3 -- Add `tier_schema_version` to signal_quality_audit
  // ============================================================
  //
  // The audit-writer's tier-derivation algorithm previously had no
  // explicit version identity -- `// schema_version = 1` was a comment,
  // not a column. When TICKET_935_1 (Path B score formula) and
  // TICKET_935_2 (`stability_compromised` tier) bump the algorithm to
  // v2, pre- and post-change rows must remain distinguishable for the
  // IPC reader, which selects the latest-authority row per algorithm.
  //
  // `DEFAULT 1` stamps every pre-existing row as v1 retroactively;
  // new INSERTs from the current writer also pin v1. Bumping is the
  // explicit responsibility of the ticket that changes the tier table
  // or score formula.
  //
  // Paired with v3-handlers.ts ORDER BY change: the IPC reader picks
  // `tier_schema_version DESC, authority_priority` so a fresher v2
  // diagnostic row beats a stale v1 confirmatory row -- newer
  // algorithm always wins over older algorithm.
  {
    version: 90,
    name: 'TICKET_935_3: signal_quality_audit.tier_schema_version column -- explicit algorithm-version identity so IPC reader (v3-handlers.ts:1721) can prefer fresher-algorithm rows over stale-algorithm rows regardless of authority',
    up: `
      ALTER TABLE signal_quality_audit
        ADD COLUMN tier_schema_version INTEGER NOT NULL DEFAULT 1;
    `,
    down: `
      -- SQLite does not support DROP COLUMN in older versions; rebuild table.
      -- Down-migration is best-effort because SQLite ALTER TABLE DROP COLUMN
      -- requires 3.35+ (Aug 2021). Production better-sqlite3 ships >= 3.36,
      -- so DROP COLUMN is safe; if the build is older, the rollback fails
      -- loudly and the operator must rebuild manually.
      ALTER TABLE signal_quality_audit DROP COLUMN tier_schema_version;
    `,
  },

  // ============================================================
  // TICKET_935_2 -- Expand signal_quality_audit.tier CHECK constraint to
  // include `stability_compromised` (v2 algorithm bump).
  // ============================================================
  //
  // The v70 CHECK constraint pins tier IN ('unverified', 'noise_shaped',
  // 'weak_researchable', 'confirmed'). TICKET_935_2 (Path B of the
  // signal-quality audit) splits `noise_shaped` into two structurally
  // different buckets and introduces `stability_compromised` -- a row
  // the writer now produces for any `verdict=significant` arm with a
  // rejected substrate axis. Without expanding the CHECK, the very first
  // v2 INSERT fails with SqliteError "CHECK constraint failed: tier IN".
  //
  // SQLite cannot ALTER an inline CHECK in place (same constraint that
  // forced v80 / v81 to rebuild imported_packages). The "new table, copy,
  // drop, rename" pattern below preserves every existing row, including
  // the v90-added tier_schema_version column.
  //
  // Indexes are recreated AFTER the rename so they bind to the
  // post-rename table; the FK CASCADE clauses match v70 verbatim.
  //
  // No data backfill needed: `stability_compromised` is a NEW value the
  // writer emits on new INSERTs only. Pre-existing rows keep their
  // original tier; they will not be retroactively reclassified (that
  // would require recomputing the q-axes, which is out of scope for the
  // migration layer).
  {
    version: 91,
    name: 'TICKET_935_2: expand signal_quality_audit.tier CHECK to include `stability_compromised` (v2 algorithm). SQLite CHECK constraints cannot be ALTER-ed; recreate the table with the wider constraint while preserving all rows including the v90 tier_schema_version column.',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE TABLE signal_quality_audit_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          algorithm_id INTEGER NOT NULL,
          signal_run_id INTEGER NOT NULL,

          mode TEXT NOT NULL CHECK (mode IN ('preview', 'confirmatory')),
          authority TEXT NOT NULL CHECK (authority IN ('diagnostic', 'confirmatory')),

          q1_sample_health REAL,
          q2_stationarity REAL,
          q3_predictive_power REAL,
          q4_stability REAL,

          statistical_verdict TEXT NOT NULL CHECK (statistical_verdict IN (
            'significant', 'marginal', 'not_significant', 'insufficient_data'
          )),
          statistical_verdict_score REAL NOT NULL,

          stat_quality_score REAL NOT NULL,

          tier TEXT NOT NULL CHECK (tier IN (
            'unverified', 'noise_shaped', 'stability_compromised',
            'weak_researchable', 'confirmed'
          )),

          schema_version INTEGER NOT NULL,
          tier_schema_version INTEGER NOT NULL DEFAULT 1,
          tier_reason TEXT NOT NULL,
          source_commit_sha TEXT NOT NULL,
          metric_snapshot_json TEXT NOT NULL,

          audit_detail TEXT NOT NULL DEFAULT '{}',
          create_time TEXT NOT NULL DEFAULT (datetime('now')),

          FOREIGN KEY (algorithm_id) REFERENCES nona_signal(id) ON DELETE CASCADE,
          FOREIGN KEY (signal_run_id) REFERENCES signal_run(id) ON DELETE CASCADE
        );

        INSERT INTO signal_quality_audit_new (
          id, algorithm_id, signal_run_id, mode, authority,
          q1_sample_health, q2_stationarity, q3_predictive_power, q4_stability,
          statistical_verdict, statistical_verdict_score,
          stat_quality_score, tier,
          schema_version, tier_schema_version, tier_reason,
          source_commit_sha, metric_snapshot_json, audit_detail, create_time
        )
        SELECT
          id, algorithm_id, signal_run_id, mode, authority,
          q1_sample_health, q2_stationarity, q3_predictive_power, q4_stability,
          statistical_verdict, statistical_verdict_score,
          stat_quality_score, tier,
          schema_version, tier_schema_version, tier_reason,
          source_commit_sha, metric_snapshot_json, audit_detail, create_time
        FROM signal_quality_audit;

        DROP INDEX IF EXISTS idx_signal_quality_audit_authority_time;
        DROP INDEX IF EXISTS idx_signal_quality_audit_authority;
        DROP INDEX IF EXISTS idx_signal_quality_audit_tier;
        DROP INDEX IF EXISTS idx_signal_quality_audit_signal_run_id;
        DROP INDEX IF EXISTS idx_signal_quality_audit_algorithm_id;

        DROP TABLE signal_quality_audit;
        ALTER TABLE signal_quality_audit_new RENAME TO signal_quality_audit;

        CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_algorithm_id
          ON signal_quality_audit(algorithm_id);
        CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_signal_run_id
          ON signal_quality_audit(signal_run_id);
        CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_tier
          ON signal_quality_audit(tier);
        CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_authority
          ON signal_quality_audit(authority);
        CREATE INDEX IF NOT EXISTS idx_signal_quality_audit_authority_time
          ON signal_quality_audit(algorithm_id, authority, create_time DESC);
      `);
    },
    // Down-migration is best-effort and refuses if any v2-only row exists;
    // narrowing the CHECK while `stability_compromised` rows live in the
    // table would silently lose them on the SELECT-INTO copy. The operator
    // must reclassify or delete those rows first.
    down: 'SELECT 1',
  },

  // TICKET_935_4_1: Composition-axis audit table.
  //
  // Schema is defined by TICKET_935_4 Part 2 (Option ii -- separate
  // table, NOT an extension of `signal_quality_audit`, to preserve the
  // "two axes never merged" precedent). This row records the per-signal
  // fusion-axis evidence at `(signal_id, basket_id, run_id, ts)`
  // granularity; the qualification row in `signal_quality_audit` keeps
  // its own `(algorithm_id, signal_run_id)` scope unchanged.
  //
  // Column shape NOTES vs the design doc:
  //   - The doc wrote `signal_id TEXT` for design clarity. HEAD's
  //     `signal_quality_audit` keys on `algorithm_id INTEGER` (FK
  //     `nona_signal(id)`); to match newer table conventions
  //     (TICKET_580/665/etc. use `signal_id INTEGER REFERENCES
  //     nona_signal(id)`) and to keep the FK-cascade behaviour, this
  //     table uses `signal_id INTEGER NOT NULL REFERENCES nona_signal(id)
  //     ON DELETE CASCADE`. The semantic meaning -- "the signal this
  //     composition row scores" -- is identical.
  //   - The doc's foot-noted FK `(signal_id) REFERENCES
  //     signal_quality_audit(signal_id)` is intentionally NOT
  //     implemented: `signal_quality_audit` has no `signal_id` column
  //     and a soft cross-axis link by row-id would couple the
  //     qualification and composition writers, contradicting Part 2
  //     rationale 3 ("independent cadence"). The FK to `nona_signal(id)`
  //     gives us the cascade-on-delete guarantee the doc wanted, via
  //     the canonical anchor.
  //   - `run_id` is NOT FK'd to `signal_run(id)` because a fusion run
  //     and a `signal_run` are different concepts -- a fusion run is
  //     the output of `factor-fusion-trunk.ts` over a *basket* of
  //     already-evaluated signals, not a per-signal evaluation. Keeping
  //     it as a plain INTEGER avoids over-constraining the writer
  //     (TICKET_935_4_2) which may not have a signal_run row to point
  //     at when the basket is built from saved strategies.
  //
  // v1 metric coverage: per TICKET_935_4 Part 1 inventory only
  // `comp_decay_weight` and `comp_base_weight` are populated by the
  // writer at HEAD. The other four (`comp_marginal_ic`,
  // `comp_post_cost_ir`, `comp_correlation_rank`, `comp_capacity_score`)
  // are RESERVED nullable columns -- they ship NULL until the
  // corresponding TICKET_880_3 follow-ups land. Reader (TICKET_935_4_3)
  // renders NULL as "unmeasured within the relevant facet", never zero.
  //
  // Tier CHECK encodes the four v1 tiers from
  // `signal-composition-constants.ts` (`COMP_TIER_LIFTING/NEUTRAL/
  // DRAGGING/UNMEASURED`). Note: the writer in TICKET_935_4_2 is not
  // permitted to emit `comp_unmeasured` -- it is a pure read-side
  // fallback when the LEFT JOIN returns no row -- but the CHECK
  // intentionally includes it so the column type union is identical
  // across write-path and read-path callers.
  //
  // Indexes follow the design doc:
  //   - `idx_sca_basket_latest` -- supports the IPC LEFT JOIN's
  //     `MAX(ts)` lookup keyed on `(basket_id, run_id DESC, ts DESC)`.
  //   - `idx_sca_signal_basket` -- supports the per-signal latest-row
  //     lookup from the Explorer click-through (signal_id is the row's
  //     foreign key and the basket facet pivots on `basket_id`).
  {
    version: 92,
    name: 'TICKET_935_4_1: signal_composition_audit table for composition-axis evidence',
    up: `
CREATE TABLE signal_composition_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- semantic key (one row per (signal, basket) at a given fusion run)
  signal_id INTEGER NOT NULL,
  basket_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,

  -- v1 per-signal evidence (decay_aware_weight + its base reference)
  comp_decay_weight REAL,
  comp_base_weight REAL,

  -- RESERVED -- nullable until TICKET_880_3 follow-up tickets ship the
  -- per-signal emission. Reader renders NULL as "unmeasured", never 0.
  comp_marginal_ic REAL,
  comp_post_cost_ir REAL,
  comp_correlation_rank INTEGER,
  comp_capacity_score REAL,

  -- tier + provenance
  comp_tier TEXT NOT NULL CHECK (comp_tier IN (
    'comp_lifting', 'comp_neutral', 'comp_dragging', 'comp_unmeasured'
  )),
  comp_authority TEXT NOT NULL,
  comp_schema_version INTEGER NOT NULL,
  comp_reason TEXT,

  create_time TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (signal_id, basket_id, run_id, ts),
  FOREIGN KEY (signal_id) REFERENCES nona_signal(id) ON DELETE CASCADE
);

CREATE INDEX idx_sca_basket_latest
  ON signal_composition_audit (basket_id, run_id DESC, ts DESC);
CREATE INDEX idx_sca_signal_basket
  ON signal_composition_audit (signal_id, basket_id);
`,
    down: `
DROP INDEX IF EXISTS idx_sca_signal_basket;
DROP INDEX IF EXISTS idx_sca_basket_latest;
DROP TABLE IF EXISTS signal_composition_audit;
`,
  },
  {
    version: 93,
    name: 'TICKET_196_8_1: signal_roster_state + signal_roster_transitions for Bench-Active rotation',
    up: `
CREATE TABLE signal_roster_state (
  algo_id                 TEXT    PRIMARY KEY,
  roster                  TEXT    NOT NULL
                            CHECK (roster IN ('active', 'bench')),
  since_at                INTEGER NOT NULL,
  last_transition_reason  TEXT    NOT NULL
                            CHECK (last_transition_reason IN (
                              'promote', 'relegate',
                              'manual_add', 'manual_remove',
                              'initial_admit'
                            ))
);

CREATE TABLE signal_roster_transitions (
  algo_id              TEXT    NOT NULL,
  at_ms                INTEGER NOT NULL,
  from_roster          TEXT,
  to_roster            TEXT    NOT NULL
                         CHECK (to_roster IN ('active', 'bench')),
  reason               TEXT    NOT NULL
                         CHECK (reason IN (
                           'promote', 'relegate',
                           'manual_add', 'manual_remove',
                           'initial_admit'
                         )),
  score_at_transition  REAL,
  rank_at_transition   INTEGER,
  PRIMARY KEY (algo_id, at_ms)
);
`,
    down: `
DROP TABLE IF EXISTS signal_roster_transitions;
DROP TABLE IF EXISTS signal_roster_state;
`,
  },

  {
    version: 94,
    name: 'TICKET_196_8: relegation_config single-row table for rotation-cycle parameters',
    up: `
CREATE TABLE relegation_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  enabled           INTEGER NOT NULL DEFAULT 0,
  percentage        REAL    NOT NULL DEFAULT 10,
  cadence_bars      INTEGER NOT NULL DEFAULT 20,
  window_bars       INTEGER NOT NULL DEFAULT 60,
  min_library_size  INTEGER NOT NULL DEFAULT 8
);
INSERT INTO relegation_config (id, enabled, percentage, cadence_bars, window_bars, min_library_size)
VALUES (1, 0, 10, 20, 60, 8);
`,
    down: `
DROP TABLE IF EXISTS relegation_config;
`,
  },

  // =========================================================================
  // TICKET_941: nona_signal.deleted_reason -- soft-delete audit trail column.
  //
  // Paired with scripts/soft_delete_signals_by_cohort.ts (TICKET_941 Script 2).
  // Every cohort-driven soft-delete writes both `deleted_at = datetime('now')`
  // AND `deleted_reason = '<cohort-name> via TICKET_941'`, so the row's
  // tombstone carries its own forensic provenance (which cohort, which
  // contract-violation ticket). TICKET_472 / TICKET_887 require this trail
  // for any bulk operation; TICKET_886_6's draft/confirmed lifecycle already
  // assumes historical rows remain queryable -- this column closes the
  // "why was it deleted" gap that `deleted_at` alone leaves open.
  //
  // Nullable: pre-941 soft-deletes (e.g. TICKET_886_6 draft-cancel) have no
  // cohort identity and must remain NULL. The script writes non-NULL for
  // every row it touches; readers MUST NOT treat NULL as "unknown reason"
  // -- it means "deleted by a pre-cohort code path." See TICKET_941
  // operator runbook for the read-side contract.
  // =========================================================================
  {
    version: 95,
    name: 'TICKET_941: Add nona_signal.deleted_reason column (nullable TEXT; written by scripts/soft_delete_signals_by_cohort.ts to record which cohort triggered the soft-delete)',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };
      if (!hasColumn('nona_signal', 'deleted_reason')) {
        db.exec('ALTER TABLE nona_signal ADD COLUMN deleted_reason TEXT DEFAULT NULL');
      }
    },
    down: 'SELECT 1',
  },

  // =========================================================================
  // TICKET_947_3: Drop the SQLite per-bar eval matrices. After TICKET_947_1
  // (writer) and TICKET_947_2 (reader + parity script), parquet is the
  // sole substrate for the canonical-score / forward-return series. The
  // SQLite dual-write was kept only for the parity window; this migration
  // removes the tables and reclaims the ~44 GB they occupied on a typical
  // dev DB.
  //
  // ONE-WAY DOOR. No down migration: a down would recreate empty tables
  // with no data, which TICKET_851 forbids as a workaround. Recovery from
  // this migration is "restore the pre-v96 SQLite backup and roll the
  // codebase back to before TICKET_947_1." The Phase 0 / Phase 2 backups
  // under apps/desktop/data/StratCraft.db.pre_*_*.bak are the recovery
  // artifacts.
  //
  // Pre-flight is PER-ACTIVE-SIGNAL: every nona_signal row a reader could
  // still hit (status=1 AND deleted_at IS NULL -- nona_signal.status is
  // INTEGER 0/1, NOT a TEXT 'active'/'archived') MUST have a non-tmp
  // run_id partition under BOTH parquet roots. A bare existence check on
  // the roots is not sufficient -- any signal persisted before TICKET_947_1
  // shipped and not re-sweep-persisted since has SQLite rows but no parquet
  // partition, and dropping the tables would silently destroy its per-bar
  // data. TICKET_857 (fail fast, actionable): we list the missing signal
  // IDs so the user can re-run Tool Sweep for just those signals and
  // re-attempt the migration.
  //
  // VACUUM cannot run inside a transaction. It runs in the postCommit
  // hook after the outer migrate() transaction has committed and v96 is
  // durable in schema_version. A VACUUM failure does not roll back -- the
  // tables stay dropped; only the disk reclaim is deferred and the user
  // can run `VACUUM` manually.
  // =========================================================================
  {
    version: 96,
    name: 'TICKET_947_3: Drop signal_canonical_score + signal_forward_return after parquet migration',
    preflight: (db) => {
      const evalRoot = getEvalParquetRoot();

      // The signals a reader could still touch: status=1 is the
      // discovery-orchestrator's filter for "live signal." `status` is
      // an INTEGER (0/1) per nona_signal's schema -- not a TEXT
      // 'active'/'archived'. deleted_at IS NULL excludes soft-deleted
      // rows. Together this matches every signal a read path can still
      // address.
      const activeSignals = db
        .prepare(
          `SELECT id FROM nona_signal WHERE status = 1 AND deleted_at IS NULL`
        )
        .all() as Array<{ id: number }>;

      if (activeSignals.length === 0) {
        dbLog.info(
          '[TICKET_947_3 preflight] No active nona_signal rows; nothing to verify, migration proceeds.'
        );
        return;
      }

      const hasNonTmpRun = (table: 'canonical_score' | 'forward_return', signalId: number): boolean => {
        const signalDir = join(evalRoot, table, `signal_id=${signalId}`);
        if (!existsSync(signalDir)) return false;
        let entries: string[];
        try {
          entries = readdirSync(signalDir);
        } catch {
          return false;
        }
        // Per the writer contract (eval-parquet-writer.ts), a successful
        // run is `run_id={r}/` (no dot); in-flight or failed runs are
        // `run_id={r}.tmp/`. We accept only the non-tmp form.
        return entries.some(
          (e) => e.startsWith('run_id=') && !e.includes('.')
        );
      };

      const missingCanonical: number[] = [];
      const missingForward: number[] = [];
      for (const { id } of activeSignals) {
        if (!hasNonTmpRun('canonical_score', id)) missingCanonical.push(id);
        if (!hasNonTmpRun('forward_return', id)) missingForward.push(id);
      }

      if (missingCanonical.length === 0 && missingForward.length === 0) {
        dbLog.info(
          `[TICKET_947_3 preflight] Verified ${activeSignals.length} active signals; ` +
          `all have parquet partitions under both eval roots. Proceeding with DROP.`
        );
        return;
      }

      const truncate = (arr: number[]): string => {
        const head = arr.slice(0, 20).join(', ');
        return arr.length > 20 ? `${head}, ... (${arr.length} total)` : head;
      };
      throw new Error(
        `[TICKET_947_3 preflight] Refusing to drop SQLite eval tables: ` +
        `${missingCanonical.length} active signal(s) have no canonical_score parquet partition ` +
        `and ${missingForward.length} have no forward_return parquet partition under ${evalRoot}. ` +
        `Dropping the tables would destroy per-bar data for these signals. ` +
        `Remedy: re-run Tool Sweep for the listed signals (TICKET_947_1 dual-write is still live, ` +
        `so the next sweep writes the missing parquet), then re-attempt the migration. ` +
        `Missing canonical_score signal_ids: [${truncate(missingCanonical)}]. ` +
        `Missing forward_return signal_ids: [${truncate(missingForward)}].`
      );
    },
    up: `
      DROP INDEX IF EXISTS idx_canonical_score_signal_ts;
      DROP INDEX IF EXISTS idx_signal_forward_return_signal_ts;
      DROP TABLE IF EXISTS signal_canonical_score;
      DROP TABLE IF EXISTS signal_forward_return;
    `,
    // No down migration. See header comment: a workaround that recreates
    // empty tables is forbidden by TICKET_851. Recovery is via the pre-v96
    // backup of StratCraft.db.
    down: '',
    postCommit: (db) => {
      // SQLite forbids VACUUM inside a transaction. Runs here so the
      // dropped pages actually return to the OS -- without VACUUM the
      // 44 GB stays allocated and the post-merge size check fails.
      db.exec('VACUUM');
    },
  },

  // =========================================================================
  // TICKET_950: Purge historical dangling nona_signal references from every
  // `alpha_factory_config.signals` JSON blob. Companion to the writer-side
  // cascade in v3-handlers.ts (SIGNAL_SOURCE_DELETE_DISCOVERED). The cascade
  // prevents NEW dangling refs; this migration eliminates the historical
  // backlog accumulated before the cascade shipped (the symptom that
  // triggered TICKET_949 and 950: 16 "(deleted signal)" zombie cards in
  // Alpha Factory).
  //
  // Dangling = a chip whose `id` is not in
  //   SELECT id FROM nona_signal WHERE deleted_at IS NULL.
  // (Soft-deleted rows are excluded, matching the list/load contract.)
  //
  // Idempotent: re-running on a clean DB rewrites each row with an
  // identical `signals` JSON and bumps `updated_at` only if a chip was
  // actually dropped (no-op otherwise -- the loop short-circuits when the
  // filtered length equals the input length).
  //
  // No `down`: re-introducing dangling references would be a workaround
  // (TICKET_851). Recovery for any user who explicitly needs the historical
  // chip list is via the pre-v97 SQLite backup.
  // =========================================================================
  {
    version: 97,
    name: 'TICKET_950: Purge dangling nona_signal references from alpha_factory_config.signals',
    up: (db: MigrationDb) => {
      const activeIds = new Set(
        (db.prepare(`SELECT id FROM nona_signal WHERE deleted_at IS NULL`).all() as Array<{ id: number | string }>)
          .map(row => String(row.id)),
      );

      const rows = db
        .prepare(`SELECT id, signals FROM alpha_factory_config`)
        .all() as Array<{ id: string; signals: string | null }>;

      if (rows.length === 0) {
        dbLog.info('[TICKET_950 migration] No alpha_factory_config rows; nothing to purge.');
        return;
      }

      const update = db.prepare(
        `UPDATE alpha_factory_config SET signals = ?, updated_at = datetime('now') WHERE id = ?`,
      );

      let rowsTouched = 0;
      let chipsDropped = 0;
      for (const row of rows) {
        if (!row.signals) continue;
        let parsed: Array<{ id?: string | number }>;
        try {
          parsed = JSON.parse(row.signals) as Array<{ id?: string | number }>;
        } catch {
          dbLog.warn(`[TICKET_950 migration] alpha_factory_config.id=${row.id} has unparseable signals; skipping`);
          continue;
        }
        if (!Array.isArray(parsed)) continue;
        const filtered = parsed.filter(chip => {
          if (chip == null || typeof chip !== 'object') return false;
          if (chip.id === undefined || chip.id === null) return false;
          return activeIds.has(String(chip.id));
        });
        if (filtered.length === parsed.length) continue;
        chipsDropped += parsed.length - filtered.length;
        rowsTouched += 1;
        update.run(JSON.stringify(filtered), row.id);
      }

      dbLog.info(
        `[TICKET_950 migration] Purged ${chipsDropped} dangling chip ref(s) ` +
        `across ${rowsTouched} alpha_factory_config row(s); ${activeIds.size} active nona_signal id(s) retained.`,
      );
    },
    down: '',
  },

  // =========================================================================
  // TICKET_954_1: v2 multi-window score + rotation state machine + explicit
  // staleness contract -- the full v2 forward-fill patch layer in one
  // schema change. See docs/design/TICKET_954_1_*.md "Implementation order"
  // step 1. v95-v97 are owned by TICKET_941 / TICKET_947_3 / TICKET_950; the
  // ticket originally said v95 in error and was patched on 2026-06-13.
  //
  // signal_scoreboard gains:
  //   - score_30, score_60, score_120, score_250 (nullable REAL) -- per-window
  //     rolling rank-IC; v2 readers consume these, v1 readers keep reading
  //     `score`.
  //   - agreement_score (nullable REAL [0,1]) -- fraction of windows where
  //     the signal is in top tercile of the Active pool; consumed by the
  //     state machine.
  //   - last_observation_at (nullable INTEGER bar timestamp) -- last native
  //     observation; staleness contract per TICKET_954_2 Finding 9.
  //   - staleness_bars (nullable INTEGER) -- cached derived value for fast
  //     read; staleness math lives in signal-staleness.ts (single source of
  //     truth -- TICKET_954_1 Change 4).
  //
  // signal_roster_state gains:
  //   - roster_state (nullable TEXT, CHECK new|healthy|watchlist|cut) -- 4-
  //     state machine per TICKET_196_8 v2 concrete form. Nullable so Bench
  //     rows stay NULL (Bench has no state in v2).
  //   - state_entered_at_bar (nullable INTEGER) -- K-cycle confirmation
  //     boundary; bar timestamp when the row last transitioned.
  //   - consecutive_cycles_in_state (nullable INTEGER) -- fast transition
  //     counter; the state machine increments this each cycle the row
  //     stays in its current state.
  //
  // Backfill:
  //   - signal_scoreboard.score_60 := signal_scoreboard.score (preserves v1
  //     equivalence per TICKET_954_1 Change 1 "Why not delete `score`").
  //   - signal_roster_state.roster_state := 'healthy' WHERE roster='active'
  //     (Active rows enter v2 in full-weight state, matching v1 behaviour).
  //     Bench rows stay NULL.
  //
  // No new tables, no CHECK-recreate of existing tables (we use partial
  // CHECK via CHECK clauses on the new columns directly). All columns
  // nullable -- v1 readers untouched, v1 writers can keep writing without
  // populating the new columns until the v2 writer ships in step 2.
  //
  // SQLite does not support multi-column CHECK in ALTER TABLE ADD COLUMN
  // when it references columns not yet present, so roster_state's CHECK
  // is single-column and inline.
  // =========================================================================
  {
    version: 98,
    name: 'TICKET_954_1: Multi-window scores + agreement + staleness on signal_scoreboard; 4-state roster_state on signal_roster_state',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      // signal_scoreboard: multi-window + staleness columns.
      if (!hasColumn('signal_scoreboard', 'score_30')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN score_30 REAL');
      }
      if (!hasColumn('signal_scoreboard', 'score_60')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN score_60 REAL');
      }
      if (!hasColumn('signal_scoreboard', 'score_120')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN score_120 REAL');
      }
      if (!hasColumn('signal_scoreboard', 'score_250')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN score_250 REAL');
      }
      if (!hasColumn('signal_scoreboard', 'agreement_score')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN agreement_score REAL');
      }
      if (!hasColumn('signal_scoreboard', 'last_observation_at')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN last_observation_at INTEGER');
      }
      if (!hasColumn('signal_scoreboard', 'staleness_bars')) {
        db.exec('ALTER TABLE signal_scoreboard ADD COLUMN staleness_bars INTEGER');
      }

      // Backfill score_60 = score for every existing row. TICKET_954_1
      // Change 1: v1's single-window score IS the 60-bar window; keeping
      // score_60 equal to score is the honest equivalence, not a shim.
      const scoreBackfill = db
        .prepare(
          'UPDATE signal_scoreboard SET score_60 = score WHERE score_60 IS NULL AND score IS NOT NULL'
        )
        .run();
      dbLog.info(
        `[TICKET_954_1 migration v98] Backfilled signal_scoreboard.score_60 from score for ${scoreBackfill.changes} row(s).`
      );

      // signal_roster_state: 4-state machine columns.
      if (!hasColumn('signal_roster_state', 'roster_state')) {
        // SQLite ALTER TABLE ADD COLUMN ... CHECK is supported as a column
        // constraint on the added column only.
        db.exec(
          "ALTER TABLE signal_roster_state ADD COLUMN roster_state TEXT " +
          "CHECK (roster_state IS NULL OR roster_state IN ('new', 'healthy', 'watchlist', 'cut'))"
        );
      }
      if (!hasColumn('signal_roster_state', 'state_entered_at_bar')) {
        db.exec('ALTER TABLE signal_roster_state ADD COLUMN state_entered_at_bar INTEGER');
      }
      if (!hasColumn('signal_roster_state', 'consecutive_cycles_in_state')) {
        db.exec('ALTER TABLE signal_roster_state ADD COLUMN consecutive_cycles_in_state INTEGER');
      }

      // Backfill: Active rows enter v2 in 'healthy' state (full weight,
      // matches v1 behaviour). Bench rows stay NULL -- Bench has no state
      // in v2 (TICKET_954_1 Change 2 Migration paragraph).
      const rosterBackfill = db
        .prepare(
          "UPDATE signal_roster_state SET roster_state = 'healthy' " +
          "WHERE roster = 'active' AND roster_state IS NULL"
        )
        .run();
      dbLog.info(
        `[TICKET_954_1 migration v98] Backfilled signal_roster_state.roster_state='healthy' for ${rosterBackfill.changes} Active row(s); Bench rows remain NULL.`
      );
    },
    // No down: SQLite 3.35+ DROP COLUMN works for plain columns but not
    // for columns with CHECK constraints (roster_state). The backfill is
    // also one-way -- a down that NULL-ed score_60 would silently lose
    // any score_60 values written by the v2 writer after migration.
    // Recovery is via pre-v98 SQLite backup, per TICKET_851.
    down: 'SELECT 1',
  },

  // ===========================================================================
  // TICKET_962 R2: split metadata-virtual coverage from parquet truth on
  // `data_cache_files`.
  //
  // Pre-962, `first_timestamp` / `last_timestamp` carried TWO conflicting
  // semantics: when the column shrank to the on-disk parquet extents it was
  // "parquet truth"; when the TICKET_372 virtual extension widened it to
  // `Math.min(realFirst, requestedStartTs)` it was "metadata-virtual
  // coverage" -- a number that is NOT in the parquet. The Coverage check
  // (data-cache-manager.ts: needPrepend / needAppend) needs the virtual
  // value to short-circuit re-fetch of confirmed-empty ranges (TICKET_372's
  // original intent). EVERY OTHER consumer -- the `Append complete` log
  // line (R3), the renderer's "coverage 2025-08-04~2026-06-12" badge, any
  // future code that materializes the bars -- needs the truth value, or it
  // silently lies (a reader concludes "we have the 2025-08-04 left edge on
  // disk" when the file actually starts 2026-05-04).
  //
  // The split: `first_timestamp` / `last_timestamp` keep their existing
  // semantics (virtual coverage, TICKET_372). NEW columns
  // `actual_first_timestamp` / `actual_last_timestamp` carry the parquet
  // extents. Decision sites stay on virtual; read / report sites switch to
  // actual. The post-startup back-fill in
  // `DataCacheManager.backfillActualTimestamps()` reads each parquet's
  // footer-level row-group statistics via DuckDB MIN/MAX (O(1) per file
  // -- no row materialization, consistent with the "no full-history read"
  // rule in CLAUDE.md) and writes the values.
  //
  // Why columns NULL after the schema migration, not zero-filled or
  // virtual-copied:
  //   * `first_timestamp` is currently a MIXTURE of virtual and truth on
  //     existing rows (any cached file written before 962 may carry the
  //     virtual extension OR the parquet truth, depending on whether the
  //     last write went through the empty-merge branch). Copying it into
  //     `actual_first_timestamp` would propagate the lie we are trying
  //     to escape.
  //   * NULL is the honest "we have not yet verified parquet truth"
  //     signal. The startup back-fill resolves it to a real value within
  //     seconds of init. Read consumers MUST treat NULL as a fail-fast
  //     assertion (TICKET_858) -- never silently fall back to the
  //     virtual value, which is the exact pathology this split exists
  //     to prevent.
  //
  // SQLite CHECK NOT NULL cannot be added without a table rebuild. The
  // table rebuild is deferred until a future migration once the back-fill
  // is universally landed; the application-layer assertion in
  // `upsertMetadata` (post-write path) carries the invariant for all
  // newly-written rows immediately.
  // ===========================================================================
  {
    version: 99,
    name: 'TICKET_962: Add data_cache_files.actual_first_timestamp / actual_last_timestamp (parquet-truth coverage, split from metadata-virtual coverage)',
    up: (db: MigrationDb) => {
      const hasColumn = (table: string, column: string): boolean => {
        const rows = db
          .prepare(`PRAGMA table_info(${table})`)
          .all() as Array<{ name?: string }>;
        return rows.some(row => row.name === column);
      };

      if (!hasColumn('data_cache_files', 'actual_first_timestamp')) {
        db.exec('ALTER TABLE data_cache_files ADD COLUMN actual_first_timestamp INTEGER');
      }
      if (!hasColumn('data_cache_files', 'actual_last_timestamp')) {
        db.exec('ALTER TABLE data_cache_files ADD COLUMN actual_last_timestamp INTEGER');
      }

      // NO inline back-fill -- the back-fill needs an async DuckDB call to
      // read each parquet's row-group min/max, which the (sync) migration
      // transaction cannot host. `DataCacheManager.backfillActualTimestamps`
      // runs at init() time and is guaranteed to complete before any
      // consumer that reads actual_*: post-startup write-path sites assert
      // non-null themselves (TICKET_858).
      dbLog.info(
        '[TICKET_962 migration v99] Added actual_first_timestamp / actual_last_timestamp columns to data_cache_files. ' +
        'Post-init backfill (DataCacheManager.backfillActualTimestamps) will populate from parquet row-group statistics.'
      );
    },
    down: 'SELECT 1',
  },

  // ===========================================================================
  // v100 -- TICKET_975_1_3: expression index on json_extract(nona_signal.metadata, '$.fingerprint')
  //
  // Every leaderboard query (and listDiscovered) joins nona_signal to
  // nona_signal_definition on this expression. Without an index SQLite
  // full-scans nona_signal and parses JSON per row. With 1800+ signals
  // this turns a sub-100ms GROUP BY into a multi-second blocking call.
  // SQLite 3.9+ supports indexes on deterministic expressions.
  // ===========================================================================
  {
    version: 100,
    name: 'TICKET_975_1_3: expression index on nona_signal metadata fingerprint for leaderboard join performance',
    up: (db: MigrationDb) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nona_signal_metadata_fingerprint
        ON nona_signal(json_extract(metadata, '$.fingerprint'))
        WHERE deleted_at IS NULL AND status = 1
      `);
      dbLog.info(
        '[TICKET_975_1_3 migration v100] Created expression index idx_nona_signal_metadata_fingerprint ' +
        'on json_extract(metadata, \'$.fingerprint\') for leaderboard query performance.'
      );
    },
    down: 'DROP INDEX IF EXISTS idx_nona_signal_metadata_fingerprint',
  },

  // ===========================================================================
  // v101 -- TICKET_991_5: LSTM training runs table for training dashboard
  //
  // Stores training run metadata, queue state, and quality metrics for:
  // 1. Training history display (start/end time, duration, metrics)
  // 2. Same-data dedup via SHA-256 fingerprint
  // 3. FIFO queue persistence (survives Electron restart)
  // 4. Crash recovery (PID + heartbeat tracking)
  // 5. Model retention policy (keep most recent 20)
  // ===========================================================================
  {
    version: 101,
    name: 'TICKET_991_5: LSTM training runs table for dashboard and dedup',
    up: `
      CREATE TABLE IF NOT EXISTS lstm_training_runs (
        id              TEXT    PRIMARY KEY,
        fingerprint     TEXT    NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'queued'
                                CHECK(status IN ('queued','running','completed','failed','cancelled','skipped')),
        queue_position  INTEGER,
        signal_ids      TEXT    NOT NULL,
        symbol_count    INTEGER,
        bar_count       INTEGER,
        sample_count    INTEGER,
        time_window_start INTEGER,
        time_window_end   INTEGER,
        model_type      TEXT    NOT NULL DEFAULT 'lstm_attention',
        lookback_bars   INTEGER NOT NULL DEFAULT 60,
        forward_bars    INTEGER NOT NULL DEFAULT 5,
        hidden_size     INTEGER NOT NULL DEFAULT 32,
        num_layers      INTEGER NOT NULL DEFAULT 1,
        dropout         REAL    NOT NULL DEFAULT 0.2,
        weight_decay    REAL    NOT NULL DEFAULT 0.001,
        learning_rate   REAL    NOT NULL DEFAULT 0.001,
        batch_size      INTEGER NOT NULL DEFAULT 32,
        epochs          INTEGER NOT NULL DEFAULT 30,
        walk_forward_splits INTEGER NOT NULL DEFAULT 5,
        num_heads       INTEGER DEFAULT 0,
        attention_dropout REAL  DEFAULT 0.0,
        source_type     TEXT    NOT NULL DEFAULT 'sweep'
                                CHECK(source_type IN ('sweep','backtest')),
        source_run_ids  TEXT,
        per_fold_sharpes TEXT,
        mean_val_sharpe REAL,
        onnx_path       TEXT,
        model_version_id TEXT,
        error_message   TEXT,
        error_traceback TEXT,
        pid             INTEGER,
        last_heartbeat_ts INTEGER,
        current_fold    INTEGER,
        current_epoch   INTEGER,
        total_folds     INTEGER,
        total_epochs    INTEGER,
        started_at      INTEGER,
        completed_at    INTEGER,
        created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_lstm_training_fingerprint ON lstm_training_runs(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_lstm_training_status ON lstm_training_runs(status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_lstm_training_status;
      DROP INDEX IF EXISTS idx_lstm_training_fingerprint;
      DROP TABLE IF EXISTS lstm_training_runs;
    `,
  },

  // ---------------------------------------------------------------------------
  // TICKET_998 Phase 1.1: model_param_count column for data sufficiency gauge
  // ---------------------------------------------------------------------------
  {
    version: 102,
    name: 'TICKET_998_1_1: Add model_param_count to lstm_training_runs',
    up: `ALTER TABLE lstm_training_runs ADD COLUMN model_param_count INTEGER;`,
    down: `-- SQLite does not support DROP COLUMN; column is harmless if unused`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1005: feed_lstm + combinator_mode columns for alpha_factory_config
  // ---------------------------------------------------------------------------
  {
    version: 103,
    name: 'TICKET_1005: Add feed_lstm and combinator_mode to alpha_factory_config',
    up: `
ALTER TABLE alpha_factory_config ADD COLUMN feed_lstm INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alpha_factory_config ADD COLUMN combinator_mode TEXT NOT NULL DEFAULT 'statistical';
`,
    down: `-- SQLite does not support DROP COLUMN; columns are harmless if unused`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1010: Per-cockpit backtest telemetry table
  // ---------------------------------------------------------------------------
  {
    version: 104,
    name: 'TICKET_1010: Create desktop_backtest_telemetry table',
    up: `
CREATE TABLE desktop_backtest_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  builder_mode TEXT NOT NULL CHECK(builder_mode IN (
    'regimeDetector', 'regimeEntry', 'marketObserver', 'traderEntry',
    'aiLibero', 'strategyStudio', 'exitStrategy', 'catalogStrategy'
  )),
  status TEXT NOT NULL CHECK(status IN ('started', 'success', 'failed')),
  failure_reason TEXT,
  failure_detail TEXT,
  strategy_name TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT,
  execution_time_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_backtest_telemetry_mode ON desktop_backtest_telemetry(builder_mode);
CREATE INDEX idx_backtest_telemetry_status ON desktop_backtest_telemetry(status);
CREATE INDEX idx_backtest_telemetry_created ON desktop_backtest_telemetry(created_at);
CREATE INDEX idx_backtest_telemetry_task ON desktop_backtest_telemetry(task_id);
`,
    down: `DROP TABLE IF EXISTS desktop_backtest_telemetry;`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1014: Quant Factory Run Result Persistence
  // ---------------------------------------------------------------------------
  {
    version: 105,
    name: 'TICKET_1014: nona_backtest_run_signal + nona_backtest_run_combinator + extend nona_backtest_book',
    up: (db: MigrationDb) => {
      db.exec(`
CREATE TABLE nona_backtest_run_signal (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER NOT NULL REFERENCES nona_backtest_run(id) ON DELETE CASCADE,
  signal_id           INTEGER NOT NULL,
  signal_name         TEXT,
  signal_source       TEXT,
  template_id         TEXT,
  bar_interval        TEXT NOT NULL,
  nature              TEXT NOT NULL,
  ic                  REAL,
  decay_slope         REAL,
  roster_state        TEXT NOT NULL DEFAULT 'active',
  state_weight        REAL NOT NULL DEFAULT 1.0,
  fusion_weight       REAL,
  excluded            INTEGER NOT NULL DEFAULT 0,
  exclusion_reason    TEXT,
  pair_count          INTEGER,
  symbol_count        INTEGER,
  eval_time_ms        INTEGER,
  last_observation_at INTEGER,
  native_interval_ms  INTEGER
);
CREATE INDEX idx_run_signal_run ON nona_backtest_run_signal(run_id);
CREATE INDEX idx_run_signal_id  ON nona_backtest_run_signal(run_id, signal_id);
      `);

      db.exec(`
CREATE TABLE nona_backtest_run_combinator (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER NOT NULL UNIQUE REFERENCES nona_backtest_run(id) ON DELETE CASCADE,
  method              TEXT NOT NULL,
  diagnostics_json    TEXT,
  total_signals_input INTEGER NOT NULL,
  total_signals_fused INTEGER NOT NULL,
  decay_sensitivity   REAL,
  kelly_fraction      REAL,
  construction_rule   TEXT NOT NULL,
  warnings_json       TEXT
);
CREATE INDEX idx_combinator_run ON nona_backtest_run_combinator(run_id);
      `);

      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN construction_rule       TEXT');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN total_orders_emitted    INTEGER');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN drawdown_trigger_count  INTEGER');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN hold_bar_count          INTEGER');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN rebalance_count         INTEGER');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN max_single_bar_turnover REAL');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN per_symbol_contrib_json TEXT');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN leverage_series_blob    BLOB');
      db.exec('ALTER TABLE nona_backtest_book ADD COLUMN quote_ccy               TEXT');
    },
    down: `
DROP INDEX IF EXISTS idx_combinator_run;
DROP TABLE IF EXISTS nona_backtest_run_combinator;
DROP INDEX IF EXISTS idx_run_signal_id;
DROP INDEX IF EXISTS idx_run_signal_run;
DROP TABLE IF EXISTS nona_backtest_run_signal;
-- SQLite does not support DROP COLUMN; columns are harmless if unused
    `,
  },

  {
    version: 106,
    name: 'TICKET_1018_1: Add training_ic column to nona_backtest_run_signal',
    up: (db: MigrationDb) => {
      db.exec('ALTER TABLE nona_backtest_run_signal ADD COLUMN training_ic REAL');
    },
    down: `-- SQLite does not support DROP COLUMN; column is harmless if unused`,
  },

  {
    version: 107,
    name: 'TICKET_1028_1: Make nona_signal name+user unique index partial (exclude soft-deleted rows)',
    up: `
DROP INDEX IF EXISTS idx_nona_signal_name_user;
CREATE UNIQUE INDEX idx_nona_signal_name_user
  ON nona_signal(strategy_name, user_id)
  WHERE deleted_at IS NULL;
`,
    down: `
DROP INDEX IF EXISTS idx_nona_signal_name_user;
CREATE UNIQUE INDEX idx_nona_signal_name_user
  ON nona_signal(strategy_name, user_id);
`,
  },

  {
    version: 108,
    name: 'TICKET_1072_1: Add completeness + missing_days columns to data_cache_files',
    up: (db: MigrationDb) => {
      db.exec('ALTER TABLE data_cache_files ADD COLUMN completeness REAL NOT NULL DEFAULT 1.0');
      db.exec('ALTER TABLE data_cache_files ADD COLUMN missing_days TEXT');
    },
    down: `-- SQLite does not support DROP COLUMN; columns are harmless if unused`,
  },

  {
    version: 109,
    name: 'TICKET_1095: Add asset_class column to imported_packages; migrate duckdb_import_forex -> byod_forex',
    up: (db: MigrationDb) => {
      db.exec("ALTER TABLE imported_packages ADD COLUMN asset_class TEXT NOT NULL DEFAULT 'forex'");

      // Rewrite nona_signal.market_scope JSON arrays: duckdb_import_forex -> byod_forex
      const signals = db.prepare(
        `SELECT id, market_scope FROM nona_signal WHERE market_scope LIKE '%duckdb_import_forex%'`,
      ).all() as Array<{ id: number; market_scope: string }>;
      const updateStmt = db.prepare(`UPDATE nona_signal SET market_scope = ? WHERE id = ?`);
      for (const sig of signals) {
        const updated = sig.market_scope.replace(/duckdb_import_forex/g, 'byod_forex');
        updateStmt.run(updated, sig.id);
      }

      // Canonicalize data_cache_files.provider aliases to package name
      db.exec(`UPDATE data_cache_files SET provider = 'forex' WHERE provider IN ('duckdb', 'duckdb_import', 'forex_duckdb_import')`);
    },
    down: `-- SQLite does not support DROP COLUMN; column is harmless if unused`,
  },

  {
    version: 110,
    name: 'TICKET_1098: re-migrate residual duckdb_import_forex -> byod_forex in nona_signal.market_scope',
    up: (db: MigrationDb) => {
      const signals = db.prepare(
        `SELECT id, market_scope FROM nona_signal WHERE market_scope LIKE '%duckdb_import_forex%'`,
      ).all() as Array<{ id: number; market_scope: string }>;
      if (signals.length === 0) return;
      const updateStmt = db.prepare(`UPDATE nona_signal SET market_scope = ? WHERE id = ?`);
      for (const sig of signals) {
        const updated = sig.market_scope.replace(/duckdb_import_forex/g, 'byod_forex');
        updateStmt.run(updated, sig.id);
      }
    },
    down: `-- no-op: the original values are stale aliases that should not be restored`,
  },

  {
    version: 111,
    name: 'TICKET_1099: Persist parquet codec in data_cache_files to avoid per-file footer inspection',
    up: `ALTER TABLE data_cache_files ADD COLUMN codec TEXT;`,
    down: `-- SQLite cannot drop columns`,
  },

  {
    version: 112,
    name: 'TICKET_1126: data_quality_event table + backtest run/book status + L1 content revision + invalidate metric-invariant-violating runs',
    up: (db: MigrationDb) => {
      // Idempotent column adds: the headless F1 repair tooling
      // (repair-forex-l1.ts) may have provisioned these pieces
      // before the app first runs this migration. SQLite has no
      // `ADD COLUMN IF NOT EXISTS`, so guard via pragma.
      const addColumnIfMissing = (table: string, column: string, ddl: string): void => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === column)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        }
      };

      // F2: quarantine/audit ledger for every OHLC validation disposition
      // (reject / suspect at write gates, repair / delete from F1 tooling).
      // DDL shared with the headless F1/F4 tooling (TICKET_854).
      db.exec(getDataQualityEventTableDdl());

      // F4: run-history validity. Runs are 'valid' by default; the data fix
      // below invalidates persisted runs whose firm metrics violate hard
      // invariants (negative final equity under multiplicative compounding,
      // drawdown below -100%) -- the TICKET_1126 corrupt-bar incident
      // signature (runs 53-57 and any structurally identical run).
      addColumnIfMissing('nona_backtest_run', 'status', `status TEXT NOT NULL DEFAULT 'valid'`);
      addColumnIfMissing('nona_backtest_run', 'invalid_reason', `invalid_reason TEXT`);

      // F3: explicit book termination semantics (bankruptcy floor) +
      // engine input-sanity skip transparency.
      addColumnIfMissing('nona_backtest_book', 'book_status', `book_status TEXT NOT NULL DEFAULT 'completed'`);
      addColumnIfMissing('nona_backtest_book', 'bankrupt_at_ts', `bankrupt_at_ts INTEGER`);
      addColumnIfMissing('nona_backtest_book', 'insane_input_skip_count', `insane_input_skip_count INTEGER NOT NULL DEFAULT 0`);

      // F5: per-series L1 data-content revision. Every parquet-content write
      // (download append, heal, aggregation, import, repair) bumps it; the
      // eval-cache fingerprint incorporates it so a data repair can never be
      // silently negated by a stale cache entry.
      addColumnIfMissing('data_cache_files', 'content_revision', `content_revision INTEGER NOT NULL DEFAULT 1`);

      db.prepare(`
        UPDATE nona_backtest_run
        SET status = 'invalid',
            invalid_reason = ?
        WHERE firm_final_equity <= 0 OR firm_max_drawdown < -1
      `).run(
        'TICKET_1126: firm metrics violate hard invariants (final equity <= 0 ' +
        'or max drawdown < -100%) -- replay consumed corrupt L1 price bars; ' +
        'results are numerically invalid',
      );
    },
    down: `-- SQLite cannot drop columns; data_quality_event left in place (harmless if unused)`,
  },

  {
    version: 113,
    name: 'TICKET_1140: per-book daily hit rate (gross/net) -- the defined portfolio-replay analog of trade win rate',
    // Nullable on purpose: rows persisted before this migration have no
    // recomputable hit rate (the per-bar return stream is not stored), and
    // fabricating history is forbidden (TICKET_858). New runs write both.
    up: `
ALTER TABLE nona_backtest_book ADD COLUMN gross_hit_rate_daily REAL;
ALTER TABLE nona_backtest_book ADD COLUMN net_hit_rate_daily REAL;
`,
    down: `-- SQLite cannot drop columns`,
  },

  {
    version: 114,
    name: 'TICKET_1142: sharpe_ann_basis marker for frequency-aware annualisation',
    up: `
ALTER TABLE nona_backtest_book ADD COLUMN sharpe_ann_basis TEXT;
ALTER TABLE nona_backtest_run ADD COLUMN sharpe_ann_basis TEXT;
`,
    down: `-- SQLite cannot drop columns`,
  },

  {
    version: 115,
    name: 'TICKET_1147 Phase 2: ASHA screening lifecycle -- screening_status on nona_signal (arm level) and signal_run (row level)',
    // NULL = normal lifecycle (never screened, or screening cleared on
    // rung-1 completion / revival). 'screened_fold0' = the arm was parked
    // by ASHA rung-0 screening: only fold 0 was evaluated. Screened rows
    // are ABSENCE, not evidence (TICKET_1138 axis rule): family-bh.ts
    // excludes them from the BH multiple-testing family, and the
    // leaderboard/picker default filter excludes screened signals
    // (TICKET_1147 D4 / AC7). DSR trial accounting deliberately still
    // sees them (countTrialsForSnapshot / countAttemptedArms filter on
    // status='ok' only) -- screening must never shrink the
    // multiple-testing family it selected from.
    up: `
ALTER TABLE nona_signal ADD COLUMN screening_status TEXT;
ALTER TABLE signal_run ADD COLUMN screening_status TEXT;
`,
    down: `-- SQLite cannot drop columns`,
  },

  // ── TICKET_1165_2 AC4 ──────────────────────────────────────────────
  {
    version: 116,
    name: 'TICKET_1165_2 AC4: backfill hypothesis_output_type on existing hypothesis signals',
    up: `
UPDATE nona_signal
SET classification_metadata = json_set(
  classification_metadata,
  '$.hypothesis_output_type',
  CASE
    WHEN json_extract(classification_metadata, '$.sub_domain') LIKE '%adf%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%hurst%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%garch%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%hmm%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%regime%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%variance_ratio%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%ljung%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%jarque%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%shapiro%'
      OR json_extract(classification_metadata, '$.sub_domain') LIKE '%kolmogorov%'
      OR json_extract(classification_metadata, '$.discovery_category') LIKE '%regime%'
      OR json_extract(classification_metadata, '$.discovery_category') LIKE '%volatility_clustering%'
    THEN 'window_level'
    ELSE 'per_bar'
  END
)
WHERE json_extract(classification_metadata, '$.discovery_mode') = 'hypothesis'
  AND json_extract(classification_metadata, '$.hypothesis_output_type') IS NULL;
`,
    down: `-- json_set is additive; removing a JSON key requires json_remove which is lossy for ordering. No-op.`,
  },

  // ── TICKET_1187: retry_count column for download_queue ──────────────
  {
    version: 117,
    name: 'TICKET_1187: Add retry_count to download_queue for zombie task prevention',
    up: `ALTER TABLE download_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`,
    down: `-- SQLite cannot drop columns`,
  },

  // ── TICKET_1195 F4: surface the pre-spawn memory estimate in the UI ─
  {
    version: 118,
    name: 'TICKET_1195 F4: Add memory_estimate_mb to lstm_training_runs',
    up: `ALTER TABLE lstm_training_runs ADD COLUMN memory_estimate_mb INTEGER;`,
    down: `-- SQLite cannot drop columns`,
  },

  // ── TICKET_1243 D0: Convert absolute artifact_path to relative ─────
  // Strips everything up to and including "/algorithms/" so that
  // "/home/user/.config/Electron/algorithms/12345/artifact" becomes
  // "12345/artifact". Relative paths resolve against getArtifactsRoot()
  // at read time, making the DB portable across any root relocation.
  // Paths that are already relative (no "/algorithms/" prefix) are
  // untouched. NULL paths are untouched.
  {
    version: 119,
    name: 'TICKET_1243 D0: Convert absolute artifact_path to relative (portable across root relocation)',
    up: `
      UPDATE nona_signal
         SET artifact_path = SUBSTR(artifact_path, INSTR(artifact_path, '/algorithms/') + LENGTH('/algorithms/'))
       WHERE artifact_path IS NOT NULL
         AND INSTR(artifact_path, '/algorithms/') > 0;

      UPDATE signal_run
         SET artifact_path = SUBSTR(artifact_path, INSTR(artifact_path, '/algorithms/') + LENGTH('/algorithms/'))
       WHERE artifact_path IS NOT NULL
         AND INSTR(artifact_path, '/algorithms/') > 0;
    `,
    down: `-- Cannot reconstruct absolute paths from relative; no-op.`,
  },

  // ── TICKET_1272_1 W1: shared-encoder embedding dimension column ─────
  // The N-agnostic shared_encoder combinator sizes its embedding
  // dimension (d_embed) from data volume (compute_adaptive_d_common) or
  // an explicit override; unlike lstm/lstm_attention it has no
  // hidden_size/num_heads/attention_dropout. Persist d_embed so the run
  // row records the actual capacity the model was trained at (and so the
  // fingerprint / model-store version can echo it).
  {
    version: 120,
    name: 'TICKET_1272_1 W1: Add d_embed to lstm_training_runs',
    up: `ALTER TABLE lstm_training_runs ADD COLUMN d_embed INTEGER;`,
    down: `-- SQLite cannot drop columns`,
  },

  // ── TICKET_1274: detached-trainer supervision + journal observation ──
  // The trainer is spawned detached (systemd-run --user unit on Linux;
  // detached+unref elsewhere) with stdout(JSONL)/stderr redirected to
  // per-run files so it survives an Electron restart and its traceback
  // survives every death mode. These columns let ANY app process observe
  // and recover ANY run without holding a ChildProcess handle:
  //   pid_start_time  -- /proc/<pid>/stat starttime (field 22) captured at
  //                      spawn; liveness = pid alive AND starttime matches,
  //                      which is pid-reuse-safe over multi-hour runs (AC8).
  //   systemd_unit    -- transient unit name when spawned via systemd-run;
  //                      cancel/kill targets the unit (no ChildProcess after
  //                      an adoption across restart).
  //   events_file     -- append-only JSON-lines journal (source of truth for
  //                      run lifecycle; the DB row is its materialized view).
  //   events_offset   -- byte offset the service has tailed up to; persisted
  //                      so an adopting process replays only the un-consumed
  //                      tail after a restart.
  //   stderr_file     -- raw trainer stderr; its tail is the real failure
  //                      cause captured for FAILED rows (AC2/AC4).
  //   source_window_key -- resolved training-window identity (sorted
  //                      --run-ids for the trace path, or the eval-partition
  //                      set for the sweep path). Case A completed-dedup keys
  //                      off this so a rolling window retrains while an
  //                      identical window still dedups (AC7).
  {
    version: 121,
    name: 'TICKET_1274: detached-trainer supervision + journal columns for lstm_training_runs',
    up: `
      ALTER TABLE lstm_training_runs ADD COLUMN pid_start_time TEXT;
      ALTER TABLE lstm_training_runs ADD COLUMN systemd_unit TEXT;
      ALTER TABLE lstm_training_runs ADD COLUMN events_file TEXT;
      ALTER TABLE lstm_training_runs ADD COLUMN events_offset INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE lstm_training_runs ADD COLUMN stderr_file TEXT;
      ALTER TABLE lstm_training_runs ADD COLUMN source_window_key TEXT;
    `,
    down: `-- SQLite cannot drop columns`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1277: LSTM retrain governance -- champion/challenger registration
  // gate + selection-bias measurement. Un-blocking rolling-window retraining
  // (TICKET_1274 AC7) exposed governance gaps above the dedup layer; these
  // columns make the gate outcome auditable per completed run (AC1/AC5,
  // TICKET_858 -- a held challenger is surfaced, never silently dropped):
  //   registration   -- 'registered' (challenger became the active champion)
  //                      or 'held' (stored non-active; champion serves on).
  //                      NULL for pre-1277 rows and for rows that never
  //                      reached the gate (failed/cancelled).
  //   gate_detail     -- JSON verdict: champion version id, both models'
  //                      metrics, per-condition G1/G2/G3 pass/exempt, the
  //                      anti-ratchet epsilon_eff and N, and any bypass reason.
  //   selection_overlap -- roster-selection-window / training-window overlap
  //                      fraction (P3 evidence base; typically 1.0 -- that
  //                      number IS the finding). TICKET_1277_1 owns the root fix.
  //   champion_holdout_sharpe / challenger_holdout_sharpe -- both models'
  //                      out-of-sample scores on the champion's new-information
  //                      segment, when it exists and clears the holdout floor
  //                      (armed by the commit-2 Python --champion-onnx channel).
  // ---------------------------------------------------------------------------
  {
    version: 122,
    name: 'TICKET_1277: registration-gate + selection-bias columns for lstm_training_runs',
    up: `
      ALTER TABLE lstm_training_runs ADD COLUMN registration TEXT
        CHECK(registration IS NULL OR registration IN ('registered','held'));
      ALTER TABLE lstm_training_runs ADD COLUMN gate_detail TEXT;
      ALTER TABLE lstm_training_runs ADD COLUMN selection_overlap REAL;
      ALTER TABLE lstm_training_runs ADD COLUMN champion_holdout_sharpe REAL;
      ALTER TABLE lstm_training_runs ADD COLUMN challenger_holdout_sharpe REAL;
    `,
    down: `-- SQLite cannot drop columns`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1272_4 F2: pre-training loading-phase observability. The trainer now
  // emits `phase` events (boot -> load_traces -> build_matrix/build_windows)
  // BEFORE the `start` event, which on the shared-encoder path fires only after
  // a tens-of-minutes trace-load + matrix + window build. Persist the current
  // phase (+ its done/total) so a run adopted after an app restart resumes the
  // UI at the loading phase it reached rather than snapping to a dead bar.
  //   train_phase        -- last phase event name; NULL until the first event.
  //   train_phase_done / train_phase_total -- sub-progress within the phase
  //                        (e.g. load_traces 3/5 signals); 0/0 for boot.
  // ---------------------------------------------------------------------------
  {
    version: 123,
    name: 'TICKET_1272_4: pre-training phase columns for lstm_training_runs',
    up: `
      ALTER TABLE lstm_training_runs ADD COLUMN train_phase TEXT;
      ALTER TABLE lstm_training_runs ADD COLUMN train_phase_done INTEGER;
      ALTER TABLE lstm_training_runs ADD COLUMN train_phase_total INTEGER;
    `,
    down: `-- SQLite cannot drop columns`,
  },
  {
    version: 124,
    name: 'TICKET_1272_4 F4c: resume_attempts for lstm_training_runs checkpoint/resume',
    // Count of dead-without-terminal-event respawns done with --resume-from.
    // Bounded by LSTM_TRAIN_MAX_RESUME_ATTEMPTS so a deterministic crash cannot
    // loop; past the bound the run is FAILED with the stderr tail.
    up: `ALTER TABLE lstm_training_runs ADD COLUMN resume_attempts INTEGER NOT NULL DEFAULT 0;`,
    down: `-- SQLite cannot drop columns`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1278_3: index the scoreboard sort so buildScoreboardQuery's inner
  // subquery bounds the top-N by score WITHOUT a full table scan + temp B-tree.
  // Before this index the scoreboard query `SCAN sb` (26K+ rows) then sorted
  // them in a temp B-tree even for LIMIT 1 -- measured at 25.5s for limit:1 on
  // the 7GB DB, long enough to ECONNRESET the single-threaded MCP server.
  //
  // The index leads with `score DESC` (NOT `mode`): the tool exposes no `mode`
  // param and the scoreboard carries both backtest + live rows, so the inner
  // ORDER BY has no mode predicate to anchor a `(mode, score)` index. Leading
  // with the sort column lets `ORDER BY score DESC LIMIT ?` walk the index
  // directly (no scan, no temp B-tree) -- limit:1 drops to a few ms.
  //
  // Non-default sort columns (sharpe_long, hit_rate, ...) fall back to a scan
  // + temp B-tree over the 26K scoreboard rows ALONE (no joins in the inner
  // subquery), which is milliseconds -- not worth six single-column indexes.
  // ---------------------------------------------------------------------------
  {
    version: 125,
    name: 'TICKET_1278_3: idx_signal_scoreboard_score for inner-LIMIT-first scoreboard query',
    up: `
      CREATE INDEX IF NOT EXISTS idx_signal_scoreboard_score
        ON signal_scoreboard(score DESC);
    `,
    down: `DROP INDEX IF EXISTS idx_signal_scoreboard_score;`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1287 P2: per-signal chained backtest schema.
  //
  // Chain mode backtests each selected input signal individually as a full
  // single-signal run, executed sequentially as a chain. Each chain entry IS a
  // first-class `nona_backtest_run` row (reusable by every existing result
  // view / trace / scoreboard consumer); chain membership is recorded on the
  // run row -- no parallel result store (design D5).
  //
  //  - chain_id (TEXT NULL): one uuid per chain launch; NULL for fused runs so
  //    existing rows are unaffected.
  //  - chain_position (INTEGER NULL): 0-based entry index within the chain.
  //  - idx_backtest_run_chain: partial index (chain_id IS NOT NULL) so the
  //    derived chain summary query `WHERE chain_id = ?` walks the index without
  //    a scan, while fused rows (chain_id NULL) add no index weight.
  //  - alpha_factory_config.run_mode (TEXT NOT NULL DEFAULT 'fused'): persisted
  //    Layer-2 mode selection; DEFAULT 'fused' keeps existing config rows on
  //    today's behaviour bit-for-bit (design D7 / AC4).
  //
  // Idempotent column/index adds (PRAGMA guards): SQLite has no
  // `ADD COLUMN IF NOT EXISTS`, and the migration must be safe to re-run.
  // ---------------------------------------------------------------------------
  {
    version: 126,
    name: 'TICKET_1287 P2: chain_id + chain_position on nona_backtest_run, run_mode on alpha_factory_config, idx_backtest_run_chain',
    up: (db: MigrationDb) => {
      const addColumnIfMissing = (table: string, column: string, ddl: string): void => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === column)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        }
      };
      const hasIndex = (name: string): boolean => {
        const rows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
          .all(name) as Array<{ name?: string }>;
        return rows.length > 0;
      };

      addColumnIfMissing('nona_backtest_run', 'chain_id', `chain_id TEXT`);
      addColumnIfMissing('nona_backtest_run', 'chain_position', `chain_position INTEGER`);

      if (!hasIndex('idx_backtest_run_chain')) {
        db.exec(
          `CREATE INDEX idx_backtest_run_chain ON nona_backtest_run(chain_id) WHERE chain_id IS NOT NULL`,
        );
      }

      addColumnIfMissing('alpha_factory_config', 'run_mode', `run_mode TEXT NOT NULL DEFAULT 'fused'`);
    },
    // SQLite 3.35+ supports DROP COLUMN; the repo's minimum is verified well
    // above that (v42/v46). Drop index first (it references chain_id), then the
    // columns.
    down: `
      DROP INDEX IF EXISTS idx_backtest_run_chain;
      ALTER TABLE nona_backtest_run DROP COLUMN chain_position;
      ALTER TABLE nona_backtest_run DROP COLUMN chain_id;
      ALTER TABLE alpha_factory_config DROP COLUMN run_mode;
    `,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1287 F1a (design §10): durable per-signal chain-entry store.
  //
  // A chain records the outcome of *every* attempted signal, but only a
  // COMPLETED entry is a real backtest (book/equity/signal rows -> a
  // `nona_backtest_run` row). A failed or skipped entry has none of that, so it
  // MUST NOT be forced into `nona_backtest_run` as a phantom row (design D5).
  // This companion table is the single ordered source of truth for chain
  // outcomes:
  //   - It records completed | failed | skipped entries alike, keyed by
  //     (chain_id, chain_position) -- the same coordinates carried on
  //     `nona_backtest_run` (v126), so the two stay join-consistent.
  //   - `run_id` is a nullable FK to `nona_backtest_run(run_id)`: non-NULL for
  //     completed entries (row click -> full run view), NULL for failed/skipped.
  //   - `error` holds the verbatim failure message (TICKET_858: no silent loss).
  //   - net_sharpe / gross_sharpe / max_drawdown / final_equity / trade_count
  //     are a denormalised metric snapshot so the chain list / comparison table
  //     render from one cheap query without re-opening each run blob.
  //   - idx_chain_entry_created (created_at DESC) backs the history list ordering.
  //
  // Idempotent: SQLite has no `CREATE TABLE IF NOT EXISTS` guard for the index
  // pair uniformly, so the migration checks `sqlite_master` before CREATE and is
  // safe to re-run. `down` drops the table (the index drops with it).
  // ---------------------------------------------------------------------------
  {
    version: 127,
    name: 'TICKET_1287 F1a: nona_backtest_chain_entry durable per-signal chain-outcome table',
    up: (db: MigrationDb) => {
      const hasTable = (name: string): boolean => {
        const rows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .all(name) as Array<{ name?: string }>;
        return rows.length > 0;
      };

      if (!hasTable('nona_backtest_chain_entry')) {
        db.exec(`
          CREATE TABLE nona_backtest_chain_entry (
            chain_id       TEXT    NOT NULL,
            chain_position INTEGER NOT NULL,
            signal_id      INTEGER NOT NULL,
            signal_name    TEXT    NOT NULL,
            status         TEXT    NOT NULL,
            run_id         INTEGER NULL,
            error          TEXT    NULL,
            net_sharpe     REAL    NULL,
            gross_sharpe   REAL    NULL,
            max_drawdown   REAL    NULL,
            final_equity   REAL    NULL,
            trade_count    INTEGER NULL,
            created_at     INTEGER NOT NULL,
            PRIMARY KEY (chain_id, chain_position)
          );
          CREATE INDEX idx_chain_entry_created ON nona_backtest_chain_entry(created_at DESC);
        `);
      }
    },
    down: `DROP TABLE IF EXISTS nona_backtest_chain_entry;`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1287_1 Layer B2 (design §"Layer B fix"): reversible trash table for
  // the alpha_factory_config single-row invariant.
  //
  // `saveAlphaFactoryConfigOp` enforces TICKET_929's physical single-row
  // invariant with `DELETE FROM alpha_factory_config WHERE id != ?`. That DELETE
  // blindly abolishes every non-current row with no backup, so a single mis-id'd
  // save (the 57 -> 0 regression) wipes the user's signals irreversibly. Before
  // deleting, the save now copies each doomed row into this trash table inside
  // the SAME transaction, so the data is always recoverable even if the B1
  // fail-fast assertion ever misses a case. `deleted_at` records when the row
  // was trashed. Schema mirrors alpha_factory_config's columns (as of v126,
  // incl. run_mode) plus deleted_at; id is NOT a primary key here because the
  // same config id can be trashed more than once over the app's lifetime.
  //
  // Idempotent: guarded by a sqlite_master check, safe to re-run. `down` drops
  // the table (the index drops with it).
  // ---------------------------------------------------------------------------
  {
    version: 128,
    name: 'TICKET_1287_1 B2: alpha_factory_config_trash reversible delete table',
    up: (db: MigrationDb) => {
      const hasTable = (name: string): boolean => {
        const rows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .all(name) as Array<{ name?: string }>;
        return rows.length > 0;
      };

      if (!hasTable('alpha_factory_config_trash')) {
        db.exec(`
          CREATE TABLE alpha_factory_config_trash (
            trash_id        INTEGER PRIMARY KEY AUTOINCREMENT,
            id              TEXT    NOT NULL,
            name            TEXT,
            signal_method   TEXT,
            lookback        INTEGER,
            signals         TEXT,
            exit_method     TEXT,
            exits           TEXT,
            factors         TEXT,
            factor_method   TEXT,
            factor_lookback INTEGER,
            combinator_mode TEXT,
            feed_lstm       INTEGER,
            run_mode        TEXT,
            is_active       INTEGER,
            created_at      TEXT,
            updated_at      TEXT,
            deleted_at      TEXT    NOT NULL
          );
          CREATE INDEX idx_af_config_trash_deleted ON alpha_factory_config_trash(deleted_at DESC);
        `);
      }
    },
    down: `DROP TABLE IF EXISTS alpha_factory_config_trash;`,
  },

  {
    version: 129,
    name: 'TICKET_1302 U6: shared data-provider defaults store',
    up: `
CREATE TABLE data_provider_defaults (
  domain TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
    down: `DROP TABLE IF EXISTS data_provider_defaults;`,
  },

  {
    version: 130,
    name: 'TICKET_1303_1_2: canonical research-task catalog and immutable task index',
    up: `
CREATE TABLE research_task_catalog_entry (
  kind TEXT NOT NULL CHECK (kind IN (
    'project',
    'workspace',
    'data-capability',
    'tool-capability-profile',
    'command-policy',
    'resource-budget',
    'research-policy-bundle',
    'acceptance-profile'
  )),
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, id, version)
);

CREATE TABLE research_task_catalog_head (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (kind, id),
  FOREIGN KEY (kind, id, version)
    REFERENCES research_task_catalog_entry(kind, id, version)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE TABLE research_task_index (
  task_id TEXT PRIMARY KEY,
  task_spec_version TEXT NOT NULL,
  task_spec_hash TEXT NOT NULL UNIQUE CHECK (
    length(task_spec_hash) = 64 AND task_spec_hash NOT GLOB '*[^a-f0-9]*'
  ),
  subject_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('strategy', 'signal')),
  workspace_id TEXT NOT NULL,
  workspace_version TEXT NOT NULL,
  workspace_content_hash TEXT NOT NULL UNIQUE CHECK (
    length(workspace_content_hash) = 64
    AND workspace_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  workspace_root_device TEXT NOT NULL,
  workspace_root_file_identity TEXT NOT NULL,
  acceptance_profile_id TEXT NOT NULL,
  acceptance_profile_version TEXT NOT NULL,
  acceptance_profile_content_hash TEXT NOT NULL CHECK (
    length(acceptance_profile_content_hash) = 64
    AND acceptance_profile_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  data_capability_content_hash TEXT NOT NULL CHECK (
    length(data_capability_content_hash) = 64
    AND data_capability_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  capability_profile_id TEXT NOT NULL,
  capability_profile_version TEXT NOT NULL,
  capability_profile_content_hash TEXT NOT NULL CHECK (
    length(capability_profile_content_hash) = 64
    AND capability_profile_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  research_policy_id TEXT NOT NULL,
  research_policy_version TEXT NOT NULL,
  research_policy_content_hash TEXT NOT NULL CHECK (
    length(research_policy_content_hash) = 64
    AND research_policy_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  command_policy_id TEXT NOT NULL,
  command_policy_version TEXT NOT NULL,
  command_policy_content_hash TEXT NOT NULL CHECK (
    length(command_policy_content_hash) = 64
    AND command_policy_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_research_task_subject_created
  ON research_task_index(subject_id, created_at DESC);

CREATE TABLE research_task_selection (
  subject_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  selected_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES research_task_index(task_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE TRIGGER research_task_catalog_entry_immutable_update
BEFORE UPDATE ON research_task_catalog_entry
BEGIN
  SELECT RAISE(ABORT, 'research_task_catalog_entry is immutable');
END;

CREATE TRIGGER research_task_catalog_entry_immutable_delete
BEFORE DELETE ON research_task_catalog_entry
BEGIN
  SELECT RAISE(ABORT, 'research_task_catalog_entry is immutable');
END;

CREATE TRIGGER research_task_index_immutable_update
BEFORE UPDATE ON research_task_index
BEGIN
  SELECT RAISE(ABORT, 'research_task_index is immutable');
END;

CREATE TRIGGER research_task_index_immutable_delete
BEFORE DELETE ON research_task_index
BEGIN
  SELECT RAISE(ABORT, 'research_task_index is immutable');
END;
`,
    down: `
DROP TRIGGER IF EXISTS research_task_index_immutable_delete;
DROP TRIGGER IF EXISTS research_task_index_immutable_update;
DROP TRIGGER IF EXISTS research_task_catalog_entry_immutable_delete;
DROP TRIGGER IF EXISTS research_task_catalog_entry_immutable_update;
DROP INDEX IF EXISTS idx_research_task_subject_created;
DROP TABLE IF EXISTS research_task_selection;
DROP TABLE IF EXISTS research_task_index;
DROP TABLE IF EXISTS research_task_catalog_head;
DROP TABLE IF EXISTS research_task_catalog_entry;
`,
  },

  {
    version: 131,
    name: 'TICKET_1303_1_2: deterministic Artifact admission registry',
    up: `
CREATE TABLE artifact_admission_attempt (
  admission_result_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_content_hash TEXT NOT NULL CHECK (
    length(candidate_content_hash) = 64
    AND candidate_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  turn_admission_fingerprint TEXT NOT NULL CHECK (
    length(turn_admission_fingerprint) = 64
    AND turn_admission_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  acceptance_profile_id TEXT NOT NULL,
  acceptance_profile_version TEXT NOT NULL,
  acceptance_profile_content_hash TEXT NOT NULL CHECK (
    length(acceptance_profile_content_hash) = 64
    AND acceptance_profile_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  gate_plan_json TEXT NOT NULL CHECK (json_valid(gate_plan_json)),
  status TEXT NOT NULL CHECK (status IN ('running', 'accepted', 'rejected')),
  failed_stage TEXT,
  diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
  artifact_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (candidate_content_hash, turn_admission_fingerprint),
  FOREIGN KEY (task_id) REFERENCES research_task_index(task_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE artifact_admission_stage_result (
  admission_result_id TEXT NOT NULL,
  stage_ordinal INTEGER NOT NULL CHECK (stage_ordinal BETWEEN 1 AND 7),
  stage TEXT NOT NULL CHECK (stage IN (
    'contract', 'security', 'source', 'compile-abi',
    'tests-leakage', 'research-operations', 'persistence'
  )),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
  diagnostics_json TEXT NOT NULL CHECK (json_valid(diagnostics_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (admission_result_id, stage),
  UNIQUE (admission_result_id, stage_ordinal),
  FOREIGN KEY (admission_result_id)
    REFERENCES artifact_admission_attempt(admission_result_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE artifact_registry (
  artifact_id TEXT PRIMARY KEY,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('strategy', 'signal')),
  root_content_hash TEXT NOT NULL UNIQUE CHECK (
    length(root_content_hash) = 64
    AND root_content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  candidate_content_hash TEXT NOT NULL,
  admission_result_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  accepted_at TEXT NOT NULL,
  FOREIGN KEY (admission_result_id)
    REFERENCES artifact_admission_attempt(admission_result_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES research_task_index(task_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE artifact_evidence_reference (
  artifact_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^a-f0-9]*'
  ),
  PRIMARY KEY (artifact_id, requirement_id),
  FOREIGN KEY (artifact_id) REFERENCES artifact_registry(artifact_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE artifact_provenance_edge (
  artifact_id TEXT NOT NULL,
  edge_key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  PRIMARY KEY (artifact_id, edge_key),
  FOREIGN KEY (artifact_id) REFERENCES artifact_registry(artifact_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE artifact_canonical_link (
  artifact_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL CHECK (owner IN ('algorithm-storage', 'signal-storage')),
  record_id TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifact_registry(artifact_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TRIGGER artifact_registry_immutable_update
BEFORE UPDATE ON artifact_registry
BEGIN
  SELECT RAISE(ABORT, 'artifact_registry is immutable');
END;

CREATE TRIGGER artifact_registry_immutable_delete
BEFORE DELETE ON artifact_registry
BEGIN
  SELECT RAISE(ABORT, 'artifact_registry is immutable');
END;

CREATE TRIGGER artifact_evidence_immutable_update
BEFORE UPDATE ON artifact_evidence_reference
BEGIN
  SELECT RAISE(ABORT, 'artifact_evidence_reference is immutable');
END;

CREATE TRIGGER artifact_evidence_immutable_delete
BEFORE DELETE ON artifact_evidence_reference
BEGIN
  SELECT RAISE(ABORT, 'artifact_evidence_reference is immutable');
END;
`,
    down: `
DROP TRIGGER IF EXISTS artifact_evidence_immutable_delete;
DROP TRIGGER IF EXISTS artifact_evidence_immutable_update;
DROP TRIGGER IF EXISTS artifact_registry_immutable_delete;
DROP TRIGGER IF EXISTS artifact_registry_immutable_update;
DROP TABLE IF EXISTS artifact_canonical_link;
DROP TABLE IF EXISTS artifact_provenance_edge;
DROP TABLE IF EXISTS artifact_evidence_reference;
DROP TABLE IF EXISTS artifact_registry;
DROP TABLE IF EXISTS artifact_admission_stage_result;
DROP TABLE IF EXISTS artifact_admission_attempt;
`,
  },

  {
    version: 132,
    name: 'TICKET_1303_1_8: immutable local attribution and governance outbox',
    up: `
CREATE TABLE agent_inference_attribution (
  record_id TEXT PRIMARY KEY,
  correction_of TEXT,
  schema_version TEXT NOT NULL,
  subject_scope_hash TEXT NOT NULL CHECK (
    length(subject_scope_hash) = 64
    AND subject_scope_hash NOT GLOB '*[^a-f0-9]*'
  ),
  task_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  admission_fingerprint TEXT NOT NULL CHECK (
    length(admission_fingerprint) = 64
    AND admission_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  runtime_id TEXT NOT NULL CHECK (runtime_id IN (
    'stratcraft', 'acp', 'codex', 'github-copilot', 'claude-agent'
  )),
  adapter_contract_version TEXT NOT NULL,
  native_version TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  entitlement_source TEXT NOT NULL CHECK (entitlement_source IN (
    'stratcraft-plan', 'provider-api-key', 'provider-subscription', 'local'
  )),
  payer_class TEXT NOT NULL CHECK (payer_class IN (
    'user', 'stratcraft', 'provider', 'local'
  )),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_event_id TEXT,
  usage_json TEXT NOT NULL CHECK (json_valid(usage_json)),
  status TEXT NOT NULL CHECK (status IN (
    'started', 'completed', 'failed', 'cancelled'
  )),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  native_diagnostic_id TEXT,
  recorded_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  FOREIGN KEY (correction_of) REFERENCES agent_inference_attribution(record_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (task_id) REFERENCES research_task_index(task_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_agent_inference_provider_event
  ON agent_inference_attribution(turn_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX idx_agent_inference_task_turn
  ON agent_inference_attribution(task_id, turn_id, recorded_at);

CREATE TABLE agent_governance_attribution (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  task_id TEXT NOT NULL,
  artifact_id TEXT,
  artifact_root_hash TEXT,
  admission_id TEXT,
  admission_fingerprint TEXT NOT NULL CHECK (
    length(admission_fingerprint) = 64
    AND admission_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  policy_hashes_json TEXT NOT NULL CHECK (json_valid(policy_hashes_json)),
  evidence_hashes_json TEXT NOT NULL CHECK (json_valid(evidence_hashes_json)),
  operation TEXT NOT NULL CHECK (operation IN (
    'local_admission', 'evidence_receipt_requested',
    'evidence_receipt_recorded', 'credit_recorded'
  )),
  local_result TEXT CHECK (local_result IN ('accepted', 'rejected')),
  server_receipt_id TEXT,
  receipt_signature TEXT,
  receipt_key_id TEXT,
  assurance_level TEXT CHECK (assurance_level IN (
    'claim_recorded', 'client_verified', 'server_verified'
  )),
  receipt_revoked_at TEXT,
  credit_unit TEXT,
  credit_value TEXT,
  submission_state TEXT NOT NULL CHECK (submission_state IN (
    'not_submitted', 'queued_offline', 'submitted', 'claim_recorded',
    'client_verified', 'server_verified', 'rejected', 'revoked', 'failed'
  )),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  FOREIGN KEY (task_id) REFERENCES research_task_index(task_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (artifact_id) REFERENCES artifact_registry(artifact_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (admission_id) REFERENCES artifact_admission_attempt(admission_result_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_agent_governance_task_time
  ON agent_governance_attribution(task_id, occurred_at, event_id);

CREATE TABLE agent_governance_outbox_message (
  message_id TEXT PRIMARY KEY,
  governance_event_id TEXT NOT NULL,
  account_binding_hash TEXT NOT NULL CHECK (
    length(account_binding_hash) = 64
    AND account_binding_hash NOT GLOB '*[^a-f0-9]*'
  ),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    idempotency_key GLOB 'sha256:*' AND length(idempotency_key) = 71
  ),
  request_digest TEXT NOT NULL CHECK (
    request_digest GLOB 'sha256:*' AND length(request_digest) = 71
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (governance_event_id)
    REFERENCES agent_governance_attribution(event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_agent_governance_outbox_account
  ON agent_governance_outbox_message(account_binding_hash, created_at);

CREATE TABLE agent_governance_outbox_delivery (
  delivery_event_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'queued_offline', 'submitted', 'rejected', 'failed'
  )),
  http_status INTEGER CHECK (http_status BETWEEN 100 AND 599),
  error_code TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES agent_governance_outbox_message(message_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_agent_governance_outbox_delivery
  ON agent_governance_outbox_delivery(message_id, occurred_at);

CREATE TRIGGER agent_inference_attribution_immutable_update
BEFORE UPDATE ON agent_inference_attribution
BEGIN
  SELECT RAISE(ABORT, 'agent_inference_attribution is immutable');
END;
CREATE TRIGGER agent_inference_attribution_immutable_delete
BEFORE DELETE ON agent_inference_attribution
BEGIN
  SELECT RAISE(ABORT, 'agent_inference_attribution is immutable');
END;
CREATE TRIGGER agent_governance_attribution_immutable_update
BEFORE UPDATE ON agent_governance_attribution
BEGIN
  SELECT RAISE(ABORT, 'agent_governance_attribution is immutable');
END;
CREATE TRIGGER agent_governance_attribution_immutable_delete
BEFORE DELETE ON agent_governance_attribution
BEGIN
  SELECT RAISE(ABORT, 'agent_governance_attribution is immutable');
END;
CREATE TRIGGER agent_governance_outbox_message_immutable_update
BEFORE UPDATE ON agent_governance_outbox_message
BEGIN
  SELECT RAISE(ABORT, 'agent_governance_outbox_message is immutable');
END;
CREATE TRIGGER agent_governance_outbox_message_immutable_delete
BEFORE DELETE ON agent_governance_outbox_message
BEGIN
  SELECT RAISE(ABORT, 'agent_governance_outbox_message is immutable');
END;
CREATE TRIGGER agent_governance_outbox_delivery_immutable_update
BEFORE UPDATE ON agent_governance_outbox_delivery
BEGIN
  SELECT RAISE(ABORT, 'agent_governance_outbox_delivery is immutable');
END;
CREATE TRIGGER agent_governance_outbox_delivery_immutable_delete
BEFORE DELETE ON agent_governance_outbox_delivery
BEGIN
  SELECT RAISE(ABORT, 'agent_governance_outbox_delivery is immutable');
END;
`,
    down: `
DROP TRIGGER IF EXISTS agent_governance_outbox_delivery_immutable_delete;
DROP TRIGGER IF EXISTS agent_governance_outbox_delivery_immutable_update;
DROP TRIGGER IF EXISTS agent_governance_outbox_message_immutable_delete;
DROP TRIGGER IF EXISTS agent_governance_outbox_message_immutable_update;
DROP TRIGGER IF EXISTS agent_governance_attribution_immutable_delete;
DROP TRIGGER IF EXISTS agent_governance_attribution_immutable_update;
DROP TRIGGER IF EXISTS agent_inference_attribution_immutable_delete;
DROP TRIGGER IF EXISTS agent_inference_attribution_immutable_update;
DROP INDEX IF EXISTS idx_agent_governance_outbox_delivery;
DROP INDEX IF EXISTS idx_agent_governance_outbox_account;
DROP INDEX IF EXISTS idx_agent_governance_task_time;
DROP INDEX IF EXISTS idx_agent_inference_task_turn;
DROP INDEX IF EXISTS idx_agent_inference_provider_event;
DROP TABLE IF EXISTS agent_governance_outbox_delivery;
DROP TABLE IF EXISTS agent_governance_outbox_message;
DROP TABLE IF EXISTS agent_governance_attribution;
DROP TABLE IF EXISTS agent_inference_attribution;
`,
  },

  {
    version: 133,
    name: 'TICKET_1303_1_8_1: register the default Guide chat research task',
    // v132 gave agent_inference_attribution.task_id a NOT NULL foreign key to
    // research_task_index, but the admitted default Guide chat task
    // (GUIDE_TASK_IDENTITY, taskId 'guide-chat') is never written to that index
    // -- ResearchTaskService only inserts explicitly created tasks under a fresh
    // randomUUID(). Every plain Guide turn therefore died on
    // 'FOREIGN KEY constraint failed' before inference started.
    //
    // The fix registers the default task as a real owner row so the existing
    // foreign key resolves. The constraint itself is deliberately left intact.
    //
    // Hashes below are the frozen constants in
    // apps/desktop/src/mcp/standalone/src/agent/runtime/runtime-contract-constants.ts
    // (SHA-256 of the versioned '<id>:v1' payload). A drift test pins them.
    //
    // subject_id uses the reserved 'mcp-standalone' sentinel
    // (MCP_STANDALONE_USER_ID) because this row is shared infrastructure, not
    // any end user's research task.
    //
    // Deliberately NOT inserted into research_task_selection: that table's
    // task_id is UNIQUE, so a single subject would claim the default forever,
    // and selectedTask() must keep returning undefined so buildAgentSelection
    // continues to fall back to GUIDE_TASK_IDENTITY. Seeding a selection row
    // would promote the default into a user-chosen task and corrupt the Guide
    // task picker.
    up: `
INSERT INTO research_task_index (
  task_id,
  task_spec_version,
  task_spec_hash,
  subject_id,
  project_id,
  artifact_kind,
  workspace_id,
  workspace_version,
  workspace_content_hash,
  workspace_root_device,
  workspace_root_file_identity,
  acceptance_profile_id,
  acceptance_profile_version,
  acceptance_profile_content_hash,
  data_capability_content_hash,
  capability_profile_id,
  capability_profile_version,
  capability_profile_content_hash,
  research_policy_id,
  research_policy_version,
  research_policy_content_hash,
  command_policy_id,
  command_policy_version,
  command_policy_content_hash
) VALUES (
  'guide-chat',
  '1',
  '6d46982c7260297e11fb04a5c9a54cbcda9513c6800ce0a29fc342164372bfbb',
  'mcp-standalone',
  'guide-chat',
  'strategy',
  'guide-application-data',
  '1',
  '0508ea005c0cd18391653a4b9394715a985c055a490645729e200225c6059550',
  'guide-application-data',
  'guide-application-data',
  'guide-live-mcp-catalog',
  '1',
  '690a46b55b289f6d32fab1de90ab45b28a78f785d0a46e74ddf0251b5cc0d5bb',
  '690a46b55b289f6d32fab1de90ab45b28a78f785d0a46e74ddf0251b5cc0d5bb',
  'guide-live-mcp-catalog',
  '1',
  '690a46b55b289f6d32fab1de90ab45b28a78f785d0a46e74ddf0251b5cc0d5bb',
  'guide-default-research',
  '1',
  'efbe41c0b00f51aa4be3339defe5f4d6f71581697bf2e28de16b25c0f7ae172d',
  'guide-confirm-destructive',
  '1',
  '6ce9b54e27feca516703b1ad84cb55268ad78458eb600097bff4debd3cc70e99'
)
ON CONFLICT(task_id) DO NOTHING;
`,
    // research_task_index carries immutability triggers on UPDATE and DELETE,
    // so a rollback cannot remove the seeded row. Dropping the trigger to force
    // a delete would break the append-only guarantee the parent ticket relies
    // on, and re-running up is idempotent, so the down step is intentionally a
    // no-op. Reverting past v130 drops the table outright.
    down: `
SELECT 'TICKET_1303_1_8_1: guide-chat task row is immutable and is retained';
`,
  },

  {
    version: 134,
    name: 'TICKET_1314: SecureStore master-key lifecycle, recovery, backup, and writer fencing',
    up: `
CREATE TABLE IF NOT EXISTS credentials (
  plugin_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  tier       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE secure_store_key (
  key_id           TEXT PRIMARY KEY,
  keyring_account  TEXT NOT NULL UNIQUE,
  key_fingerprint  TEXT NOT NULL,
  generation       INTEGER NOT NULL UNIQUE,
  lifecycle_status TEXT NOT NULL
    CHECK (lifecycle_status IN ('available', 'retired')),
  created_at       INTEGER NOT NULL,
  activated_at     INTEGER NOT NULL,
  retired_at       INTEGER,
  UNIQUE (key_id, generation)
);

CREATE TABLE secure_store_state (
  singleton_id            INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  store_id                TEXT NOT NULL UNIQUE,
  envelope_version        INTEGER NOT NULL CHECK (envelope_version IN (1, 2)),
  active_key_id           TEXT NOT NULL REFERENCES secure_store_key(key_id),
  active_generation       INTEGER NOT NULL,
  minimum_writer_protocol INTEGER NOT NULL CHECK (minimum_writer_protocol >= 1),
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (active_key_id, active_generation)
    REFERENCES secure_store_key(key_id, generation)
);

CREATE TRIGGER secure_store_state_key_available_insert
BEFORE INSERT ON secure_store_state
FOR EACH ROW
WHEN (SELECT lifecycle_status FROM secure_store_key WHERE key_id = NEW.active_key_id) <> 'available'
BEGIN
  SELECT RAISE(ABORT, 'active SecureStore key must be available');
END;

CREATE TRIGGER secure_store_state_key_available_update
BEFORE UPDATE OF active_key_id, active_generation ON secure_store_state
FOR EACH ROW
WHEN (SELECT lifecycle_status FROM secure_store_key WHERE key_id = NEW.active_key_id) <> 'available'
BEGIN
  SELECT RAISE(ABORT, 'active SecureStore key must be available');
END;

CREATE TRIGGER secure_store_active_key_cannot_retire
BEFORE UPDATE OF lifecycle_status ON secure_store_key
FOR EACH ROW
WHEN NEW.lifecycle_status = 'retired'
 AND EXISTS (
   SELECT 1 FROM secure_store_state
   WHERE active_key_id = OLD.key_id
 )
BEGIN
  SELECT RAISE(ABORT, 'active SecureStore key cannot be retired');
END;

CREATE TABLE secure_store_writer_lease (
  writer_id       TEXT PRIMARY KEY,
  process_kind    TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  build_id        TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  heartbeat_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);

CREATE TABLE credential_recovery_archive (
  recovery_id    TEXT PRIMARY KEY,
  plugin_id      TEXT NOT NULL,
  key            TEXT NOT NULL,
  value          TEXT NOT NULL,
  tier           INTEGER NOT NULL,
  health_state   TEXT NOT NULL,
  archived_at    INTEGER NOT NULL
);

CREATE TABLE secure_store_audit (
  audit_id       TEXT PRIMARY KEY,
  event_type     TEXT NOT NULL,
  key_id         TEXT,
  generation     INTEGER,
  detail         TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE secure_store_backup (
  backup_id      TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL,
  content_digest TEXT NOT NULL UNIQUE,
  created_at     INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('retained', 'removed'))
);

CREATE TABLE secure_store_backup_key (
  backup_id TEXT NOT NULL REFERENCES secure_store_backup(backup_id),
  key_id    TEXT NOT NULL,
  PRIMARY KEY (backup_id, key_id)
);

CREATE TABLE secure_store_lifecycle_journal (
  operation_id   TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  state          TEXT NOT NULL,
  key_ids_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(key_ids_json)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX idx_secure_store_writer_lease_expiry
  ON secure_store_writer_lease(expires_at);
CREATE INDEX idx_credential_recovery_archive_namespace
  ON credential_recovery_archive(plugin_id, key);
CREATE INDEX idx_secure_store_backup_key_key
  ON secure_store_backup_key(key_id);
`,
    down: `
DROP INDEX IF EXISTS idx_secure_store_backup_key_key;
DROP INDEX IF EXISTS idx_credential_recovery_archive_namespace;
DROP INDEX IF EXISTS idx_secure_store_writer_lease_expiry;
DROP TABLE IF EXISTS secure_store_lifecycle_journal;
DROP TABLE IF EXISTS secure_store_backup_key;
DROP TABLE IF EXISTS secure_store_backup;
DROP TABLE IF EXISTS secure_store_audit;
DROP TABLE IF EXISTS credential_recovery_archive;
DROP TABLE IF EXISTS secure_store_writer_lease;
DROP TRIGGER IF EXISTS secure_store_active_key_cannot_retire;
DROP TRIGGER IF EXISTS secure_store_state_key_available_update;
DROP TRIGGER IF EXISTS secure_store_state_key_available_insert;
DROP TABLE IF EXISTS secure_store_state;
DROP TABLE IF EXISTS secure_store_key;
`,
  },

  {
    version: 135,
    name: 'TICKET_1317: durable AI Studio workflow binding per subject and Guide conversation',
    up: `
CREATE TABLE ai_studio_workflow_binding (
  subject_id              TEXT NOT NULL,
  conversation_id         TEXT NOT NULL,
  session_id              TEXT NOT NULL,
  workflow_revision       INTEGER NOT NULL CHECK (workflow_revision >= 1),
  rules_hash              TEXT NOT NULL,
  strategy_rules_json     TEXT CHECK (strategy_rules_json IS NULL OR json_valid(strategy_rules_json)),
  available_actions_json  TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(available_actions_json)),
  expires_at              REAL NOT NULL DEFAULT 0,
  generated_artifact_hash TEXT,
  generated_class_name    TEXT,
  row_revision            INTEGER NOT NULL CHECK (row_revision >= 1),
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  PRIMARY KEY (subject_id, conversation_id)
);

CREATE INDEX idx_ai_studio_workflow_binding_session
  ON ai_studio_workflow_binding(session_id);
CREATE INDEX idx_ai_studio_workflow_binding_conversation
  ON ai_studio_workflow_binding(conversation_id);
`,
    down: `
DROP INDEX IF EXISTS idx_ai_studio_workflow_binding_conversation;
DROP INDEX IF EXISTS idx_ai_studio_workflow_binding_session;
DROP TABLE IF EXISTS ai_studio_workflow_binding;
`,
  },

  {
    version: 136,
    name: 'TICKET_1317: purge orphaned AI Studio bindings keyed by synthetic new:<turnId>',
    up: `
-- Bindings committed on the first turn of a new conversation were keyed by a
-- synthetic 'new:<turnId>' conversation id that no later turn could reproduce
-- (turnId is a fresh UUID per turn). Those rows are unreachable by every read
-- path: lookups use the real conversation id, so the rows can never be loaded,
-- resumed, or retired -- they only consume space and mask the real state.
-- They are irrecoverable rather than salvageable: the mapping from the synthetic
-- key back to the conversation it belonged to was never persisted anywhere.
DELETE FROM ai_studio_workflow_binding WHERE conversation_id LIKE 'new:%';
`,
    down: `
-- Irreversible by nature: the deleted rows were unreachable and their owning
-- conversation is unknowable, so there is nothing to restore them to.
`,
  },

  // ---------------------------------------------------------------------------
  // TICKET_1277_2 F2: make the model lineage a genuine namespace across BOTH
  // the filesystem manifest and the run table.
  //
  // TICKET_1000's lineage operations (Start Fresh / Restore Snapshot) touched
  // only the filesystem; `lstm_training_runs` was never reconciled. TICKET_1277
  // then began resolving champion provenance out of that table, so:
  //   - after Start Fresh, rows from the SUPERSEDED lineage still counted
  //     toward the anti-ratchet N, inflating epsilon_eff (AC7 became false as
  //     stated), and
  //   - after Restore Snapshot, the boundary was the restored champion's
  //     ORIGINAL completed_at, so every unrelated run completed since counted
  //     as an attempt stacked on it -- N inflated far enough to freeze the
  //     restored champion in place.
  //
  // `lineage_epoch` is written at enqueue from the manifest's current epoch, so
  // both TICKET_1277 queries can scope to a single lineage.
  //
  // Backfill is deliberately NULL, not 0: a SQL migration cannot see the
  // manifest, so it cannot know which epoch pre-existing rows belong to.
  // NULL means "lineage unknown", and the readers match a champion's epoch to
  // its challengers' (NULL matches NULL) -- a legacy champion keeps exactly its
  // pre-migration counting behaviour, while every run enqueued from here on is
  // correctly scoped. Guessing 0 would silently mis-scope a user already past
  // several Start Fresh cycles.
  // ---------------------------------------------------------------------------
  {
    version: 137,
    name: 'TICKET_1277_2: lineage_epoch on lstm_training_runs for lineage-scoped champion provenance',
    up: `
      ALTER TABLE lstm_training_runs ADD COLUMN lineage_epoch INTEGER;
      CREATE INDEX IF NOT EXISTS idx_lstm_training_lineage_epoch
        ON lstm_training_runs(lineage_epoch, status, completed_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_lstm_training_lineage_epoch;
      -- SQLite cannot drop columns
    `,
  },

  {
    version: 138,
    name: 'TICKET_1303_1_3: per-subject Agent runtime selection',
    // The Guide snapshot hard-coded `runtimeId: 'stratcraft'` and published a
    // single-element runtimes array, so the registered external runtime
    // adapters (acp, codex, github-copilot, claude-agent) could never be
    // selected or dispatched to. Runtime choice needs a durable per-subject
    // owner for the same reason the task selection has one: admission rebuilds
    // the selection from persisted state, not from renderer input.
    up: `
      CREATE TABLE agent_runtime_selection (
        subject_id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL CHECK (
          runtime_id IN ('stratcraft', 'acp', 'codex', 'github-copilot', 'claude-agent')
        ),
        selected_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    down: `
      DROP TABLE IF EXISTS agent_runtime_selection;
    `,
  },

  {
    version: 139,
    name: 'TICKET_1335: factor_engine_registry owns catalog state only, never Python package identity',
    // Root cause (TICKET_1335 D2 + D2 gap 3): `pandas-ta` had two live install
    // authorities -- the locked `pixi.toml`/`pixi.lock` manifest and an ambient
    // `pip install ${python_package}` driven by this table. Worse, `installed`
    // recorded a *second readiness truth* that never agreed with the locked
    // interpreter's import probe, which is why TICKET_1335_1 AC15 ("the
    // pandas-ta card is the only surface reporting pandas-ta readiness") was
    // structurally unsatisfiable rather than merely unimplemented.
    //
    // Two column changes, one concept: this table describes factor *catalogs*,
    // so `python_package` is removed outright (the locked manifest is the sole
    // package owner) and `installed` becomes `catalog_active` so no reader can
    // mistake catalog seeding for dependency readiness. The rename is the point
    // -- keeping the name `installed` would preserve the exact conflation the
    // root cause names, even with the package column gone.
    //
    // Rebuilt rather than ALTER-dropped: DROP COLUMN requires SQLite 3.35+ and
    // cannot rename in the same statement, and the 12-step rebuild is the
    // documented safe form. Migration 18 stays immutable as history.
    up: `
      CREATE TABLE factor_engine_registry_new (
        engine_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT,
        factor_count INTEGER NOT NULL DEFAULT 0,
        examples TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        catalog_active INTEGER NOT NULL DEFAULT 0,
        version TEXT,
        activated_at TEXT
      );
      INSERT INTO factor_engine_registry_new (
        engine_id, display_name, description, factor_count, examples,
        builtin, catalog_active, version, activated_at
      )
      SELECT
        engine_id, display_name, description, factor_count, examples,
        builtin, installed, version, installed_at
      FROM factor_engine_registry;
      DROP TABLE factor_engine_registry;
      ALTER TABLE factor_engine_registry_new RENAME TO factor_engine_registry;
    `,
    // Reversal restores the columns but deliberately writes NULL for
    // python_package. Re-deriving 'pandas-ta' here would recreate the dual
    // authority this migration exists to remove, and the value is recoverable
    // from migration 18 if a historical replay ever needs it.
    down: `
      CREATE TABLE factor_engine_registry_old (
        engine_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT,
        python_package TEXT,
        factor_count INTEGER NOT NULL DEFAULT 0,
        examples TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        installed INTEGER NOT NULL DEFAULT 0,
        version TEXT,
        installed_at TEXT
      );
      INSERT INTO factor_engine_registry_old (
        engine_id, display_name, description, python_package, factor_count,
        examples, builtin, installed, version, installed_at
      )
      SELECT
        engine_id, display_name, description, NULL, factor_count,
        examples, builtin, catalog_active, version, activated_at
      FROM factor_engine_registry;
      DROP TABLE factor_engine_registry;
      ALTER TABLE factor_engine_registry_old RENAME TO factor_engine_registry;
    `,
  },

  {
    version: 140,
    name: 'TICKET_1335: durable research_environment_jobs with single-active-owner enforcement',
    // Root cause (TICKET_1335 D4): a Pixi materialization runs for minutes and
    // may be requested from Electron, the headless runtime, the Service API, or
    // MCP. Without one durable owner of job truth, each surface keeps a private
    // in-memory registry, so two installers can run concurrently against the
    // same `.pixi` directory and a renderer reload loses the job entirely
    // (TICKET_1335 AC6/AC10, TICKET_1335_1 AC6).
    //
    // The canonical application SQLite database is that owner. The substrate is
    // pre-existing, not introduced here: db-manager.ts opens it with
    // journal_mode=WAL, foreign_keys=ON, and a busy_timeout, and the standalone
    // MCP process opens the same file, so multi-process WAL access is already a
    // property of this layer.
    //
    // `at_most_one_active_job` is the enforcement, not a convention. A partial
    // unique index over the *profile* restricted to non-terminal states means a
    // second admission attempt fails at the database rather than relying on the
    // advisory lock alone -- defence at the layer that owns the invariant. The
    // terminal states are deliberately excluded so history accumulates.
    //
    // `owner_instance_id` is a random per-run identifier, NOT a PID. TICKET_1335
    // D4 forbids PID as ownership proof because PID reuse after a crash would
    // let an unrelated process inherit a dead owner's claim; `owner_pid` is
    // retained as diagnostics only and is never read to authorize recovery.
    up: `
      CREATE TABLE IF NOT EXISTS research_environment_jobs (
        job_id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('install', 'repair', 'verify')),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
        current_stage TEXT CHECK (current_stage IN (
          'admission', 'install', 'repair', 'python_verify', 'julia_verify'
        )),
        manifest_sha256 TEXT NOT NULL,
        lock_sha256 TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL,
        owner_pid INTEGER,
        heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        result_json TEXT,
        failure_json TEXT,
        log_tail TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS at_most_one_active_job
        ON research_environment_jobs (profile)
        WHERE state IN ('queued', 'running');
      CREATE INDEX IF NOT EXISTS idx_research_env_jobs_created
        ON research_environment_jobs (profile, created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_research_env_jobs_created;
      DROP INDEX IF EXISTS at_most_one_active_job;
      DROP TABLE IF EXISTS research_environment_jobs;
    `,
  },

  {
    version: 141,
    name: 'TICKET_661_1: additive legacy-strategy migration schema (inventory snapshot, attempts, lineage)',
    // TICKET_661_1 section 5.2: these owner tables install BEFORE any archive
    // work, so every step that cannot join a database transaction (archive
    // publication, compilation) has somewhere durable to record its outcome.
    // Installing them is explicitly NOT a mutation of the immutable original
    // saved-strategy payload: nothing here alters `nona_algorithms` or
    // `nona_signal`, which is why the whole schema is additive.
    //
    // Section 5.1 splits what the old design collapsed into one "language"
    // column into three INDEPENDENT axes, and the CHECK constraints are the
    // enforcement rather than a convention:
    //   resolved_language     -- cpp | python | ambiguous
    //   execution_readiness   -- unvalidated | valid | compiled | admitted | blocked
    //   semantic_equivalence  -- unassessed | parity_verified |
    //                            accepted_without_parity | failed | not_applicable
    // `resolved_language == 'cpp'` alone never authorizes execution; only
    // `execution_readiness == 'admitted'` does. `ambiguous` is terminal and can
    // never be silently downgraded to cpp -- section 3.1 recorded the inverted
    // form of that rule as the live P0 defect.
    //
    // `record_parent_kind` is load-bearing, not descriptive (section 3.2). The
    // executable surface is the `v_algorithms_all` view --
    // `nona_algorithms UNION ALL nona_signal` -- and the 2026-08-01 re-census
    // found 12,560 active signal rows against 65 algorithm rows, over 99% of
    // them Python. Sections 5.1.1 and 7 assign those research artifacts to
    // TICKET_1292_21 and bar this policy from rewriting or removing them, so
    // the capability class is persisted per record and the archive path is
    // constrained to 'algorithm' at the schema level. Without this column an
    // inventory would stage 12,556 archive records for a class this ticket does
    // not own.
    //
    // Section 5.1.1 requires DB `code` and the `file_path` attachment to be
    // hashed SEPARATELY and neither to be silently authoritative: the run path
    // already chooses between them conditionally, so a record can carry two
    // different bodies. Two distinct hash columns is what makes the AC-2
    // "byte-exact" recheck able to fail on either side independently; a single
    // merged hash could not.
    //
    // `idempotency_key` derives from source identity + source hash + archive
    // manifest hash (section 5.3.1). The partial unique index restricted to
    // non-terminal states is what makes AC-7 restart-safety structural: a
    // recovery pass that re-drives an interrupted attempt cannot create a second
    // live attempt for the same key, so retrying a completed attempt is a no-op
    // rather than a duplicate replacement.
    up: `
      CREATE TABLE IF NOT EXISTS strategy_migration_snapshot (
        snapshot_id TEXT NOT NULL,
        record_id INTEGER NOT NULL,
        record_parent_kind TEXT NOT NULL CHECK (record_parent_kind IN ('algorithm', 'signal')),
        record_version INTEGER,
        record_update_time TEXT,
        record_deleted INTEGER NOT NULL DEFAULT 0,
        resolved_language TEXT NOT NULL CHECK (
          resolved_language IN ('cpp', 'python', 'ambiguous')
        ),
        execution_readiness TEXT CHECK (
          execution_readiness IN ('unvalidated', 'valid', 'compiled', 'admitted', 'blocked')
        ),
        semantic_equivalence TEXT CHECK (
          semantic_equivalence IN (
            'unassessed', 'parity_verified', 'accepted_without_parity',
            'failed', 'not_applicable'
          )
        ),
        db_code_sha256 TEXT,
        attachment_path TEXT,
        attachment_sha256 TEXT,
        attachment_missing INTEGER NOT NULL DEFAULT 0,
        classifier_version INTEGER NOT NULL,
        classification_evidence_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, record_id, record_parent_kind)
      );
      CREATE INDEX IF NOT EXISTS idx_strategy_migration_snapshot_language
        ON strategy_migration_snapshot (snapshot_id, record_parent_kind, resolved_language);

      CREATE TABLE IF NOT EXISTS strategy_migration_attempt (
        attempt_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        source_record_id INTEGER NOT NULL,
        source_parent_kind TEXT NOT NULL CHECK (source_parent_kind = 'algorithm'),
        state TEXT NOT NULL CHECK (state IN (
          'inventoried', 'archive_staged', 'archive_published',
          'candidate_committed', 'admitted', 'failed', 'cancelled'
        )),
        source_db_code_sha256 TEXT,
        source_attachment_sha256 TEXT,
        archive_manifest_sha256 TEXT,
        archive_staging_path TEXT,
        archive_published_path TEXT,
        replacement_record_id INTEGER,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS at_most_one_live_migration_attempt
        ON strategy_migration_attempt (idempotency_key)
        WHERE state NOT IN ('failed', 'cancelled', 'admitted');
      CREATE INDEX IF NOT EXISTS idx_strategy_migration_attempt_source
        ON strategy_migration_attempt (source_record_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS strategy_migration_lineage (
        replacement_record_id INTEGER NOT NULL PRIMARY KEY,
        source_record_id INTEGER NOT NULL,
        attempt_id TEXT NOT NULL,
        source_db_code_sha256 TEXT,
        source_attachment_sha256 TEXT,
        archive_manifest_sha256 TEXT,
        generation_provider TEXT,
        generation_model TEXT,
        migrated_at TEXT NOT NULL,
        accepted_by TEXT,
        accepted_at TEXT,
        FOREIGN KEY (attempt_id) REFERENCES strategy_migration_attempt (attempt_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_replacement_per_source
        ON strategy_migration_lineage (source_record_id);
    `,
    down: `
      DROP INDEX IF EXISTS one_replacement_per_source;
      DROP TABLE IF EXISTS strategy_migration_lineage;
      DROP INDEX IF EXISTS idx_strategy_migration_attempt_source;
      DROP INDEX IF EXISTS at_most_one_live_migration_attempt;
      DROP TABLE IF EXISTS strategy_migration_attempt;
      DROP INDEX IF EXISTS idx_strategy_migration_snapshot_language;
      DROP TABLE IF EXISTS strategy_migration_snapshot;
    `,
  },

  {
    version: 142,
    name: 'TICKET_1355: add research environment uninstall lifecycle values',
    up: `
      DROP INDEX IF EXISTS idx_research_env_jobs_created;
      DROP INDEX IF EXISTS at_most_one_active_job;
      ALTER TABLE research_environment_jobs RENAME TO research_environment_jobs_v140;
      CREATE TABLE research_environment_jobs (
        job_id TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('install', 'repair', 'verify', 'uninstall')),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
        current_stage TEXT CHECK (current_stage IN (
          'admission', 'install', 'repair', 'uninstall', 'python_verify', 'julia_verify'
        )),
        manifest_sha256 TEXT NOT NULL,
        lock_sha256 TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL,
        owner_pid INTEGER,
        heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        result_json TEXT,
        failure_json TEXT,
        log_tail TEXT
      );
      INSERT INTO research_environment_jobs SELECT * FROM research_environment_jobs_v140;
      DROP TABLE research_environment_jobs_v140;
      CREATE UNIQUE INDEX at_most_one_active_job
        ON research_environment_jobs (profile) WHERE state IN ('queued', 'running');
      CREATE INDEX idx_research_env_jobs_created
        ON research_environment_jobs (profile, created_at DESC);
    `,
    down: `
      DELETE FROM research_environment_jobs WHERE operation = 'uninstall';
      DROP INDEX IF EXISTS idx_research_env_jobs_created;
      DROP INDEX IF EXISTS at_most_one_active_job;
      ALTER TABLE research_environment_jobs RENAME TO research_environment_jobs_v142;
      CREATE TABLE research_environment_jobs (
        job_id TEXT PRIMARY KEY, profile TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('install', 'repair', 'verify')),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
        current_stage TEXT CHECK (current_stage IN ('admission', 'install', 'repair', 'python_verify', 'julia_verify')),
        manifest_sha256 TEXT NOT NULL, lock_sha256 TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL, owner_pid INTEGER, heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        result_json TEXT, failure_json TEXT, log_tail TEXT
      );
      INSERT INTO research_environment_jobs SELECT * FROM research_environment_jobs_v142;
      DROP TABLE research_environment_jobs_v142;
      CREATE UNIQUE INDEX at_most_one_active_job
        ON research_environment_jobs (profile) WHERE state IN ('queued', 'running');
      CREATE INDEX idx_research_env_jobs_created
        ON research_environment_jobs (profile, created_at DESC);
    `,
  },

  {
    version: 143,
    name: 'TICKET_1355_1: add locked capability projection transitions',
    up: `
      DROP INDEX IF EXISTS idx_research_env_jobs_created;
      DROP INDEX IF EXISTS at_most_one_active_job;
      ALTER TABLE research_environment_jobs RENAME TO research_environment_jobs_v142;
      CREATE TABLE research_environment_jobs (
        job_id TEXT PRIMARY KEY, profile TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN (
          'install', 'repair', 'verify', 'uninstall', 'remove_capability', 'restore_capability'
        )),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
        current_stage TEXT CHECK (current_stage IN (
          'admission', 'install', 'repair', 'uninstall', 'transition', 'python_verify', 'julia_verify'
        )),
        manifest_sha256 TEXT NOT NULL, lock_sha256 TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL, owner_pid INTEGER, heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        result_json TEXT, failure_json TEXT, log_tail TEXT
      );
      INSERT INTO research_environment_jobs SELECT * FROM research_environment_jobs_v142;
      DROP TABLE research_environment_jobs_v142;
      CREATE UNIQUE INDEX at_most_one_active_job
        ON research_environment_jobs (profile) WHERE state IN ('queued', 'running');
      CREATE INDEX idx_research_env_jobs_created
        ON research_environment_jobs (profile, created_at DESC);
    `,
    down: `
      DELETE FROM research_environment_jobs
        WHERE operation IN ('remove_capability', 'restore_capability');
      DROP INDEX IF EXISTS idx_research_env_jobs_created;
      DROP INDEX IF EXISTS at_most_one_active_job;
      ALTER TABLE research_environment_jobs RENAME TO research_environment_jobs_v143;
      CREATE TABLE research_environment_jobs (
        job_id TEXT PRIMARY KEY, profile TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('install', 'repair', 'verify', 'uninstall')),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
        current_stage TEXT CHECK (current_stage IN (
          'admission', 'install', 'repair', 'uninstall', 'python_verify', 'julia_verify'
        )),
        manifest_sha256 TEXT NOT NULL, lock_sha256 TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL, owner_pid INTEGER, heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        result_json TEXT, failure_json TEXT, log_tail TEXT
      );
      INSERT INTO research_environment_jobs SELECT * FROM research_environment_jobs_v143;
      DROP TABLE research_environment_jobs_v143;
      CREATE UNIQUE INDEX at_most_one_active_job
        ON research_environment_jobs (profile) WHERE state IN ('queued', 'running');
      CREATE INDEX idx_research_env_jobs_created
        ON research_environment_jobs (profile, created_at DESC);
    `,
  },

  {
    version: 144,
    name: 'TICKET_1355_1: backfill projection in persisted research environment results',
    up: `
      UPDATE research_environment_jobs
      SET result_json = json_set(result_json, '$.projection', 'default')
      WHERE result_json IS NOT NULL
        AND json_valid(result_json)
        AND json_type(result_json) = 'object'
        AND json_type(result_json, '$.projection') IS NULL;
    `,
    down: `
      UPDATE research_environment_jobs
      SET result_json = json_remove(result_json, '$.projection')
      WHERE result_json IS NOT NULL
        AND json_valid(result_json)
        AND json_type(result_json) = 'object'
        AND operation IN ('install', 'repair', 'verify', 'uninstall')
        AND json_extract(result_json, '$.projection') = 'default';
    `,
  },

  {
    version: 145,
    name: 'TICKET_1355_1: durable active research environment projection',
    up: `
      CREATE TABLE research_environment_active_projection (
        profile TEXT PRIMARY KEY,
        projection TEXT NOT NULL CHECK (projection IN ('default', 'without-gpquant')),
        status_json TEXT NOT NULL CHECK (json_valid(status_json)),
        pending_cleanup_projection TEXT CHECK (
          pending_cleanup_projection IS NULL
          OR pending_cleanup_projection IN ('default', 'without-gpquant')
        ),
        published_by_job_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (published_by_job_id) REFERENCES research_environment_jobs(job_id)
      );

      INSERT INTO research_environment_active_projection
        (profile, projection, status_json, pending_cleanup_projection,
         published_by_job_id, updated_at)
      SELECT profile,
             COALESCE(json_extract(result_json, '$.projection'), 'default'),
             result_json,
             NULL,
             job_id,
             COALESCE(finished_at, heartbeat_at)
      FROM research_environment_jobs AS candidate
      WHERE state = 'succeeded'
        AND result_json IS NOT NULL
        AND json_valid(result_json)
        AND rowid = (
          SELECT rowid FROM research_environment_jobs AS latest
          WHERE latest.profile = candidate.profile
            AND latest.state = 'succeeded'
            AND latest.result_json IS NOT NULL
            AND json_valid(latest.result_json)
          ORDER BY latest.created_at DESC, latest.rowid DESC
          LIMIT 1
        );
    `,
    down: `DROP TABLE IF EXISTS research_environment_active_projection;`,
  },

  {
    version: 146,
    name: 'TICKET_1355_2C: durable conversation job observation binding',
    up: `
      CREATE TABLE research_environment_job_observations (
        conversation_id INTEGER NOT NULL,
        originating_turn_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        job_id TEXT NOT NULL PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN (
          'install', 'repair', 'verify', 'uninstall',
          'remove_capability', 'restore_capability'
        )),
        mcp_session_id TEXT NOT NULL,
        observation_state TEXT NOT NULL CHECK (
          observation_state IN ('observing', 'terminal', 'retired')
        ),
        last_seen_revision INTEGER NOT NULL DEFAULT 0 CHECK (last_seen_revision >= 0),
        last_job_snapshot TEXT CHECK (
          last_job_snapshot IS NULL OR json_valid(last_job_snapshot)
        ),
        terminal_presentation_state TEXT NOT NULL DEFAULT 'pending' CHECK (
          terminal_presentation_state IN ('pending', 'presented')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES nona_ai_conversations(id)
          ON DELETE CASCADE,
        FOREIGN KEY (job_id) REFERENCES research_environment_jobs(job_id)
      );
      CREATE UNIQUE INDEX research_environment_observation_tool_call
        ON research_environment_job_observations
          (conversation_id, originating_turn_id, tool_call_id);
      CREATE INDEX research_environment_observation_state
        ON research_environment_job_observations
          (observation_state, updated_at);
    `,
    down: `
      DROP INDEX IF EXISTS research_environment_observation_state;
      DROP INDEX IF EXISTS research_environment_observation_tool_call;
      DROP TABLE IF EXISTS research_environment_job_observations;
    `,
  },

  {
    version: 147,
    name: 'TICKET_1361 P2: corrective layer storage',
    up: `
      CREATE TABLE corrective_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'disabled' CHECK (
          state IN ('disabled', 'collect_only', 'enabled')
        ),
        provider TEXT NOT NULL DEFAULT 'builtin_gbdt' CHECK (provider = 'builtin_gbdt'),
        mode TEXT NOT NULL DEFAULT 'gate' CHECK (
          mode IN ('gate', 'sizing', 'hybrid')
        ),
        threshold REAL NOT NULL DEFAULT 0.5 CHECK (
          threshold >= 0.0 AND threshold <= 1.0
        ),
        sizing_exponent REAL NOT NULL DEFAULT 1.0 CHECK (
          sizing_exponent >= 0.1 AND sizing_exponent <= 5.0
        ),
        sizing_policy_id TEXT NOT NULL DEFAULT 'gate' CHECK (
          sizing_policy_id IN ('gate', 'sizing', 'hybrid')
        ),
        model_artifact_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO corrective_config (id) VALUES (1);

      CREATE TABLE corrective_candidates (
        run_id TEXT NOT NULL,
        candidate_id INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        strategy_artifact_id TEXT NOT NULL,
        model_artifact_id TEXT,
        as_of_timestamp_ns INTEGER NOT NULL,
        knowledge_cutoff_timestamp_ns INTEGER NOT NULL,
        symbol_id TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('long', 'short')),
        proposed_size REAL NOT NULL CHECK (proposed_size >= 0),
        final_size REAL NOT NULL CHECK (final_size >= 0),
        size_unit TEXT NOT NULL DEFAULT 'shares',
        feature_vector TEXT NOT NULL CHECK (json_valid(feature_vector)),
        feature_schema_hash TEXT NOT NULL,
        feature_schema_version INTEGER NOT NULL DEFAULT 1,
        gate_verdict TEXT NOT NULL CHECK (
          gate_verdict IN ('pass', 'reject', 'collect_only', 'disabled')
        ),
        calibrated_probability REAL,
        sizing_policy_id TEXT,
        reason_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (run_id, candidate_id)
      );
      CREATE INDEX corrective_candidates_run ON corrective_candidates (run_id);
      CREATE INDEX corrective_candidates_symbol ON corrective_candidates (symbol_id);
      CREATE INDEX corrective_candidates_ts ON corrective_candidates (as_of_timestamp_ns);

      CREATE TABLE corrective_outcomes (
        run_id TEXT NOT NULL,
        candidate_id INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        outcome_type TEXT NOT NULL CHECK (
          outcome_type IN ('actual', 'shadow', 'censored')
        ),
        entry_timestamp_ns INTEGER NOT NULL,
        exit_timestamp_ns INTEGER,
        holding_interval_bars INTEGER NOT NULL DEFAULT 0,
        gross_pnl REAL NOT NULL DEFAULT 0,
        commission REAL NOT NULL DEFAULT 0,
        slippage REAL NOT NULL DEFAULT 0,
        net_pnl REAL NOT NULL DEFAULT 0,
        completion_status TEXT NOT NULL DEFAULT 'complete' CHECK (
          completion_status IN ('complete', 'censored')
        ),
        label_policy_version INTEGER NOT NULL DEFAULT 1,
        profit_label INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (run_id, candidate_id),
        FOREIGN KEY (run_id, candidate_id) REFERENCES corrective_candidates (run_id, candidate_id)
      );

      CREATE TABLE corrective_training_jobs (
        job_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (
          state IN ('queued', 'running', 'completed', 'failed', 'cancelled')
        ),
        provider TEXT NOT NULL DEFAULT 'builtin_gbdt',
        config TEXT NOT NULL CHECK (json_valid(config)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        started_at TEXT,
        completed_at TEXT,
        artifact_id TEXT,
        error_code TEXT,
        error_message TEXT
      );
      CREATE INDEX corrective_training_jobs_state ON corrective_training_jobs (state);

      CREATE TABLE corrective_artifacts (
        artifact_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1,
        model_format TEXT NOT NULL DEFAULT 'onnx' CHECK (model_format = 'onnx'),
        model_filename TEXT NOT NULL,
        calibration_params TEXT NOT NULL CHECK (json_valid(calibration_params)),
        feature_manifest TEXT NOT NULL CHECK (json_valid(feature_manifest)),
        feature_schema_hash TEXT NOT NULL,
        feature_schema_version INTEGER NOT NULL DEFAULT 1,
        schema_version_str TEXT NOT NULL,
        trainer_version TEXT NOT NULL,
        label_policy_version INTEGER NOT NULL DEFAULT 1,
        sizing_policy_version INTEGER NOT NULL DEFAULT 1,
        training_window TEXT NOT NULL CHECK (json_valid(training_window)),
        validation_window TEXT NOT NULL CHECK (json_valid(validation_window)),
        metrics TEXT NOT NULL CHECK (json_valid(metrics)),
        minimum_sample_evidence TEXT NOT NULL CHECK (json_valid(minimum_sample_evidence)),
        golden_vector TEXT NOT NULL CHECK (json_valid(golden_vector)),
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE corrective_comparisons (
        comparison_id TEXT PRIMARY KEY,
        baseline_run_id TEXT NOT NULL,
        corrective_run_id TEXT NOT NULL,
        strategy_artifact_id TEXT NOT NULL,
        model_artifact_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('gate', 'sizing', 'hybrid')),
        threshold REAL NOT NULL,
        baseline_metrics TEXT NOT NULL CHECK (json_valid(baseline_metrics)),
        corrective_metrics TEXT NOT NULL CHECK (json_valid(corrective_metrics)),
        holdout_metrics TEXT CHECK (holdout_metrics IS NULL OR json_valid(holdout_metrics)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `,
    down: `
      DROP TABLE IF EXISTS corrective_comparisons;
      DROP TABLE IF EXISTS corrective_artifacts;
      DROP TABLE IF EXISTS corrective_training_jobs;
      DROP INDEX IF EXISTS corrective_candidates_ts;
      DROP INDEX IF EXISTS corrective_candidates_symbol;
      DROP INDEX IF EXISTS corrective_candidates_run;
      DROP TABLE IF EXISTS corrective_outcomes;
      DROP TABLE IF EXISTS corrective_candidates;
      DROP TABLE IF EXISTS corrective_config;
    `,
  },

];

// TICKET_950: test-only export of the migration array. Test callers must
// treat it as read-only; mutating it pollutes production state in the same
// process. Named with the `_FOR_TEST` suffix so production code cannot use
// it by accident.
export const EMBEDDED_MIGRATIONS_FOR_TEST: ReadonlyArray<Migration> = EMBEDDED_MIGRATIONS;

/**
 * MigrationManager - Version-controlled database migrations.
 *
 * Drives EMBEDDED_MIGRATIONS through the apply loop. Shared by Electron main
 * and the standalone MCP server (TICKET_1289_1 F1) -- the caller must install a
 * MigrationHost via setMigrationHost() before calling migrate()/rollback().
 *
 * Features:
 * - Embedded migration array (single source of truth; no file I/O)
 * - UP/DOWN migration support
 * - One outer .immediate transaction per pending batch + a locked version
 *   re-read, so concurrent first-start on a shared DB is serialized (AC7)
 * - Schema version tracking in the `schema_version` table
 */
export class MigrationManager {
  constructor(private db: MigrationDb) {}

  /**
   * Get current schema version from database
   */
  private getCurrentVersion(): number {
    try {
      const stmt = this.db.prepare('SELECT MAX(version) as version FROM schema_version');
      const result = stmt.get() as { version: number | null } | undefined;
      return result?.version || 0;
    } catch {
      // Table doesn't exist yet - create it
      dbLog.info('[MigrationManager] schema_version table not found, creating...');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      return 0;
    }
  }

  /**
   * Load embedded migrations (no file I/O needed)
   */
  private loadMigrations(): Migration[] {
    dbLog.info(`[MigrationManager] Using ${EMBEDDED_MIGRATIONS.length} embedded migrations`);
    return EMBEDDED_MIGRATIONS.sort((a, b) => a.version - b.version);
  }

  /**
   * TICKET_580_5: Get the number of pending migrations (for pre-migration backup decision).
   */
  getPendingCount(): number {
    const currentVersion = this.getCurrentVersion();
    return this.loadMigrations().filter(m => m.version > currentVersion).length;
  }

  /**
   * Run all pending migrations (UP)
   *
   * Executes migrations in version order, skipping already applied ones.
   */
  async migrate(): Promise<void> {
    // TICKET_1289_1 AC7: two hosts (Electron main + standalone MCP) may point at
    // the SAME DB and race a first-start. The DEFERRED transaction the original
    // code used does NOT take a write lock until its first write, so both could
    // read version 0, both begin, and duplicate-apply. Serialize on the SQLite
    // write lock instead:
    //   1. busy_timeout so the loser WAITS for the RESERVED lock (not SQLITE_BUSY);
    //   2. the pending batch runs under a single IMMEDIATE transaction (BEGIN
    //      IMMEDIATE takes the RESERVED lock up front);
    //   3. the pending set is (re-)computed INSIDE that immediate transaction,
    //      so the loser -- which only enters after the winner commits -- sees
    //      the current version and no-ops.
    this.db.pragma(`busy_timeout = ${MIGRATION_LOCK_BUSY_TIMEOUT_MS}`);

    // Pre-lock read only decides whether to bother acquiring the write lock.
    const preLockVersion = this.getCurrentVersion();
    const preLockPending = this.loadMigrations().filter(m => m.version > preLockVersion);
    if (preLockPending.length === 0) {
      dbLog.info('[MigrationManager] No pending migrations');
      return;
    }

    dbLog.info(
      `[MigrationManager] ${preLockPending.length} pending migration(s); acquiring write lock...`,
    );

    // Post-commit hooks are collected from whatever the immediate transaction
    // actually applied (empty if this host lost the race and no-oped).
    let appliedMigrations: Migration[] = [];

    try {
      this.db.transactionImmediate(() => {
        // Re-read UNDER the write lock. If the race winner already migrated,
        // this host sees the current version and applies nothing (clean no-op).
        const lockedVersion = this.getCurrentVersion();
        const migrations = this.loadMigrations().filter(m => m.version > lockedVersion);
        appliedMigrations = migrations;

        if (migrations.length === 0) {
          dbLog.info(
            '[MigrationManager] Another process already applied the pending ' +
              'migrations while we waited for the lock; nothing to do.',
          );
          return;
        }

        dbLog.info(`[MigrationManager] Running ${migrations.length} pending migration(s)...`);

        for (const migration of migrations) {
          dbLog.info(
            `[MigrationManager] Applying migration ${migration.version}: ${migration.name}`
          );

          try {
            if (migration.preflight) {
              migration.preflight(this.db);
            }
            if (typeof migration.up === 'function') {
              migration.up(this.db);
            } else {
              this.db.exec(migration.up);
            }

            // Record migration in schema_version table
            this.db
              .prepare('INSERT INTO schema_version (version) VALUES (?)')
              .run(migration.version);

            dbLog.info(
              `[MigrationManager] Migration ${migration.version} applied successfully`
            );
          } catch (error) {
            dbLog.error(
              `[MigrationManager] Failed to apply migration ${migration.version}:`,
              error
            );
            throw new Error(
              `Migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      })();

      // TICKET_947_3: post-commit hooks run AFTER the outer transaction
      // commits. v96 uses this for `VACUUM` -- SQLite refuses VACUUM
      // inside a transaction, and the table DROP only reclaims free
      // pages once VACUUM rebuilds the file. A post-commit failure does
      // not roll back the schema change (it is already durable); we log
      // and continue so subsequent migrations are not blocked.
      // Iterates only what THIS host actually applied (empty if it lost the
      // AC7 race and no-oped inside the immediate transaction).
      for (const migration of appliedMigrations) {
        if (!migration.postCommit) continue;
        try {
          dbLog.info(
            `[MigrationManager] Running post-commit hook for migration ${migration.version}`
          );
          migration.postCommit(this.db);
          dbLog.info(
            `[MigrationManager] Post-commit hook for migration ${migration.version} completed`
          );
        } catch (error) {
          dbLog.error(
            `[MigrationManager] Post-commit hook for migration ${migration.version} failed (schema change is already durable):`,
            error
          );
        }
      }

      dbLog.info('[MigrationManager] All migrations completed successfully');
    } catch (error) {
      dbLog.error('[MigrationManager] Migration failed:', error);
      throw error;
    }
  }

  /**
   * Rollback to specific version (DOWN)
   *
   * Executes DOWN migrations in reverse order.
   *
   * @param targetVersion - Version to rollback to (exclusive)
   */
  async rollback(targetVersion: number): Promise<void> {
    const currentVersion = this.getCurrentVersion();

    if (targetVersion >= currentVersion) {
      throw new Error(
        `Cannot rollback: target version ${targetVersion} must be less than current version ${currentVersion}`
      );
    }

    const migrations = this.loadMigrations()
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version); // Reverse order for rollback

    if (migrations.length === 0) {
      dbLog.info('[MigrationManager] No migrations to rollback');
      return;
    }

    dbLog.info(`[MigrationManager] Rolling back ${migrations.length} migration(s)...`);

    try {
      this.db.transaction(() => {
        for (const migration of migrations) {
          dbLog.info(
            `[MigrationManager] Rolling back migration ${migration.version}: ${migration.name}`
          );

          if (!migration.down || migration.down.trim().length === 0) {
            throw new Error(
              `Migration ${migration.version} has no DOWN migration defined. Cannot rollback.`
            );
          }

          try {
            this.db.exec(migration.down);

            // Remove from schema_version table
            this.db
              .prepare('DELETE FROM schema_version WHERE version = ?')
              .run(migration.version);

            dbLog.info(
              `[MigrationManager] Migration ${migration.version} rolled back successfully`
            );
          } catch (error) {
            dbLog.error(
              `[MigrationManager] Failed to rollback migration ${migration.version}:`,
              error
            );
            throw new Error(
              `Rollback of migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      })();

      dbLog.info('[MigrationManager] Rollback completed successfully');
    } catch (error) {
      dbLog.error('[MigrationManager] Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  getStatus(): {
    currentVersion: number;
    availableMigrations: number;
    pendingMigrations: number;
    migrations: Array<{ version: number; name: string; applied: boolean }>;
  } {
    const currentVersion = this.getCurrentVersion();
    const migrations = this.loadMigrations();

    return {
      currentVersion,
      availableMigrations: migrations.length,
      pendingMigrations: migrations.filter(m => m.version > currentVersion).length,
      migrations: migrations.map(m => ({
        version: m.version,
        name: m.name,
        applied: m.version <= currentVersion,
      })),
    };
  }

  /**
   * Check if migrations are needed
   */
  hasPendingMigrations(): boolean {
    const currentVersion = this.getCurrentVersion();
    const migrations = this.loadMigrations();
    return migrations.some(m => m.version > currentVersion);
  }
}
