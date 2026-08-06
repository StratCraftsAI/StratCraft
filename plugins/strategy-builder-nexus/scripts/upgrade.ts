/**
 * Strategy Builder Nexus - onUpgrade Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 *
 * Handles schema migrations and data upgrades.
 *
 * Full type definition: apps/desktop/src/shared/types/plugin-lifecycle.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Minimal type for this script (full definition in shared/types/plugin-lifecycle.ts)
interface UpgradeContext {
  storagePath: string;
  fromVersion: string;
  toVersion: string;
  log: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  progress: { report(percent: number, message?: string): void };
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

export default async function onUpgrade(context: UpgradeContext): Promise<void> {
  const { storagePath, fromVersion, toVersion, log, progress } = context;

  log.info(`Upgrading Strategy Builder from ${fromVersion} to ${toVersion}`);
  progress.report(0, 'lifecycle.checkingUpgradeRequirements');

  const dbPath = path.join(storagePath, 'strategies.db');

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    // Migration: v1.x to v2.x
    if (compareVersions(fromVersion, '2.0.0') < 0 && compareVersions(toVersion, '2.0.0') >= 0) {
      progress.report(30, 'lifecycle.migratingDatabaseToV2');

      try {
        // Add new columns for v2 features
        db.exec(`
          ALTER TABLE strategies ADD COLUMN tags TEXT DEFAULT '[]';
        `);
        log.info('Added tags column');
      } catch {
        log.debug('tags column already exists');
      }

      try {
        db.exec(`
          ALTER TABLE strategies ADD COLUMN version INTEGER DEFAULT 1;
        `);
        log.info('Added version column');
      } catch {
        log.debug('version column already exists');
      }

      try {
        // Add execution history table if missing
        db.exec(`
          CREATE TABLE IF NOT EXISTS execution_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id TEXT NOT NULL,
            execution_type TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            status TEXT NOT NULL,
            result TEXT,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id)
          );
          CREATE INDEX IF NOT EXISTS idx_execution_strategy ON execution_history(strategy_id);
        `);
        log.info('Added execution_history table');
      } catch {
        log.debug('execution_history table already exists');
      }

      log.info('Database schema updated for v2.0');
    }

    db.close();
  } catch (error) {
    log.warn(`Database migration skipped: ${error}`);
  }

  progress.report(60, 'lifecycle.updatingConfiguration');

  // Update config with new defaults
  const configPath = path.join(storagePath, 'config.json');
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    // Add new config fields if missing
    if (!config.aiSettings) {
      config.aiSettings = {
        enabled: true,
        model: 'default',
        maxTokens: 2048,
      };
    }

    config.version = 2;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    log.info('Configuration updated');
  } catch (error) {
    log.warn(`Config update skipped: ${error}`);
  }

  progress.report(90, 'lifecycle.creatingNewDirectories');

  // Create new directories that may not exist in older versions
  const newDirs = ['generated'];
  for (const dir of newDirs) {
    await fs.mkdir(path.join(storagePath, dir), { recursive: true });
  }

  progress.report(100, 'lifecycle.upgradeComplete');
  log.info(`Upgrade from ${fromVersion} to ${toVersion} completed`);
}
