/**
 * Backtest Nexus - onUninstall Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 *
 * Cleans up Python environment and backtest data.
 *
 * Full type definition: apps/desktop/src/shared/types/plugin-lifecycle.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Minimal type for this script (full definition in shared/types/plugin-lifecycle.ts)
interface UninstallContext {
  storagePath: string;
  keepUserData: boolean;
  log: { info(msg: string): void; warn(msg: string): void };
}

export default async function onUninstall(context: UninstallContext): Promise<void> {
  const { storagePath, keepUserData, log } = context;

  // Always remove virtual environment (can be recreated, takes significant space)
  const venvPath = path.join(storagePath, 'venv');
  try {
    await fs.rm(venvPath, { recursive: true, force: true });
    log.info('Python virtual environment removed');
  } catch (error) {
    log.warn(`Failed to remove venv: ${error}`);
  }

  // Always clean logs (diagnostic only)
  const logsDir = path.join(storagePath, 'logs');
  try {
    await fs.rm(logsDir, { recursive: true, force: true });
    log.info('Logs cleaned');
  } catch (error) {
    log.warn(`Failed to clean logs: ${error}`);
  }

  // Always clean checkpoints (temporary data)
  const checkpointsDir = path.join(storagePath, 'checkpoints');
  try {
    await fs.rm(checkpointsDir, { recursive: true, force: true });
    log.info('Checkpoints cleaned');
  } catch (error) {
    log.warn(`Failed to clean checkpoints: ${error}`);
  }

  // Always clean cache
  const cacheDir = path.join(storagePath, 'cache');
  try {
    await fs.rm(cacheDir, { recursive: true, force: true });
    log.info('Cache cleaned');
  } catch (error) {
    log.warn(`Failed to clean cache: ${error}`);
  }

  if (!keepUserData) {
    // Remove results database
    const dbPath = path.join(storagePath, 'backtest.db');
    try {
      await fs.rm(dbPath, { force: true });
      await fs.rm(`${dbPath}-wal`, { force: true });
      await fs.rm(`${dbPath}-shm`, { force: true });
      log.info('Results database removed');
    } catch (error) {
      log.warn(`Failed to remove database: ${error}`);
    }

    // Remove results directory
    const resultsDir = path.join(storagePath, 'results');
    try {
      await fs.rm(resultsDir, { recursive: true, force: true });
      log.info('Backtest results removed');
    } catch (error) {
      log.warn(`Failed to remove results: ${error}`);
    }

    // Remove config
    const configPath = path.join(storagePath, 'config.json');
    try {
      await fs.rm(configPath, { force: true });
      log.info('Configuration removed');
    } catch (error) {
      log.warn(`Failed to remove config: ${error}`);
    }

    log.info('All user data removed');
  } else {
    log.info('Backtest results preserved at: ' + path.join(storagePath, 'results'));
  }

  log.info('Backtest Nexus uninstall complete');
}
