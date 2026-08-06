/**
 * Plugin Installation IPC Handlers
 *
 * TICKET_100: Plugin Installation Flow & User Consent
 *
 * IPC channels for plugin installation with consent flow:
 * - plugin:install:preview - Get installation preview
 * - plugin:install:confirm - Confirm and start installation
 * - plugin:install:cancel - Cancel installation
 * - plugin:install:progress - (event) Installation progress updates
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pluginLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import {
  getInstallationManager,
  initializeInstallationManager,
  type InstallProgress,
} from '../services/installation-manager';
import type { PluginInstallPreview } from '../../shared/types/plugin';
import { getCurrentMainLocale } from '../services/locale-service';
import { loadDialogStrings } from '../i18n/dialogs';

// =============================================================================
// Types
// =============================================================================

interface InstallPreviewRequest {
  packagePath?: string;
  pluginId?: string;
  version?: string;
}

interface InstallConfirmRequest {
  packagePath: string;
  preview: PluginInstallPreview;
}

// =============================================================================
// Handlers
// =============================================================================

export function registerInstallHandlers(): void {
  // Preview installation
  ipcMain.handle(
    'plugin:install:preview',
    async (_event, request: InstallPreviewRequest) => {
      try {
        const manager = getInstallationManager();

        let packagePath = request.packagePath;

        // If no path provided, open file dialog
        if (!packagePath) {
          const locale = getCurrentMainLocale();
          const d = loadDialogStrings(locale);
          const result = await dialog.showOpenDialog({
            title: d.pluginInstall.title,
            filters: [
              { name: d.pluginInstall.filter.nexusPackage, extensions: ['nexuspkg', 'zip'] },
            ],
            properties: ['openFile'],
          });

          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'MSG_INSTALL_NO_FILE' };
          }

          packagePath = result.filePaths[0];
        }

        // Extract manifest and signature from package
        const { manifest, signatureJson, signatureBytes } =
          await extractPackageMetadata(packagePath);

        // Generate preview
        const preview = await manager.previewInstall(
          JSON.stringify(manifest),
          signatureJson,
          signatureBytes
        );

        return {
          success: true,
          preview,
          packagePath,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : mainT(getCurrentMainLocale(), 'errors', 'ipc.install.unknownError');
        pluginLog.error('Preview failed:', error);
        return { success: false, error: message };
      }
    }
  );

  // Confirm and install
  ipcMain.handle(
    'plugin:install:confirm',
    async (event, request: InstallConfirmRequest) => {
      try {
        const manager = getInstallationManager();

        // Subscribe to progress events
        const progressHandler = (progress: InstallProgress) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send('plugin:install:progress', progress);
          }
        };

        manager.on('progress', progressHandler);

        try {
          const result = await manager.installFromPackage(
            request.packagePath,
            request.preview
          );

          return result;
        } finally {
          manager.off('progress', progressHandler);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : mainT(getCurrentMainLocale(), 'errors', 'ipc.install.unknownError');
        pluginLog.error('Install failed:', error);
        return {
          success: false,
          pluginId: request.preview.pluginId,
          version: request.preview.version,
          error: message,
        };
      }
    }
  );

  // Check granted permissions
  ipcMain.handle(
    'plugin:install:getPermissions',
    async (_event, pluginId: string) => {
      const manager = getInstallationManager();
      const granted = manager.getGrantedPermissions(pluginId);
      return { success: true, permissions: granted || null };
    }
  );

  // Check specific permission
  ipcMain.handle(
    'plugin:install:hasPermission',
    async (
      _event,
      pluginId: string,
      permissionType: string
    ) => {
      const manager = getInstallationManager();
      const has = manager.hasPermission(
        pluginId,
        permissionType as keyof import('../../shared/types/plugin').DetailedPluginPermissions
      );
      return { success: true, hasPermission: has };
    }
  );

  pluginLog.info('Plugin install handlers registered');
}

// =============================================================================
// Helper Functions
// =============================================================================

async function extractPackageMetadata(packagePath: string): Promise<{
  manifest: Record<string, unknown>;
  signatureJson: string | null;
  signatureBytes: Buffer | null;
}> {
  // For now, assume package is a zip file
  // In production, would use proper package extraction

  const ext = path.extname(packagePath).toLowerCase();

  if (ext === '.nexuspkg' || ext === '.zip') {
    // Extract using adm-zip
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(packagePath);
      const entries = zip.getEntries();

      let manifest: Record<string, unknown> | null = null;
      let signatureJson: string | null = null;
      let signatureBytes: Buffer | null = null;

      for (const entry of entries) {
        const name = entry.entryName;

        if (name === 'manifest.json' || name.endsWith('/manifest.json')) {
          manifest = JSON.parse(entry.getData().toString('utf-8'));
        } else if (name === 'SIGNATURE.json' || name.endsWith('/SIGNATURE.json')) {
          signatureJson = entry.getData().toString('utf-8');
        } else if (name === 'SIGNATURE.sig' || name.endsWith('/SIGNATURE.sig')) {
          signatureBytes = entry.getData();
        }
      }

      if (!manifest) {
        throw new Error('MSG_INSTALL_NO_MANIFEST');
      }

      return { manifest, signatureJson, signatureBytes };
    } catch (error) {
      if (error instanceof Error && (error.message.includes('manifest.json') || error.message.includes('MSG_INSTALL_NO_MANIFEST'))) {
        throw error;
      }
      // If adm-zip fails, try as directory
    }
  }

  // Assume it's a directory path
  const manifestPath = path.join(packagePath, 'manifest.json');
  const signaturePath = path.join(packagePath, 'SIGNATURE.json');
  const sigBytesPath = path.join(packagePath, 'SIGNATURE.sig');

  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent);

  let signatureJson: string | null = null;
  let signatureBytes: Buffer | null = null;

  try {
    signatureJson = await fs.readFile(signaturePath, 'utf-8');
    signatureBytes = await fs.readFile(sigBytesPath);
  } catch {
    // No signature - package is unsigned
  }

  return { manifest, signatureJson, signatureBytes };
}

// =============================================================================
// Initialization
// =============================================================================

export async function initializeInstallHandlers(): Promise<void> {
  await initializeInstallationManager();
  registerInstallHandlers();
}
