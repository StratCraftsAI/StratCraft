/**
 * Database Backup IPC Handlers
 *
 * TICKET_580_5: Automatic Backup and Recovery
 *
 * Handles:
 * - Manual backup creation
 * - Restore from backup
 * - List available backups
 */

import { ipcMain } from 'electron';
import { ipcLog } from '../utils/logger';
import { getDatabaseManager } from '../database/db-manager';
import { getDatabaseBackupService } from '../services/database-backup-service';
import type { BackupInfo } from '../services/database-backup-service';
import { BackupKeyRegistry } from '../services/backup-key-registry';
import { getSecureCredentialService } from '../services/secure-credential-service';
import { CREDENTIAL_CHANNELS } from '../../shared/constants/channels';

// Channel constants
const BACKUP_CHANNELS = {
  BACKUP: 'v3:database:backup',
  RESTORE: 'v3:database:restore',
  LIST_BACKUPS: 'v3:database:list-backups',
} as const;

export async function backupDatabase(): Promise<{ success: true; path: string }> {
  const db = getDatabaseManager();
  const backupService = getDatabaseBackupService();
  const backupPath = await backupService.createBackup(db, 'manual');
  ipcLog.info('[BackupHandlers] Manual backup created:', backupPath);
  return { success: true, path: backupPath };
}

export function listDatabaseBackups(): { success: true; backups: BackupInfo[] } {
  return { success: true, backups: getDatabaseBackupService().listBackups() };
}

export function restoreDatabase(backupId: string): {
  success: true;
  staged: true;
  backupId: string;
  requiresApplicationRestart: true;
} {
  const dbPath = getDatabaseManager().getPath();
  const result = getDatabaseBackupService().stageRestore(dbPath, backupId);
  return { success: true, ...result };
}

export function registerBackupHandlers(): void {
  // Manual backup
  ipcMain.handle(BACKUP_CHANNELS.BACKUP, async () => {
    try {
      return await backupDatabase();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('[BackupHandlers] Manual backup failed:', msg);
      return { success: false, errorMessage: msg };
    }
  });

  // Restore from backup
  ipcMain.handle(BACKUP_CHANNELS.RESTORE, async (_event, backupPath: string) => {
    try {
      if (!backupPath || typeof backupPath !== 'string') {
        return { success: false, errorMessage: 'Invalid backup path', i18nKey: 'backup.validation.invalidBackupPath' };
      }

      const backupId = backupPath.split(/[\\/]/).pop() ?? '';
      const result = restoreDatabase(backupId);
      ipcLog.info('[BackupHandlers] Database restore staged:', result.backupId);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('[BackupHandlers] Restore failed:', msg);
      return { success: false, errorMessage: msg };
    }
  });

  // List available backups
  ipcMain.handle(BACKUP_CHANNELS.LIST_BACKUPS, async () => {
    try {
      return listDatabaseBackups();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ipcLog.error('[BackupHandlers] List backups failed:', msg);
      return { success: false, backups: [], errorMessage: msg };
    }
  });

  ipcMain.handle(
    CREDENTIAL_CHANNELS.EXPORT_BACKUP_RECOVERY_BUNDLE,
    async (_event, backupFilename: string, passphrase: string) => {
      const backup = getDatabaseBackupService().listBackups()
        .find(candidate => candidate.filename === backupFilename);
      if (!backup) {
        return { success: false, errorMessage: 'The selected database backup is not retained.' };
      }
      try {
        const db = getDatabaseManager().getDb();
        const selection = new BackupKeyRegistry(db).verifiedRecoverySelection(backup.path);
        return getSecureCredentialService().exportBackupRecoveryBundle(selection, passphrase);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ipcLog.error('[BackupHandlers] Recovery export failed:', errorMessage);
        return { success: false, errorMessage };
      }
    },
  );

  ipcLog.info('[BackupHandlers] Backup handlers registered');
}
