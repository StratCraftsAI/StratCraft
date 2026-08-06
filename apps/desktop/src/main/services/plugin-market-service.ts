/**
 * PluginMarketService - API-backed Plugin Marketplace
 *
 * TICKET_051: Plugin Marketplace Implementation
 * Singleton service for plugin discovery, installation, and updates.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { createLogger } from '../utils/logger';
import { compareSemver } from '@shared/utils/semver';
import { extractZip } from '../utils/archive';
import { authenticatedJsonFetch, getDesktopApiUrl } from '../utils/api-request';
// TICKET_447_1: License and auth gates for paid plugin installation
import { getLicenseValidationService } from './license-validation-service';
import { getAuthService } from './auth-service';
import { getEntitlementEnforcer } from './entitlement-enforcer';
// TICKET_892_4: Server-authoritative entitlement for marketplace install gate
import { getEntitlementSyncService } from './entitlement-sync-service';
import { resolvePlatformVersion } from '../utils/platform-resolver';
import { PLUGIN_MARKET_CACHE_TTL_MS } from '../../shared/constants/timing';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { getPluginStatusRegistry } from './plugin-status-registry';
import { getResearchWorkerPackageLifecycle } from './research-worker-package-lifecycle';
import type {
  RegistryIndex,
  RegistryPlugin,
  PluginDetails,
  RegistryStats,
  InstallProgress,
  InstalledPlugin,
  InstallPhase,
} from '../../shared/types/marketplace';
import {
  API_PLUGINS_REGISTRY,
  API_PLUGINS_STATS,
  SIGMA_PRESENTATION_PLUGIN_ID,
  SIGMA_COMMERCIAL_PACKAGE_ID,
  SIGMA_VERSION_PAIRING_RULE,
  SIGMA_REQUIRED_HOST_ROLES,
  type MarketplaceInstallResult,
  type SigmaHostRole,
} from '@StratCraft/types';

const marketLog = createLogger('MARKET');

// =============================================================================
// Configuration
// =============================================================================

const CACHE_TTL_MS = PLUGIN_MARKET_CACHE_TTL_MS;
const QUANT_LAB_PLUGIN_ID = 'com.stratcraft.quant-lab-nexus';
const RESEARCH_WORKER_PACKAGE_DIRECTORY = 'research-worker-package';

/**
 * TICKET_1368 Phase 6: Admitted operation context for transactional Sigma
 * installation. PluginMarketService consumes this instead of independently
 * deciding authentication or tier.
 */
export interface SigmaProductInstallContext {
  readonly attestationId: string;
  readonly resolvedVersion: string | null;
  readonly registryRevision: string;
  readonly entitlementRevision: string;
  readonly onStage: (stage: string, progressFraction: number) => void;
}

// =============================================================================
// PluginMarketService Class
// =============================================================================

export class PluginMarketService extends EventEmitter {
  private static instance: PluginMarketService | null = null;

  private initialized = false;
  private registryCache: RegistryIndex | null = null;
  private statsCache: RegistryStats | null = null;
  private cacheTimestamp = 0;
  private installedPlugins: Map<string, InstalledPlugin> = new Map();
  private userPluginsDir = '';
  private tempDir = '';

  // TICKET_600: In-flight request dedup to prevent concurrent duplicate HTTP requests
  private pendingRegistryFetch: Promise<RegistryIndex> | null = null;

  // TICKET_1368 Phase 6: Serialize Sigma install/update/uninstall mutations
  private sigmaInstallMutex: Promise<void> = Promise.resolve();

  private constructor() {
    super();
  }

  static getInstance(): PluginMarketService {
    if (!PluginMarketService.instance) {
      PluginMarketService.instance = new PluginMarketService();
    }
    return PluginMarketService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      marketLog.warn('PluginMarketService already initialized');
      return;
    }

    this.userPluginsDir = path.join(app.getPath('userData'), 'plugins');
    this.tempDir = path.join(app.getPath('temp'), 'StratCraft-marketplace');

    // Ensure directories exist
    await fs.mkdir(this.userPluginsDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });

    // Load installed plugins manifest
    await this.loadInstalledPlugins();

    // TICKET_440: Migrate pre-TICKET_436 installations with nested directory structure
    await this.migratePreTicket436Installs();

    this.initialized = true;
    marketLog.info('PluginMarketService initialized');
    marketLog.info('User plugins directory:', this.userPluginsDir);
  }

  // ===========================================================================
  // Registry Operations
  // ===========================================================================

  async fetchRegistry(forceRefresh = false): Promise<RegistryIndex> {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.registryCache &&
      now - this.cacheTimestamp < CACHE_TTL_MS
    ) {
      marketLog.debug('Returning cached registry');
      return this.registryCache;
    }

    // TICKET_600: Deduplicate concurrent requests -- if a fetch is already in-flight, reuse its promise
    if (this.pendingRegistryFetch) {
      marketLog.debug('Registry fetch already in-flight, reusing promise');
      return this.pendingRegistryFetch;
    }

    marketLog.info('Fetching registry from desktop API...');

    // TICKET_893: authenticated fetch — no unauthenticated marketplace API requests
    this.pendingRegistryFetch = authenticatedJsonFetch<RegistryIndex>(
      API_PLUGINS_REGISTRY,
    ).then((result) => {
      this.registryCache = result;
      this.cacheTimestamp = Date.now();
      marketLog.info(`Registry loaded: ${result.plugins.length} plugins`);
      return result;
    }).catch((error) => {
      marketLog.warn('Remote registry unavailable, using bundled fallback:', error);
      return this.loadBundledRegistry();
    }).finally(() => {
      this.pendingRegistryFetch = null;
    });

    return this.pendingRegistryFetch;
  }

  async fetchStats(): Promise<RegistryStats> {
    const now = Date.now();

    if (this.statsCache && now - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.statsCache;
    }

    try {
      this.statsCache = await authenticatedJsonFetch<RegistryStats>(
        API_PLUGINS_STATS,
      );
      return this.statsCache;
    } catch (error) {
      marketLog.warn('Error fetching stats:', error);
      return {};
    }
  }

  async fetchPluginDetails(pluginId: string): Promise<PluginDetails> {
    marketLog.info('Fetching plugin details:', pluginId);
    return authenticatedJsonFetch<PluginDetails>(
      `/api/v1/plugins/${encodeURIComponent(pluginId)}/details`,
    );
  }

  searchPlugins(plugins: RegistryPlugin[], query: string): RegistryPlugin[] {
    if (!query.trim()) return plugins;

    const lowerQuery = query.toLowerCase();
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.description.toLowerCase().includes(lowerQuery) ||
        p.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  // ===========================================================================
  // Installation Operations
  // ===========================================================================

  async installPlugin(pluginId: string, version?: string): Promise<void> {
    const installPath = path.join(this.userPluginsDir, pluginId);
    const tempPath = path.join(this.tempDir, `${pluginId}-${Date.now()}`);
    const installBackupPath = `${installPath}.rollback-${Date.now()}`;
    const priorInstallation = this.installedPlugins.get(pluginId);
    const hadPriorInstallation = priorInstallation !== undefined;
    let installedPathCreated = false;
    let priorInstallRetained = false;
    let installationRecorded = false;

    try {
      // TICKET_725_5: Bundled plugin local-first install.
      // If the plugin ships on disk and its version satisfies the request, copy
      // from the bundled path instead of downloading from the server.
      const bundledResult = await this.tryInstallFromBundled(pluginId, version, installPath);
      if (bundledResult) {
        return;
      }

      // 1. Fetch plugin metadata
      this.emitProgress(pluginId, 'downloading', 0, mainT(getCurrentMainLocale(), 'ui', 'marketplace.fetchingMetadata'));
      const pluginMeta = await this.fetchPluginDetails(pluginId);

      const targetVersion = version || pluginMeta.versions[0].version;
      const versionCandidates = pluginMeta.versions.filter((v) => v.version === targetVersion);
      if (versionCandidates.length === 0) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.versionNotFound', { version: targetVersion }));
      }

      // TICKET_725_2: Select platform-specific entry from version candidates
      const versionInfo = resolvePlatformVersion(versionCandidates);

      // TICKET_447_1: Paid plugin install gates
      await this.checkPaidPluginGates(pluginMeta);

      // 2. Download ZIP
      this.emitProgress(pluginId, 'downloading', 20, mainT(getCurrentMainLocale(), 'ui', 'marketplace.downloadingPlugin'));
      const zipPath = await this.downloadPlugin(versionInfo.downloadUrl, tempPath, pluginMeta);

      // 3. Verify SHA256
      this.emitProgress(pluginId, 'verifying', 30, mainT(getCurrentMainLocale(), 'ui', 'marketplace.verifyingChecksum'));
      await this.verifySha256(zipPath, versionInfo.sha256);

      // 4. Resolve plugin dependencies
      this.emitProgress(pluginId, 'resolving_dependencies', 40, mainT(getCurrentMainLocale(), 'ui', 'marketplace.resolvingDependencies'));
      if (pluginMeta.pluginDependencies) {
        await this.installPluginDependencies(pluginMeta.pluginDependencies);
      }

      // 5. Extract
      this.emitProgress(pluginId, 'extracting', 50, mainT(getCurrentMainLocale(), 'ui', 'marketplace.extractingPlugin'));
      await extractZip(zipPath, tempPath);

      // 5a. Flatten nested root directory from zip (TICKET_436)
      // GitHub Release zips contain a root directory (e.g., repo-name-1.0.0/).
      // Detect single root directory and promote its contents to tempPath.
      const extractedEntries = await fs.readdir(tempPath, { withFileTypes: true });
      const dirs = extractedEntries.filter((e) => e.isDirectory());
      const files = extractedEntries.filter((e) => e.isFile());

      if (dirs.length === 1 && files.length <= 1) {
        const nestedDir = path.join(tempPath, dirs[0].name);
        const nestedManifest = path.join(nestedDir, 'manifest.json');

        try {
          await fs.access(nestedManifest);
          // manifest.json is inside nested dir - flatten it
          const nestedContents = await fs.readdir(nestedDir);
          for (const item of nestedContents) {
            await fs.rename(path.join(nestedDir, item), path.join(tempPath, item));
          }
          await fs.rmdir(nestedDir);
          marketLog.info(`Flattened nested directory: ${dirs[0].name}`);
        } catch {
          // nestedDir does not contain manifest.json, no flattening needed
        }
      }

      // 5b. Clean up leftover zip file
      try {
        await fs.unlink(zipPath);
      } catch {
        // zip already removed or path changed
      }

      // 6. Validate manifest (fail fast - no silent fallback)
      const manifestPath = path.join(tempPath, 'manifest.json');
      let manifest: { id: string };
      const manifestContent = await fs.readFile(manifestPath, 'utf-8').catch(() => {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.manifestNotFound', { pluginId }));
      });
      manifest = JSON.parse(manifestContent);

      if (manifest.id && manifest.id !== pluginId) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.manifestIdMismatch', { expected: pluginId, actual: manifest.id }));
      }

      // 7. Install Python dependencies
      if (pluginMeta.dependencies?.python?.length) {
        this.emitProgress(pluginId, 'installing_python_deps', 60, mainT(getCurrentMainLocale(), 'ui', 'marketplace.installingPythonDeps'));
        await this.installPythonDeps(pluginMeta.dependencies.python, tempPath);
      }

      // 8. Move to final location (atomic)
      this.emitProgress(pluginId, 'finalizing', 90, mainT(getCurrentMainLocale(), 'ui', 'marketplace.finalizingInstallation'));
      if (hadPriorInstallation) {
        await fs.rename(installPath, installBackupPath);
        priorInstallRetained = true;
      }
      await fs.rename(tempPath, installPath);
      installedPathCreated = true;

      // 9. Persist the UI package record before activating the worker. Worker
      // activation is the final fallible commit step, so a persistence failure
      // cannot leave a new worker paired with rolled-back UI files.
      const installed: InstalledPlugin = {
        id: pluginId,
        version: targetVersion,
        installedAt: new Date().toISOString(),
        source: 'marketplace',
        path: installPath,
      };
      this.installedPlugins.set(pluginId, installed);
      await this.saveInstalledPlugins();
      installationRecorded = true;

      // TICKET_1004: Update in-memory status registry
      getPluginStatusRegistry().onPluginInstalled(pluginId, installed);

      // 10. Activate the signed commercial worker. The lifecycle owner retains
      // the previous active pointer until signature verification and health
      // pass. Any failure below restores the prior UI record and files.
      if (pluginId === QUANT_LAB_PLUGIN_ID) {
        await getResearchWorkerPackageLifecycle().installFromDirectory(
          path.join(installPath, RESEARCH_WORKER_PACKAGE_DIRECTORY),
        );
      }

      this.emitProgress(pluginId, 'complete', 100, mainT(getCurrentMainLocale(), 'ui', 'marketplace.installationComplete'));
      this.emit('installComplete', pluginId);

      marketLog.info(`Plugin installed: ${pluginId}@${targetVersion}`);
      if (priorInstallRetained) {
        await fs.rm(installBackupPath, { recursive: true, force: true }).catch(
          (cleanupError) => {
            marketLog.warn('Previous plugin backup cleanup failed:', cleanupError);
          },
        );
      }
    } catch (error) {
      await fs.rm(tempPath, { recursive: true, force: true }).catch(() => {
        // Ignore cleanup errors
      });
      if (installedPathCreated) {
        await fs.rm(installPath, { recursive: true, force: true }).catch(() => {
          // Preserve the original installation error.
        });
      }
      if (installationRecorded) {
        if (priorInstallation === undefined) {
          this.installedPlugins.delete(pluginId);
          getPluginStatusRegistry().onPluginUninstalled(pluginId);
        } else {
          this.installedPlugins.set(pluginId, priorInstallation);
          getPluginStatusRegistry().onPluginInstalled(pluginId, priorInstallation);
        }
        await this.saveInstalledPlugins().catch((rollbackError) => {
          marketLog.error('Failed to restore previous plugin record:', rollbackError);
        });
      }
      if (priorInstallRetained) {
        await fs.rename(installBackupPath, installPath).catch((rollbackError) => {
          marketLog.error('Failed to restore previous plugin installation:', rollbackError);
        });
      }
      const message = error instanceof Error ? error.message : mainT(getCurrentMainLocale(), 'errors', 'pluginMarket.installationFailed');
      this.emitProgress(pluginId, 'error', 0, message);
      this.emit('installError', { pluginId, error: message });
      throw error;
    }
  }

  /**
   * TICKET_1368 Phase 6: Transactional Sigma product installation.
   *
   * Consumes an admitted operation context instead of deciding auth/tier.
   * Acquires, verifies, stages, and publishes both the presentation plugin
   * and the signed commercial package as one atomic product transaction.
   *
   * On any failure, neither artifact is left as the active Sigma product.
   * An update failure preserves the previously verified version; a clean
   * install failure returns to absent.
   */
  async installSigmaProduct(context: SigmaProductInstallContext): Promise<MarketplaceInstallResult> {
    const startedAtMs = Date.now();
    const serialized = this.sigmaInstallMutex.then(() =>
      this.doInstallSigmaProduct(context, startedAtMs),
    );
    this.sigmaInstallMutex = serialized.then(
      () => {},
      () => {},
    );
    return serialized;
  }

  private async doInstallSigmaProduct(
    context: SigmaProductInstallContext,
    startedAtMs: number,
  ): Promise<MarketplaceInstallResult> {
    const pluginId = SIGMA_PRESENTATION_PLUGIN_ID;
    const installPath = path.join(this.userPluginsDir, pluginId);
    const tempPath = path.join(this.tempDir, `${pluginId}-sigma-${Date.now()}`);
    const installBackupPath = `${installPath}.rollback-${Date.now()}`;
    const priorInstallation = this.installedPlugins.get(pluginId);
    const hadPriorInstallation = priorInstallation !== undefined;
    let installedPathCreated = false;
    let priorInstallRetained = false;
    let installationRecorded = false;
    let presentationArtifactHash: string | null = null;
    let commercialArtifactHash: string | null = null;
    let resolvedVersion: string | null = null;

    try {
      // --- 1. Registry resolution ---
      context.onStage('registry_resolution', 0.05);
      const pluginMeta = await this.fetchPluginDetails(pluginId);

      const targetVersion = context.resolvedVersion || pluginMeta.versions[0].version;
      resolvedVersion = targetVersion;
      const versionCandidates = pluginMeta.versions.filter((v) => v.version === targetVersion);
      if (versionCandidates.length === 0) {
        throw new SigmaInstallError(
          'version_not_found',
          mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.versionNotFound', { version: targetVersion }),
          'presentation_download',
          'Check that the requested version is published for your platform',
        );
      }
      const versionInfo = resolvePlatformVersion(versionCandidates);

      // --- 2. Entitlement resolution (admission already consumed) ---
      context.onStage('entitlement_resolution', 0.1);

      // --- 3. Download presentation artifact ---
      context.onStage('presentation_download', 0.15);
      this.emitProgress(pluginId, 'downloading', 15, mainT(getCurrentMainLocale(), 'ui', 'marketplace.downloadingPlugin'));
      const zipPath = await this.downloadPlugin(versionInfo.downloadUrl, tempPath, pluginMeta);

      // --- 4. Verify presentation artifact (SHA256) ---
      context.onStage('presentation_verification', 0.25);
      this.emitProgress(pluginId, 'verifying', 25, mainT(getCurrentMainLocale(), 'ui', 'marketplace.verifyingChecksum'));
      await this.verifySha256(zipPath, versionInfo.sha256);
      presentationArtifactHash = versionInfo.sha256;

      // --- 5. Extract presentation ---
      this.emitProgress(pluginId, 'extracting', 35, mainT(getCurrentMainLocale(), 'ui', 'marketplace.extractingPlugin'));
      await extractZip(zipPath, tempPath);

      // Flatten nested root directory (TICKET_436)
      const extractedEntries = await fs.readdir(tempPath, { withFileTypes: true });
      const dirs = extractedEntries.filter((e) => e.isDirectory());
      const files = extractedEntries.filter((e) => e.isFile());
      if (dirs.length === 1 && files.length <= 1) {
        const nestedDir = path.join(tempPath, dirs[0].name);
        const nestedManifest = path.join(nestedDir, 'manifest.json');
        try {
          await fs.access(nestedManifest);
          const nestedContents = await fs.readdir(nestedDir);
          for (const item of nestedContents) {
            await fs.rename(path.join(nestedDir, item), path.join(tempPath, item));
          }
          await fs.rmdir(nestedDir);
        } catch {
          // no nested manifest
        }
      }

      try { await fs.unlink(zipPath); } catch { /* already removed */ }

      // Validate manifest
      const manifestPath = path.join(tempPath, 'manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8').catch(() => {
        throw new SigmaInstallError(
          'manifest_not_found',
          mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.manifestNotFound', { pluginId }),
          'presentation_verification',
          'The presentation artifact is malformed',
        );
      });
      const manifest = JSON.parse(manifestContent);
      if (manifest.id && manifest.id !== pluginId) {
        throw new SigmaInstallError(
          'manifest_id_mismatch',
          mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.manifestIdMismatch', { expected: pluginId, actual: manifest.id }),
          'presentation_verification',
          'The artifact identity does not match the Sigma product',
        );
      }

      // --- 6. Verify commercial package exists in extracted artifact ---
      context.onStage('commercial_download', 0.4);
      const commercialSourceDir = path.join(tempPath, RESEARCH_WORKER_PACKAGE_DIRECTORY);
      try {
        const commercialStat = await fs.lstat(commercialSourceDir);
        if (!commercialStat.isDirectory()) {
          throw new SigmaInstallError(
            'commercial_package_absent',
            'The commercial research-worker-package is not a regular directory in the presentation artifact',
            'commercial_download',
            'Ensure the Sigma artifact includes a signed commercial package',
          );
        }
      } catch (error) {
        if (error instanceof SigmaInstallError) throw error;
        throw new SigmaInstallError(
          'commercial_package_absent',
          'The commercial research-worker-package was not found in the presentation artifact',
          'commercial_download',
          'Ensure the Sigma artifact includes a signed commercial package',
        );
      }

      // --- 7. Verify commercial package (signature, health, platform) ---
      context.onStage('commercial_verification', 0.5);
      this.emitProgress(pluginId, 'verifying', 50, 'Verifying commercial package signature and health');

      // Version pairing check
      const commercialManifestPath = path.join(commercialSourceDir, 'manifest.json');
      let commercialManifestRaw: string;
      try {
        commercialManifestRaw = await fs.readFile(commercialManifestPath, 'utf-8');
      } catch {
        throw new SigmaInstallError(
          'commercial_manifest_missing',
          'The commercial package manifest is missing',
          'commercial_verification',
          'The commercial package is incomplete or corrupted',
        );
      }
      const commercialManifest = JSON.parse(commercialManifestRaw);
      const commercialVersion = commercialManifest.packageVersion ?? commercialManifest.version;
      if (commercialVersion && SIGMA_VERSION_PAIRING_RULE === 'major-minor-match') {
        const [pMajor, pMinor] = targetVersion.split('.');
        const [cMajor, cMinor] = String(commercialVersion).split('.');
        if (pMajor !== cMajor || pMinor !== cMinor) {
          throw new SigmaInstallError(
            'version_pairing_mismatch',
            `Presentation ${targetVersion} and commercial ${commercialVersion} major.minor do not match`,
            'commercial_verification',
            'The Sigma artifact contains mismatched component versions',
          );
        }
      }

      // Compute commercial hash for the result
      const commercialManifestBuffer = Buffer.from(commercialManifestRaw, 'utf-8');
      commercialArtifactHash = crypto.createHash('sha256').update(commercialManifestBuffer).digest('hex');

      // --- 8. Stage both artifacts ---
      context.onStage('staging', 0.6);
      this.emitProgress(pluginId, 'finalizing', 60, 'Staging Sigma presentation and commercial packages');

      if (hadPriorInstallation) {
        await fs.rename(installPath, installBackupPath);
        priorInstallRetained = true;
      }
      await fs.rename(tempPath, installPath);
      installedPathCreated = true;

      // --- 9. Publication: persist record ---
      context.onStage('publication', 0.7);
      this.emitProgress(pluginId, 'finalizing', 70, 'Publishing Sigma product record');

      const installed: InstalledPlugin = {
        id: pluginId,
        version: targetVersion,
        installedAt: new Date().toISOString(),
        source: 'marketplace',
        path: installPath,
      };
      this.installedPlugins.set(pluginId, installed);
      await this.saveInstalledPlugins();
      installationRecorded = true;
      getPluginStatusRegistry().onPluginInstalled(pluginId, installed);

      // --- 10. Activation: install commercial package via lifecycle owner ---
      context.onStage('activation', 0.85);
      this.emitProgress(pluginId, 'finalizing', 85, 'Activating commercial operation runtime');

      let restartRequired = false;
      try {
        await getResearchWorkerPackageLifecycle().installFromDirectory(
          path.join(installPath, RESEARCH_WORKER_PACKAGE_DIRECTORY),
        );
      } catch (activationError) {
        const activationMessage = activationError instanceof Error ? activationError.message : String(activationError);
        if (activationMessage.includes('did not activate its commercial operation module')) {
          restartRequired = true;
          marketLog.warn('Commercial runtime activation requires restart:', activationMessage);
        } else {
          throw activationError;
        }
      }

      // --- 11. Readiness ---
      context.onStage('readiness', 1.0);
      this.emitProgress(pluginId, 'complete', 100, mainT(getCurrentMainLocale(), 'ui', 'marketplace.installationComplete'));
      this.emit('installComplete', pluginId);

      marketLog.info(`Sigma product installed: ${pluginId}@${targetVersion}`);

      if (priorInstallRetained) {
        await fs.rm(installBackupPath, { recursive: true, force: true }).catch((cleanupError) => {
          marketLog.warn('Previous Sigma backup cleanup failed:', cleanupError);
        });
      }

      const terminalState = restartRequired ? 'restart_required' as const : 'ready' as const;

      return {
        contractVersion: '1.0.0',
        operationInstanceId: context.attestationId,
        productId: SIGMA_COMMERCIAL_PACKAGE_ID,
        terminalState,
        resolvedVersion,
        presentationArtifactHash,
        commercialArtifactHash,
        commercialPackageId: SIGMA_COMMERCIAL_PACKAGE_ID,
        hostRoles: [...SIGMA_REQUIRED_HOST_ROLES],
        restartRequired,
        failedStage: null,
        errorCode: null,
        errorMessage: null,
        remediationHint: null,
        startedAtMs,
        completedAtMs: Date.now(),
      };
    } catch (error) {
      // --- Rollback ---
      await fs.rm(tempPath, { recursive: true, force: true }).catch(() => {});
      if (installedPathCreated) {
        await fs.rm(installPath, { recursive: true, force: true }).catch(() => {});
      }
      if (installationRecorded) {
        if (priorInstallation === undefined) {
          this.installedPlugins.delete(pluginId);
          getPluginStatusRegistry().onPluginUninstalled(pluginId);
        } else {
          this.installedPlugins.set(pluginId, priorInstallation);
          getPluginStatusRegistry().onPluginInstalled(pluginId, priorInstallation);
        }
        await this.saveInstalledPlugins().catch((rollbackError) => {
          marketLog.error('Failed to restore previous Sigma plugin record:', rollbackError);
        });
      }
      if (priorInstallRetained) {
        await fs.rename(installBackupPath, installPath).catch((rollbackError) => {
          marketLog.error('Failed to restore previous Sigma installation:', rollbackError);
        });
      }

      const isSigmaError = error instanceof SigmaInstallError;
      const failedStage = isSigmaError ? error.failedStage : 'presentation_download';
      const errorCode = isSigmaError ? error.code : 'install_failed';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const remediationHint = isSigmaError
        ? error.remediationHint
        : 'Retry the installation or check network connectivity';

      this.emitProgress(pluginId, 'error', 0, errorMessage);
      this.emit('installError', { pluginId, error: errorMessage });

      return {
        contractVersion: '1.0.0',
        operationInstanceId: context.attestationId,
        productId: SIGMA_COMMERCIAL_PACKAGE_ID,
        terminalState: 'failed',
        resolvedVersion,
        presentationArtifactHash,
        commercialArtifactHash,
        commercialPackageId: SIGMA_COMMERCIAL_PACKAGE_ID,
        hostRoles: [...SIGMA_REQUIRED_HOST_ROLES],
        restartRequired: false,
        failedStage: failedStage as import('@StratCraft/types').SigmaInstallStage,
        errorCode,
        errorMessage,
        remediationHint,
        startedAtMs,
        completedAtMs: Date.now(),
      };
    }
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    const installed = this.installedPlugins.get(pluginId);
    if (!installed) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.pluginNotInstalled', { pluginId }));
    }

    if (installed.source !== 'marketplace') {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.cannotUninstallSource', { source: installed.source }));
    }

    if (pluginId === QUANT_LAB_PLUGIN_ID) {
      await getResearchWorkerPackageLifecycle().uninstall();
    }
    await fs.rm(installed.path, { recursive: true, force: true });
    this.installedPlugins.delete(pluginId);
    await this.saveInstalledPlugins();

    // TICKET_1004: Update in-memory status registry
    getPluginStatusRegistry().onPluginUninstalled(pluginId);

    marketLog.info(`Plugin uninstalled: ${pluginId}`);
  }

  async checkUpdates(): Promise<
    Array<{ pluginId: string; currentVersion: string; latestVersion: string }>
  > {
    const registry = await this.fetchRegistry(true);
    const updates: Array<{
      pluginId: string;
      currentVersion: string;
      latestVersion: string;
    }> = [];

    for (const [id, installed] of this.installedPlugins) {
      const registryPlugin = registry.plugins.find((p) => p.id === id);
      if (
        registryPlugin &&
        compareSemver(registryPlugin.version, installed.version) > 0
      ) {
        updates.push({
          pluginId: id,
          currentVersion: installed.version,
          latestVersion: registryPlugin.version,
        });
      }
    }

    return updates;
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  getInstalledPlugins(): InstalledPlugin[] {
    return Array.from(this.installedPlugins.values());
  }

  isInstalled(pluginId: string): boolean {
    return this.installedPlugins.has(pluginId);
  }

  getInstalledVersion(pluginId: string): string | undefined {
    return this.installedPlugins.get(pluginId)?.version;
  }

  getUserPluginsDir(): string {
    return this.userPluginsDir;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * TICKET_725_5: Resolve the on-disk bundled directory for a plugin ID.
   * Returns { dir, version } if found, null otherwise.
   */
  private async getBundledPluginInfo(
    pluginId: string
  ): Promise<{ dir: string; version: string } | null> {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const bundledBase = isDev
      ? path.join(app.getAppPath(), '../../plugins')
      : path.join(process.resourcesPath, 'bundled_plugins');

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(bundledBase, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const manifestPath = path.join(bundledBase, entry.name, 'manifest.json');
      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content);
        if (manifest.id === pluginId || entry.name === pluginId) {
          return { dir: path.join(bundledBase, entry.name), version: manifest.version || '0.0.0' };
        }
      } catch {
        // no valid manifest, continue
      }
    }
    return null;
  }

  /**
   * TICKET_725_5: If plugin exists on disk as a bundled plugin and its version
   * satisfies the request, copy it to the user plugins directory.
   * Returns true if installation was handled locally, false to fall through
   * to the server download path.
   */
  private async tryInstallFromBundled(
    pluginId: string,
    requestedVersion: string | undefined,
    installPath: string
  ): Promise<boolean> {
    // Quant Lab is an additive commercial package. Development source and the
    // open Base resources are not a substitute for its signed platform archive.
    if (pluginId === QUANT_LAB_PLUGIN_ID) return false;
    const bundled = await this.getBundledPluginInfo(pluginId);
    if (!bundled) return false;

    if (requestedVersion && compareSemver(bundled.version, requestedVersion) < 0) {
      marketLog.info(
        `Bundled ${pluginId}@${bundled.version} < requested ${requestedVersion}, falling through to server`
      );
      return false;
    }

    marketLog.info(`Installing ${pluginId}@${bundled.version} from bundled path: ${bundled.dir}`);
    this.emitProgress(pluginId, 'downloading', 0, mainT(getCurrentMainLocale(), 'ui', 'marketplace.installingFromBundled'));
    this.emitProgress(pluginId, 'extracting', 50, mainT(getCurrentMainLocale(), 'ui', 'marketplace.copyingBundledPlugin'));

    await fs.rm(installPath, { recursive: true, force: true });
    await fs.cp(bundled.dir, installPath, { recursive: true, dereference: true });

    // Verify host entry was copied for plugins with independent process
    const bundledManifestRaw = await fs.readFile(
      path.join(bundled.dir, 'manifest.json'), 'utf-8'
    );
    const bundledManifest = JSON.parse(bundledManifestRaw);
    if (bundledManifest.process?.entry) {
      const hostEntry = path.join(installPath, bundledManifest.process.entry);
      try {
        await fs.access(hostEntry);
        marketLog.info(`[INSTALL] Host entry verified: ${hostEntry}`);
      } catch {
        marketLog.error(`[INSTALL] Host entry missing after fs.cp: ${hostEntry}`);
        throw new Error(
          `Bundled install incomplete: host entry not found at ${hostEntry}. ` +
          `Source: ${path.join(bundled.dir, bundledManifest.process.entry)}`
        );
      }
    }

    const installed: InstalledPlugin = {
      id: pluginId,
      version: bundled.version,
      installedAt: new Date().toISOString(),
      source: 'marketplace',
      path: installPath,
    };
    this.installedPlugins.set(pluginId, installed);
    await this.saveInstalledPlugins();

    // TICKET_1004: Update in-memory status registry
    getPluginStatusRegistry().onPluginInstalled(pluginId, installed);

    this.emitProgress(pluginId, 'complete', 100, mainT(getCurrentMainLocale(), 'ui', 'marketplace.installationComplete'));
    this.emit('installComplete', pluginId);
    marketLog.info(`Plugin installed from bundled: ${pluginId}@${bundled.version}`);
    return true;
  }

  /**
   * TICKET_725: Load bundled registry from app resources as offline fallback.
   */
  private async loadBundledRegistry(): Promise<RegistryIndex> {
    const bundledPath = path.join(
      app.getAppPath(),
      'resources',
      'marketplace',
      'bundled-registry.json'
    );

    const content = await fs.readFile(bundledPath, 'utf-8');
    const result = JSON.parse(content) as RegistryIndex;
    this.registryCache = result;
    this.cacheTimestamp = Date.now();
    marketLog.info(`Bundled registry loaded: ${result.plugins.length} plugins`);
    return result;
  }

  /**
   * TICKET_447_1: Check install gates for paid plugins
   * - First-party (StratCraft): requires auth + entitlement tier
   * - Third-party: requires valid license key
   */
  private async checkPaidPluginGates(pluginMeta: PluginDetails): Promise<void> {
    const pricing = pluginMeta.pricing;

    if (pricing.type === 'free') return;

    if (pricing.provider === 'StratCraft') {
      // TICKET_892_4: Server-authoritative entitlement gate.
      // WP merges subscription + buyout into entitled_plugins; Desktop reads
      // the effective tier directly from the cache.
      const authService = getAuthService();
      const requiredTier = pricing.tier ? pricing.tier.toLowerCase() : null;

      // TICKET_1307: the install gate resolves admission through the SAME shared
      // resolver as the runtime gates, so install-time and use-time verdicts can
      // never disagree. `checkPluginAdmission` sources the granted side from
      // `resolveUserTier` (override > plan > free) rather than the grant
      // snapshot, so a user who has upgraded their plan can install immediately.
      const syncService = getEntitlementSyncService();
      // A plugin with no tier requirement has nothing to compare, so the
      // effective tier is only needed for the rejection message below.
      const admission = requiredTier
        ? syncService.checkPluginAdmission(pluginMeta.id, requiredTier)
        : null;
      const effectiveTier = admission?.grantedTier ?? syncService.getPluginOwnership(pluginMeta.id).tier;

      if (admission) {
        if (admission.admitted) {
          marketLog.info(
            `First-party install gate passed for ${pluginMeta.id} (effectiveTier=${effectiveTier}, authenticated=${authService.isAuthenticated()})`
          );
          return;
        }
      }

      if (!authService.isAuthenticated()) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.loginRequired'));
      }

      if (requiredTier) {
        const payload = JSON.stringify({
          pluginId: pluginMeta.id,
          requiredTier: pricing.tier,
          currentTier: effectiveTier,
        });
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.tierInsufficient', { payload, requiredTier: pricing.tier!, currentTier: effectiveTier }));
      }

      marketLog.info(`First-party install gate passed for ${pluginMeta.id}`);
    } else if (pricing.provider === 'third-party') {
      // Third-party gate: valid license key
      const licenseService = getLicenseValidationService();
      const hasKey = await licenseService.hasLicenseKey(pluginMeta.id);

      if (!hasKey) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.licenseKeyRequired'));
      }

      // Re-validate stored key
      if (pricing.licenseValidation) {
        const storedKey = await licenseService.getLicenseKey(pluginMeta.id);
        if (storedKey) {
          const result = await licenseService.validateLicense(
            pluginMeta.id,
            storedKey,
            pricing.licenseValidation
          );
          if (!result.valid) {
            throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.licenseKeyInvalid', { error: result.error || 'Validation failed' }));
          }
        }
      }

      marketLog.info(`Third-party license gate passed for ${pluginMeta.id}`);
    }
  }

  private async downloadPlugin(
    url: string,
    destDir: string,
    pluginMeta?: PluginDetails
  ): Promise<string> {
    await fs.mkdir(destDir, { recursive: true });
    const zipPath = path.join(destDir, 'plugin.zip');

    // TICKET_602: Resolve relative URLs to absolute using Desktop API base
    const resolvedUrl = url.startsWith('http') ? url : `${getDesktopApiUrl()}${url}`;

    marketLog.debug('Downloading from:', resolvedUrl);

    // TICKET_447_1: Handle authenticated downloads for paid plugins
    if (pluginMeta?.distribution?.type === 'authenticated' && pluginMeta.distribution.authenticatedDownloadUrl) {
      const licenseService = getLicenseValidationService();
      const licenseKey = await licenseService.getLicenseKey(pluginMeta.id);
      if (!licenseKey) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'marketplace.licenseKeyRequired'));
      }
      const authUrl = pluginMeta.distribution.authenticatedDownloadUrl
        .replace('{{LICENSE_KEY}}', encodeURIComponent(licenseKey));
      const response = await fetch(authUrl);
      if (!response.ok) {
        throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.authenticatedDownloadFailed', { status: String(response.status) }));
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(zipPath, buffer);
      marketLog.debug('Downloaded (authenticated) to:', zipPath);
      return zipPath;
    }

    // TICKET_447_1: First-party paid plugin download via Desktop API tunnel
    if (pluginMeta?.pricing?.provider === 'StratCraft' && pluginMeta.pricing.type !== 'free') {
      const authService = getAuthService();
      const tokenResult = await authService.getAccessToken();
      if (tokenResult) {
        const response = await fetch(resolvedUrl, {
          headers: { 'Authorization': `Bearer ${tokenResult}` },
        });
        if (!response.ok) {
          throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.authenticatedDownloadFailed', { status: String(response.status) }));
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(zipPath, buffer);
        marketLog.debug('Downloaded (first-party auth) to:', zipPath);
        return zipPath;
      }
    }

    // Direct download for public URLs
    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.downloadFailed', { status: String(response.status) }));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(zipPath, buffer);

    marketLog.debug('Downloaded to:', zipPath);
    return zipPath;
  }

  private async verifySha256(filePath: string, expected: string): Promise<void> {
    const buffer = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    if (hash !== expected) {
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.pluginMarket.checksumMismatch', { expected, actual: hash }));
    }

    marketLog.debug('Checksum verified');
  }

  // extractZip moved to ../utils/archive.ts for code reuse

  private async installPythonDeps(deps: string[], pluginDir: string): Promise<void> {
    const libsDir = path.join(pluginDir, 'libs');
    await fs.mkdir(libsDir, { recursive: true });

    const { spawn } = require('child_process');

    return new Promise((resolve, reject) => {
      const pip = spawn('pip', ['install', '-t', libsDir, '--no-cache-dir', ...deps]);

      let stderr = '';
      pip.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      pip.on('close', (code: number) => {
        if (code === 0) {
          marketLog.debug('Python dependencies installed');
          resolve();
        } else {
          reject(new Error(`pip install failed with code ${code}: ${stderr}`));
        }
      });

      pip.on('error', (err: Error) => {
        reject(new Error(`pip spawn error: ${err.message}`));
      });
    });
  }

  private async installPluginDependencies(
    deps: Record<string, string>
  ): Promise<void> {
    for (const [depId, versionConstraint] of Object.entries(deps)) {
      const installed = this.installedPlugins.get(depId);
      if (!installed || !this.satisfiesVersion(installed.version, versionConstraint)) {
        marketLog.info(`Installing dependency: ${depId}@${versionConstraint}`);
        // Install dependency recursively
        await this.installPlugin(depId);
      }
    }
  }

  private emitProgress(
    pluginId: string,
    phase: InstallPhase,
    progress: number,
    message: string
  ): void {
    const progressData: InstallProgress = {
      pluginId,
      phase,
      progress,
      message,
    };
    this.emit('installProgress', progressData);
    marketLog.debug(`Install progress [${pluginId}]: ${phase} ${progress}% - ${message}`);
  }

  /**
   * TICKET_440: Migrate pre-TICKET_436 installations.
   *
   * Plugins installed before TICKET_436 have a broken directory structure:
   *   {pluginDir}/quant-lab-nexus-1.0.0/manifest.json  (nested)
   * instead of:
   *   {pluginDir}/manifest.json                        (flat)
   *
   * This applies the same flattening logic as TICKET_436 installPlugin() step 5a.
   */
  private async migratePreTicket436Installs(): Promise<void> {
    let staleEntryCleaned = false;

    for (const [pluginId, installed] of this.installedPlugins) {
      const pluginDir = installed.path;

      // TICKET_444: Check directory existence before scanning.
      // .installed.json may contain stale entries for directories that no longer exist.
      try {
        await fs.access(pluginDir);
      } catch {
        marketLog.warn(`[TICKET_444] Stale .installed.json entry: directory missing for ${pluginId}: ${pluginDir}`);
        this.installedPlugins.delete(pluginId);
        staleEntryCleaned = true;
        continue;
      }

      const rootManifest = path.join(pluginDir, 'manifest.json');

      try {
        await fs.access(rootManifest);
        // manifest.json at root - already correct, skip
        continue;
      } catch {
        // manifest.json missing at root - check for nested structure
      }

      try {
        const entries = await fs.readdir(pluginDir, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory());

        if (dirs.length === 0) continue;

        // Same detection as TICKET_436: single nested dir with manifest.json
        for (const dir of dirs) {
          const nestedDir = path.join(pluginDir, dir.name);
          const nestedManifest = path.join(nestedDir, 'manifest.json');

          try {
            await fs.access(nestedManifest);
          } catch {
            continue;
          }

          // Found nested manifest - flatten
          const nestedContents = await fs.readdir(nestedDir);
          for (const item of nestedContents) {
            await fs.rename(path.join(nestedDir, item), path.join(pluginDir, item));
          }
          await fs.rmdir(nestedDir);
          marketLog.info(`[TICKET_440] Flattened nested directory for ${pluginId}: ${dir.name}`);
          break;
        }

        // Clean up leftover zip files
        const updatedEntries = await fs.readdir(pluginDir);
        for (const entry of updatedEntries) {
          if (entry.endsWith('.zip')) {
            await fs.unlink(path.join(pluginDir, entry));
            marketLog.info(`[TICKET_440] Removed leftover zip for ${pluginId}: ${entry}`);
          }
        }
      } catch (error) {
        marketLog.error(`[TICKET_440] Failed to migrate ${pluginId}:`, error);
      }
    }

    // TICKET_444: Persist cleaned manifest if stale entries were removed
    if (staleEntryCleaned) {
      await this.saveInstalledPlugins();
      marketLog.info('[TICKET_444] Cleaned stale entries from .installed.json');
    }
  }

  private async loadInstalledPlugins(): Promise<void> {
    const manifestPath = path.join(this.userPluginsDir, '.installed.json');
    try {
      const data = await fs.readFile(manifestPath, 'utf-8');
      const plugins = JSON.parse(data) as InstalledPlugin[];
      this.installedPlugins = new Map(plugins.map((p) => [p.id, p]));
      marketLog.info(`Loaded ${this.installedPlugins.size} installed plugins`);
    } catch {
      // No manifest yet - first run
      marketLog.debug('No installed plugins manifest found');
    }
  }

  private async saveInstalledPlugins(): Promise<void> {
    const manifestPath = path.join(this.userPluginsDir, '.installed.json');
    const plugins = Array.from(this.installedPlugins.values());
    await fs.writeFile(manifestPath, JSON.stringify(plugins, null, 2));
    marketLog.debug('Saved installed plugins manifest');
  }

  // TICKET_456: compareVersions replaced by shared compareSemver from @shared/utils/semver

  private satisfiesVersion(version: string, constraint: string): boolean {
    // Simple semver implementation
    if (constraint.startsWith('^')) {
      const minVersion = constraint.slice(1);
      return compareSemver(version, minVersion) >= 0;
    }
    if (constraint.startsWith('~')) {
      const minVersion = constraint.slice(1);
      // ~1.2.0 means >=1.2.0 <1.3.0
      const [major, minor] = minVersion.split('.').map(Number);
      const [vMajor, vMinor] = version.split('.').map(Number);
      return vMajor === major && vMinor === minor && compareSemver(version, minVersion) >= 0;
    }
    if (constraint.startsWith('>=')) {
      const minVersion = constraint.slice(2);
      return compareSemver(version, minVersion) >= 0;
    }
    return version === constraint;
  }

  /**
   * TICKET_1307: Resolve the CURRENT required tier for a plugin from the
   * registry. This is the requirement side of the admission comparison and is
   * the value that drifts over a plugin's lifetime, so it must be read from
   * registry data -- never hardcoded at the call site.
   *
   * Loads the registry when the cache is cold (lazy init / post-shutdown)
   * rather than reporting "unknown", so a gate evaluated before the
   * marketplace has been opened still sees the real requirement.
   * `fetchRegistry` already falls back to the bundled registry when the remote
   * is unreachable, so this resolves offline too.
   *
   * Returns the lowercased `pricing.tier`, or null when the plugin is free or
   * absent from the registry (i.e. no tier requirement to enforce).
   * Throws only if the registry cannot be resolved at all -- callers must not
   * substitute a guessed tier (TICKET_857 fail fast).
   */
  async getRequiredTier(pluginId: string): Promise<string | null> {
    const registry = this.registryCache ?? (await this.fetchRegistry());
    const entry = registry.plugins.find((p) => p.id === pluginId);
    if (!entry?.pricing?.tier) return null;
    return entry.pricing.tier.toLowerCase();
  }

  shutdown(): void {
    this.initialized = false;
    this.registryCache = null;
    this.statsCache = null;
    marketLog.info('PluginMarketService shutdown');
  }
}

// =============================================================================
// TICKET_1368 Phase 6: Typed Sigma installation error
// =============================================================================

class SigmaInstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly failedStage: string,
    readonly remediationHint: string,
  ) {
    super(message);
    this.name = 'SigmaInstallError';
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let pluginMarketServiceInstance: PluginMarketService | null = null;

export function getPluginMarketService(): PluginMarketService {
  if (!pluginMarketServiceInstance) {
    pluginMarketServiceInstance = PluginMarketService.getInstance();
  }
  return pluginMarketServiceInstance;
}

export async function initializePluginMarketService(): Promise<PluginMarketService> {
  const service = getPluginMarketService();
  await service.initialize();
  return service;
}

export default PluginMarketService;
