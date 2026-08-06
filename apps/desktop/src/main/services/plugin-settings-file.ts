/**
 * Plugin settings file accessor -- `{userData}/plugins/<id>/config.json`.
 *
 * TICKET_1265_5 D1: single owner of the plugin settings config.json
 * read-modify-write path. Extracted from the `plugin:setConfig` IPC handler
 * so that every main-process writer (IPC handler, llm-selection-store)
 * shares ONE per-plugin write lock. Two independent lock domains over the
 * same file would reintroduce the read-modify-write race the IPC handler's
 * lock was built to prevent (TICKET_093).
 *
 * TICKET_1276: the MCP standalone server writes the strategy-builder
 * config.json too (LLM selection), so the actual read-modify-write is
 * delegated to `@StratCraft/config-file` -- cross-process advisory lock +
 * atomic tmp/fsync/rename. The in-process promise chain is kept on top so
 * same-process callers queue instead of spinning on the lock.
 *
 * Not to be confused with PluginConfigManager, which owns the separate
 * `user-config.json` (Layer 3 service entitlement preferences).
 */

import { app } from 'electron';
import * as path from 'path';
import { readJsonConfigFile, updateJsonConfigFile } from '@StratCraft/config-file';
import { pluginLog } from '../utils/logger';

const CONFIG_FILENAME = 'config.json';

/** Per-plugin promise chain serializing read-modify-write cycles. */
const writeChains = new Map<string, Promise<unknown>>();

/** Absolute path of a plugin's settings config.json. */
export function getPluginSettingsPath(pluginId: string): string {
  return path.join(app.getPath('userData'), 'plugins', pluginId, CONFIG_FILENAME);
}

/**
 * Read a plugin's settings config.json.
 * Missing file -> `{}`. Invalid JSON throws (TICKET_857 fail fast --
 * callers surface the error instead of silently resetting user settings).
 */
export function readPluginSettings(pluginId: string): Record<string, unknown> {
  return readJsonConfigFile(getPluginSettingsPath(pluginId));
}

/**
 * Merge `patch` into a plugin's settings config.json.
 * Serialized per plugin in-process (promise chain) and across processes
 * (config-file advisory lock). Returns the merged config as written.
 */
export function updatePluginSettings(
  pluginId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const doWrite = async (): Promise<Record<string, unknown>> => {
    const config = await updateJsonConfigFile(getPluginSettingsPath(pluginId), patch);
    pluginLog.debug(`Updated plugin settings for ${pluginId}: ${Object.keys(patch).join(', ')}`);
    return config;
  };

  // Chain writes: wait for the previous write to this plugin's config
  // before starting, whether it succeeded or failed.
  const prev = writeChains.get(pluginId) ?? Promise.resolve();
  const current = prev.then(doWrite, doWrite);
  writeChains.set(pluginId, current);
  return current;
}
