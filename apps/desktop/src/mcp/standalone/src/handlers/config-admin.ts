/**
 * TICKET_1302 U8 configuration, backup, and runtime administration tools.
 */

import * as path from 'path';
import {
  SYSTEM_CONFIG_CAPABILITY_DEFAULTS,
  SYSTEM_CONFIG_CAPABILITY_KEYS,
  getSystemConfigCapabilityValue,
  systemConfigChangeRequiresRestart,
  validateSystemConfigCapabilitySnapshot,
  validateSystemConfigCapabilityValue,
  type SystemConfigCapabilityKey,
} from '@StratCraft/types';
import { readJsoncConfigFile, updateJsoncConfigValue } from '@StratCraft/config-file';
import { resolveUserDataDir } from '../db';
import { discoverServiceApi } from '../bridge/discovery';
import type { ServiceApiConfig } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';
import { electronNotRunning } from './electron-guard';
import type { McpToolResult } from './tool-result';

export type SystemConfigChange = {
  key: SystemConfigCapabilityKey;
  value: unknown;
};

function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): McpToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    }],
    isError: true,
  };
}

export function resolveSystemConfigPath(): string {
  return path.join(resolveUserDataDir(), 'config', 'StratCraft.config.jsonc');
}

function resolvedCapabilitySnapshot(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SYSTEM_CONFIG_CAPABILITY_KEYS.map(key => [
    key,
    getSystemConfigCapabilityValue(config, key) ?? SYSTEM_CONFIG_CAPABILITY_DEFAULTS[key],
  ]));
}

function nestedCapabilityDocument(snapshot: Record<string, unknown>): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    let target = document;
    const segments = key.split('.');
    for (const segment of segments.slice(0, -1)) {
      target[segment] ??= {};
      target = target[segment] as Record<string, unknown>;
    }
    target[segments[segments.length - 1]] = value;
  }
  return document;
}

export function handleGetConfig(params: {
  keys?: SystemConfigCapabilityKey[];
} = {}): McpToolResult {
  try {
    const snapshot = resolvedCapabilitySnapshot(readJsoncConfigFile(resolveSystemConfigPath()));
    const keys = params.keys ?? [...SYSTEM_CONFIG_CAPABILITY_KEYS];
    return jsonResult({
      values: Object.fromEntries(keys.map(key => [key, snapshot[key]])),
    });
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleSetConfig(params: {
  change: SystemConfigChange;
}): Promise<McpToolResult> {
  try {
    const { key } = params.change;
    const value = validateSystemConfigCapabilityValue(key, params.change.value);
    const configPath = resolveSystemConfigPath();
    const existing = readJsoncConfigFile(configPath);
    const snapshot = resolvedCapabilitySnapshot(existing);
    const previousValue = snapshot[key];
    snapshot[key] = value;
    const validation = validateSystemConfigCapabilitySnapshot(
      nestedCapabilityDocument(snapshot),
    );
    if (!validation.valid) {
      throw new Error(validation.errors.map(item => item.message).join('; '));
    }
    await updateJsoncConfigValue(configPath, key, value);
    return jsonResult({
      success: true,
      key,
      value,
      changed: JSON.stringify(previousValue) !== JSON.stringify(value),
      requiresRestart: systemConfigChangeRequiresRestart(key),
    });
  } catch (error) {
    return errorResult(error);
  }
}

export function handleValidateConfig(): McpToolResult {
  try {
    const snapshot = resolvedCapabilitySnapshot(readJsoncConfigFile(resolveSystemConfigPath()));
    return jsonResult(validateSystemConfigCapabilitySnapshot(
      nestedCapabilityDocument(snapshot),
    ));
  } catch (error) {
    return errorResult(error);
  }
}

async function runtimeCall(
  operation: string,
  call: (config: ServiceApiConfig) => Promise<apiClient.ApiResponse>,
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning(operation);
  try {
    const response = await call(config);
    if (response.unreachable) return electronNotRunning(operation);
    return response.success ? jsonResult(response) : errorResult(response.error ?? 'Unknown error');
  } catch (error) {
    return errorResult(error);
  }
}

export const handleReloadConfig = (): Promise<McpToolResult> =>
  runtimeCall('Reload configuration', apiClient.reloadSystemConfig);
export const handleGetConfigHealth = (): Promise<McpToolResult> =>
  runtimeCall('Get configuration health', apiClient.getSystemConfigHealth);
export const handleGetMachineInfo = (): Promise<McpToolResult> =>
  runtimeCall('Get machine information', apiClient.getMachineInfo);
export const handleBackupDatabase = (): Promise<McpToolResult> =>
  runtimeCall('Backup database', apiClient.backupDatabase);
export const handleListDatabaseBackups = (): Promise<McpToolResult> =>
  runtimeCall('List database backups', apiClient.listDatabaseBackups);
export const handleRestoreDatabase = (
  params: { backup_filename: string; confirm: boolean },
): Promise<McpToolResult> =>
  runtimeCall('Restore database', config => apiClient.restoreDatabase(config, {
    backup_id: params.backup_filename,
    confirm: params.confirm,
  }));
