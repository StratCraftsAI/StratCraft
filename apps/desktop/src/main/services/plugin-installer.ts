/**
 * Plugin Installer Service
 *
 * TICKET_250_10: Plugin Installation System
 * TICKET_725_2: Per-platform plugin ZIP distribution (no local C++ build)
 *
 * Handles installation of third-party executor plugins:
 * - Manifest validation
 * - Pre-built native binary verification (TICKET_725_2)
 * - UI component registration
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const installerLog = createLogger('PLUGIN-INSTALLER');

// =============================================================================
// Types
// =============================================================================

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  libraryName: string;
  dependencies: string[];
  author?: string;
  license?: string;
  // UI configuration
  ui?: {
    entryPoint?: string;
    routes?: Array<{ path: string; component: string }>;
  };
}

export interface InstallProgress {
  phase: 'validating' | 'building' | 'installing-deps' | 'registering' | 'complete' | 'failed';
  percent: number;
  message: string;
}

export interface InstallResult {
  success: boolean;
  pluginName: string;
  installPath: string;
  error?: string;
}

// =============================================================================
// Plugin Installer Service
// =============================================================================

class PluginInstallerService extends EventEmitter {
  private installDir: string;

  constructor() {
    super();
    this.installDir = path.join(app.getPath('userData'), 'plugins');
  }

  /**
   * Get plugin installation directory
   */
  getInstallDir(): string {
    return this.installDir;
  }

  /**
   * Install plugin from source directory
   */
  async installFromSource(sourcePath: string): Promise<InstallResult> {
    const manifestPath = path.join(sourcePath, 'manifest.json');

    // Phase 1: Validate
    this.emitProgress('validating', 0, 'install.progress.validatingManifest');

    if (!fs.existsSync(manifestPath)) {
      return this.failInstall('', 'manifest.json not found');
    }

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
      return this.failInstall('', `Invalid manifest.json: ${error}`);
    }

    if (!manifest.name || !manifest.version) {
      return this.failInstall('', 'Manifest missing required fields: name, version');
    }

    const pluginName = manifest.name;
    const installPath = path.join(this.installDir, pluginName);

    installerLog.info(`Installing plugin: ${pluginName} v${manifest.version}`);
    this.emitProgress('validating', 10, `Plugin: ${pluginName} v${manifest.version}`);

    try {
      // Create install directory
      if (!fs.existsSync(this.installDir)) {
        fs.mkdirSync(this.installDir, { recursive: true });
      }

      // Phase 2: Verify pre-built native binary (TICKET_725_2)
      // Native binaries are included in per-platform ZIPs, no local build needed.
      const libDir = path.join(sourcePath, 'lib');
      if (fs.existsSync(libDir)) {
        this.emitProgress('building', 20, 'install.progress.verifyingBinary');

        const suffix = this.getNativeBinarySuffix();
        const libFiles = fs.readdirSync(libDir);
        const hasNativeBinary = libFiles.some((f) => f.endsWith(suffix));

        if (hasNativeBinary) {
          this.emitProgress('building', 50, 'install.progress.binaryVerified');
        } else {
          installerLog.warn(`No native binary with suffix ${suffix} found in ${libDir}`);
        }
      }

      // Phase 3: Copy to install directory
      this.emitProgress('registering', 80, 'install.progress.copyingFiles');

      await this.copyPluginFiles(sourcePath, installPath, manifest);

      // Phase 4: Register plugin
      this.emitProgress('registering', 90, 'install.progress.registeringPlugin');

      await this.registerPlugin(installPath, manifest);

      this.emitProgress('complete', 100, 'install.progress.installationComplete');

      installerLog.info(`Plugin ${pluginName} installed successfully`);

      return {
        success: true,
        pluginName,
        installPath,
      };

    } catch (error) {
      return this.failInstall(pluginName, String(error));
    }
  }

  /**
   * Uninstall plugin
   */
  async uninstall(pluginName: string): Promise<{
    success: boolean;
    error?: string;
    i18nKey?: string;
  }> {
    const installPath = path.join(this.installDir, pluginName);

    if (!fs.existsSync(installPath)) {
      return { success: false, error: 'Plugin not installed', i18nKey: 'plugin.notInstalled' };
    }

    try {
      // Remove plugin directory
      fs.rmSync(installPath, { recursive: true, force: true });

      installerLog.info(`Plugin ${pluginName} uninstalled`);
      return { success: true };

    } catch (error) {
      installerLog.error(`Failed to uninstall ${pluginName}:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * List installed plugins
   */
  listInstalled(): Array<{ name: string; version: string; path: string }> {
    const plugins: Array<{ name: string; version: string; path: string }> = [];

    if (!fs.existsSync(this.installDir)) {
      return plugins;
    }

    const entries = fs.readdirSync(this.installDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const manifestPath = path.join(this.installDir, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          plugins.push({
            name: manifest.name || entry.name,
            version: manifest.version || 'unknown',
            path: path.join(this.installDir, entry.name),
          });
        } catch {
          // Invalid manifest
        }
      }
    }

    return plugins;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private emitProgress(phase: InstallProgress['phase'], percent: number, message: string): void {
    const progress: InstallProgress = { phase, percent, message };
    this.emit('progress', progress);
    installerLog.debug(`[${phase}] ${percent}% - ${message}`);
  }

  private failInstall(pluginName: string, error: string): InstallResult {
    this.emitProgress('failed', 0, error);
    installerLog.error(`Installation failed: ${error}`);
    return {
      success: false,
      pluginName,
      installPath: '',
      error,
    };
  }

  private async copyPluginFiles(sourcePath: string, installPath: string, _manifest: PluginManifest): Promise<void> {
    // Remove existing installation
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    // TICKET_725_2: Copy entire source directory (includes manifest, IIFE, lib/ with native binary)
    this.copyDir(sourcePath, installPath);

    // Set executable permission on native binaries (Linux/macOS)
    if (process.platform !== 'win32') {
      const libDir = path.join(installPath, 'lib');
      if (fs.existsSync(libDir)) {
        const files = fs.readdirSync(libDir);
        for (const file of files) {
          if (file.endsWith('.so') || file.endsWith('.dylib')) {
            fs.chmodSync(path.join(libDir, file), 0o755);
          }
        }
      }
    }
  }

  private getNativeBinarySuffix(): string {
    switch (process.platform) {
      case 'linux': return '.so';
      case 'darwin': return '.dylib';
      case 'win32': return '.dll';
      default: return '.so';
    }
  }

  private copyDir(src: string, dst: string): void {
    fs.mkdirSync(dst, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        this.copyDir(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  private async registerPlugin(installPath: string, manifest: PluginManifest): Promise<void> {
    // Plugin is registered automatically when PluginLoader scans directories
    // Just verify the installation is valid
    const libDir = path.join(installPath, 'lib');
    const expectedLib = `lib${manifest.libraryName}.so`;

    if (fs.existsSync(libDir)) {
      const libs = fs.readdirSync(libDir);
      const hasLib = libs.some(f => f.includes(manifest.libraryName));

      if (!hasLib) {
        installerLog.warn(`Library ${expectedLib} not found in ${libDir}`);
      }
    }

    installerLog.info(`Plugin ${manifest.name} registered at ${installPath}`);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let installerService: PluginInstallerService | null = null;

export function getPluginInstaller(): PluginInstallerService {
  if (!installerService) {
    installerService = new PluginInstallerService();
  }
  return installerService;
}
