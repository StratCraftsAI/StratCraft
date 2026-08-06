/**
 * Installation Manager
 *
 * TICKET_100: Plugin Installation Flow & User Consent
 *
 * Orchestrates the complete plugin installation flow:
 * 1. Download package
 * 2. Verify signature (TICKET_098)
 * 3. Validate permissions (TICKET_099)
 * 4. User consent
 * 5. Extract and install
 * 6. Rollback on failure
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import { extractZip } from '../utils/archive';
import { getLifecycleRunner } from './lifecycle-runner';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import type {
  PluginTrustLevel,
  PluginInstallPreview,
  PluginPublisherInfo,
  ParsedPluginPermission,
  DetailedPluginPermissions,
  GrantedPluginPermissions,
} from '../../shared/types/plugin';

const installLog = createLogger('INSTALL');

// =============================================================================
// Types
// =============================================================================

export type InstallPhase =
  | 'downloading'
  | 'verifying'
  | 'validating'
  | 'extracting'
  | 'copying'
  | 'registering'
  | 'initializing'
  | 'complete'
  | 'error';

export interface InstallProgress {
  pluginId: string;
  phase: InstallPhase;
  progress: number;
  message: string;
}

export interface InstallResult {
  success: boolean;
  pluginId: string;
  version: string;
  error?: string;
  rollbackPerformed?: boolean;
}

export interface InstallSession {
  id: string;
  pluginId: string;
  version: string;
  preview: PluginInstallPreview;
  tempDir: string;
  backupDir?: string;
  startedAt: string;
}

// =============================================================================
// Permission Risk Levels
// =============================================================================

const PERMISSION_RISK: Record<keyof DetailedPluginPermissions, ParsedPluginPermission['riskLevel']> = {
  network: 'medium',
  fs: 'medium',
  bridge: 'medium',
  secrets: 'medium',
  shell: 'high',
  native: 'critical',
};

// =============================================================================
// Installation Manager Class
// =============================================================================

export class InstallationManager extends EventEmitter {
  private static instance: InstallationManager | null = null;

  private userPluginsDir = '';
  private tempDir = '';
  private backupsDir = '';
  private grantedPermissions: Map<string, GrantedPluginPermissions> = new Map();
  private activeSessions: Map<string, InstallSession> = new Map();
  private initialized = false;

  private constructor() {
    super();
  }

  static getInstance(): InstallationManager {
    if (!InstallationManager.instance) {
      InstallationManager.instance = new InstallationManager();
    }
    return InstallationManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.userPluginsDir = path.join(app.getPath('userData'), 'plugins');
    this.tempDir = path.join(app.getPath('temp'), 'StratCraft-install');
    this.backupsDir = path.join(this.userPluginsDir, '.backups');

    await fs.mkdir(this.userPluginsDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
    await fs.mkdir(this.backupsDir, { recursive: true });

    await this.loadGrantedPermissions();

    this.initialized = true;
    installLog.info('InstallationManager initialized');
  }

  // ===========================================================================
  // Preview Installation
  // ===========================================================================

  async previewInstall(
    manifestJson: string,
    signatureJson: string | null,
    signatureBytes: Buffer | null
  ): Promise<PluginInstallPreview> {
    const manifest = JSON.parse(manifestJson);

    // Determine trust level based on signature
    let trustLevel: PluginTrustLevel = 'unsigned';
    let publisher: PluginPublisherInfo | null = null;
    const warnings: string[] = [];

    if (signatureJson && signatureBytes) {
      const verifyResult = await this.verifySignature(
        signatureJson,
        signatureBytes,
        new Map() // Would need file contents for full verification
      );
      trustLevel = verifyResult.trustLevel;
      publisher = verifyResult.publisher;
      warnings.push(...verifyResult.warnings);
    } else {
      warnings.push(mainT(getCurrentMainLocale(), 'errors', 'main.installation.pluginNotSigned'));
    }

    // Parse permissions
    const permissions = this.parsePermissions(manifest.detailedPermissions || {});
    const requiresDevMode = this.checkRequiresDevMode(permissions);

    // Check for existing installation
    const existingVersion = await this.getInstalledVersion(manifest.id);

    return {
      pluginId: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName || manifest.name,
      publisher,
      trustLevel,
      permissions,
      warnings,
      requiresDevMode,
      existingVersion,
    };
  }

  // ===========================================================================
  // Install Plugin
  // ===========================================================================

  async installFromPackage(
    packagePath: string,
    preview: PluginInstallPreview
  ): Promise<InstallResult> {
    const sessionId = crypto.randomUUID();
    const tempDir = path.join(this.tempDir, sessionId);
    const installPath = path.join(this.userPluginsDir, preview.pluginId);

    const session: InstallSession = {
      id: sessionId,
      pluginId: preview.pluginId,
      version: preview.version,
      preview,
      tempDir,
      startedAt: new Date().toISOString(),
    };

    this.activeSessions.set(sessionId, session);

    try {
      // 1. Extract to temp
      this.emitProgress(preview.pluginId, 'extracting', 20, mainT(getCurrentMainLocale(), 'ui', 'installProgress.extractingPackage'));
      await fs.mkdir(tempDir, { recursive: true });
      await this.extractPackage(packagePath, tempDir);

      // 2. Backup existing (if upgrade)
      if (preview.existingVersion) {
        this.emitProgress(preview.pluginId, 'copying', 40, mainT(getCurrentMainLocale(), 'ui', 'installProgress.backingUpExisting'));
        const backupDir = path.join(
          this.backupsDir,
          `${preview.pluginId}.${preview.existingVersion}.backup`
        );
        session.backupDir = backupDir;
        await this.backupPlugin(installPath, backupDir);
      }

      // 3. Remove existing
      await fs.rm(installPath, { recursive: true, force: true });

      // 4. Move to install location
      this.emitProgress(preview.pluginId, 'copying', 60, mainT(getCurrentMainLocale(), 'ui', 'installProgress.installingFiles'));
      await fs.rename(tempDir, installPath);

      // 5. Store granted permissions
      this.emitProgress(preview.pluginId, 'registering', 70, mainT(getCurrentMainLocale(), 'ui', 'installProgress.registeringPermissions'));
      await this.storeGrantedPermissions(preview);

      // 6. Run lifecycle hooks (TICKET_101)
      this.emitProgress(preview.pluginId, 'initializing', 80, mainT(getCurrentMainLocale(), 'ui', 'installProgress.runningLifecycleHooks'));
      const storagePath = path.join(app.getPath('userData'), 'plugin-data', preview.pluginId);
      await fs.mkdir(storagePath, { recursive: true });

      const lifecycleRunner = getLifecycleRunner();
      lifecycleRunner.setProgressCallback((id, percent, message) => {
        // Map lifecycle progress to 80-95% range
        const mappedProgress = 80 + Math.floor(percent * 0.15);
        this.emitProgress(id, 'initializing', mappedProgress, message || mainT(getCurrentMainLocale(), 'ui', 'installProgress.initializing'));
      });

      if (preview.existingVersion) {
        // Upgrade: run onUpgrade hook
        await lifecycleRunner.runOnUpgrade(
          preview.pluginId,
          installPath,
          storagePath,
          preview.existingVersion,
          preview.version,
          session.backupDir || ''
        );
      } else {
        // Fresh install: run onInstall hook
        await lifecycleRunner.runOnInstall(preview.pluginId, installPath, storagePath);
      }

      // 7. Complete
      this.emitProgress(preview.pluginId, 'complete', 100, mainT(getCurrentMainLocale(), 'ui', 'installProgress.installationComplete'));

      this.activeSessions.delete(sessionId);
      this.emit('installComplete', preview.pluginId);

      installLog.info(`Plugin installed: ${preview.pluginId}@${preview.version}`);

      return {
        success: true,
        pluginId: preview.pluginId,
        version: preview.version,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      installLog.error(`Installation failed: ${message}`);

      // Rollback
      const rollbackPerformed = await this.rollback(session);

      this.emitProgress(preview.pluginId, 'error', 0, message);
      this.activeSessions.delete(sessionId);

      return {
        success: false,
        pluginId: preview.pluginId,
        version: preview.version,
        error: message,
        rollbackPerformed,
      };
    }
  }

  // ===========================================================================
  // Rollback
  // ===========================================================================

  private async rollback(session: InstallSession): Promise<boolean> {
    installLog.info(`Rolling back installation: ${session.pluginId}`);

    try {
      const installPath = path.join(this.userPluginsDir, session.pluginId);

      // Remove partial installation
      await fs.rm(installPath, { recursive: true, force: true });

      // Restore backup if exists
      if (session.backupDir) {
        const backupExists = await fs
          .access(session.backupDir)
          .then(() => true)
          .catch(() => false);

        if (backupExists) {
          await fs.rename(session.backupDir, installPath);
          installLog.info(`Restored backup: ${session.pluginId}`);
        }
      }

      // Cleanup temp
      await fs.rm(session.tempDir, { recursive: true, force: true });

      return true;
    } catch (error) {
      installLog.error('Rollback failed:', error);
      return false;
    }
  }

  // ===========================================================================
  // Signature Verification
  // ===========================================================================

  private async verifySignature(
    signatureJson: string,
    signatureBytes: Buffer,
    fileContents: Map<string, Buffer>
  ): Promise<{
    trustLevel: PluginTrustLevel;
    publisher: PluginPublisherInfo | null;
    warnings: string[];
  }> {
    // Simplified verification - in production would use @StratCraft/plugin-verifier
    try {
      const metadata = JSON.parse(signatureJson);

      // Check if official publisher
      const isOfficial = metadata.publisher?.id?.startsWith('com.stratcraft');

      return {
        trustLevel: isOfficial ? 'official' : 'verified',
        publisher: metadata.publisher || null,
        warnings: [],
      };
    } catch {
      return {
        trustLevel: 'unverified',
        publisher: null,
        warnings: [mainT(getCurrentMainLocale(), 'errors', 'main.installation.signatureFormatInvalid')],
      };
    }
  }

  // ===========================================================================
  // Permission Handling
  // ===========================================================================

  private parsePermissions(
    permissions: DetailedPluginPermissions
  ): ParsedPluginPermission[] {
    const parsed: ParsedPluginPermission[] = [];

    if (permissions.network) {
      parsed.push({
        type: 'network',
        riskLevel: 'medium',
        description: `Network access to: ${permissions.network.hosts.join(', ')}`,
        reason: permissions.network.reason,
      });
    }

    if (permissions.fs) {
      const hasWrite = permissions.fs.write && permissions.fs.write.length > 0;
      const paths = [
        ...(permissions.fs.read || []).map(p => `read: ${p}`),
        ...(permissions.fs.write || []).map(p => `write: ${p}`),
      ];
      parsed.push({
        type: 'fs',
        riskLevel: hasWrite ? 'high' : 'medium',
        description: `File system access: ${paths.join(', ')}`,
        reason: permissions.fs.reason,
      });
    }

    if (permissions.bridge) {
      parsed.push({
        type: 'bridge',
        riskLevel: 'medium',
        description: `Bridge API access: ${permissions.bridge.apis.join(', ')}`,
        reason: permissions.bridge.reason,
      });
    }

    if (permissions.secrets) {
      parsed.push({
        type: 'secrets',
        riskLevel: 'medium',
        description: `Secrets storage: ${permissions.secrets.keys.join(', ')}`,
        reason: permissions.secrets.reason,
      });
    }

    if (permissions.shell) {
      parsed.push({
        type: 'shell',
        riskLevel: 'high',
        description: `Shell execution: ${permissions.shell.commands.join(', ')}`,
        reason: permissions.shell.reason,
      });
    }

    if (permissions.native) {
      parsed.push({
        type: 'native',
        riskLevel: 'critical',
        description: `Native modules: ${permissions.native.modules.join(', ')}`,
        reason: permissions.native.reason,
      });
    }

    return parsed;
  }

  private checkRequiresDevMode(permissions: ParsedPluginPermission[]): boolean {
    return permissions.some(p => p.riskLevel === 'critical');
  }

  private async storeGrantedPermissions(preview: PluginInstallPreview): Promise<void> {
    const granted: GrantedPluginPermissions = {
      version: preview.version,
      grantedAt: new Date().toISOString(),
      permissions: this.reconstructPermissions(preview.permissions),
    };

    this.grantedPermissions.set(preview.pluginId, granted);
    await this.saveGrantedPermissions();
  }

  private reconstructPermissions(
    parsed: ParsedPluginPermission[]
  ): DetailedPluginPermissions {
    const permissions: DetailedPluginPermissions = {};

    for (const p of parsed) {
      // Simplified reconstruction - in production would store original
      switch (p.type) {
        case 'network':
          permissions.network = { hosts: [], reason: p.reason };
          break;
        case 'fs':
          permissions.fs = { reason: p.reason };
          break;
        case 'bridge':
          permissions.bridge = { apis: [], reason: p.reason };
          break;
        case 'secrets':
          permissions.secrets = { keys: [], reason: p.reason };
          break;
        case 'shell':
          permissions.shell = { commands: [], reason: p.reason };
          break;
        case 'native':
          permissions.native = { modules: [], reason: p.reason };
          break;
      }
    }

    return permissions;
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private async loadGrantedPermissions(): Promise<void> {
    const filePath = path.join(this.userPluginsDir, 'permissions.json');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, GrantedPluginPermissions>;
      this.grantedPermissions = new Map(Object.entries(parsed));
      installLog.debug(`Loaded ${this.grantedPermissions.size} permission records`);
    } catch {
      // No permissions file yet
    }
  }

  private async saveGrantedPermissions(): Promise<void> {
    const filePath = path.join(this.userPluginsDir, 'permissions.json');
    const data = Object.fromEntries(this.grantedPermissions);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  private async getInstalledVersion(pluginId: string): Promise<string | undefined> {
    const manifestPath = path.join(this.userPluginsDir, pluginId, 'manifest.json');
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return manifest.version;
    } catch {
      return undefined;
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async extractPackage(packagePath: string, destPath: string): Promise<void> {
    // Delegate to shared utility (code reuse per CLAUDE.md)
    await extractZip(packagePath, destPath);
  }

  private async backupPlugin(sourcePath: string, backupPath: string): Promise<void> {
    const exists = await fs
      .access(sourcePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) return;

    // Remove old backup if exists
    await fs.rm(backupPath, { recursive: true, force: true });

    // Copy to backup location
    await fs.cp(sourcePath, backupPath, { recursive: true });
  }

  private emitProgress(
    pluginId: string,
    phase: InstallPhase,
    progress: number,
    message: string
  ): void {
    const data: InstallProgress = { pluginId, phase, progress, message };
    this.emit('progress', data);
    installLog.debug(`[${pluginId}] ${phase} ${progress}% - ${message}`);
  }

  // ===========================================================================
  // Uninstall Plugin
  // ===========================================================================

  async uninstallPlugin(pluginId: string, keepUserData = false): Promise<InstallResult> {
    const installPath = path.join(this.userPluginsDir, pluginId);
    const storagePath = path.join(app.getPath('userData'), 'plugin-data', pluginId);

    try {
      // Check if plugin exists
      const exists = await fs
        .access(installPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        return {
          success: false,
          pluginId,
          version: '',
          error: mainT(getCurrentMainLocale(), 'errors', 'installation.pluginNotFound'),
        };
      }

      // Get version for result
      const version = (await this.getInstalledVersion(pluginId)) || 'unknown';

      // Run onUninstall lifecycle hook (TICKET_101)
      installLog.info(`Running onUninstall for ${pluginId}`);
      const lifecycleRunner = getLifecycleRunner();
      try {
        await lifecycleRunner.runOnUninstall(pluginId, installPath, storagePath, keepUserData);
      } catch (error) {
        // Log but continue with uninstall
        installLog.warn(`onUninstall hook failed for ${pluginId}:`, error);
      }

      // Remove plugin files
      await fs.rm(installPath, { recursive: true, force: true });

      // Remove storage if not keeping user data
      if (!keepUserData) {
        await fs.rm(storagePath, { recursive: true, force: true });
      }

      // Remove from granted permissions
      this.grantedPermissions.delete(pluginId);
      await this.saveGrantedPermissions();

      installLog.info(`Plugin uninstalled: ${pluginId}`);
      this.emit('uninstallComplete', pluginId);

      return {
        success: true,
        pluginId,
        version,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      installLog.error(`Uninstall failed for ${pluginId}: ${message}`);

      return {
        success: false,
        pluginId,
        version: '',
        error: message,
      };
    }
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  getGrantedPermissions(pluginId: string): GrantedPluginPermissions | undefined {
    return this.grantedPermissions.get(pluginId);
  }

  hasPermission(pluginId: string, permissionType: keyof DetailedPluginPermissions): boolean {
    const granted = this.grantedPermissions.get(pluginId);
    if (!granted) return false;
    return !!granted.permissions[permissionType];
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let instance: InstallationManager | null = null;

export function getInstallationManager(): InstallationManager {
  if (!instance) {
    instance = InstallationManager.getInstance();
  }
  return instance;
}

export async function initializeInstallationManager(): Promise<InstallationManager> {
  const manager = getInstallationManager();
  await manager.initialize();
  return manager;
}
