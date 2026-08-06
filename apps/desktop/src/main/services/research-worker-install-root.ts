/**
 * Authoritative Quant Lab package path resolution (TICKET_1367 S1).
 *
 * This owner is Electron-neutral. Runtime adapters supply their user-data and
 * resources paths; environment overrides and their validation are resolved
 * exactly once here for both Electron and the headless Service API host.
 */

import * as path from 'path';
import {
  RESEARCH_WORKER_PACKAGE_ID,
  RESEARCH_WORKER_TRUST_STORE_FILE,
} from '../constants/research-worker';

const INSTALL_ROOT_ENV = 'STRATCRAFT_WORKER_INSTALL_ROOT';
const TRUST_STORE_ENV = 'STRATCRAFT_WORKER_TRUST_STORE';
const COMMERCIAL_PACKAGES_DIRECTORY = 'commercial-packages';
const LIFECYCLE_STAGING_PREFIX = '.research-worker-stage-';

export type ResearchWorkerPathProvenance =
  | 'explicit'
  | 'environment'
  | 'application-user-data'
  | 'application-resources';

export interface ResearchWorkerPackagePathResolution {
  readonly installationRoot: string;
  readonly installationRootProvenance: ResearchWorkerPathProvenance;
  readonly trustStorePath: string;
  readonly trustStorePathProvenance: ResearchWorkerPathProvenance;
}

export interface ResearchWorkerPackagePathResolverOptions {
  readonly installationRoot?: string;
  readonly trustStorePath?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly userDataPath: () => string;
  readonly resourcesPath: () => string | undefined;
  /** Electron-compatible application path supplied by the current host. */
  readonly applicationPath: () => string;
  readonly isPackaged?: boolean;
  readonly platform?: NodeJS.Platform;
}

function platformPath(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return platform === 'win32' ? path.win32 : path.posix;
}

function requireAbsolutePath(
  value: string,
  label: string,
  platform: NodeJS.Platform,
): string {
  const paths = platformPath(platform);
  if (value.trim().length === 0 || !paths.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty absolute path.`);
  }
  return paths.normalize(value);
}

function isContainedBy(candidate: string, parent: string, platform: NodeJS.Platform): boolean {
  const paths = platformPath(platform);
  const relative = paths.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative));
}

function assertSafeEnvironmentInstallRoot(
  installationRoot: string,
  applicationPath: string,
  platform: NodeJS.Platform,
): void {
  if (isContainedBy(installationRoot, applicationPath, platform)) {
    throw new Error(
      `${INSTALL_ROOT_ENV} must not point into the StratCraft application or source tree.`,
    );
  }
  const paths = platformPath(platform);
  const segments = installationRoot.split(paths.sep);
  if (segments.some((segment) =>
    segment === 'staging' || segment.startsWith(LIFECYCLE_STAGING_PREFIX))) {
    throw new Error(`${INSTALL_ROOT_ENV} must not point into a package staging directory.`);
  }
}

export function resolveResearchWorkerPackagePaths(
  options: ResearchWorkerPackagePathResolverOptions,
): ResearchWorkerPackagePathResolution {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const explicitInstallationRoot = options.installationRoot;
  const environmentInstallationRoot = environment[INSTALL_ROOT_ENV];

  let installationRoot: string;
  let installationRootProvenance: ResearchWorkerPathProvenance;
  if (explicitInstallationRoot !== undefined) {
    installationRoot = requireAbsolutePath(
      explicitInstallationRoot,
      'Quant Lab installation root',
      platform,
    );
    installationRootProvenance = 'explicit';
  } else if (environmentInstallationRoot !== undefined) {
    installationRoot = requireAbsolutePath(
      environmentInstallationRoot,
      INSTALL_ROOT_ENV,
      platform,
    );
    const applicationPath = requireAbsolutePath(
      options.applicationPath(),
      'StratCraft application path',
      platform,
    );
    const ownershipRoot = options.isPackaged
      ? applicationPath
      : platformPath(platform).resolve(applicationPath, '..', '..');
    assertSafeEnvironmentInstallRoot(installationRoot, ownershipRoot, platform);
    installationRootProvenance = 'environment';
  } else {
    const paths = platformPath(platform);
    const userDataPath = requireAbsolutePath(
      options.userDataPath(),
      'StratCraft user-data path',
      platform,
    );
    installationRoot = paths.join(
      userDataPath,
      COMMERCIAL_PACKAGES_DIRECTORY,
      RESEARCH_WORKER_PACKAGE_ID,
    );
    installationRootProvenance = 'application-user-data';
  }

  const explicitTrustStorePath = options.trustStorePath;
  const environmentTrustStorePath = environment[TRUST_STORE_ENV];
  let trustStorePath: string;
  let trustStorePathProvenance: ResearchWorkerPathProvenance;
  if (explicitTrustStorePath !== undefined) {
    trustStorePath = requireAbsolutePath(
      explicitTrustStorePath,
      'Quant Lab trust-store path',
      platform,
    );
    trustStorePathProvenance = 'explicit';
  } else if (environmentTrustStorePath !== undefined) {
    trustStorePath = requireAbsolutePath(
      environmentTrustStorePath,
      TRUST_STORE_ENV,
      platform,
    );
    trustStorePathProvenance = 'environment';
  } else {
    const paths = platformPath(platform);
    const resourcesPath = options.resourcesPath();
    if (resourcesPath === undefined) {
      throw new Error(
        'StratCraft resources path is unavailable; initialize the host before resolving the Quant Lab trust store.',
      );
    }
    trustStorePath = paths.join(
      requireAbsolutePath(resourcesPath, 'StratCraft resources path', platform),
      RESEARCH_WORKER_TRUST_STORE_FILE,
    );
    trustStorePathProvenance = 'application-resources';
  }

  return {
    installationRoot,
    installationRootProvenance,
    trustStorePath,
    trustStorePathProvenance,
  };
}
