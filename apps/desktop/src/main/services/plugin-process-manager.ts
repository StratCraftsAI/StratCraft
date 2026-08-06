/**
 * Plugin Process Manager
 *
 * TICKET_515_1: Spawns independent Plugin Processes and establishes
 * direct Renderer <-> Plugin Process communication via Electron MessagePort.
 *
 * TICKET_632_2: Enhanced with process lifecycle tracking, exponential backoff
 * crash restart, and status reporting.
 *
 * After port setup, Host is NOT involved in Plugin business communication.
 * Host only monitors lifecycle (spawn, exit, shutdown).
 *
 * Pattern: Design doc Section 2.6
 */

import { MessageChannelMain, utilityProcess, app, BrowserWindow } from 'electron';
import type { UtilityProcess } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { cpSync } from 'fs';
import { createLogger } from '../utils/logger';
import { getSecureCredentialService } from './secure-credential-service';
import { getCompilerResolver } from './compiler-resolver';
import type { PluginManifest, PluginProcessStatus, PluginProcessStatusInfo } from '../../shared/types/plugin';

const log = createLogger('PLUGIN-PROCESS-MANAGER');

// =============================================================================
// Constants
// =============================================================================

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const STABLE_RESET_MS = 60_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

// =============================================================================
// Types
// =============================================================================

interface ProcessEntry {
  child: UtilityProcess;
  status: PluginProcessStatus;
  restartCount: number;
  backoffMs: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  manifest: PluginManifest;
}

// =============================================================================
// Singleton
// =============================================================================

let instance: PluginProcessManager | null = null;

export function initializePluginProcessManager(): void {
  if (instance) {
    log.warn('PluginProcessManager already initialized');
    return;
  }
  instance = new PluginProcessManager();
  log.info('PluginProcessManager initialized');
}

export function getPluginProcessManager(): PluginProcessManager {
  if (!instance) {
    throw new Error('PluginProcessManager not initialized. Call initializePluginProcessManager() first.');
  }
  return instance;
}

// =============================================================================
// Manager
// =============================================================================

export class PluginProcessManager {
  private processes = new Map<string, ProcessEntry>();

  /**
   * Spawn a Plugin Process and establish direct Renderer <-> Plugin port.
   * After port setup, Host is not involved in Plugin communication.
   */
  async activate(pluginId: string, manifest: PluginManifest): Promise<void> {
    if (manifest.process?.mode !== 'independent') return;

    const existing = this.processes.get(pluginId);
    if (existing && existing.status !== 'stopped' && existing.status !== 'crashed') {
      log.warn(`Plugin ${pluginId} process already running`);
      return;
    }

    await this.spawnProcess(pluginId, manifest);
  }

  /**
   * Deactivate a specific plugin process.
   * Sets status to 'stopped' to prevent crash-restart.
   */
  async deactivate(pluginId: string): Promise<void> {
    const entry = this.processes.get(pluginId);
    if (!entry) return;

    // Mark as stopped to prevent crash-restart
    entry.status = 'stopped';

    // Clear any pending restart timer
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    if (entry.stableTimer) {
      clearTimeout(entry.stableTimer);
      entry.stableTimer = null;
    }

    entry.child.postMessage({ type: 'shutdown' });

    // Wait for graceful exit, then force kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        entry.child.kill();
        resolve();
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      entry.child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.processes.delete(pluginId);
    log.info(`Plugin ${pluginId} process deactivated`);
  }

  /**
   * Graceful shutdown: signal all Plugin Processes to stop.
   */
  async shutdownAll(): Promise<void> {
    const shutdowns = Array.from(this.processes.keys()).map((id) =>
      this.deactivate(id)
    );
    await Promise.allSettled(shutdowns);
    log.info('All plugin processes shut down');
  }

  /**
   * Get status of a specific plugin process.
   */
  getStatus(pluginId: string): PluginProcessStatusInfo {
    const entry = this.processes.get(pluginId);
    if (!entry) {
      return { status: 'stopped', restartCount: 0 };
    }
    return {
      status: entry.status,
      restartCount: entry.restartCount,
      pid: entry.child.pid ?? undefined,
    };
  }

  /**
   * Get statuses of all tracked plugin processes.
   */
  getAllStatuses(): Record<string, PluginProcessStatusInfo> {
    const result: Record<string, PluginProcessStatusInfo> = {};
    for (const [pluginId, entry] of this.processes) {
      result[pluginId] = {
        status: entry.status,
        restartCount: entry.restartCount,
        pid: entry.child.pid ?? undefined,
      };
    }
    return result;
  }

  /**
   * TICKET_1235_10 F3: Send a request-response message to a running plugin
   * process over the utilityProcess parent-child IPC channel.
   */
  invoke(
    pluginId: string,
    channel: string,
    payload: unknown,
    timeoutMs = 30_000,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const entry = this.processes.get(pluginId);
    if (!entry || entry.status !== 'running') {
      const status = entry?.status ?? 'not-found';
      return Promise.resolve({
        success: false,
        error: `Plugin ${pluginId} is not running (status: ${status}). Use activate_plugin to start it.`,
      });
    }

    const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: `Plugin invoke timeout after ${timeoutMs}ms on channel ${channel}` });
      }, timeoutMs);

      const onMessage = (msg: { type?: string; id?: string; payload?: { success: boolean; data?: unknown; error?: string } }) => {
        if (msg.type !== 'invoke-response' || msg.id !== id) return;
        cleanup();
        resolve(msg.payload ?? { success: false, error: 'Empty response' });
      };

      const cleanup = () => {
        clearTimeout(timer);
        entry.child.removeListener('message', onMessage);
      };

      entry.child.on('message', onMessage);
      entry.child.postMessage({ type: 'invoke', id, channel, payload });
    });
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async spawnProcess(pluginId: string, manifest: PluginManifest): Promise<void> {
    const pluginDir = this.getPluginDir(pluginId);
    const entryPath = path.resolve(pluginDir, manifest.process!.entry);

    if (!fs.existsSync(entryPath)) {
      const repaired = this.repairHostFromBundled(pluginId, manifest, entryPath);
      if (!repaired) {
        throw new Error(`Plugin entry not found: ${entryPath}`);
      }
    }

    const pluginDataDir = this.getPluginDataDir(pluginId);
    fs.mkdirSync(pluginDataDir, { recursive: true });

    // Determine restart state from previous entry (if crash-restarting)
    const prev = this.processes.get(pluginId);
    const restartCount = prev ? prev.restartCount : 0;
    const backoffMs = prev ? prev.backoffMs : INITIAL_BACKOFF_MS;

    // TICKET_1040 Part 2: Log the actual HOST_DB_PATH passed to the child so a
    // host startup failure caused by a bad DB path is diagnosable from main.log
    // (the host's own stderr would otherwise be the only evidence).
    const hostDbPath = this.getHostDbPath();
    log.info(`Spawning ${pluginId} with HOST_DB_PATH="${hostDbPath}" (entry: ${entryPath})`);

    // TICKET_1040_3: The C++ `stratforge-runner` is host infrastructure (TICKET_133),
    // resolved and packaged by the host (compiler-resolver.ts + extraResources) exactly
    // as Sigma's runner is. Independent plugins (e.g. signal-generator-nexus) that need
    // to spawn the runner MUST consume the host-resolved binary instead of bundling their
    // own copy in `native/`. We pass the resolved path down via QNX_NONABT_RUNNER — the
    // same env var compiler-resolver.doResolveRunner() already honours — so the contract
    // is symmetric. Plugins that don't need a runner simply ignore it.
    const runnerEnv = this.getHostRunnerEnv();

    // Spawn Plugin Process via Electron utilityProcess (supports MessagePort transfer).
    // TICKET_1040 1C: stdio 'pipe' so the child's stdout/stderr are exposed and can
    // be piped into electron-log — a host crash must be observable, not an opaque "code 1".
    const child = utilityProcess.fork(entryPath, [], {
      cwd: pluginDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PLUGIN_ID: pluginId,
        PLUGIN_DATA_DIR: pluginDataDir,
        HOST_DB_PATH: hostDbPath,
        ...runnerEnv,
      },
    });

    // TICKET_1040 1C: Surface plugin host stdout/stderr in main.log, prefixed per
    // plugin. Without this, a host startup exception collapses to a bare "code 1".
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd();
      if (text) log.info(`[${pluginId}] ${text}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd();
      if (text) log.error(`[${pluginId}] ${text}`);
    });

    const entry: ProcessEntry = {
      child,
      status: 'spawning',
      restartCount,
      backoffMs,
      restartTimer: null,
      stableTimer: null,
      manifest,
    };

    this.processes.set(pluginId, entry);

    // TICKET_010 Phase 5: Relay credential requests from plugin host process
    // to the main process's SecureCredentialService (Electron safeStorage).
    child.on('message', async (msg: { type: string; channel?: string; requestId?: string; payload?: unknown }) => {
      if (msg.type !== 'credential-request') return;
      const credService = getSecureCredentialService();
      const { channel, requestId, payload } = msg;
      try {
        let result: unknown;
        switch (channel) {
          case 'getSecret': {
            const { key } = payload as { key: string };
            const resp = await credService.getSecret(pluginId, key);
            result = resp.success ? resp.value ?? null : null;
            break;
          }
          case 'setSecret': {
            const { key, value } = payload as { key: string; value: string };
            await credService.setSecret(pluginId, key, value);
            result = true;
            break;
          }
          case 'deleteSecret': {
            const { key } = payload as { key: string };
            await credService.deleteSecret(pluginId, key);
            result = true;
            break;
          }
          case 'listKeys': {
            result = await credService.listCredentialKeys(pluginId);
            break;
          }
          default:
            child.postMessage({ type: 'credential-response', requestId, error: `Unknown credential channel: ${channel}` });
            return;
        }
        child.postMessage({ type: 'credential-response', requestId, result });
      } catch (err) {
        child.postMessage({ type: 'credential-response', requestId, error: String(err) });
      }
    });

    // Monitor lifecycle (no message inspection)
    child.on('exit', (code) => {
      if (entry.stableTimer) {
        clearTimeout(entry.stableTimer);
        entry.stableTimer = null;
      }

      if (entry.status === 'stopped') {
        log.info(`Plugin ${pluginId} process stopped (code ${code})`);
        return;
      }

      entry.status = 'crashed';
      entry.restartCount++;
      log.warn(`Plugin ${pluginId} process crashed (code ${code}), restart #${entry.restartCount} in ${entry.backoffMs}ms`);

      entry.restartTimer = setTimeout(() => {
        entry.restartTimer = null;
        entry.backoffMs = Math.min(entry.backoffMs * 2, MAX_BACKOFF_MS);
        this.spawnProcess(pluginId, manifest).catch((err) => {
          log.error(`Plugin ${pluginId} restart failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, entry.backoffMs);
    });

    child.on('error', (type, location) => {
      log.error(`Plugin ${pluginId} process fatal error: ${type} at ${location}`);
    });

    // Create MessagePort pair now — renderer receives port1 immediately so it
    // can register its listener before we resolve. port2 goes to the child
    // after the 'spawn' event (utilityProcess requires spawn before postMessage).
    const { port1, port2 } = new MessageChannelMain();

    // Wait for child to spawn before delivering port2 to plugin process
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => {
        child.postMessage({ type: 'port-setup' }, [port2]);

        entry.status = 'running';

        entry.stableTimer = setTimeout(() => {
          entry.restartCount = 0;
          entry.backoffMs = INITIAL_BACKOFF_MS;
          entry.stableTimer = null;
          log.info(`Plugin ${pluginId} process stable, backoff reset`);
        }, STABLE_RESET_MS);

        log.info(`Plugin ${pluginId} process spawned (pid: ${child.pid})`);

        // Send port1 to renderer (renderer registers listener before activate())
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.postMessage(`plugin-port:${pluginId}`, null, [port1]);
        }

        resolve();
      });

      child.once('exit', (code) => {
        if (entry.status === 'spawning') {
          reject(new Error(`Plugin ${pluginId} exited during spawn (code ${code})`));
        }
      });
    });
  }

  private getPluginDir(pluginId: string): string {
    return path.join(app.getPath('userData'), 'plugins', pluginId);
  }

  private getPluginDataDir(pluginId: string): string {
    return path.join(app.getPath('userData'), 'plugins', pluginId, 'data');
  }

  private getHostDbPath(): string {
    return path.join(app.getPath('userData'), 'data', 'StratCraft.db');
  }

  /**
   * TICKET_1040_3: Resolve the host-owned `stratforge-runner` and return it as an
   * env fragment ({ QNX_NONABT_RUNNER }) to be merged into an independent plugin's
   * spawn env, so plugins consume the host binary (Sigma model) instead of bundling
   * their own copy under `native/`.
   *
   * Returns an empty object when the host cannot resolve a runner. This is NOT a
   * silent failure (TICKET_858): a plugin that genuinely requires the runner
   * fail-fasts itself with an actionable error when the env var is absent. We do
   * not block spawning of plugins that don't need a runner at all (most plugins),
   * so resolution failure is logged at warn here and surfaced at the point of use.
   */
  private getHostRunnerEnv(): Record<string, string> {
    let runnerPath: string | undefined;
    try {
      runnerPath = getCompilerResolver().resolveRunner()?.path;
    } catch (err) {
      // Resolver not initialized (e.g. in a minimal/test boot) — treat as unresolved.
      log.warn(`Could not resolve host runner for plugin spawn: ${(err as Error).message}`);
      return {};
    }
    if (!runnerPath) {
      log.warn(
        'Host could not resolve stratforge-runner (compiler-resolver returned none). ' +
          'Plugins requiring the runner will fail-fast with an actionable error.'
      );
      return {};
    }
    return { QNX_NONABT_RUNNER: runnerPath };
  }

  /**
   * When a marketplace plugin's host entry is missing from userData (e.g. partial
   * install from tryInstallFromBundled), copy the host directory from the bundled
   * plugin source. Returns true if the entry is now available.
   */
  private repairHostFromBundled(
    pluginId: string,
    manifest: PluginManifest,
    entryPath: string
  ): boolean {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const bundledBase = isDev
      ? path.join(app.getAppPath(), '../../plugins')
      : path.join(process.resourcesPath!, 'bundled_plugins');

    const hostRelDir = manifest.process!.entry.split('/')[0];
    const bundledHostDir = path.join(bundledBase, pluginId, hostRelDir);

    if (!fs.existsSync(bundledHostDir)) {
      try {
        const entries = fs.readdirSync(bundledBase, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          const manifestPath = path.join(bundledBase, entry.name, 'manifest.json');
          try {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            const m = JSON.parse(content);
            if (m.id === pluginId) {
              const resolved = path.join(bundledBase, entry.name, hostRelDir);
              if (fs.existsSync(resolved)) {
                return this.doCopyHostDir(resolved, path.resolve(this.getPluginDir(pluginId), hostRelDir), entryPath, pluginId);
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* bundled base unreadable */ }
      log.error(`[REPAIR] Bundled host directory not found for ${pluginId}`);
      return false;
    }

    return this.doCopyHostDir(bundledHostDir, path.resolve(this.getPluginDir(pluginId), hostRelDir), entryPath, pluginId);
  }

  private doCopyHostDir(src: string, dest: string, entryPath: string, pluginId: string): boolean {
    try {
      log.info(`[REPAIR] Copying missing host dir from bundled: ${src} -> ${dest}`);
      cpSync(src, dest, { recursive: true, dereference: true });
      if (fs.existsSync(entryPath)) {
        log.info(`[REPAIR] Host entry repaired for ${pluginId}: ${entryPath}`);
        return true;
      }
      log.error(`[REPAIR] Copied host dir but entry still missing: ${entryPath}`);
      return false;
    } catch (err) {
      log.error(`[REPAIR] Failed to copy host dir for ${pluginId}:`, err);
      return false;
    }
  }
}
