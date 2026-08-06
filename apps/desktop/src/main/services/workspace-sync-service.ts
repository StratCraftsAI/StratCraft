/**
 * WorkspaceSyncService
 *
 * TICKET_556: Workspace Sync to User Storage
 *
 * Phase 1: Manual Export/Import of workspace data to a user-specified folder.
 * The sync target folder can be a cloud drive mount (OneDrive, Google Drive, Dropbox).
 *
 * Exported data:
 * - Strategy .py files from {userData}/strategies/
 * - Algorithm DB records as JSON
 * - Backtest results from desktop_backtest_results table
 * - Sanitized config (no credentials/secrets)
 *
 * Excluded data:
 * - Credentials / API keys
 * - Cache files, logs, executor binaries
 */

import { app } from 'electron';
import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  cpSync,
  statSync,
  rmSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { appLog } from '../utils/logger';
import { getDatabaseManager } from '../database/db-manager';

// =============================================================================
// Types
// =============================================================================

export interface SyncManifest {
  version: number;
  timestamp: string;
  machineId: string;
  appVersion: string;
  exportedAt: string;
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  lastSyncedMachineId: string;
  targetDir: string;
  remoteManifest: SyncManifest | null;
}

export interface SyncResult {
  success: boolean;
  exportedStrategies: number;
  exportedAlgorithms: number;
  exportedResults: number;
  error?: string;
  i18nKey?: string;
}

export interface ImportResult {
  success: boolean;
  importedStrategies: number;
  importedAlgorithms: number;
  importedResults: number;
  error?: string;
  i18nKey?: string;
}

// =============================================================================
// Constants
// =============================================================================

const MANIFEST_FILENAME = 'manifest.json';
const ALGORITHMS_FILENAME = 'algorithms.json';
const RESULTS_FILENAME = 'results.json';
const CONFIG_FILENAME = 'config.jsonc';
const STRATEGIES_DIR = 'strategies';
const SYNC_MANIFEST_VERSION = 1;

// Machine ID is generated once per app installation
let cachedMachineId: string | null = null;

function getMachineId(): string {
  if (cachedMachineId) return cachedMachineId;

  const userDataPath = app.getPath('userData');
  const machineIdPath = join(userDataPath, '.machine-id');

  if (existsSync(machineIdPath)) {
    cachedMachineId = readFileSync(machineIdPath, 'utf-8').trim();
  } else {
    cachedMachineId = randomUUID();
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(machineIdPath, cachedMachineId, 'utf-8');
  }

  return cachedMachineId;
}

// =============================================================================
// Strategies Directory (same as v3-handlers.ts getStrategiesDir)
// =============================================================================

function getStrategiesDir(): string {
  const userDataPath = app.getPath('userData');
  const strategiesDir = join(userDataPath, 'strategies');
  if (!existsSync(strategiesDir)) {
    mkdirSync(strategiesDir, { recursive: true });
  }
  return strategiesDir;
}

// =============================================================================
// WorkspaceSyncService
// =============================================================================

export class WorkspaceSyncService {
  /**
   * Export workspace data to the target directory.
   */
  async exportWorkspace(targetDir: string): Promise<SyncResult> {
    appLog.info(`[SYNC] Starting workspace export to: ${targetDir}`);

    if (!targetDir) {
      return { success: false, exportedStrategies: 0, exportedAlgorithms: 0, exportedResults: 0, error: 'Target directory is required', i18nKey: 'sync.targetDirectoryRequired' };
    }

    // Validate target directory is writable
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appLog.error(`[SYNC] Cannot create target directory: ${msg}`);
      return { success: false, exportedStrategies: 0, exportedAlgorithms: 0, exportedResults: 0, error: `Cannot create target directory: ${msg}` };
    }

    let exportedStrategies = 0;
    let exportedAlgorithms = 0;
    let exportedResults = 0;

    try {
      // 1. Export strategies (.py files)
      exportedStrategies = this.exportStrategies(targetDir);

      // 2. Export algorithm DB records
      exportedAlgorithms = this.exportAlgorithms(targetDir);

      // 3. Export backtest results
      exportedResults = this.exportBacktestResults(targetDir);

      // 4. Export sanitized config
      this.exportConfig(targetDir);

      // 5. Write manifest
      this.writeManifest(targetDir);

      appLog.info(`[SYNC] Export complete: ${exportedStrategies} strategies, ${exportedAlgorithms} algorithms, ${exportedResults} results`);

      return { success: true, exportedStrategies, exportedAlgorithms, exportedResults };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appLog.error(`[SYNC] Export failed: ${msg}`);
      return { success: false, exportedStrategies, exportedAlgorithms, exportedResults, error: msg };
    }
  }

  /**
   * Import workspace data from the source directory.
   */
  async importWorkspace(sourceDir: string): Promise<ImportResult> {
    appLog.info(`[SYNC] Starting workspace import from: ${sourceDir}`);

    if (!sourceDir) {
      return { success: false, importedStrategies: 0, importedAlgorithms: 0, importedResults: 0, error: 'Source directory is required', i18nKey: 'sync.sourceDirectoryRequired' };
    }

    // Verify manifest exists
    const manifestPath = join(sourceDir, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      return { success: false, importedStrategies: 0, importedAlgorithms: 0, importedResults: 0, error: 'No sync manifest found in source directory. Not a valid sync folder.', i18nKey: 'sync.invalidFolder' };
    }

    let importedStrategies = 0;
    let importedAlgorithms = 0;
    let importedResults = 0;

    try {
      // 1. Import strategies
      importedStrategies = this.importStrategies(sourceDir);

      // 2. Import algorithms
      importedAlgorithms = this.importAlgorithms(sourceDir);

      // 3. Import backtest results
      importedResults = this.importBacktestResults(sourceDir);

      // 4. Import config (sanitized)
      this.importConfig(sourceDir);

      appLog.info(`[SYNC] Import complete: ${importedStrategies} strategies, ${importedAlgorithms} algorithms, ${importedResults} results`);

      return { success: true, importedStrategies, importedAlgorithms, importedResults };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appLog.error(`[SYNC] Import failed: ${msg}`);
      return { success: false, importedStrategies, importedAlgorithms, importedResults, error: msg };
    }
  }

  /**
   * Get sync status including remote manifest info.
   */
  getSyncStatus(targetDir: string): SyncStatus {
    let remoteManifest: SyncManifest | null = null;

    if (targetDir) {
      const manifestPath = join(targetDir, MANIFEST_FILENAME);
      if (existsSync(manifestPath)) {
        try {
          remoteManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        } catch {
          appLog.warn('[SYNC] Failed to parse remote manifest');
        }
      }
    }

    return {
      lastSyncedAt: remoteManifest?.exportedAt ?? null,
      lastSyncedMachineId: remoteManifest?.machineId ?? '',
      targetDir,
      remoteManifest,
    };
  }

  // ===========================================================================
  // Private: Export helpers
  // ===========================================================================

  private exportStrategies(targetDir: string): number {
    const strategiesDir = getStrategiesDir();
    const targetStrategiesDir = join(targetDir, STRATEGIES_DIR);

    // Clean target strategies directory
    if (existsSync(targetStrategiesDir)) {
      rmSync(targetStrategiesDir, { recursive: true, force: true });
    }
    mkdirSync(targetStrategiesDir, { recursive: true });

    if (!existsSync(strategiesDir)) return 0;

    const entries = readdirSync(strategiesDir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const srcPath = join(strategiesDir, entry.name);
        const destPath = join(targetStrategiesDir, entry.name);
        cpSync(srcPath, destPath, { recursive: true });
        count++;
      }
    }

    return count;
  }

  /**
   * Export workflow algorithms (`nona_algorithms`) only.
   *
   * Discovery signals (`nona_signal`, TICKET_762) are intentionally
   * excluded from workspace sync: they have a different volume profile
   * (potentially thousands of rows per Signal Discovery run), a
   * different lifecycle (regenerated by the discovery pipeline, not
   * user-curated), and a different consumer model (Quant Lab Signal
   * Factory pool, not Builder export targets). If a future ticket adds
   * cross-machine discovery sync, it must introduce its own
   * `exportSignals` / `importSignals` pair with size-aware semantics
   * (e.g. streaming, chunked, or differential transfer).
   */
  private exportAlgorithms(targetDir: string): number {
    const db = getDatabaseManager().getDb();
    const rows = db.prepare('SELECT * FROM nona_algorithms WHERE deleted_at IS NULL').all();

    writeFileSync(
      join(targetDir, ALGORITHMS_FILENAME),
      JSON.stringify(rows, null, 2),
      'utf-8'
    );

    return rows.length;
  }

  private exportBacktestResults(targetDir: string): number {
    const db = getDatabaseManager().getDb();
    const rows = db.prepare(
      'SELECT task_id, strategy_name, symbol, timeframe, start_date, end_date, initial_capital, final_capital, total_pnl, total_return, sharpe_ratio, max_drawdown, win_rate, profit_factor, total_trades, execution_time_ms, created_at FROM desktop_backtest_results'
    ).all();

    writeFileSync(
      join(targetDir, RESULTS_FILENAME),
      JSON.stringify(rows, null, 2),
      'utf-8'
    );

    return rows.length;
  }

  private exportConfig(targetDir: string): void {
    const configDir = join(app.getPath('userData'), 'config');
    const configPath = join(configDir, 'StratCraft.config.jsonc');

    if (!existsSync(configPath)) return;

    const configContent = readFileSync(configPath, 'utf-8');

    // Parse config, sanitize sensitive fields, re-serialize
    try {
      // Remove JSONC comments for parsing
      const jsonContent = configContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(jsonContent);

      // Remove sensitive fields
      delete config.credentials;
      delete config.apiKeys;
      delete config.tokens;

      // Remove sync metadata (will be regenerated)
      if (config.sync) {
        delete config.sync.lastSyncedAt;
        delete config.sync.lastSyncedMachineId;
      }

      writeFileSync(
        join(targetDir, CONFIG_FILENAME),
        JSON.stringify(config, null, 2),
        'utf-8'
      );
    } catch {
      appLog.warn('[SYNC] Failed to parse/sanitize config, skipping config export');
    }
  }

  private writeManifest(targetDir: string): void {
    const manifest: SyncManifest = {
      version: SYNC_MANIFEST_VERSION,
      timestamp: new Date().toISOString(),
      machineId: getMachineId(),
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
    };

    writeFileSync(
      join(targetDir, MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );
  }

  // ===========================================================================
  // Private: Import helpers
  // ===========================================================================

  private importStrategies(sourceDir: string): number {
    const sourceStrategiesDir = join(sourceDir, STRATEGIES_DIR);
    if (!existsSync(sourceStrategiesDir)) return 0;

    const strategiesDir = getStrategiesDir();
    const entries = readdirSync(sourceStrategiesDir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const srcPath = join(sourceStrategiesDir, entry.name);
        const destPath = join(strategiesDir, entry.name);
        cpSync(srcPath, destPath, { recursive: true, force: true });
        count++;
      }
    }

    return count;
  }

  private importAlgorithms(sourceDir: string): number {
    const algorithmsPath = join(sourceDir, ALGORITHMS_FILENAME);
    if (!existsSync(algorithmsPath)) return 0;

    const rows = JSON.parse(readFileSync(algorithmsPath, 'utf-8'));
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const db = getDatabaseManager().getDb();
    let count = 0;

    const insertOrReplace = db.prepare(`
      INSERT OR REPLACE INTO nona_algorithms (
        id, code, file_path, strategy_name, description, strategy_type,
        classification_metadata, record_type, category, metadata, pnl,
        prompt_template, strategy_rules, user_id, is_system, activate,
        status, sync_status, local_only, version, create_time, update_time
      ) VALUES (
        @id, @code, @file_path, @strategy_name, @description, @strategy_type,
        @classification_metadata, @record_type, @category, @metadata, @pnl,
        @prompt_template, @strategy_rules, @user_id, @is_system, @activate,
        @status, @sync_status, @local_only, @version, @create_time, @update_time
      )
    `);

    const importAll = db.transaction(() => {
      for (const row of rows) {
        insertOrReplace.run(row);
        count++;
      }
    });

    importAll();
    return count;
  }

  private importBacktestResults(sourceDir: string): number {
    const resultsPath = join(sourceDir, RESULTS_FILENAME);
    if (!existsSync(resultsPath)) return 0;

    const rows = JSON.parse(readFileSync(resultsPath, 'utf-8'));
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const db = getDatabaseManager().getDb();
    let count = 0;

    const insertOrIgnore = db.prepare(`
      INSERT OR IGNORE INTO desktop_backtest_results (
        task_id, strategy_name, symbol, timeframe, start_date, end_date,
        initial_capital, final_capital, total_pnl, total_return, sharpe_ratio,
        max_drawdown, win_rate, profit_factor, total_trades, execution_time_ms,
        created_at
      ) VALUES (
        @task_id, @strategy_name, @symbol, @timeframe, @start_date, @end_date,
        @initial_capital, @final_capital, @total_pnl, @total_return, @sharpe_ratio,
        @max_drawdown, @win_rate, @profit_factor, @total_trades, @execution_time_ms,
        @created_at
      )
    `);

    const importAll = db.transaction(() => {
      for (const row of rows) {
        insertOrIgnore.run(row);
        count++;
      }
    });

    importAll();
    return count;
  }

  private importConfig(sourceDir: string): void {
    const configPath = join(sourceDir, CONFIG_FILENAME);
    if (!existsSync(configPath)) return;

    // Config import is intentionally a no-op in Phase 1.
    // User preferences from sync are read-only for inspection.
    // Full config merge is planned for Phase 2.
    appLog.info('[SYNC] Config file found in sync folder (read-only in Phase 1)');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: WorkspaceSyncService | null = null;

export function getWorkspaceSyncService(): WorkspaceSyncService {
  if (!instance) {
    instance = new WorkspaceSyncService();
  }
  return instance;
}
