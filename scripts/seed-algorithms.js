#!/usr/bin/env node

/**
 * Seed Test Algorithms
 *
 * Populates nona_algorithms table with test data for component7 (WorkflowRowSelector).
 * Run this script to populate the database with test algorithms.
 *
 * Usage:
 *   node scripts/seed-algorithms.js
 *
 * @see TICKET_077_COMPONENT7 - Data Integration
 */

const path = require('path');

// Load better-sqlite3 from desktop app node_modules
const betterSqlite3Path = path.join(__dirname, '../apps/desktop/node_modules/better-sqlite3');
const Database = require(betterSqlite3Path);

// Database path
const DB_PATH = path.join(__dirname, '../apps/desktop/data/StratCraft.db');

console.log('[Seed] Opening database:', DB_PATH);

const db = new Database(DB_PATH);

// Test algorithm data
const testAlgorithms = [
  // Type 9: Trend-Range (Select Algorithm)
  {
    code: 'TR001',
    strategy_name: 'Trend Following',
    strategy_type: 9,
    description: 'Follow market trends',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'TR002',
    strategy_name: 'Range Trading',
    strategy_type: 9,
    description: 'Trade within price ranges',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'TR003',
    strategy_name: 'Momentum Analysis',
    strategy_type: 9,
    description: 'Analyze momentum indicators',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'TR004',
    strategy_name: 'Mean Reversion',
    strategy_type: 9,
    description: 'Trade mean reversion patterns',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },

  // Type 4: Pre-condition
  {
    code: 'PRE001',
    strategy_name: 'Volume Filter',
    strategy_type: 4,
    description: 'Minimum volume requirement',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'PRE002',
    strategy_name: 'Volatility Check',
    strategy_type: 4,
    description: 'Volatility threshold',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'PRE003',
    strategy_name: 'Trend Confirmation',
    strategy_type: 4,
    description: 'Confirm trend direction',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },

  // Type 0-3: Select Steps
  {
    code: 'SS001',
    strategy_name: 'MA Crossover',
    strategy_type: 0,
    description: 'Moving average crossover',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'SS002',
    strategy_name: 'RSI Entry',
    strategy_type: 1,
    description: 'RSI-based entry signal',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'SS003',
    strategy_name: 'MACD Signal',
    strategy_type: 2,
    description: 'MACD histogram signal',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'SS004',
    strategy_name: 'Bollinger Breakout',
    strategy_type: 3,
    description: 'Bollinger band breakout',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'SS005',
    strategy_name: 'Volume Spike',
    strategy_type: 1,
    description: 'Volume increase detection',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },
  {
    code: 'SS006',
    strategy_name: 'Support/Resistance',
    strategy_type: 2,
    description: 'S/R level detection',
    classification_metadata: JSON.stringify({ signal_source: 'technical' }),
  },

  // Type 6: Post-condition
  {
    code: 'POST001',
    strategy_name: 'Stop Loss',
    strategy_type: 6,
    description: 'Fixed stop loss',
    classification_metadata: JSON.stringify({ signal_source: 'exit' }),
  },
  {
    code: 'POST002',
    strategy_name: 'Take Profit',
    strategy_type: 6,
    description: 'Fixed take profit',
    classification_metadata: JSON.stringify({ signal_source: 'exit' }),
  },
  {
    code: 'POST003',
    strategy_name: 'Trailing Stop',
    strategy_type: 6,
    description: 'Trailing stop loss',
    classification_metadata: JSON.stringify({ signal_source: 'exit' }),
  },
];

// Check if data already exists
const existingCount = db.prepare('SELECT COUNT(*) as count FROM nona_algorithms').get();

if (existingCount.count > 0) {
  console.log(`[Seed] Database already has ${existingCount.count} algorithms`);
  console.log('[Seed] Clearing existing test data...');
  db.prepare('DELETE FROM nona_algorithms WHERE user_id = ?').run('default');
}

// Insert test data
const insert = db.prepare(`
  INSERT INTO nona_algorithms (
    code,
    strategy_name,
    strategy_type,
    description,
    classification_metadata,
    user_id,
    status,
    activate,
    record_type,
    is_system,
    sync_status,
    local_only
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((algorithms) => {
  for (const algo of algorithms) {
    insert.run(
      algo.code,
      algo.strategy_name,
      algo.strategy_type,
      algo.description,
      algo.classification_metadata,
      'default', // user_id
      1, // status (active)
      1, // activate
      'strategy', // record_type
      0, // is_system
      'local', // sync_status
      1 // local_only
    );
  }
});

try {
  insertMany(testAlgorithms);
  console.log(`[Seed] Successfully inserted ${testAlgorithms.length} test algorithms`);

  // Verify data
  const counts = {
    trendRange: db.prepare('SELECT COUNT(*) as count FROM nona_algorithms WHERE strategy_type = 9').get().count,
    preCondition: db.prepare('SELECT COUNT(*) as count FROM nona_algorithms WHERE strategy_type = 4').get().count,
    selectSteps: db.prepare('SELECT COUNT(*) as count FROM nona_algorithms WHERE strategy_type IN (0, 1, 2, 3)').get().count,
    postCondition: db.prepare('SELECT COUNT(*) as count FROM nona_algorithms WHERE strategy_type = 6').get().count,
  };

  console.log('[Seed] Algorithm counts by type:');
  console.log('  - Trend-Range (9):', counts.trendRange);
  console.log('  - Pre-condition (4):', counts.preCondition);
  console.log('  - Select Steps (0-3):', counts.selectSteps);
  console.log('  - Post-condition (6):', counts.postCondition);
} catch (error) {
  console.error('[Seed] Failed to insert test data:', error);
  process.exit(1);
}

db.close();
console.log('[Seed] Done');
