/**
 * Open Desktop Base entrypoint.
 *
 * This bootstrap contains only public runtime adaptation. Commercial
 * capabilities are activated after installation through the signed extension
 * bridge and are never imported by this bundle.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { app, BrowserWindow, session } from 'electron';

import { StartupAuditService, type StartupAuditInsertData } from './database/services/startup-audit-service';
import { getDatabaseManager, resetDatabaseManager } from './database/db-manager';
import { registerPublicIpcHandlers } from './ipc/public-index';
import { getConfigService, initializeConfigService } from './services/config-service';
import { initializeCrashReporter, shutdownCrashReporter } from './services/crash-reporter';
import { initializeDatabaseBackupService, getDatabaseBackupService } from './services/database-backup-service';
import { migrateFromOldAppName } from './services/data-migration-service';
import {
  initializePublicRuntimeServices,
  shutdownPublicRuntimeServices,
} from './services/public-runtime-services';
import { appLog, getLogDirectory } from './utils/logger';
import { createWindow, getMainWindow } from './window';

const PROTOCOL_SCHEME = 'stratcraft';
const smokeEvidencePath = process.env.STRATCRAFT_GENERATED_PUBLIC_SMOKE_EVIDENCE;
let smokeEvidence: Record<string, unknown> = {};

function writeSmokeEvidence(updates: Record<string, unknown>): void {
  if (!smokeEvidencePath) return;
  smokeEvidence = { ...smokeEvidence, ...updates };
  fs.mkdirSync(path.dirname(smokeEvidencePath), { recursive: true });
  fs.writeFileSync(smokeEvidencePath, `${JSON.stringify(smokeEvidence, null, 2)}\n`);
}

async function handleDeepLink(url: string): Promise<void> {
  if (!url.toLowerCase().startsWith(`${PROTOCOL_SCHEME}://callback`)) return;
  const { getAuthService } = await import('./services/auth-service');
  await getAuthService().handleCallback(url);
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [process.argv[1]]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

app.disableHardwareAcceleration();
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
initializeCrashReporter();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLink = commandLine.find((argument) =>
      argument.toLowerCase().startsWith(`${PROTOCOL_SCHEME}://`));
    if (deepLink) void handleDeepLink(deepLink);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleDeepLink(url);
  });

  app.whenReady().then(async () => {
    const startedAt = Date.now();
    const auditWarnings: string[] = [];
    const auditData: Partial<StartupAuditInsertData> = {
      session_id: randomUUID(),
      node_version: process.versions.node,
      electron_version: process.versions.electron,
      platform: process.platform,
    };

    try {
      if (app.isPackaged) {
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
          callback({
            responseHeaders: {
              ...details.responseHeaders,
              'Content-Security-Policy': [
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:",
                "img-src 'self' data: blob:",
                "font-src 'self'",
              ].join('; '),
            },
          });
        });
      }

      const migration = await migrateFromOldAppName();
      auditData.migration_561_status = migration.status;
      auditData.migration_561_dirs_copied = migration.dirsCopied;
      auditData.migration_561_files_copied = migration.filesCopied;
      auditData.migration_561_files_skipped = migration.filesSkipped;
      auditData.migration_561_error = migration.error;
      if (migration.status === 'error') {
        auditWarnings.push(`Migration-561 failed: ${migration.error ?? 'unknown error'}`);
      }

      await initializeConfigService();
      let database = getDatabaseManager();
      initializeDatabaseBackupService(database.getPath());
      const integrity = database.checkIntegrity();
      if (!integrity.ok) {
        const recovery = getDatabaseBackupService().attemptRecovery(database.getPath());
        if (!recovery.recovered) {
          throw new Error(`Database integrity check failed: ${(integrity.errors ?? []).join('; ')}`);
        }
        resetDatabaseManager();
        database = getDatabaseManager();
      }
      await database.initialize();

      const { initializePluginMarketService } = await import('./services/plugin-market-service');
      await initializePluginMarketService();
      const { initializePluginStatusRegistry } = await import('./services/plugin-status-registry');
      await initializePluginStatusRegistry();
      await (await import('./services/license-validation-service')).initializeLicenseValidationService();
      await (await import('./services/entitlement-enforcer')).initializeEntitlementEnforcer();
      try {
        await (await import('./services/auth-service')).initializeAuthService();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        auditWarnings.push(`Auth initialization failed: ${message}`);
        appLog.warn('[Public Base] Auth initialization failed (non-fatal):', error);
      }

      await initializePublicRuntimeServices('electron');
      await registerPublicIpcHandlers();
      const mainWindow = createWindow();

      if (smokeEvidencePath) {
        mainWindow.webContents.once('did-finish-load', async () => {
          try {
            const ready = await mainWindow.webContents.executeJavaScript(
              'Boolean(window.electronAPI && document.getElementById("root"))',
            );
            const { getCompilerResolver } = await import('./services/compiler-resolver');
            const executor = getCompilerResolver().resolvePluginExecutor();
            if (!executor) throw new Error('Packaged runtime smoke could not discover StratCraft-executor');
            getDatabaseManager().getDb().prepare('SELECT 1').get();
            writeSmokeEvidence({
              schemaVersion: 1,
              main: true,
              preload: ready,
              renderer: ready,
              database: true,
              executor: true,
              executorPath: executor.path,
              cleanShutdown: false,
              platform: process.platform,
              arch: process.arch,
              electron: process.versions.electron,
            });
            app.quit();
          } catch (error) {
            writeSmokeEvidence({
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
            app.exit(1);
          }
        });
      }

      auditData.startup_duration_ms = Date.now() - startedAt;
      auditData.status = auditWarnings.length > 0 ? 'warning' : 'success';
      auditData.warnings = auditWarnings.length > 0 ? JSON.stringify(auditWarnings) : null;
      new StartupAuditService(getDatabaseManager()).insertAudit(auditData as StartupAuditInsertData);
      appLog.info('[Public Base] StratCraft Desktop is ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLog.error('[Public Base] Fatal startup error:', message);
      writeSmokeEvidence({ status: 'failed', error: message });
      app.exit(1);
    }
  });

  app.on('before-quit', async () => {
    shutdownPublicRuntimeServices();
    try {
      const { getPluginProcessManager } = await import('./services/plugin-process-manager');
      await getPluginProcessManager().shutdownAll();
    } catch { /* not initialized */ }
    try { getConfigService().shutdown(); } catch { /* not initialized */ }
    try { getDatabaseManager().close(); } catch { /* not initialized */ }
    await shutdownCrashReporter();
    writeSmokeEvidence({ cleanShutdown: true });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  process.on('uncaughtException', (error) => appLog.error('Uncaught Exception:', error));
  process.on('unhandledRejection', (reason) => appLog.error('Unhandled Rejection:', reason));
}
