-- Seed Test Algorithms
-- Populates nona_algorithms table with test data for component7
-- Usage: sqlite3 apps/desktop/data/StratCraft.db < scripts/seed-algorithms.sql

-- Clear existing test data
DELETE FROM nona_algorithms WHERE user_id = 'default';

-- Type 9: Trend-Range (Select Algorithm)
INSERT INTO nona_algorithms (code, strategy_name, strategy_type, description, classification_metadata, user_id, status, activate, record_type, is_system, sync_status, local_only)
VALUES
  ('TR001', 'Trend Following', 9, 'Follow market trends', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('TR002', 'Range Trading', 9, 'Trade within price ranges', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('TR003', 'Momentum Analysis', 9, 'Analyze momentum indicators', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('TR004', 'Mean Reversion', 9, 'Trade mean reversion patterns', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1);

-- Type 4: Pre-condition
INSERT INTO nona_algorithms (code, strategy_name, strategy_type, description, classification_metadata, user_id, status, activate, record_type, is_system, sync_status, local_only)
VALUES
  ('PRE001', 'Volume Filter', 4, 'Minimum volume requirement', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('PRE002', 'Volatility Check', 4, 'Volatility threshold', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('PRE003', 'Trend Confirmation', 4, 'Confirm trend direction', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1);

-- Type 0-3: Select Steps
INSERT INTO nona_algorithms (code, strategy_name, strategy_type, description, classification_metadata, user_id, status, activate, record_type, is_system, sync_status, local_only)
VALUES
  ('SS001', 'MA Crossover', 0, 'Moving average crossover', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('SS002', 'RSI Entry', 1, 'RSI-based entry signal', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('SS003', 'MACD Signal', 2, 'MACD histogram signal', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('SS004', 'Bollinger Breakout', 3, 'Bollinger band breakout', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('SS005', 'Volume Spike', 1, 'Volume increase detection', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('SS006', 'Support/Resistance', 2, 'S/R level detection', '{"signal_source":"technical"}', 'default', 1, 1, 'strategy', 0, 'local', 1);

-- Type 6: Post-condition
INSERT INTO nona_algorithms (code, strategy_name, strategy_type, description, classification_metadata, user_id, status, activate, record_type, is_system, sync_status, local_only)
VALUES
  ('POST001', 'Stop Loss', 6, 'Fixed stop loss', '{"signal_source":"exit"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('POST002', 'Take Profit', 6, 'Fixed take profit', '{"signal_source":"exit"}', 'default', 1, 1, 'strategy', 0, 'local', 1),
  ('POST003', 'Trailing Stop', 6, 'Trailing stop loss', '{"signal_source":"exit"}', 'default', 1, 1, 'strategy', 0, 'local', 1);

-- Verify counts
SELECT 'Inserted algorithms:' as message;
SELECT
  strategy_type,
  COUNT(*) as count,
  CASE
    WHEN strategy_type = 9 THEN 'Trend-Range'
    WHEN strategy_type = 4 THEN 'Pre-condition'
    WHEN strategy_type IN (0,1,2,3) THEN 'Select Steps'
    WHEN strategy_type = 6 THEN 'Post-condition'
    ELSE 'Unknown'
  END as type_name
FROM nona_algorithms
WHERE user_id = 'default'
GROUP BY strategy_type
ORDER BY strategy_type;
