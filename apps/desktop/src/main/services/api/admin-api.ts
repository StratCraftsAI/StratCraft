/**
 * TICKET_1302 U8 live runtime administration operations.
 */

import { getConfigService } from '../config-service';
import { getComputeEnvironment } from '../compute-environment';
import {
  backupDatabase,
  listDatabaseBackups,
  restoreDatabase,
} from '../../ipc/backup-handlers';

export async function reloadConfig(): Promise<unknown> {
  const service = getConfigService();
  const result = await service.reload();
  return result.accepted
    ? { success: true, health: service.getConfigHealth() }
    : { success: false, error: result.error, health: service.getConfigHealth() };
}

export function getConfigHealth(): unknown {
  return { success: true, health: getConfigService().getConfigHealth() };
}

export async function getMachineInfo(): Promise<unknown> {
  const state = await getComputeEnvironment().probe();
  return {
    success: true,
    machine: {
      cpuCores: state.totalCores,
      cpuAvailable: state.cpuAvailable,
      cpuUtilization: state.cpuUtilization,
      ramBytes: Math.round(state.memTotalMB * 1024 * 1024),
      ramAvailableBytes: Math.round(state.memAvailableMB * 1024 * 1024),
      memoryUtilization: state.memUtilization,
      swapTotalBytes: Math.round(state.swapTotalMB * 1024 * 1024),
      swapUsedBytes: Math.round(state.swapUsedMB * 1024 * 1024),
      probedAt: state.probedAt,
    },
  };
}

export async function createDatabaseBackup(): Promise<unknown> {
  const result = await backupDatabase();
  return {
    success: true,
    filename: result.path.split(/[\\/]/).pop(),
  };
}

export async function getDatabaseBackups(): Promise<unknown> {
  const result = listDatabaseBackups();
  return {
    success: true,
    backups: result.backups.map(({ filename, timestamp, size }) => ({
      filename,
      timestamp,
      size,
    })),
  };
}

export async function stageDatabaseRestore(body: Record<string, unknown>): Promise<unknown> {
  if (body.confirm !== true) {
    return { success: false, error: 'restore_database requires confirm=true' };
  }
  if (typeof body.backup_id !== 'string' || body.backup_id.length === 0) {
    return { success: false, error: 'backup_id is required' };
  }
  if (body.backup_id.includes('/') || body.backup_id.includes('\\')) {
    return {
      success: false,
      error: 'backup_id must be a filename returned by list_database_backups',
    };
  }
  return restoreDatabase(body.backup_id);
}
