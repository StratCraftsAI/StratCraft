/**
 * Database Backup Service
 *
 * TICKET_580_5: Automatic Backup and Recovery
 *
 * Two-phase singleton pattern (same as executor-queue-service.ts).
 * Provides:
 * - Automatic backup on startup (if stale)
 * - Pre-migration backup
 * - Integrity check (PRAGMA quick_check)
 * - Backup rotation (oldest deleted when exceeding maxBackups)
 * - Recovery from backup when corruption detected
 * - Manual backup/restore via IPC
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import type { DatabaseManager } from '../database/db-manager';
import Database from 'better-sqlite3';
import { BackupKeyRegistry } from './backup-key-registry';

const backupLog = createLogger('BACKUP');

// =============================================================================
// Types
// =============================================================================

export interface BackupConfig {
  /** Maximum number of backups to retain (default: 7) */
  maxBackups: number;
  /** Minimum interval between automatic backups in ms (default: 24h) */
  intervalMs: number;
  /** Directory for backup files */
  backupDir: string;
}

export interface BackupInfo {
  path: string;
  filename: string;
  timestamp: number;
  size: number;
}

export interface IntegrityResult {
  ok: boolean;
  errors?: string[];
}

export interface RecoveryResult {
  recovered: boolean;
  backupUsed?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_BACKUPS = 7;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BACKUP_PREFIX = 'StratCraft_';
const BACKUP_EXTENSION = '.db';
const CORRUPTED_SUFFIX = '.corrupted';
const PENDING_RESTORE_SUFFIX = '.restore-pending.json';
const RESTORE_TEMP_SUFFIX = '.restore.tmp';
const RESTORE_ROLLBACK_SUFFIX = '.restore.rollback';

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

// =============================================================================
// Service
// =============================================================================

export class DatabaseBackupService {
  private config: BackupConfig;

  constructor(dbPath: string, overrides?: Partial<BackupConfig>) {
    const defaultBackupDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'backups')
      : path.join(path.dirname(dbPath), 'backups');

    this.config = {
      maxBackups: overrides?.maxBackups ?? DEFAULT_MAX_BACKUPS,
      intervalMs: overrides?.intervalMs ?? DEFAULT_INTERVAL_MS,
      backupDir: overrides?.backupDir ?? defaultBackupDir,
    };

    // Ensure backup directory exists
    if (!fs.existsSync(this.config.backupDir)) {
      const dirMode = process.platform !== 'win32' ? { recursive: true, mode: 0o700 } : { recursive: true };
      fs.mkdirSync(this.config.backupDir, dirMode as fs.MakeDirectoryOptions);
      backupLog.info(`[DatabaseBackupService] Created backup directory: ${this.config.backupDir}`);
    }

    backupLog.info(`[DatabaseBackupService] Initialized (dir=${this.config.backupDir}, max=${this.config.maxBackups})`);
  }

  /**
   * Run SQLite integrity check on database.
   * Uses PRAGMA quick_check (fast) first; falls back to full integrity_check only on failure.
   */
  checkIntegrity(db: DatabaseManager): IntegrityResult {
    try {
      const result = db.getDb().pragma('quick_check') as Array<{ quick_check: string }>;
      const ok = result.length === 1 && result[0].quick_check === 'ok';
      if (ok) {
        return { ok: true };
      }
      const errors = result.map(r => r.quick_check);
      backupLog.error('[DatabaseBackupService] Integrity check FAILED:', errors);
      return { ok: false, errors };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      backupLog.error('[DatabaseBackupService] Integrity check threw:', msg);
      return { ok: false, errors: [msg] };
    }
  }

  /**
   * Create a timestamped backup of the database.
   * Returns the full path to the created backup file.
   */
  async createBackup(db: DatabaseManager, label?: string): Promise<string> {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '_')
      .slice(0, 15); // YYYYMMDD_HHmmss
    const labelSuffix = label ? `_${label}` : '';
    const filename = `${BACKUP_PREFIX}${timestamp}${labelSuffix}${BACKUP_EXTENSION}`;
    const backupPath = path.join(this.config.backupDir, filename);

    await db.backup(backupPath);
    const keyRegistry = new BackupKeyRegistry(db.getDb());
    keyRegistry.registerBackup(backupPath);
    backupLog.info(`[DatabaseBackupService] Backup created: ${filename}`);

    // Rotate after creating
    this.rotateBackups(db.getDb());

    return backupPath;
  }

  /**
   * Create backup only if the last backup is older than intervalMs.
   * Returns the backup path if created, null otherwise.
   */
  async createBackupIfStale(db: DatabaseManager): Promise<string | null> {
    const backups = this.listBackups();
    if (backups.length > 0) {
      const newest = backups[0];
      const age = Date.now() - newest.timestamp;
      if (age < this.config.intervalMs) {
        backupLog.info(`[DatabaseBackupService] Last backup is ${Math.round(age / 60000)}min old, skipping`);
        return null;
      }
    }
    return this.createBackup(db, 'auto');
  }

  /**
   * Delete oldest backups when count exceeds maxBackups.
   */
  rotateBackups(liveDb?: Database.Database): void {
    const backups = this.listBackups();
    if (backups.length <= this.config.maxBackups) {
      return;
    }

    // backups is sorted newest-first, so delete from the end
    const toDelete = backups.slice(this.config.maxBackups);
    for (const backup of toDelete) {
      try {
        fs.unlinkSync(backup.path);
        if (liveDb) new BackupKeyRegistry(liveDb).markRemoved(backup.path);
        backupLog.info(`[DatabaseBackupService] Rotated out: ${backup.filename}`);
      } catch (err) {
        backupLog.warn(`[DatabaseBackupService] Failed to delete old backup: ${backup.filename}`, err);
      }
    }
  }

  /**
   * Backfill or verify retained backup manifests and live key references.
   * This is called after migrations so pre-v134 snapshots become registered.
   */
  reconcileSecureStoreBackups(liveDb: Database.Database): void {
    const keyRegistry = new BackupKeyRegistry(liveDb);
    for (const backup of this.listBackups()) keyRegistry.reconcileInventory(backup.path);
  }

  /**
   * List all backup files sorted newest-first.
   */
  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.config.backupDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.config.backupDir);
    const backups: BackupInfo[] = [];

    for (const entry of entries) {
      if (!entry.startsWith(BACKUP_PREFIX) || !entry.endsWith(BACKUP_EXTENSION)) {
        continue;
      }
      const fullPath = path.join(this.config.backupDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        backups.push({
          path: fullPath,
          filename: entry,
          timestamp: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
        // Skip files that can't be stat'd
      }
    }

    // Sort newest-first
    backups.sort((a, b) => b.timestamp - a.timestamp);
    return backups;
  }

  /**
   * Attempt to recover from the newest valid backup.
   * Preserves the corrupted database file with .corrupted suffix.
   */
  attemptRecovery(dbPath: string): RecoveryResult {
    const backups = this.listBackups();
    if (backups.length === 0) {
      backupLog.error('[DatabaseBackupService] No backups available for recovery');
      return { recovered: false };
    }

    // Preserve the corrupted file
    const corruptedPath = dbPath + CORRUPTED_SUFFIX;
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, corruptedPath);
        backupLog.info(`[DatabaseBackupService] Corrupted DB preserved as: ${corruptedPath}`);
      }
    } catch (err) {
      backupLog.error('[DatabaseBackupService] Failed to preserve corrupted DB:', err);
      return { recovered: false };
    }

    // Also remove WAL and SHM files from the corrupted DB
    for (const suffix of ['-wal', '-shm']) {
      const auxPath = dbPath + suffix;
      if (fs.existsSync(auxPath)) {
        try {
          fs.unlinkSync(auxPath);
        } catch {
          // Non-fatal
        }
      }
    }

    // Try each backup newest-first
    for (const backup of backups) {
      try {
        fs.copyFileSync(backup.path, dbPath);
        backupLog.info(`[DatabaseBackupService] Restored from backup: ${backup.filename}`);
        return { recovered: true, backupUsed: backup.filename };
      } catch (err) {
        backupLog.warn(`[DatabaseBackupService] Backup ${backup.filename} failed to restore:`, err);
        continue;
      }
    }

    // All backups failed -- restore the corrupted file back
    try {
      if (fs.existsSync(corruptedPath)) {
        fs.renameSync(corruptedPath, dbPath);
      }
    } catch {
      // Best effort
    }

    backupLog.error('[DatabaseBackupService] All backup recovery attempts failed');
    return { recovered: false };
  }

  /**
   * Get the backup directory path.
   */
  getBackupDir(): string {
    return this.config.backupDir;
  }

  /**
   * Validate and stage a restore for the next database-owner startup.
   * Active connections are never closed or replaced from an IPC request.
   */
  stageRestore(dbPath: string, backupId: string): {
    staged: true;
    backupId: string;
    requiresApplicationRestart: true;
  } {
    if (
      path.basename(backupId) !== backupId
      || backupId.includes('/')
      || backupId.includes('\\')
    ) {
      throw new Error('backupId must be a filename returned by listDatabaseBackups');
    }
    const backup = this.listBackups().find(item => item.filename === backupId);
    if (!backup) throw new Error(`Database backup '${backupId}' was not found`);
    assertSqliteFileIntegrity(backup.path);
    const markerPath = dbPath + PENDING_RESTORE_SUFFIX;
    const tempMarker = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempMarker, JSON.stringify({ backupPath: backup.path, backupId }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fsyncFile(tempMarker);
    fs.renameSync(tempMarker, markerPath);
    backupLog.info(`[DatabaseBackupService] Restore staged for next startup: ${backupId}`);
    return {
      staged: true,
      backupId,
      requiresApplicationRestart: true,
    };
  }
}

function assertSqliteFileIntegrity(filePath: string): void {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('quick_check') as Array<{ quick_check: string }>;
    if (rows.length !== 1 || rows[0].quick_check !== 'ok') {
      throw new Error(`Backup integrity check failed: ${rows.map(row => row.quick_check).join('; ')}`);
    }
  } finally {
    db.close();
  }
}

/**
 * Apply a staged restore before DatabaseManager opens its first connection.
 * Replacement is atomic and rolls back if the restored image fails integrity.
 */
export function applyPendingDatabaseRestore(dbPath: string): string | null {
  const markerPath = dbPath + PENDING_RESTORE_SUFFIX;
  if (!fs.existsSync(markerPath)) return null;
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as {
    backupPath?: unknown;
    backupId?: unknown;
  };
  if (typeof marker.backupPath !== 'string' || typeof marker.backupId !== 'string') {
    throw new Error(`Invalid pending database restore marker: ${markerPath}`);
  }
  if (
    path.basename(marker.backupId) !== marker.backupId
    || path.basename(marker.backupPath) !== marker.backupId
  ) {
    throw new Error(`Invalid pending database restore target: ${markerPath}`);
  }
  assertSqliteFileIntegrity(marker.backupPath);

  const tempPath = dbPath + RESTORE_TEMP_SUFFIX;
  const rollbackPath = dbPath + RESTORE_ROLLBACK_SUFFIX;
  let originalMoved = false;
  let replacementInstalled = false;
  try {
    fs.copyFileSync(marker.backupPath, tempPath);
    fsyncFile(tempPath);
    assertSqliteFileIntegrity(tempPath);
    if (fs.existsSync(rollbackPath)) fs.unlinkSync(rollbackPath);

    if (fs.existsSync(dbPath)) {
      fs.renameSync(dbPath, rollbackPath);
      originalMoved = true;
    }
    for (const suffix of ['-wal', '-shm']) {
      const auxiliaryPath = dbPath + suffix;
      if (fs.existsSync(auxiliaryPath)) fs.unlinkSync(auxiliaryPath);
    }
    fs.renameSync(tempPath, dbPath);
    replacementInstalled = true;
    assertSqliteFileIntegrity(dbPath);
    if (originalMoved && fs.existsSync(rollbackPath)) fs.unlinkSync(rollbackPath);
    fs.unlinkSync(markerPath);
    return marker.backupId;
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (replacementInstalled && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (originalMoved && fs.existsSync(rollbackPath)) fs.renameSync(rollbackPath, dbPath);
    throw error;
  }
}

// =============================================================================
// Two-phase Singleton
// =============================================================================

let instance: DatabaseBackupService | null = null;

/**
 * Initialize the DatabaseBackupService singleton.
 * Must be called once during app startup.
 */
export function initializeDatabaseBackupService(
  dbPath: string,
  overrides?: Partial<BackupConfig>,
): DatabaseBackupService {
  if (instance) {
    backupLog.warn('[DatabaseBackupService] Already initialized, returning existing instance');
    return instance;
  }
  instance = new DatabaseBackupService(dbPath, overrides);
  return instance;
}

/**
 * Get the initialized DatabaseBackupService singleton.
 * Throws if not yet initialized.
 */
export function getDatabaseBackupService(): DatabaseBackupService {
  if (!instance) {
    throw new Error('[DatabaseBackupService] Not initialized. Call initializeDatabaseBackupService() first.');
  }
  return instance;
}

/**
 * Reset singleton (for testing).
 */
export function resetDatabaseBackupService(): void {
  instance = null;
}
