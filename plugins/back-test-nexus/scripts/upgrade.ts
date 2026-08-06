/**
 * Backtest Nexus - onUpgrade Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 * TICKET_690: Removed Python venv/pip update logic (C++ only pipeline)
 *
 * Updates configuration and migrates database schema.
 *
 * Full type definition: apps/desktop/src/shared/types/plugin-lifecycle.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Minimal type for this script (full definition in shared/types/plugin-lifecycle.ts)
interface UpgradeContext {
  pluginPath: string;
  storagePath: string;
  platform: NodeJS.Platform;
  fromVersion: string;
  toVersion: string;
  log: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void };
  progress: { report(percent: number, message?: string): void };
}

export default async function onUpgrade(context: UpgradeContext): Promise<void> {
  const { storagePath, fromVersion, toVersion, log, progress } = context;

  log.info(`Upgrading Backtest Nexus from ${fromVersion} to ${toVersion}`);

  progress.report(20, 'lifecycle.updatingConfiguration');

  // Update config
  const configPath = path.join(storagePath, 'config.json');
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    // Add new config fields if missing
    if (!config.resultSettings) {
      config.resultSettings = {
        keepLastN: 50,
        autoExport: false,
        exportFormat: 'json',
      };
    }

    config.version = 2;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    log.info('Configuration updated');
  } catch (error) {
    log.warn(`Config update skipped: ${error}`);
  }

  progress.report(60, 'lifecycle.updatingDatabaseSchema');

  // Database migrations
  const dbPath = path.join(storagePath, 'backtest.db');
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    // Add any new tables/columns
    try {
      db.exec(`
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
        );
        CREATE INDEX IF NOT EXISTS idx_trades_run ON trades(run_id);
      `);
    } catch {
      log.debug('trades table already exists');
    }

    db.close();
    log.info('Database schema updated');
  } catch (error) {
    log.warn(`Database migration skipped: ${error}`);
  }

  progress.report(100, 'lifecycle.upgradeComplete');
  log.info(`Upgrade from ${fromVersion} to ${toVersion} completed`);
}
