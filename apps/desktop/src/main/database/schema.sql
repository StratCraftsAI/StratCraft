-- =======================================================================================
-- StratCraft Desktop Framework Schema - INFRASTRUCTURE ONLY
-- SQLite 3.38+
-- See: TICKET_110_PLUGIN_DATABASE_INFRASTRUCTURE.md
-- =======================================================================================
--
-- ARCHITECTURE PRINCIPLE:
-- Framework provides API, Plugins provide Logic (CLAUDE.md)
--
-- This schema contains ONLY infrastructure tables.
-- Business tables (algorithms, factors, etc.) belong in PLUGINS.
--
-- =======================================================================================

-- =======================================================================================
-- Schema Version Tracking
-- Purpose: Track applied migrations (required by MigrationManager)
-- =======================================================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert initial version
INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- =======================================================================================
-- SQLite Optimizations
-- =======================================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
-- mmap_size set dynamically by DatabaseManager.computeMmapSize() (TICKET_1099)

-- =======================================================================================
-- END OF FRAMEWORK SCHEMA
--
-- Business tables (algorithms, factors, backtests, etc.) are defined in plugins:
-- - plugins/algorithm-editor/database/schema/algorithms.sql
-- - plugins/factor-library/database/schema/factors.sql
-- - plugins/backtest-engine/database/schema/backtests.sql
--
-- Each plugin has its own isolated database file (plugin.db)
-- =======================================================================================
