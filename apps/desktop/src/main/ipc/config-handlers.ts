/**
 * Config IPC Handlers
 *
 * TICKET_046: System-Level Configuration Implementation
 * IPC handlers for configuration management.
 */

import os from 'os';
import { ipcMain, BrowserWindow } from 'electron';
import { getConfigService } from '../services/config-service';
import type { ConfigHealth } from '../services/config-service';
import type { SystemConfig, ConfigChangeEvent } from '../../shared/types/config';
import { appLog } from '../utils/logger';
import { getMachineInfo } from '../services/api/admin-api';

// =============================================================================
// IPC Channel Names
// =============================================================================

export const CONFIG_CHANNELS = {
  GET: 'config:get',
  GET_ALL: 'config:getAll',
  SET: 'config:set',
  RELOAD: 'config:reload',
  VALIDATE: 'config:validate',
  DETECT_OPTIMAL_BACKTEST_TASKS: 'config:detectOptimalBacktestTasks',
  GET_MACHINE_INFO: 'config:getMachineInfo',
  // TICKET_641_3: Config health status
  GET_HEALTH: 'config:getHealth',
  // Events (main -> renderer)
  CHANGED: 'config:changed',
  RELOADED: 'config:reloaded',
  CONFIG_HEALTH_CHANGED: 'config:healthChanged',
} as const;

// =============================================================================
// Handler Registration
// =============================================================================

/**
 * Register all config IPC handlers
 */
export function registerConfigHandlers(): void {
  const configService = getConfigService();

  // ---------------------------------------------------------------------------
  // config:get - Get a single config value by path
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.GET, async (_event, path: string) => {
    try {
      const value = configService.get(path);
      return { success: true, value };
    } catch (error) {
      appLog.error('config:get error:', error);
      return { success: false, error: String(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // config:getAll - Get entire configuration
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.GET_ALL, async () => {
    try {
      const config = configService.getAll();
      return { success: true, config };
    } catch (error) {
      appLog.error('config:getAll error:', error);
      return { success: false, error: String(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // config:set - Set a config value
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    CONFIG_CHANNELS.SET,
    async (_event, path: string, value: unknown) => {
      appLog.debug(`[CONFIG] config:set called - path: ${path}, value: ${JSON.stringify(value)}`);
      try {
        const changeEvent = await configService.set(path, value);
        appLog.debug(`[CONFIG] config:set result - changed: ${changeEvent !== null}`);
        return {
          success: true,
          changed: changeEvent !== null,
          requiresRestart: changeEvent?.requiresRestart ?? false,
        };
      } catch (error) {
        appLog.error('config:set error:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // config:reload - Force reload configuration from file
  // TICKET_641_3: Returns health info when reload is rejected due to parse errors
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.RELOAD, async () => {
    try {
      const result = await configService.reload();
      if (!result.accepted) {
        return {
          success: false,
          error: result.error,
          health: configService.getConfigHealth(),
        };
      }
      return { success: true };
    } catch (error) {
      appLog.error('config:reload error:', error);
      return { success: false, error: String(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // config:validate - Validate current configuration
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.VALIDATE, async () => {
    try {
      const result = configService.validate();
      return { success: true, ...result };
    } catch (error) {
      appLog.error('config:validate error:', error);
      return { success: false, error: String(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // config:getHealth - Get config health status (TICKET_641_3)
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.GET_HEALTH, async () => {
    try {
      const health = configService.getConfigHealth();
      return { success: true, health };
    } catch (error) {
      appLog.error('config:getHealth error:', error);
      return { success: false, error: String(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // config:detectOptimalBacktestTasks - Auto-detect optimal concurrency
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.DETECT_OPTIMAL_BACKTEST_TASKS, () => {
    const cpuCount = os.cpus().length;
    const optimal = Math.max(1, Math.floor(cpuCount / 2));
    appLog.info(`[CONFIG] detectOptimalBacktestTasks: cpuCount=${cpuCount}, optimal=${optimal}`);
    return optimal;
  });

  // ---------------------------------------------------------------------------
  // config:getMachineInfo - CPU cores + total RAM for pre-run time estimation
  // ---------------------------------------------------------------------------
  ipcMain.handle(CONFIG_CHANNELS.GET_MACHINE_INFO, async () => {
    const result = await getMachineInfo() as {
      success: true;
      machine: Record<string, unknown>;
    };
    return result.machine;
  });

  // ---------------------------------------------------------------------------
  // Event Forwarding to Renderer
  // ---------------------------------------------------------------------------
  configService.on('changed', (event: ConfigChangeEvent) => {
    broadcastToAllWindows(CONFIG_CHANNELS.CHANGED, event);
  });

  configService.on('reloaded', () => {
    broadcastToAllWindows(CONFIG_CHANNELS.RELOADED, {});
  });

  // TICKET_641_3: Forward config health changes to renderer
  configService.on('configHealthChanged', (health: ConfigHealth) => {
    broadcastToAllWindows(CONFIG_CHANNELS.CONFIG_HEALTH_CHANGED, health);
  });

  appLog.info('Config IPC handlers registered');
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Broadcast message to all renderer windows
 */
function broadcastToAllWindows(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}
