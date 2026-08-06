/**
 * TICKET_561: One-time data migration from old app name (@quantnexus) to new (@StratCraft).
 *
 * Copies user data from the old userData directory to the new one on first launch
 * after the rename. Must run BEFORE database init, plugin discovery, or any other
 * service that reads from userData.
 *
 * Safety:
 * - Copy only (old data preserved as backup)
 * - No overwrite (skip directories that already have content)
 * - Marker file prevents re-runs
 * - Partial failure does not block app startup
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { appLog } from '../utils/logger';

const OLD_APP_DIR_NAME = '@quantnexus';
const OLD_DESKTOP_DIR_NAME = 'desktop';
const MIGRATION_MARKER = '.migration-561-complete';

/**
 * TICKET_560_2: Structured result from data migration for startup audit persistence.
 */
export interface MigrationResult {
  status: 'skipped' | 'fresh_install' | 'migrated' | 'error';
  dirsCopied: number;
  filesCopied: number;
  filesSkipped: number;
  error?: string;
}

const DIRECTORIES_TO_MIGRATE = [
  'plugins',
  'data',
  'strategies',
  'config',
  'backtest-results',
  'plugin-data',
];

// TICKET_589 / TICKET_1276 P0: secure-credentials.json is not file-copied here.
// Credential migration is handled inside SecureCredentialService: the legacy
// safeStorage store is decrypted and rewritten into the shared secure-store, and
// legacy pluginIds are consolidated at key level (not file-level copy).
const FILES_TO_MIGRATE: string[] = [];

/**
 * Recursively copy a directory.
 * Does NOT overwrite existing files in the destination.
 */
function copyDirRecursive(src: string, dest: string): { copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const result = copyDirRecursive(srcPath, destPath);
      copied += result.copied;
      skipped += result.skipped;
    } else {
      if (fs.existsSync(destPath)) {
        skipped++;
      } else {
        fs.copyFileSync(srcPath, destPath);
        copied++;
      }
    }
  }

  return { copied, skipped };
}

/**
 * Check if a directory exists and has at least one non-hidden entry.
 * Hidden entries (dot-prefixed like .backups) are ignored because they may be
 * created by the app/Electron on first launch before migration runs.
 */
function dirHasContent(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  const entries = fs.readdirSync(dirPath);
  return entries.some((entry) => !entry.startsWith('.'));
}

/**
 * Compute the old userData path based on the current one.
 *
 * Current: /home/user/.config/@StratCraft/desktop
 * Old:     /home/user/.config/@quantnexus/desktop
 *
 * Works on all platforms because we derive from app.getPath('userData').
 */
function getOldUserDataPath(): string {
  const currentUserData = app.getPath('userData');
  // Go up two levels (past "desktop" and "@StratCraft"), then join old path
  const grandParent = path.dirname(path.dirname(currentUserData));
  return path.join(grandParent, OLD_APP_DIR_NAME, OLD_DESKTOP_DIR_NAME);
}

/**
 * Run one-time data migration from old @quantnexus userData to new @StratCraft userData.
 *
 * Must be called BEFORE getDatabaseManager(), registerIpcHandlers(), and any plugin discovery.
 */
export async function migrateFromOldAppName(): Promise<MigrationResult> {
  const newUserData = app.getPath('userData');
  const markerPath = path.join(newUserData, MIGRATION_MARKER);

  // Already migrated
  if (fs.existsSync(markerPath)) {
    appLog.debug('[Migration-561] Migration marker found, skipping');
    return { status: 'skipped', dirsCopied: 0, filesCopied: 0, filesSkipped: 0 };
  }

  const oldUserData = getOldUserDataPath();

  // No old data (fresh install)
  if (!fs.existsSync(oldUserData)) {
    appLog.info('[Migration-561] No old userData found at:', oldUserData);
    writeMarker(markerPath);
    return { status: 'fresh_install', dirsCopied: 0, filesCopied: 0, filesSkipped: 0 };
  }

  appLog.info('[Migration-561] Starting data migration');
  appLog.info('[Migration-561] Old path:', oldUserData);
  appLog.info('[Migration-561] New path:', newUserData);

  let hasError = false;
  let firstError: string | undefined;
  let totalDirsCopied = 0;
  let totalFilesCopied = 0;
  let totalFilesSkipped = 0;

  // Migrate directories
  for (const dir of DIRECTORIES_TO_MIGRATE) {
    const srcDir = path.join(oldUserData, dir);
    const destDir = path.join(newUserData, dir);

    if (!fs.existsSync(srcDir)) {
      appLog.debug(`[Migration-561] Source dir not found, skipping: ${dir}`);
      continue;
    }

    if (dirHasContent(destDir)) {
      appLog.info(`[Migration-561] Destination already has content, skipping: ${dir}`);
      continue;
    }

    try {
      const result = copyDirRecursive(srcDir, destDir);
      appLog.info(`[Migration-561] Migrated ${dir}: ${result.copied} files copied, ${result.skipped} skipped`);
      totalDirsCopied++;
      totalFilesCopied += result.copied;
      totalFilesSkipped += result.skipped;
    } catch (error) {
      appLog.error(`[Migration-561] Failed to migrate ${dir}:`, error);
      hasError = true;
      if (!firstError) {
        firstError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  // Migrate individual files
  for (const file of FILES_TO_MIGRATE) {
    const srcFile = path.join(oldUserData, file);
    const destFile = path.join(newUserData, file);

    if (!fs.existsSync(srcFile)) {
      appLog.debug(`[Migration-561] Source file not found, skipping: ${file}`);
      continue;
    }

    if (fs.existsSync(destFile)) {
      appLog.info(`[Migration-561] Destination file already exists, skipping: ${file}`);
      totalFilesSkipped++;
      continue;
    }

    try {
      fs.copyFileSync(srcFile, destFile);
      appLog.info(`[Migration-561] Migrated file: ${file}`);
      totalFilesCopied++;
    } catch (error) {
      appLog.error(`[Migration-561] Failed to migrate file ${file}:`, error);
      hasError = true;
      if (!firstError) {
        firstError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  // Only write marker if no errors (allows retry on next launch)
  if (hasError) {
    appLog.warn('[Migration-561] Migration completed with errors. Marker NOT written (will retry next launch).');
    return {
      status: 'error',
      dirsCopied: totalDirsCopied,
      filesCopied: totalFilesCopied,
      filesSkipped: totalFilesSkipped,
      error: firstError,
    };
  } else {
    writeMarker(markerPath);
    appLog.info('[Migration-561] Migration completed successfully');
    return {
      status: 'migrated',
      dirsCopied: totalDirsCopied,
      filesCopied: totalFilesCopied,
      filesSkipped: totalFilesSkipped,
    };
  }
}

function writeMarker(markerPath: string): void {
  try {
    fs.writeFileSync(markerPath, `Migration completed at ${new Date().toISOString()}\n`);
  } catch (error) {
    appLog.error('[Migration-561] Failed to write migration marker (migration will re-run on next startup):', error);
    throw error;
  }
}
