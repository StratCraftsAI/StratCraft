import os from 'node:os';
import path from 'node:path';
import type {
  ManagedToolArchitecture,
  ManagedToolPlatform,
  ManagedToolStorePathIdentity,
} from '@StratCraft/types';
import {
  MANAGED_TOOL_ACTIVATION_SUFFIX,
  MANAGED_TOOL_ACTIVE_DIRECTORY,
  MANAGED_TOOL_ARTIFACTS_DIRECTORY,
  MANAGED_TOOL_DATA_DIRECTORY,
  MANAGED_TOOL_INSTALLS_DIRECTORY,
  MANAGED_TOOL_STAGING_DIRECTORY,
  MANAGED_TOOLS_DIRECTORY,
} from './constants';
import { ManagedToolContractError } from './errors';

export interface UserDataRootResolutionInput {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

export function resolveStandaloneUserDataRoot(
  input: UserDataRootResolutionInput = {},
): string {
  const platform = input.platform ?? process.platform;
  const homeDirectory = input.homeDirectory ?? os.homedir();
  const environment = input.environment ?? process.env;
  const explicitRoot = environment.STRATCRAFT_MCP_USERDATA_DIR;
  if (explicitRoot !== undefined) {
    return requirePlatformAbsoluteUserDataRoot(explicitRoot, platform);
  }

  if (platform === 'darwin') {
    return path.join(
      requirePlatformAbsoluteUserDataRoot(homeDirectory, platform),
      'Library',
      'Application Support',
      '@StratCraft',
      'desktop',
    );
  }
  if (platform === 'win32') {
    const windowsPath = path.win32;
    const appData =
      environment.APPDATA ??
      windowsPath.join(
        requirePlatformAbsoluteUserDataRoot(homeDirectory, platform),
        'AppData',
        'Roaming',
      );
    return windowsPath.join(
      requirePlatformAbsoluteUserDataRoot(appData, platform),
      '@StratCraft',
      'desktop',
    );
  }

  const configRoot =
    environment.XDG_CONFIG_HOME ??
    path.join(requireAbsoluteUserDataRoot(homeDirectory), '.config');
  return path.join(requireAbsoluteUserDataRoot(configRoot), '@StratCraft', 'desktop');
}

function requirePlatformAbsoluteUserDataRoot(
  userDataRoot: string,
  platform: NodeJS.Platform,
): string {
  const platformPath = platform === 'win32' ? path.win32 : path;
  if (userDataRoot.length === 0 || !platformPath.isAbsolute(userDataRoot)) {
    throw new ManagedToolContractError(
      'USER_DATA_ROOT_INVALID',
      'Managed tools require a non-empty absolute user-data root.',
      { userDataRoot },
    );
  }
  return platformPath.normalize(userDataRoot);
}

export function requireAbsoluteUserDataRoot(userDataRoot: string): string {
  return requirePlatformAbsoluteUserDataRoot(userDataRoot, process.platform);
}

export interface ManagedToolStorePathInput {
  userDataRoot: string;
  toolId: string;
  version: string;
  platform: ManagedToolPlatform;
  architecture: ManagedToolArchitecture;
  artifactSha256: string;
}

export function resolveManagedToolStorePaths(
  input: ManagedToolStorePathInput,
): ManagedToolStorePathIdentity {
  const userDataRoot = requireAbsoluteUserDataRoot(input.userDataRoot);
  const storeRoot = path.join(userDataRoot, MANAGED_TOOLS_DIRECTORY);
  return {
    userDataRoot,
    storeRoot,
    artifactPath: path.join(
      storeRoot,
      MANAGED_TOOL_ARTIFACTS_DIRECTORY,
      input.artifactSha256,
    ),
    installPath: path.join(
      storeRoot,
      MANAGED_TOOL_INSTALLS_DIRECTORY,
      input.toolId,
      input.version,
      `${input.platform}-${input.architecture}`,
    ),
    activationPath: path.join(
      storeRoot,
      MANAGED_TOOL_ACTIVE_DIRECTORY,
      `${input.toolId}${MANAGED_TOOL_ACTIVATION_SUFFIX}`,
    ),
    stagingRoot: path.join(storeRoot, MANAGED_TOOL_STAGING_DIRECTORY),
    dataPath: path.join(storeRoot, MANAGED_TOOL_DATA_DIRECTORY, input.toolId),
  };
}
