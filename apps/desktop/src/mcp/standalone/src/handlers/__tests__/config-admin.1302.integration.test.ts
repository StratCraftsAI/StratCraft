/**
 * TICKET_1302 U8 integration: MCP handler -> shared JSONC store and
 * MCP handler -> runtime Service API adapter boundaries.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  reload: vi.fn(),
  health: vi.fn(),
  machine: vi.fn(),
  backup: vi.fn(),
  listBackups: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('../../bridge/discovery', () => ({
  discoverServiceApi: mocks.discover,
}));
vi.mock('../../bridge/api-client', () => ({
  reloadSystemConfig: mocks.reload,
  getSystemConfigHealth: mocks.health,
  getMachineInfo: mocks.machine,
  backupDatabase: mocks.backup,
  listDatabaseBackups: mocks.listBackups,
  restoreDatabase: mocks.restore,
}));

import {
  handleBackupDatabase,
  handleGetConfig,
  handleGetConfigHealth,
  handleGetMachineInfo,
  handleListDatabaseBackups,
  handleReloadConfig,
  handleRestoreDatabase,
  handleSetConfig,
  handleValidateConfig,
} from '../config-admin';

let userDataDirectory: string;

function payload(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  vi.clearAllMocks();
  userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qnx-u8-config-'));
  process.env.STRATCRAFT_MCP_USERDATA_DIR = userDataDirectory;
});

afterEach(() => {
  delete process.env.STRATCRAFT_MCP_USERDATA_DIR;
  fs.rmSync(userDataDirectory, { recursive: true, force: true });
});

describe('U8 Class-S configuration handlers', () => {
  it('returns defaults and supports an allowlisted key projection without Electron', () => {
    expect(payload(handleGetConfig({ keys: ['performance.maxBacktestTasks'] }))).toEqual({
      values: { 'performance.maxBacktestTasks': 3 },
    });
  });

  it('writes one typed field, preserves other JSONC content, and reports restart semantics', async () => {
    const configDirectory = path.join(userDataDirectory, 'config');
    fs.mkdirSync(configDirectory, { recursive: true });
    const configPath = path.join(configDirectory, 'StratCraft.config.jsonc');
    fs.writeFileSync(configPath, '{\n // keep\n "performance": { "maxBacktestTasks": 3 }\n}\n');

    const result = await handleSetConfig({
      change: { key: 'performance.maxBacktestTasks', value: 4 },
    });
    expect(result.isError).toBeUndefined();
    expect(payload(result)).toMatchObject({
      success: true,
      changed: true,
      requiresRestart: false,
    });
    expect(fs.readFileSync(configPath, 'utf8')).toContain('// keep');

    const restartResult = await handleSetConfig({
      change: { key: 'paths.plugins', value: ['/plugins'] },
    });
    expect(payload(restartResult)).toMatchObject({ requiresRestart: true });
  });

  it('rejects invalid values, aggregate caps, and malformed files before writing', async () => {
    expect((await handleSetConfig({
      change: { key: 'performance.maxBacktestTasks', value: 0 },
    })).isError).toBe(true);

    await handleSetConfig({
      change: { key: 'resourceGovernance.lstm.capPercent', value: 20 },
    });
    await handleSetConfig({
      change: { key: 'resourceGovernance.sweep.capPercent', value: 40 },
    });
    const aggregate = await handleSetConfig({
      change: { key: 'resourceGovernance.mining.capPercent', value: 40 },
    });
    expect(aggregate.isError).toBe(true);
    expect(JSON.stringify(payload(aggregate))).toContain('combined caps');

    const configPath = path.join(userDataDirectory, 'config', 'StratCraft.config.jsonc');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{broken');
    expect(handleValidateConfig().isError).toBe(true);
    expect(handleGetConfig().isError).toBe(true);
  });

  it('validates the complete default snapshot', () => {
    expect(payload(handleValidateConfig())).toEqual({ valid: true, errors: [] });
  });
});

describe('U8 Class-R administration handlers', () => {
  const service = { baseUrl: 'http://127.0.0.1:1', token: 'token' };

  it('returns the canonical Electron-down error for all runtime owners', async () => {
    mocks.discover.mockReturnValue(null);
    for (const call of [
      handleReloadConfig,
      handleGetConfigHealth,
      handleGetMachineInfo,
      handleBackupDatabase,
      handleListDatabaseBackups,
      () => handleRestoreDatabase({ backup_filename: 'backup.db', confirm: true }),
    ]) {
      const result = await call();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Electron');
    }
  });

  it('propagates success, domain failure, unreachable, exception, and restore arguments', async () => {
    mocks.discover.mockReturnValue(service);
    mocks.reload.mockResolvedValue({ success: true, health: { status: 'healthy' } });
    expect(payload(await handleReloadConfig())).toMatchObject({ success: true });

    mocks.health.mockResolvedValue({ success: false, error: 'invalid config' });
    expect((await handleGetConfigHealth()).isError).toBe(true);
    mocks.health.mockResolvedValue({ success: false });
    expect((await handleGetConfigHealth()).content[0].text).toContain('Unknown error');

    mocks.machine.mockResolvedValue({ success: false, unreachable: true, error: 'refused' });
    expect((await handleGetMachineInfo()).content[0].text).toContain('Electron');

    mocks.backup.mockRejectedValue(new Error('backup failed'));
    expect((await handleBackupDatabase()).isError).toBe(true);

    mocks.listBackups.mockResolvedValue({ success: true, backups: [] });
    expect(payload(await handleListDatabaseBackups())).toMatchObject({ backups: [] });

    mocks.restore.mockResolvedValue({ success: true, staged: true });
    await handleRestoreDatabase({ backup_filename: 'StratCraft_test.db', confirm: true });
    expect(mocks.restore).toHaveBeenCalledWith(service, {
      backup_id: 'StratCraft_test.db',
      confirm: true,
    });
  });
});
