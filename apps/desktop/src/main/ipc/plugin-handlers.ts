/**
 * Plugin system IPC handlers
 *
 * Handle plugin-related requests from renderer process
 */

import { ipcMain, app, dialog, Notification, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import Store from 'electron-store';
import { pluginLog } from '../utils/logger';
import { getEntitlementEnforcer } from '../services/entitlement-enforcer';
import { isMarketplacePluginInstalled } from '../utils/plugin-install-checker';
import { getPluginProcessManager } from '../services/plugin-process-manager';
import { getPluginStatusRegistry } from '../services/plugin-status-registry';
import { readPluginSettings, updatePluginSettings } from '../services/plugin-settings-file';
import {
  getPluginMarketData,
  getPluginMarketSymbols,
} from '../services/api/market-data-read-api';
import type { PluginManifest } from '../../shared/types/plugin';
import { ERROR_MESSAGES } from '../constants/error-messages';

// =============================================================================
// Store initialization
// =============================================================================

const store = new Store({
  name: 'plugin-data',
  defaults: {},
});

// =============================================================================
// Plugin path configuration
// =============================================================================

/**
 * Get plugin paths for dual-path loading
 *
 * 1. Bundled plugins: Shipped with the app (read-only)
 * 2. User plugins: Downloaded/installed by user (read-write)
 */
function getPluginPaths(): { bundled: string; user: string } {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  // Bundled plugins path
  // Dev: plugins submodule is at project root (../../plugins from apps/desktop)
  // TICKET_264: Use app.getAppPath() instead of process.cwd() for reliable path resolution
  // process.cwd() depends on where the app was started from, which varies with turbo/pnpm
  // app.getAppPath() always returns the correct app directory (apps/desktop in dev)
  const bundledPath = isDev
    ? path.join(app.getAppPath(), '../../plugins')
    : path.join(process.resourcesPath, 'bundled_plugins'); // Prod: extraResources

  // User plugins path
  const userPath = path.join(app.getPath('userData'), 'plugins');

  return { bundled: bundledPath, user: userPath };
}

// =============================================================================
// Security path validation
// =============================================================================

function getAllowedBasePaths(): string[] {
  const { bundled, user } = getPluginPaths();
  return [
    user,
    bundled,
    app.getPath('userData'),
    // Dev environment
    process.cwd(),
  ];
}

function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const allowedPaths = getAllowedBasePaths();

  // Check if path is under any allowed directory
  return allowedPaths.some(basePath => {
    const resolvedBase = path.resolve(basePath);
    return resolved.startsWith(resolvedBase);
  });
}

function assertPathAllowed(targetPath: string): void {
  if (!isPathAllowed(targetPath)) {
    throw new Error(ERROR_MESSAGES.PLUGIN_ACCESS_DENIED);
  }
}

// =============================================================================
// Plugin manifest lookup (shared utility)
// =============================================================================

/**
 * Find a plugin manifest by plugin ID across bundled and user paths.
 * Returns the parsed manifest or null if not found.
 */
async function findPluginManifest(pluginId: string): Promise<PluginManifest | null> {
  const paths = getPluginPaths();

  for (const basePath of [paths.bundled, paths.user]) {
    if (!fs.existsSync(basePath)) continue;

    const entries = await fs.promises.readdir(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const pluginDir = path.join(basePath, entry.name);
      const manifestPath = path.join(pluginDir, 'manifest.json');

      try {
        const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);

        if (manifest.id === pluginId || entry.name === pluginId) {
          return manifest as PluginManifest;
        }
      } catch {
        // No valid manifest, continue
      }
    }
  }

  return null;
}

// =============================================================================
// Plugin filesystem handlers
// =============================================================================

function registerPluginFileHandlers(): void {
  // Get plugin paths (bundled + user)
  ipcMain.handle('plugin:getPaths', async () => {
    const paths = getPluginPaths();
    pluginLog.info('Plugin paths:', paths);
    return paths;
  });

  // Scan all plugins from both paths
  ipcMain.handle('plugin:scanAll', async () => {
    const paths = getPluginPaths();
    const enforcer = getEntitlementEnforcer();
    const allPlugins: Array<{
      id: string;
      path: string;
      source: 'bundled' | 'user';
      manifest: unknown;
    }> = [];

    // Helper to scan a directory
    async function scanDirectory(baseDir: string, source: 'bundled' | 'user') {
      try {
        if (!fs.existsSync(baseDir)) {
          pluginLog.debug(`Plugin directory does not exist: ${baseDir}`);
          return;
        }

        const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

          const pluginDir = path.join(baseDir, entry.name);
          const manifestPath = path.join(pluginDir, 'manifest.json');

          try {
            const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(manifestContent);

            // PLUGIN_TICKET_002: Filter marketplace plugins from bundled path
            // Only show marketplace plugins if they are installed via Marketplace
            if (source === 'bundled' && manifest.distribution === 'marketplace') {
              const isInstalled = await isMarketplacePluginInstalled(manifest.id);
              if (!isInstalled) {
                pluginLog.debug(`[PLUGIN_TICKET_002] Skipping uninstalled marketplace plugin: ${manifest.id}`);
                continue;
              }
            }

            allPlugins.push({
              id: manifest.id || entry.name,
              path: pluginDir,
              source,
              manifest,
            });
          } catch {
            // No valid manifest, skip
          }
        }
      } catch (error) {
        pluginLog.error(`Failed to scan ${source} plugins:`, error);
      }
    }

    // Scan both paths
    await scanDirectory(paths.bundled, 'bundled');
    await scanDirectory(paths.user, 'user');

    // User plugins override bundled plugins with same ID
    const pluginMap = new Map<string, typeof allPlugins[0]>();
    for (const plugin of allPlugins) {
      const existing = pluginMap.get(plugin.id);
      // User plugins take precedence
      if (!existing || plugin.source === 'user') {
        pluginMap.set(plugin.id, plugin);
      }
    }

    const result = Array.from(pluginMap.values());

    // TICKET_066: Register plugins with EntitlementEnforcer
    for (const plugin of result) {
      enforcer.registerPlugin(plugin.manifest as PluginManifest);
    }

    pluginLog.info(`Scanned ${result.length} plugins (${allPlugins.length} total, deduplicated): ${result.map(p => `${p.id}[${p.source}]`).join(', ')}`);
    return result;
  });

  // Get plugin directory list (legacy, for specific base dir)
  ipcMain.handle('plugin:getDirectories', async (_event, baseDir: string) => {
    assertPathAllowed(baseDir);

    try {
      const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
      const directories: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          const pluginDir = path.join(baseDir, entry.name);
          const manifestPath = path.join(pluginDir, 'manifest.json');

          // Check if manifest.json exists
          try {
            await fs.promises.access(manifestPath, fs.constants.R_OK);
            directories.push(pluginDir);
          } catch {
            // No manifest.json, skip
          }
        }
      }

      return directories;
    } catch (error) {
      pluginLog.error('Failed to read plugin directories:', error);
      return [];
    }
  });

  // Read file
  ipcMain.handle('plugin:readFile', async (_event, filePath: string) => {
    assertPathAllowed(filePath);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(ERROR_MESSAGES.PLUGIN_READ_FAILED);
    }
  });

  // Get plugin manifest by ID (TICKET_093)
  ipcMain.handle('plugin:getManifest', async (_event, pluginId: string) => {
    try {
      const manifest = await findPluginManifest(pluginId);
      if (!manifest) {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_NOT_FOUND };
      }
      return { success: true, manifest };
    } catch (error) {
      pluginLog.error(`Failed to get manifest for ${pluginId}:`, error);
      return { success: false, error: ERROR_MESSAGES.PLUGIN_MANIFEST_FAILED };
    }
  });

  // Get plugin config (TICKET_093)
  // TICKET_1265_5 D1: reads via the shared plugin-settings-file accessor.
  ipcMain.handle('plugin:getConfig', async (_event, pluginId: string) => {
    try {
      const config = readPluginSettings(pluginId);
      return { success: true, config };
    } catch (error) {
      pluginLog.error(`Failed to get config for ${pluginId}:`, error);
      return { success: false, error: ERROR_MESSAGES.PLUGIN_CONFIG_READ_FAILED };
    }
  });

  // TICKET_1004: Check if plugin is installed via in-memory registry (replaces TICKET_264 filesystem scan)
  ipcMain.handle('plugin:isInstalled', (_event, pluginId: string) => ({
    success: true,
    installed: getPluginStatusRegistry().isInstalled(pluginId),
  }));

  // TICKET_1004: Get full status entry for a single plugin
  ipcMain.handle('plugin:getStatus', (_event, pluginId: string) => {
    const entry = getPluginStatusRegistry().get(pluginId);
    return { success: true, data: entry ?? null };
  });

  // TICKET_1004: Get status entries for all registered plugins
  ipcMain.handle('plugin:getAllStatus', () => ({
    success: true,
    data: getPluginStatusRegistry().getAll(),
  }));

  // Set plugin config value (TICKET_093)
  // TICKET_1265_5 D1: serialized read-modify-write now lives in the shared
  // plugin-settings-file accessor so every main-process writer (this handler,
  // llm-selection-store) uses ONE per-plugin write lock.
  ipcMain.handle('plugin:setConfig', async (_event, pluginId: string, key: string, value: unknown) => {
    try {
      await updatePluginSettings(pluginId, { [key]: value });
      return { success: true };
    } catch (error) {
      pluginLog.error(`Failed to set config for ${pluginId}:`, error);
      return { success: false, error: ERROR_MESSAGES.PLUGIN_CONFIG_WRITE_FAILED };
    }
  });
}

// =============================================================================
// Storage handlers
// =============================================================================

function registerStoreHandlers(): void {
  ipcMain.handle('store:get', async (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('store:delete', async (_event, key: string) => {
    store.delete(key);
  });

  ipcMain.handle('store:keys', async () => {
    const data = store.store;
    return Object.keys(data);
  });
}

// =============================================================================
// UI handlers
// =============================================================================

function registerUiHandlers(): void {
  // Notification
  ipcMain.on('ui:notification', (_event, options: {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'StratCraft',
        body: options.message,
        icon: path.join(__dirname, '../../assets/icon.png'),
      });
      notification.show();
    }
  });

  // Dialog
  ipcMain.handle('ui:dialog', async (_event, options: {
    title: string;
    message: string;
    buttons?: string[];
    type?: 'info' | 'warning' | 'error' | 'question';
  }) => {
    const buttons = options.buttons || ['OK'];
    const result = await dialog.showMessageBox({
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      buttons,
    });

    return {
      button: buttons[result.response],
      checkboxChecked: false,
    };
  });

  // Progress bar (send status via webContents)
  const progressMap = new Map<string, { title: string; progress: number; message: string }>();

  ipcMain.on('ui:progress:show', (_event, options: { id: string; title: string }) => {
    progressMap.set(options.id, {
      title: options.title,
      progress: 0,
      message: '',
    });
    // Can implement native progress bar here or notify renderer process to update UI
  });

  ipcMain.on('ui:progress:update', (_event, options: {
    id: string;
    progress: number;
    message: string;
  }) => {
    const existing = progressMap.get(options.id);
    if (existing) {
      existing.progress = options.progress;
      existing.message = options.message;
    }
  });

  ipcMain.on('ui:progress:hide', (_event, id: string) => {
    progressMap.delete(id);
  });
}

// =============================================================================
// Market Data Handlers
// =============================================================================

function registerMarketHandlers(): void {
  ipcMain.handle('market:getData', async (_event, params) => getPluginMarketData(params));
  ipcMain.handle('market:getSymbols', async () => getPluginMarketSymbols());
}

// =============================================================================
// Executor Plugin Handlers (TICKET_250_9)
// =============================================================================

/**
 * Executor plugin execution state
 */
interface ExecutorPluginTask {
  id: string;
  pluginName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  result?: unknown;
  error?: string;
}

const executorTasks = new Map<string, ExecutorPluginTask>();

function registerExecutorPluginHandlers(): void {
  // List available executor plugins
  ipcMain.handle('executor-plugin:list', async () => {
    try {
      // Get plugins from quant-lab-plugin directory
      const paths = getPluginPaths();
      const quantLabPath = path.join(paths.bundled, 'quant-lab-plugin');
      const plugins: Array<{ name: string; version: string; description: string }> = [];

      // Check for alpha-factory plugin
      const manifestPath = path.join(quantLabPath, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          plugins.push({
            name: manifest.name || 'alpha-factory',
            version: manifest.version || '1.0.0',
            description: manifest.description || 'Alpha Factory plugin',
          });
        } catch {
          // Invalid manifest
        }
      }

      // Built-in backtest is always available
      plugins.unshift({
        name: 'backtest',
        version: '1.0.0',
        description: 'Built-in strategy backtesting',
      });

      return { success: true, plugins };
    } catch (error) {
      pluginLog.error('Failed to list executor plugins:', error);
      return { success: false, error: String(error) };
    }
  });

  // Execute plugin (generic interface)
  ipcMain.handle('executor-plugin:execute', async (_event, params: {
    pluginName: string;
    config: Record<string, unknown>;
  }) => {
    const taskId = `plugin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const task: ExecutorPluginTask = {
        id: taskId,
        pluginName: params.pluginName,
        status: 'running',
        progress: 0,
      };
      executorTasks.set(taskId, task);

      pluginLog.info(`[TICKET_250_9] Starting executor plugin: ${params.pluginName}, task: ${taskId}`);

      // For backtest plugin, delegate to existing executor service
      if (params.pluginName === 'backtest') {
        // Import executor service dynamically to avoid circular dependency
        const { getExecutorService } = await import('../services/executor-service');
        const executorService = getExecutorService();

        // Add pluginName to config
        const config = { ...params.config, pluginName: 'backtest' };
        const backtestTaskId = await executorService.runBacktest(config as any);

        // Map backtest task to plugin task
        task.id = backtestTaskId;
        executorTasks.delete(taskId);
        executorTasks.set(backtestTaskId, { ...task, id: backtestTaskId });

        return { success: true, taskId: backtestTaskId };
      }

      // For other plugins, would spawn executor with pluginName
      // TODO: Implement dynamic plugin execution
      pluginLog.warn(`[TICKET_250_9] Plugin ${params.pluginName} execution not yet implemented`);
      task.status = 'failed';
      task.error = `Plugin ${params.pluginName} execution not yet implemented`;

      return { success: false, taskId, error: task.error };

    } catch (error) {
      pluginLog.error(`[TICKET_250_9] Failed to execute plugin ${params.pluginName}:`, error);
      return { success: false, taskId, error: String(error) };
    }
  });

  // Cancel plugin execution
  ipcMain.handle('executor-plugin:cancel', async (_event, taskId: string) => {
    try {
      const task = executorTasks.get(taskId);
      if (!task) {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_TASK_NOT_FOUND };
      }

      if (task.status !== 'running') {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_TASK_NOT_RUNNING };
      }

      // For backtest plugin, use executor service
      if (task.pluginName === 'backtest') {
        const { getExecutorService } = await import('../services/executor-service');
        const executorService = getExecutorService();
        const cancelled = executorService.cancelTask(taskId);

        if (cancelled) {
          task.status = 'cancelled';
          return { success: true };
        }
        return { success: false, error: ERROR_MESSAGES.PLUGIN_CANCEL_FAILED };
      }

      // For other plugins, would send cancel signal
      task.status = 'cancelled';
      return { success: true };

    } catch (error) {
      pluginLog.error(`[TICKET_250_9] Failed to cancel task ${taskId}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Get plugin execution progress
  ipcMain.handle('executor-plugin:progress', async (_event, taskId: string) => {
    try {
      const task = executorTasks.get(taskId);
      if (!task) {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_TASK_NOT_FOUND };
      }

      return {
        success: true,
        status: task.status,
        progress: task.progress,
        result: task.result,
        error: task.error,
      };

    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get task result
  ipcMain.handle('executor-plugin:result', async (_event, taskId: string) => {
    try {
      const task = executorTasks.get(taskId);
      if (!task) {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_TASK_NOT_FOUND };
      }

      if (task.status === 'running') {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_TASK_RUNNING };
      }

      return {
        success: task.status === 'completed',
        result: task.result,
        error: task.error,
      };

    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  pluginLog.info('[TICKET_250_9] Executor plugin handlers registered');
}

// =============================================================================
// Plugin Process Handlers (TICKET_632_2)
// =============================================================================

function registerPluginProcessHandlers(): void {
  // Activate an independent plugin process
  ipcMain.handle('plugin:process:activate', async (_event, pluginId: string) => {
    try {
      const manifest = await findPluginManifest(pluginId);
      if (!manifest) {
        return { success: false, error: ERROR_MESSAGES.PLUGIN_NOT_FOUND };
      }

      if (manifest.process?.mode !== 'independent') {
        return { success: false, error: 'Plugin is not configured for independent process mode', i18nKey: 'plugin.validation.notConfiguredForProcessMode' };
      }

      await getPluginProcessManager().activate(pluginId, manifest);

      // TICKET_1004: Update in-memory status registry
      getPluginStatusRegistry().onPluginActivated(pluginId);

      // TICKET_805_2: broadcast activation to all renderer windows so the
      // marketplace.promo.first_run gate (renderer-side, consent-gated) can
      // decide whether to emit. Done as a broadcast rather than a per-handler
      // emit so non-renderer-originated activations (auto-activate on app
      // start, deep-link) are also caught.
      const { MARKETPLACE_CHANNELS } = await import('../../shared/constants/channels');
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(MARKETPLACE_CHANNELS.PLUGIN_ACTIVATED, { pluginId });
        }
      }

      return { success: true };
    } catch (error) {
      pluginLog.error(`[TICKET_632_2] Failed to activate plugin process ${pluginId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Deactivate an independent plugin process
  ipcMain.handle('plugin:process:deactivate', async (_event, pluginId: string) => {
    try {
      await getPluginProcessManager().deactivate(pluginId);

      // TICKET_1004: Update in-memory status registry
      getPluginStatusRegistry().onPluginDeactivated(pluginId);

      return { success: true };
    } catch (error) {
      pluginLog.error(`[TICKET_632_2] Failed to deactivate plugin process ${pluginId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get status of a plugin process
  ipcMain.handle('plugin:process:getStatus', async (_event, pluginId: string) => {
    try {
      const status = getPluginProcessManager().getStatus(pluginId);
      return { success: true, ...status };
    } catch (error) {
      pluginLog.error(`[TICKET_632_2] Failed to get plugin process status ${pluginId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  pluginLog.info('[TICKET_632_2] Plugin process handlers registered');
}

// =============================================================================
// Export registration function
// =============================================================================

export function registerPluginHandlers(): void {
  registerPluginFileHandlers();
  registerStoreHandlers();
  registerUiHandlers();
  registerMarketHandlers();
  registerExecutorPluginHandlers();  // TICKET_250_9
  registerPluginProcessHandlers();   // TICKET_632_2
  // Core handlers are registered in grpc/index.ts via initializeCoreConnection()

  pluginLog.info('Plugin IPC handlers registered');
}
