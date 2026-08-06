-- =======================================================================================
-- Algorithm Editor Plugin - Initial Schema
-- Based on WordPress nona_algorithms table, adapted for plugin architecture
-- =======================================================================================

-- UP MIGRATION

CREATE TABLE IF NOT EXISTS algorithms (
  -- Primary Key
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Strategy Content
  code TEXT NOT NULL,
  file_path TEXT,
  strategy_name TEXT,
  description TEXT,

  -- Classification
  strategy_type INTEGER DEFAULT 0 CHECK(strategy_type BETWEEN 0 AND 9),
  -- 0: all type, 1: trend, 2: bond, 3: shock, 4: breakout,
  -- 5: arbitrage, 6: grid, 7: precondition, 8: indicator, 9: custom

  classification_metadata TEXT,  -- JSON format
  record_type TEXT DEFAULT 'strategy' CHECK(record_type IN ('indicator', 'strategy')),
  category TEXT,  -- talib, freqtrade, custom
  metadata TEXT,  -- JSON: algorithm metadata

  -- Performance
  pnl TEXT DEFAULT '0.00',  -- TEXT to avoid REAL precision issues

  -- Ownership & Status
  user_id TEXT,
  is_system INTEGER DEFAULT 0 CHECK(is_system IN (0, 1)),
  status INTEGER DEFAULT 1 CHECK(status IN (0, 1)),
  activate INTEGER DEFAULT 1 CHECK(activate IN (0, 1)),

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_algorithms_user_id ON algorithms(user_id);
CREATE INDEX IF NOT EXISTS idx_algorithms_strategy_type ON algorithms(strategy_type);
CREATE INDEX IF NOT EXISTS idx_algorithms_status ON algorithms(status);
CREATE INDEX IF NOT EXISTS idx_algorithms_is_system ON algorithms(is_system);
CREATE INDEX IF NOT EXISTS idx_algorithms_created_at ON algorithms(created_at);

-- Trigger for updated_at
CREATE TRIGGER IF NOT EXISTS trigger_algorithms_updated_at
AFTER UPDATE ON algorithms
FOR EACH ROW
BEGIN
  UPDATE algorithms
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;

-- Schema Version
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- DOWN MIGRATION

DROP TRIGGER IF EXISTS trigger_algorithms_updated_at;
DROP INDEX IF EXISTS idx_algorithms_created_at;
DROP INDEX IF EXISTS idx_algorithms_is_system;
DROP INDEX IF EXISTS idx_algorithms_status;
DROP INDEX IF EXISTS idx_algorithms_strategy_type;
DROP INDEX IF EXISTS idx_algorithms_user_id;
DROP TABLE IF EXISTS algorithms;
DROP TABLE IF EXISTS schema_version;
