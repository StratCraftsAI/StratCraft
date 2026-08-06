/**
 * DatabaseService - Plugin Database Infrastructure
 *
 * Provides isolated database access for plugins with automatic data isolation.
 * Framework provides API, Plugins provide Logic (CLAUDE.md)
 *
 * See: TICKET_110_PLUGIN_DATABASE_INFRASTRUCTURE.md
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { DatabaseManager } from '../database/db-manager';
import { MigrationManager } from '../database/migrations/migration-manager';
import { dbLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';

/**
 * Plugin database manager registry
 */
const pluginDatabases = new Map<string, DatabaseManager>();

let isInitialized = false;

/**
 * Get plugin data directory
 */
function getPluginDataDir(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'plugins')
    : path.join(app.getAppPath(), 'data', 'plugins');
}

/**
 * Validate plugin ID format
 */
function validatePluginId(pluginId: string): void {
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.database.invalidPluginId'));
  }

  // Plugin ID must follow reverse domain name notation
  // e.g., com.stratcraft.algorithm-editor
  const validPattern = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
  if (!validPattern.test(pluginId)) {
    throw new Error(
      `Invalid plugin ID format: ${pluginId}. Must follow reverse domain notation (e.g., com.stratcraft.algorithm-editor)`
    );
  }
}

/**
 * Initialize database service (framework infrastructure only)
 */
export async function initializeDatabaseService(): Promise<void> {
  if (isInitialized) {
    dbLog.warn('[DatabaseService] Already initialized, skipping');
    return;
  }

  try {
    dbLog.info('[DatabaseService] Initializing plugin database infrastructure...');

    // Ensure plugin data directory exists
    const pluginDataDir = getPluginDataDir();
    if (!fs.existsSync(pluginDataDir)) {
      fs.mkdirSync(pluginDataDir, { recursive: true });
      dbLog.info(`[DatabaseService] Created plugin data directory: ${pluginDataDir}`);
    }

    isInitialized = true;
    dbLog.info('[DatabaseService] Initialization complete');
  } catch (error) {
    dbLog.error('[DatabaseService] Initialization failed:', error);
    throw error;
  }
}

/**
 * Get isolated database for a specific plugin
 *
 * Each plugin gets its own .db file in userData/plugins/{pluginId}/plugin.db
 *
 * @param pluginId - Plugin identifier (e.g., com.stratcraft.algorithm-editor)
 * @returns DatabaseManager instance for the plugin
 */
export async function getPluginDatabase(pluginId: string): Promise<DatabaseManager> {
  if (!isInitialized) {
    throw new Error('DatabaseService not initialized. Call initializeDatabaseService() first.');
  }

  // Validate plugin ID
  validatePluginId(pluginId);

  // Check if database already exists in registry
  if (pluginDatabases.has(pluginId)) {
    return pluginDatabases.get(pluginId)!;
  }

  dbLog.info(`[DatabaseService] Creating database for plugin: ${pluginId}`);

  // Create plugin-specific directory
  const pluginDir = path.join(getPluginDataDir(), pluginId);
  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true});
    dbLog.info(`[DatabaseService] Created plugin directory: ${pluginDir}`);
  }

  // Database path for plugin
  const dbPath = path.join(pluginDir, 'plugin.db');

  // Prevent path traversal attacks
  const resolvedPath = path.resolve(dbPath);
  if (!resolvedPath.startsWith(getPluginDataDir())) {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.database.pathTraversalDetected'));
  }

  // Create DatabaseManager for plugin
  const db = new DatabaseManager({ filename: resolvedPath });

  // Register in cache
  pluginDatabases.set(pluginId, db);

  dbLog.info(`[DatabaseService] Database created for plugin ${pluginId}: ${resolvedPath}`);

  return db;
}

/**
 * Get MigrationManager for a specific plugin
 *
 * @param pluginId - Plugin identifier
 * @returns MigrationManager for the plugin's database
 */
export async function getPluginMigrationManager(pluginId: string): Promise<MigrationManager> {
  const db = await getPluginDatabase(pluginId);
  return new MigrationManager(db);
}

/**
 * Backup plugin database to specified path
 *
 * @param pluginId - Plugin identifier
 * @param backupPath - Backup destination path
 */
export async function backupPluginDatabase(pluginId: string, backupPath: string): Promise<void> {
  dbLog.info(`[DatabaseService] Backing up database for plugin: ${pluginId}`);

  const db = await getPluginDatabase(pluginId);
  await db.backup(backupPath);

  dbLog.info(`[DatabaseService] Backup completed: ${backupPath}`);
}

/**
 * Get plugin database statistics
 *
 * @param pluginId - Plugin identifier
 */
export async function getPluginDatabaseStats(pluginId: string) {
  const db = await getPluginDatabase(pluginId);
  return db.getStats();
}

/**
 * Close all plugin databases
 */
export function shutdownDatabaseService(): void {
  if (!isInitialized) {
    dbLog.warn('[DatabaseService] Not initialized, skipping shutdown');
    return;
  }

  try {
    dbLog.info('[DatabaseService] Shutting down...');

    // Close all plugin databases
    for (const [pluginId, db] of pluginDatabases.entries()) {
      dbLog.info(`[DatabaseService] Closing database for plugin: ${pluginId}`);
      db.close();
    }

    pluginDatabases.clear();
    isInitialized = false;

    dbLog.info('[DatabaseService] Shutdown complete');
  } catch (error) {
    dbLog.error('[DatabaseService] Shutdown failed:', error);
    throw error;
  }
}

/**
 * Check if database service is initialized
 */
export function isDatabaseInitialized(): boolean {
  return isInitialized;
}
