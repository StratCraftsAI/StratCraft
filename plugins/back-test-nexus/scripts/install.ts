/**
 * Backtest Nexus - onInstall Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 * TICKET_690: Removed Python venv/pip/backtrader setup (C++ only pipeline)
 *
 * Sets up storage directories and initializes database schema:
 * - Create directories for results, logs, cache
 * - Initialize SQLite tables (backtest_runs, backtest_results, trades)
 *
 * Full type definition: apps/desktop/src/shared/types/plugin-lifecycle.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { InstallContext } from '../../../apps/desktop/src/shared/types/plugin-lifecycle';

export default async function onInstall(context: InstallContext): Promise<void> {
  const { storagePath, log, progress } = context;

  progress.report(0, 'lifecycle.creatingBacktestDirs');

  // Create directories
  const dirs = [
    'results',            // Backtest results
    'logs',               // Engine logs
    'cache',              // Data cache
  ];

  for (const dir of dirs) {
    await fs.mkdir(path.join(storagePath, dir), { recursive: true });
  }

  log.info('Backtest directories created');

  progress.report(30, 'lifecycle.creatingConfiguration');

  // Create default configuration
  const defaultConfig = {
    version: 1,
    engineSettings: {
      maxConcurrentBacktests: 2,
    },
    resultSettings: {
      keepLastN: 50,
      autoExport: false,
      exportFormat: 'json',
    },
  };

  const configPath = path.join(storagePath, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));

  progress.report(50, 'lifecycle.initializingDatabase');

  // Initialize results database using Database Protocol
  try {
    const { database } = context;

    // Create schema version table
    await database.execute(`
      CREATE TABLE IF NOT EXISTS _plugin_schema (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Initialize schema version
    await database.execute(
      "INSERT OR IGNORE INTO _plugin_schema (key, value) VALUES ('version', '1')"
    );

    // Create tables in a transaction
    await database.transaction(async (tx) => {
      // Backtest runs
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
          id TEXT PRIMARY KEY,
          name TEXT,
          strategy_id TEXT,
          engine TEXT NOT NULL,
          config TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          status TEXT NOT NULL,
          error TEXT
        )
      `);

      // Backtest results
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS backtest_results (
          run_id TEXT PRIMARY KEY,
          total_return REAL,
          sharpe_ratio REAL,
          max_drawdown REAL,
          win_rate REAL,
          total_trades INTEGER,
          metrics TEXT,
          equity_curve TEXT,
          FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
        )
      `);

      // Trade history
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          symbol TEXT,
          direction TEXT,
          entry_time INTEGER,
          exit_time INTEGER,
          entry_price REAL,
          exit_price REAL,
          size REAL,
          pnl REAL,
          FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
        )
      `);

      // Create indexes
      await tx.execute('CREATE INDEX IF NOT EXISTS idx_runs_strategy ON backtest_runs(strategy_id)');
      await tx.execute('CREATE INDEX IF NOT EXISTS idx_trades_run ON trades(run_id)');
    });

    log.info('Results database initialized');
  } catch (error) {
    log.error(`Database initialization failed: ${error}`);
    throw error;
  }

  progress.report(100, 'lifecycle.installationComplete');
  log.info('Backtest Nexus installed successfully');
}
