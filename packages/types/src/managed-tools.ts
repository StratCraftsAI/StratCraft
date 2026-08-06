/**
 * Shared managed-tool contracts.
 *
 * These contracts contain no Electron, MCP, network, filesystem, or process
 * implementation. Every adapter consumes the same validated descriptor and
 * immutable plan produced by the headless core.
 */

export const MANAGED_TOOL_DESCRIPTOR_SCHEMA_VERSION = 1 as const;
export const MANAGED_TOOL_CATALOG_SCHEMA_VERSION = 1 as const;

export type ManagedToolPlatform = 'linux' | 'darwin' | 'win32';
export type ManagedToolArchitecture = 'x64' | 'arm64';
export type ManagedToolArchiveFormat = 'zip';
export type ManagedToolLifecycleState =
  | 'available'
  | 'planned'
  | 'downloading'
  | 'verified'
  | 'staged'
  | 'active'
  | 'upgrading'
  | 'uninstalling'
  | 'failed';
export type ManagedToolOperationClass = 'install' | 'bounded-analysis';

export interface ManagedToolArtifactDescriptor {
  platform: ManagedToolPlatform;
  architecture: ManagedToolArchitecture;
  url: string;
  sha256: string;
  sizeBytes: number;
  archiveFormat: ManagedToolArchiveFormat;
  executableRelativePath: string;
}

export interface ManagedToolPermissionDescriptor {
  networkDuringInstall: readonly string[];
  networkDuringRun: readonly string[];
  filesystemRead: readonly string[];
  filesystemWrite: readonly string[];
}

export interface ManagedToolRuntimeDescriptor {
  maxProcesses: number;
  timeoutPolicy: 'operation-class';
}

export interface ManagedToolDescriptor {
  schemaVersion: typeof MANAGED_TOOL_DESCRIPTOR_SCHEMA_VERSION;
  descriptorRevision: string;
  toolId: string;
  displayName: string;
  version: string;
  source: {
    type: 'github-release';
    repository: string;
    immutableRef: string;
    releaseCommit: string;
    publishedAt: string;
  };
  license: {
    spdx: string;
  };
  artifacts: readonly ManagedToolArtifactDescriptor[];
  capabilities: readonly string[];
  permissions: ManagedToolPermissionDescriptor;
  runtime: ManagedToolRuntimeDescriptor;
  healthcheck: {
    argv: readonly string[];
  };
}

export interface ManagedToolCatalog {
  schemaVersion: typeof MANAGED_TOOL_CATALOG_SCHEMA_VERSION;
  catalogRevision: string;
  descriptors: readonly ManagedToolDescriptor[];
}

export interface ManagedToolStorePathIdentity {
  userDataRoot: string;
  storeRoot: string;
  artifactPath: string;
  installPath: string;
  activationPath: string;
  stagingRoot: string;
  dataPath: string;
}

export interface ManagedToolResourceDecision {
  operationClass: ManagedToolOperationClass;
  maxProcesses: number;
  artifactBytes: number;
  requiredFreeBytes: number;
}

export interface ManagedToolInstallPlan {
  planId: string;
  catalogRevision: string;
  descriptorRevision: string;
  toolId: string;
  displayName: string;
  currentVersion: string | null;
  targetVersion: string;
  immutableRef: string;
  platform: ManagedToolPlatform;
  architecture: ManagedToolArchitecture;
  artifact: ManagedToolArtifactDescriptor;
  licenseSpdx: string;
  permissions: ManagedToolPermissionDescriptor;
  pathIdentity: ManagedToolStorePathIdentity;
  resourceDecision: ManagedToolResourceDecision;
  networkRequired: boolean;
  rollbackVersion: string | null;
}

export type ManagedToolErrorCode =
  | 'CATALOG_INVALID'
  | 'TOOL_NOT_REGISTERED'
  | 'VERSION_NOT_REGISTERED'
  | 'PLATFORM_NOT_SUPPORTED'
  | 'USER_DATA_ROOT_INVALID';

