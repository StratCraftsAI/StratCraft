import { createHash } from 'node:crypto';
import type {
  ManagedToolArchitecture,
  ManagedToolCatalog,
  ManagedToolInstallPlan,
  ManagedToolPlatform,
} from '@StratCraft/types';
import { INSTALL_DISK_SAFETY_MULTIPLIER } from './constants';
import {
  resolveManagedToolArtifact,
  resolveManagedToolDescriptor,
} from './catalog';
import { resolveManagedToolStorePaths } from './path-resolver';

export interface PlanManagedToolInstallInput {
  catalog: ManagedToolCatalog;
  toolId: string;
  requestedVersion?: string;
  currentVersion?: string | null;
  userDataRoot: string;
  platform: ManagedToolPlatform;
  architecture: ManagedToolArchitecture;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value)!;
}

export function planManagedToolInstall(
  input: PlanManagedToolInstallInput,
): ManagedToolInstallPlan {
  const descriptor = resolveManagedToolDescriptor(
    input.catalog,
    input.toolId,
    input.requestedVersion,
  );
  const artifact = resolveManagedToolArtifact(
    descriptor,
    input.platform,
    input.architecture,
  );
  const pathIdentity = resolveManagedToolStorePaths({
    userDataRoot: input.userDataRoot,
    toolId: descriptor.toolId,
    version: descriptor.version,
    platform: input.platform,
    architecture: input.architecture,
    artifactSha256: artifact.sha256,
  });
  const currentVersion = input.currentVersion ?? null;
  const unsignedPlan = {
    catalogRevision: input.catalog.catalogRevision,
    descriptorRevision: descriptor.descriptorRevision,
    toolId: descriptor.toolId,
    displayName: descriptor.displayName,
    currentVersion,
    targetVersion: descriptor.version,
    immutableRef: descriptor.source.immutableRef,
    platform: input.platform,
    architecture: input.architecture,
    artifact,
    licenseSpdx: descriptor.license.spdx,
    permissions: descriptor.permissions,
    pathIdentity,
    resourceDecision: {
      operationClass: 'install' as const,
      maxProcesses: descriptor.runtime.maxProcesses,
      artifactBytes: artifact.sizeBytes,
      requiredFreeBytes: artifact.sizeBytes * INSTALL_DISK_SAFETY_MULTIPLIER,
    },
    networkRequired: true,
    rollbackVersion:
      currentVersion !== null && currentVersion !== descriptor.version
        ? currentVersion
        : null,
  };
  const planId = createHash('sha256').update(canonicalJson(unsignedPlan)).digest('hex');
  return { planId, ...unsignedPlan };
}
