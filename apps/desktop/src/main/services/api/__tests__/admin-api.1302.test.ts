import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  health: vi.fn(),
  probe: vi.fn(),
  backup: vi.fn(),
  list: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('../../config-service', () => ({
  getConfigService: () => ({
    reload: mocks.reload,
    getConfigHealth: mocks.health,
  }),
}));
vi.mock('../../compute-environment', () => ({
  getComputeEnvironment: () => ({ probe: mocks.probe }),
}));
vi.mock('../../../ipc/backup-handlers', () => ({
  backupDatabase: mocks.backup,
  listDatabaseBackups: mocks.list,
  restoreDatabase: mocks.restore,
}));

import {
  createDatabaseBackup,
  getConfigHealth,
  getDatabaseBackups,
  getMachineInfo,
  reloadConfig,
  stageDatabaseRestore,
} from '../admin-api';

describe('U8 admin Service API owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns accepted and rejected reload health from the same config service', async () => {
    mocks.health.mockReturnValue({ status: 'healthy' });
    mocks.reload.mockResolvedValue({ accepted: true });
    await expect(reloadConfig()).resolves.toEqual({
      success: true,
      health: { status: 'healthy' },
    });
    mocks.reload.mockResolvedValue({ accepted: false, error: 'parse failure' });
    await expect(reloadConfig()).resolves.toEqual({
      success: false,
      error: 'parse failure',
      health: { status: 'healthy' },
    });
    expect(getConfigHealth()).toEqual({
      success: true,
      health: { status: 'healthy' },
    });
  });

  it('maps the authoritative live compute probe without recomputing capacity', async () => {
    mocks.probe.mockResolvedValue({
      totalCores: 8,
      cpuAvailable: 3.5,
      cpuUtilization: 0.5,
      memTotalMB: 100,
      memAvailableMB: 40,
      memUtilization: 0.6,
      swapTotalMB: 20,
      swapUsedMB: 5,
      probedAt: 123,
    });
    await expect(getMachineInfo()).resolves.toEqual({
      success: true,
      machine: {
        cpuCores: 8,
        cpuAvailable: 3.5,
        cpuUtilization: 0.5,
        ramBytes: 104857600,
        ramAvailableBytes: 41943040,
        memoryUtilization: 0.6,
        swapTotalBytes: 20971520,
        swapUsedBytes: 5242880,
        probedAt: 123,
      },
    });
  });

  it('delegates backup/list and enforces restore confirmation and filename', async () => {
    mocks.backup.mockReturnValue({
      success: true,
      path: '/private/backups/StratCraft_backup.db',
    });
    mocks.list.mockReturnValue({
      success: true,
      backups: [{
        path: '/private/backups/StratCraft_backup.db',
        filename: 'StratCraft_backup.db',
        timestamp: 123,
        size: 456,
      }],
    });
    await expect(createDatabaseBackup()).resolves.toEqual({
      success: true,
      filename: 'StratCraft_backup.db',
    });
    await expect(getDatabaseBackups()).resolves.toEqual({
      success: true,
      backups: [{
        filename: 'StratCraft_backup.db',
        timestamp: 123,
        size: 456,
      }],
    });
    await expect(stageDatabaseRestore({ backup_id: 'x.db', confirm: false })).resolves.toEqual({
      success: false,
      error: 'restore_database requires confirm=true',
    });
    await expect(stageDatabaseRestore({ confirm: true })).resolves.toEqual({
      success: false,
      error: 'backup_id is required',
    });
    await expect(stageDatabaseRestore({
      backup_id: '../StratCraft_backup.db',
      confirm: true,
    })).resolves.toEqual({
      success: false,
      error: 'backup_id must be a filename returned by list_database_backups',
    });
    mocks.restore.mockReturnValue({ success: true, staged: true });
    await expect(stageDatabaseRestore({ backup_id: 'x.db', confirm: true })).resolves.toEqual({
      success: true,
      staged: true,
    });
    expect(mocks.restore).toHaveBeenCalledWith('x.db');
  });
});
