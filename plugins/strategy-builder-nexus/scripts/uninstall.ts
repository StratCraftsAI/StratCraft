/**
 * Strategy Builder Nexus - onUninstall Hook
 *
 * TICKET_102: Default Plugin Lifecycle Implementation
 *
 * Cleans up strategy storage.
 *
 * Full type definition: apps/desktop/src/shared/types/plugin-lifecycle.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Minimal type for this script (full definition in shared/types/plugin-lifecycle.ts)
interface UninstallContext {
  storagePath: string;
  keepUserData: boolean;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export default async function onUninstall(context: UninstallContext): Promise<void> {
  const { storagePath, keepUserData, log } = context;

  // Always clean generated code (can be regenerated)
  const generatedDir = path.join(storagePath, 'generated');
  try {
    await fs.rm(generatedDir, { recursive: true, force: true });
    log.info('Generated code cleaned');
  } catch (error) {
    log.warn(`Failed to clean generated code: ${error}`);
  }

  // Always clean templates (bundled with plugin)
  const templatesDir = path.join(storagePath, 'templates');
  try {
    await fs.rm(templatesDir, { recursive: true, force: true });
    log.info('Templates cleaned');
  } catch (error) {
    log.warn(`Failed to clean templates: ${error}`);
  }

  if (!keepUserData) {
    // Remove database
    const dbPath = path.join(storagePath, 'strategies.db');
    try {
      await fs.rm(dbPath, { force: true });
      await fs.rm(`${dbPath}-wal`, { force: true });
      await fs.rm(`${dbPath}-shm`, { force: true });
      log.info('Database removed');
    } catch (error) {
      log.warn(`Failed to remove database: ${error}`);
    }

    // Remove strategies
    const strategiesDir = path.join(storagePath, 'strategies');
    try {
      await fs.rm(strategiesDir, { recursive: true, force: true });
      log.info('Strategies removed');
    } catch (error) {
      log.warn(`Failed to remove strategies: ${error}`);
    }

    // Remove exports
    const exportsDir = path.join(storagePath, 'exports');
    try {
      await fs.rm(exportsDir, { recursive: true, force: true });
      log.info('Exports removed');
    } catch (error) {
      log.warn(`Failed to remove exports: ${error}`);
    }

    // Remove backups
    const backupsDir = path.join(storagePath, 'backups');
    try {
      await fs.rm(backupsDir, { recursive: true, force: true });
      log.info('Backups removed');
    } catch (error) {
      log.warn(`Failed to remove backups: ${error}`);
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
    log.info('User strategies preserved at: ' + storagePath);
  }

  log.info('Strategy Builder Nexus uninstall complete');
}
