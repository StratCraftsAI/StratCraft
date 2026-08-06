/**
 * Lifecycle Runner
 *
 * TICKET_101: Plugin Lifecycle Hooks
 * TICKET_102: Default Plugin Lifecycle Implementation
 *
 * Executes plugin lifecycle scripts (onInstall, onUpgrade, onUninstall)
 * in an isolated Node.js context with limited API surface.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { pluginLog } from '../utils/logger';
import { extractZip } from '../utils/archive';
import Database from 'better-sqlite3';
import { SQLITE_BUSY_TIMEOUT_MS, LIFECYCLE_SCRIPT_TIMEOUT_MS, DATABASE_SLOW_QUERY_THRESHOLD_MS } from '../../shared/constants/timing';
import { SQL_LOG_TRUNCATE_LENGTH } from '../../shared/constants/formatting';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import type {
  InstallContext,
  UpgradeContext,
  DowngradeContext,
  UninstallContext,
  LifecycleHook,
  LifecycleManifest,
  LifecycleStorage,
  LifecycleLogger,
  LifecycleProgress,
  DatabaseProtocol,
  Transaction,
} from '../../shared/types/plugin-lifecycle';

const execAsync = promisify(exec);

// Re-export types for external use
export type {
  InstallContext,
  UpgradeContext,
  DowngradeContext,
  UninstallContext,
  LifecycleHook,
};

// =============================================================================
// Lifecycle Runner
// =============================================================================

export class LifecycleRunner {
  private storageData = new Map<string, Map<string, unknown>>();
  private dbConnections = new Map<string, Database.Database>();
  private progressCallback?: (pluginId: string, percent: number, message?: string) => void;

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: (pluginId: string, percent: number, message?: string) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Run onInstall hook for a plugin
   */
  async runOnInstall(
    pluginId: string,
    pluginPath: string,
    storagePath: string
  ): Promise<void> {
    const manifest = await this.loadManifest(pluginPath);
    const scriptPath = manifest.lifecycle?.onInstall;

    if (!scriptPath) {
      pluginLog.debug(`[LifecycleRunner] No onInstall hook for ${pluginId}`);
      return;
    }

    const context = this.createInstallContext(pluginId, pluginPath, storagePath);
    await this.executeScript(pluginId, pluginPath, scriptPath, 'onInstall', context);
  }

  /**
   * Run onUpgrade hook for a plugin
   */
  async runOnUpgrade(
    pluginId: string,
    pluginPath: string,
    storagePath: string,
    fromVersion: string,
    toVersion: string,
    oldPluginPath: string
  ): Promise<void> {
    const manifest = await this.loadManifest(pluginPath);
    const scriptPath = manifest.lifecycle?.onUpgrade;

    if (!scriptPath) {
      pluginLog.debug(`[LifecycleRunner] No onUpgrade hook for ${pluginId}`);
      return;
    }

    const baseContext = this.createInstallContext(pluginId, pluginPath, storagePath);
    const context: UpgradeContext = {
      ...baseContext,
      fromVersion,
      toVersion,
      oldPluginPath,
    };

    await this.executeScript(pluginId, pluginPath, scriptPath, 'onUpgrade', context);
  }

  /**
   * Run onDowngrade hook for a plugin
   */
  async runOnDowngrade(
    pluginId: string,
    pluginPath: string,
    storagePath: string,
    fromVersion: string,
    toVersion: string
  ): Promise<void> {
    const manifest = await this.loadManifest(pluginPath);
    const scriptPath = manifest.lifecycle?.onDowngrade;

    if (!scriptPath) {
      pluginLog.debug(`[LifecycleRunner] No onDowngrade hook for ${pluginId}`);
      return;
    }

    const baseContext = this.createInstallContext(pluginId, pluginPath, storagePath);
    const context: DowngradeContext = {
      ...baseContext,
      fromVersion,
      toVersion,
    };

    await this.executeScript(pluginId, pluginPath, scriptPath, 'onDowngrade', context);
  }

  /**
   * Run onUninstall hook for a plugin
   */
  async runOnUninstall(
    pluginId: string,
    pluginPath: string,
    storagePath: string,
    keepUserData: boolean
  ): Promise<void> {
    const manifest = await this.loadManifest(pluginPath);
    const scriptPath = manifest.lifecycle?.onUninstall;

    if (!scriptPath) {
      pluginLog.debug(`[LifecycleRunner] No onUninstall hook for ${pluginId}`);
      return;
    }

    const context: UninstallContext = {
      pluginPath,
      storagePath,
      keepUserData,
      log: this.createLogger(pluginId),
    };

    await this.executeScript(pluginId, pluginPath, scriptPath, 'onUninstall', context);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async loadManifest(pluginPath: string): Promise<LifecycleManifest> {
    // Try manifest.json first, then package.json
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const packagePath = path.join(pluginPath, 'package.json');

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      try {
        const content = await fs.readFile(packagePath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return {};
      }
    }
  }

  private createInstallContext(
    pluginId: string,
    pluginPath: string,
    storagePath: string
  ): InstallContext {
    const tempPath = path.join(app.getPath('temp'), `nexus-lifecycle-${pluginId}`);

    return {
      pluginPath,
      storagePath,
      tempPath,
      platform: process.platform,
      arch: process.arch,
      download: this.createDownloader(),
      extract: this.createExtractor(),
      storage: this.createStorage(pluginId),
      database: this.createDatabaseProtocol(pluginId, storagePath),
      log: this.createLogger(pluginId),
      progress: this.createProgress(pluginId),
    };
  }

  private createDownloader(): (url: string, dest: string) => Promise<void> {
    return async (url: string, dest: string): Promise<void> => {
      const https = await import('https');
      const http = await import('http');

      await fs.mkdir(path.dirname(dest), { recursive: true });

      return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = require('fs').createWriteStream(dest);

        protocol.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            // Handle redirect
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.createDownloader()(redirectUrl, dest).then(resolve).catch(reject);
              return;
            }
          }

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(dest).catch(() => {});
          reject(err);
        });
      });
    };
  }

  private createExtractor(): (archive: string, dest: string) => Promise<void> {
    return async (archive: string, dest: string): Promise<void> => {
      await fs.mkdir(dest, { recursive: true });

      if (archive.endsWith('.zip')) {
        await extractZip(archive, dest);
      } else if (archive.endsWith('.tar.gz') || archive.endsWith('.tgz')) {
        await execAsync(`tar -xzf "${archive}" -C "${dest}"`);
      } else {
        throw new Error(`Unsupported archive format: ${archive}`);
      }
    };
  }

  private createStorage(pluginId: string): LifecycleStorage {
    if (!this.storageData.has(pluginId)) {
      this.storageData.set(pluginId, new Map());
    }
    const data = this.storageData.get(pluginId)!;

    return {
      get: async <T>(key: string): Promise<T | undefined> => {
        return data.get(key) as T | undefined;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        data.set(key, value);
      },
      delete: async (key: string): Promise<void> => {
        data.delete(key);
      },
    };
  }

  private createLogger(pluginId: string): LifecycleLogger {
    const prefix = `[Lifecycle:${pluginId}]`;
    return {
      debug: (msg: string) => pluginLog.debug(`${prefix} ${msg}`),
      info: (msg: string) => pluginLog.info(`${prefix} ${msg}`),
      warn: (msg: string) => pluginLog.warn(`${prefix} ${msg}`),
      error: (msg: string) => pluginLog.error(`${prefix} ${msg}`),
    };
  }

  private createProgress(pluginId: string): LifecycleProgress {
    return {
      report: (percent: number, message?: string) => {
        // TICKET_786_20 Category E: resolve i18n keys from marketplace namespace.
        // Plugin lifecycle scripts pass dot-path keys (e.g. "lifecycle.initializingDatabase").
        // If the key resolves to a translated string, use it; otherwise pass the raw message through
        // (third-party plugins may send untranslated strings).
        const resolved = message
          ? mainT(getCurrentMainLocale(), 'marketplace', message)
          : undefined;
        // mainT returns the key itself when no translation is found -- treat that as "not an i18n key"
        const displayMessage = (resolved && resolved !== message) ? resolved : message;
        pluginLog.debug(`[Lifecycle:${pluginId}] Progress: ${percent}% - ${displayMessage || ''}`);
        this.progressCallback?.(pluginId, percent, displayMessage);
      },
    };
  }

  private createDatabaseProtocol(pluginId: string, storagePath: string): DatabaseProtocol {
    const dbPath = path.join(storagePath, 'storage.db');

    return {
      execute: async (sql: string, params?: any[]): Promise<void> => {
        // 1. Security validation
        this.validateSql(sql, pluginId);

        // 2. Get connection (with pooling)
        const db = this.getDatabaseConnection(pluginId, dbPath);

        // 3. Audit logging
        pluginLog.debug(`[DB:${pluginId}] Execute: ${sql.substring(0, SQL_LOG_TRUNCATE_LENGTH)}`);

        // 4. Execute
        const startTime = Date.now();
        try {
          if (params && params.length > 0) {
            db.prepare(sql).run(...params);
          } else {
            db.exec(sql);
          }

          // Slow query detection
          const duration = Date.now() - startTime;
          if (duration > DATABASE_SLOW_QUERY_THRESHOLD_MS) {
            pluginLog.warn(`[DB:${pluginId}] Slow query (${duration}ms): ${sql.substring(0, SQL_LOG_TRUNCATE_LENGTH)}`);
          }
        } catch (error) {
          pluginLog.error(`[DB:${pluginId}] Execute failed: ${error}`);
          throw error;
        }
      },

      query: async (sql: string, params?: any[]): Promise<any[]> => {
        this.validateSql(sql, pluginId);
        const db = this.getDatabaseConnection(pluginId, dbPath);

        pluginLog.debug(`[DB:${pluginId}] Query: ${sql.substring(0, SQL_LOG_TRUNCATE_LENGTH)}`);

        const startTime = Date.now();
        try {
          const stmt = db.prepare(sql);
          const results = params && params.length > 0 ? stmt.all(...params) : stmt.all();

          const duration = Date.now() - startTime;
          if (duration > DATABASE_SLOW_QUERY_THRESHOLD_MS) {
            pluginLog.warn(`[DB:${pluginId}] Slow query (${duration}ms): ${sql.substring(0, SQL_LOG_TRUNCATE_LENGTH)}`);
          }

          return results;
        } catch (error) {
          pluginLog.error(`[DB:${pluginId}] Query failed: ${error}`);
          throw error;
        }
      },

      queryOne: async (sql: string, params?: any[]): Promise<any | null> => {
        this.validateSql(sql, pluginId);
        const db = this.getDatabaseConnection(pluginId, dbPath);

        pluginLog.debug(`[DB:${pluginId}] QueryOne: ${sql.substring(0, SQL_LOG_TRUNCATE_LENGTH)}`);

        try {
          const stmt = db.prepare(sql);
          const result = params && params.length > 0 ? stmt.get(...params) : stmt.get();
          return result || null;
        } catch (error) {
          pluginLog.error(`[DB:${pluginId}] QueryOne failed: ${error}`);
          throw error;
        }
      },

      transaction: async <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => {
        const db = this.getDatabaseConnection(pluginId, dbPath);

        pluginLog.debug(`[DB:${pluginId}] Begin transaction`);

        // Use manual transaction control since better-sqlite3 doesn't support async transactions
        db.exec('BEGIN TRANSACTION');

        try {
          const tx = this.createTransaction(db, pluginId);
          const result = await fn(tx);

          db.exec('COMMIT');
          pluginLog.debug(`[DB:${pluginId}] Transaction committed`);

          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          pluginLog.error(`[DB:${pluginId}] Transaction rolled back: ${error}`);
          throw error;
        }
      },

      getCurrentVersion: async (): Promise<number> => {
        const db = this.getDatabaseConnection(pluginId, dbPath);

        try {
          const result = db.prepare("SELECT value FROM _plugin_schema WHERE key='version'").get() as { value: string } | undefined;
          return result ? parseInt(result.value, 10) : 0;
        } catch (error) {
          // Table might not exist yet
          return 0;
        }
      },

      setVersion: async (version: number): Promise<void> => {
        const db = this.getDatabaseConnection(pluginId, dbPath);

        db.prepare(`
          INSERT OR REPLACE INTO _plugin_schema (key, value)
          VALUES ('version', ?), ('updated_at', datetime('now'))
        `).run(version.toString());

        pluginLog.info(`[DB:${pluginId}] Schema version set to ${version}`);
      },

      checkIntegrity: async (): Promise<{ ok: boolean; errors?: string[] }> => {
        const db = this.getDatabaseConnection(pluginId, dbPath);

        pluginLog.debug(`[DB:${pluginId}] Running integrity check`);

        try {
          const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
          const ok = result.length === 1 && result[0].integrity_check === 'ok';

          if (!ok) {
            const errors = result.map(r => r.integrity_check);
            pluginLog.error(`[DB:${pluginId}] Integrity check failed: ${errors.join(', ')}`);
            return { ok: false, errors };
          }

          pluginLog.debug(`[DB:${pluginId}] Integrity check passed`);
          return { ok: true };
        } catch (error) {
          pluginLog.error(`[DB:${pluginId}] Integrity check error: ${error}`);
          return { ok: false, errors: [String(error)] };
        }
      },
    };
  }

  private validateSql(sql: string, pluginId: string): void {
    // Prevent path traversal
    if (sql.includes('..')) {
      throw new Error(`[${pluginId}] SQL contains forbidden path traversal`);
    }

    // Prevent ATTACH (access other databases)
    if (/ATTACH\s+DATABASE/i.test(sql)) {
      throw new Error(`[${pluginId}] ATTACH DATABASE is forbidden`);
    }

    // Prevent DETACH (modify database connections)
    if (/DETACH\s+DATABASE/i.test(sql)) {
      throw new Error(`[${pluginId}] DETACH DATABASE is forbidden`);
    }

    // Prevent PRAGMA commands that could compromise security
    const dangerousPragmas = ['database_list', 'database_file'];
    const pragmaMatch = sql.match(/PRAGMA\s+(\w+)/i);
    if (pragmaMatch && dangerousPragmas.includes(pragmaMatch[1].toLowerCase())) {
      throw new Error(`[${pluginId}] PRAGMA ${pragmaMatch[1]} is forbidden`);
    }
  }

  private getDatabaseConnection(pluginId: string, dbPath: string): Database.Database {
    if (!this.dbConnections.has(pluginId)) {
      // Ensure storage directory exists
      const dir = path.dirname(dbPath);
      if (!require('fs').existsSync(dir)) {
        require('fs').mkdirSync(dir, { recursive: true });
      }

      const db = new Database(dbPath);

      // Enable WAL mode for better concurrency
      db.pragma('journal_mode = WAL');

      // Set reasonable timeout
      db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

      this.dbConnections.set(pluginId, db);
      pluginLog.info(`[DB:${pluginId}] Connection opened: ${dbPath}`);
    }

    return this.dbConnections.get(pluginId)!;
  }

  private createTransaction(db: Database.Database, pluginId: string): Transaction {
    return {
      execute: async (sql: string, params?: any[]): Promise<void> => {
        this.validateSql(sql, pluginId);

        if (params && params.length > 0) {
          db.prepare(sql).run(...params);
        } else {
          db.exec(sql);
        }
      },

      query: async (sql: string, params?: any[]): Promise<any[]> => {
        this.validateSql(sql, pluginId);

        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.all(...params) : stmt.all();
      },
    };
  }

  /**
   * Close database connection for a plugin
   */
  closeConnection(pluginId: string): void {
    const db = this.dbConnections.get(pluginId);
    if (db) {
      try {
        db.close();
        this.dbConnections.delete(pluginId);
        pluginLog.info(`[DB:${pluginId}] Connection closed`);
      } catch (error) {
        pluginLog.error(`[DB:${pluginId}] Error closing connection: ${error}`);
      }
    }
  }

  private async executeScript(
    pluginId: string,
    pluginPath: string,
    scriptPath: string,
    hookName: LifecycleHook,
    context: InstallContext | UpgradeContext | DowngradeContext | UninstallContext
  ): Promise<void> {
    const fullScriptPath = path.join(pluginPath, scriptPath);

    pluginLog.info(`[LifecycleRunner] Running ${hookName} for ${pluginId}`);

    try {
      // Check if script exists
      await fs.access(fullScriptPath);

      // Dynamic import the script
      const scriptModule = await import(fullScriptPath);

      // Handle both ESM and CommonJS exports
      // For CommonJS: scriptModule.default is the exports object
      // For ESM: scriptModule.default is the default export
      let handler = scriptModule.default;

      // If scriptModule.default is an object with a default property (CommonJS compiled by TypeScript)
      if (handler && typeof handler === 'object' && 'default' in handler) {
        handler = handler.default;
      }

      // Fallback to named export
      if (!handler) {
        handler = scriptModule[hookName];
      }

      if (typeof handler !== 'function') {
        pluginLog.error(`[LifecycleRunner] Script module structure:`, {
          hasDefault: !!scriptModule.default,
          defaultType: typeof scriptModule.default,
          hasHookName: !!scriptModule[hookName],
          keys: Object.keys(scriptModule)
        });
        throw new Error(`Script does not export a default function or ${hookName}`);
      }

      // Execute with timeout
      const timeoutMs = LIFECYCLE_SCRIPT_TIMEOUT_MS;
      await Promise.race([
        handler(context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Lifecycle script timeout')), timeoutMs)
        ),
      ]);

      pluginLog.info(`[LifecycleRunner] ${hookName} completed for ${pluginId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      pluginLog.error(`[LifecycleRunner] ${hookName} failed for ${pluginId}: ${errorMsg}`);
      throw error;
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let runnerInstance: LifecycleRunner | null = null;

export function getLifecycleRunner(): LifecycleRunner {
  if (!runnerInstance) {
    runnerInstance = new LifecycleRunner();
  }
  return runnerInstance;
}
