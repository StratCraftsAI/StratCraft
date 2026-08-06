import type {
  ManagedToolArchitecture,
  ManagedToolArtifactDescriptor,
  ManagedToolCatalog,
  ManagedToolDescriptor,
  ManagedToolPlatform,
} from '@StratCraft/types';
import { ManagedToolContractError } from './errors';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const IMMUTABLE_RELEASE_PATTERN = /^v\d+\.\d+\.\d+$/;
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_INSTALL_HOSTS = new Set(['github.com', 'objects.githubusercontent.com']);

function fail(message: string, details: Readonly<Record<string, unknown>> = {}): never {
  throw new ManagedToolContractError('CATALOG_INVALID', message, details);
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0) fail(`Managed-tool descriptor field ${field} is required.`, { field });
}

function validateArtifact(
  descriptor: ManagedToolDescriptor,
  artifact: ManagedToolArtifactDescriptor,
): void {
  if (!SHA256_PATTERN.test(artifact.sha256)) {
    fail('Managed-tool artifact requires a lowercase SHA-256 digest.', {
      toolId: descriptor.toolId,
      platform: artifact.platform,
      architecture: artifact.architecture,
    });
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
    fail('Managed-tool artifact size must be a positive safe integer.', {
      toolId: descriptor.toolId,
    });
  }
  if (
    artifact.executableRelativePath.length === 0 ||
    artifact.executableRelativePath.startsWith('/') ||
    artifact.executableRelativePath.startsWith('\\') ||
    artifact.executableRelativePath.split(/[\\/]/u).includes('..')
  ) {
    fail('Managed-tool executable path must remain relative to its installation.', {
      toolId: descriptor.toolId,
      executableRelativePath: artifact.executableRelativePath,
    });
  }

  let url: URL;
  try {
    url = new URL(artifact.url);
  } catch {
    fail('Managed-tool artifact URL is invalid.', { toolId: descriptor.toolId });
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !url.pathname.startsWith('/duckdb/duckdb/releases/download/')
  ) {
    fail('Managed-tool artifact must use the reviewed GitHub release origin.', {
      toolId: descriptor.toolId,
      url: artifact.url,
    });
  }
}

export function validateManagedToolCatalog(catalog: ManagedToolCatalog): void {
  if (catalog.schemaVersion !== 1) fail('Unsupported managed-tool catalog schema.');
  requireNonEmpty(catalog.catalogRevision, 'catalogRevision');
  if (catalog.descriptors.length === 0) fail('Managed-tool catalog must not be empty.');

  const descriptorKeys = new Set<string>();
  for (const descriptor of catalog.descriptors) {
    if (descriptor.schemaVersion !== 1) fail('Unsupported managed-tool descriptor schema.');
    requireNonEmpty(descriptor.descriptorRevision, 'descriptorRevision');
    requireNonEmpty(descriptor.displayName, 'displayName');
    requireNonEmpty(descriptor.version, 'version');
    if (!IDENTIFIER_PATTERN.test(descriptor.toolId)) {
      fail('Managed-tool ID must be a lowercase kebab-case identifier.', {
        toolId: descriptor.toolId,
      });
    }
    const descriptorKey = `${descriptor.toolId}@${descriptor.version}`;
    if (descriptorKeys.has(descriptorKey)) {
      fail('Managed-tool catalog contains a duplicate tool version.', { descriptorKey });
    }
    descriptorKeys.add(descriptorKey);

    if (
      descriptor.source.type !== 'github-release' ||
      descriptor.source.repository !== 'https://github.com/duckdb/duckdb' ||
      !IMMUTABLE_RELEASE_PATTERN.test(descriptor.source.immutableRef) ||
      !COMMIT_PATTERN.test(descriptor.source.releaseCommit) ||
      Number.isNaN(Date.parse(descriptor.source.publishedAt))
    ) {
      fail('Managed-tool source must be a reviewed immutable GitHub release.', {
        toolId: descriptor.toolId,
      });
    }
    requireNonEmpty(descriptor.license.spdx, 'license.spdx');
    if (descriptor.capabilities.length === 0) {
      fail('Managed-tool descriptor must declare at least one capability.', {
        toolId: descriptor.toolId,
      });
    }
    if (
      descriptor.permissions.networkDuringInstall.length === 0 ||
      descriptor.permissions.filesystemRead.length === 0 ||
      descriptor.permissions.filesystemWrite.length === 0 ||
      descriptor.permissions.networkDuringInstall.some(
        (host) => !ALLOWED_INSTALL_HOSTS.has(host),
      )
    ) {
      fail('Managed-tool descriptor permissions are missing or exceed pilot policy.', {
        toolId: descriptor.toolId,
      });
    }
    if (
      descriptor.runtime.maxProcesses !== 1 ||
      descriptor.runtime.timeoutPolicy !== 'operation-class'
    ) {
      fail('Managed-tool runtime policy exceeds the one-process pilot contract.', {
        toolId: descriptor.toolId,
      });
    }
    if (
      descriptor.healthcheck.argv.length !== 2 ||
      descriptor.healthcheck.argv[0] !== 'duckdb' ||
      descriptor.healthcheck.argv[1] !== '-version'
    ) {
      fail('Managed-tool healthcheck must use the reviewed fixed argv.', {
        toolId: descriptor.toolId,
      });
    }
    if (descriptor.artifacts.length === 0) {
      fail('Managed-tool descriptor must include reviewed artifacts.', {
        toolId: descriptor.toolId,
      });
    }

    const artifactKeys = new Set<string>();
    for (const artifact of descriptor.artifacts) {
      validateArtifact(descriptor, artifact);
      const artifactKey = `${artifact.platform}-${artifact.architecture}`;
      if (artifactKeys.has(artifactKey)) {
        fail('Managed-tool descriptor has multiple artifacts for one platform.', {
          toolId: descriptor.toolId,
          artifactKey,
        });
      }
      artifactKeys.add(artifactKey);
    }
  }
}

export function resolveManagedToolDescriptor(
  catalog: ManagedToolCatalog,
  toolId: string,
  requestedVersion?: string,
): ManagedToolDescriptor {
  validateManagedToolCatalog(catalog);
  const candidates = catalog.descriptors.filter((descriptor) => descriptor.toolId === toolId);
  if (candidates.length === 0) {
    throw new ManagedToolContractError(
      'TOOL_NOT_REGISTERED',
      `Managed tool "${toolId}" is not in the trusted catalog.`,
      { toolId },
    );
  }
  if (requestedVersion === undefined) return candidates[0];
  const descriptor = candidates.find((candidate) => candidate.version === requestedVersion);
  if (descriptor === undefined) {
    throw new ManagedToolContractError(
      'VERSION_NOT_REGISTERED',
      `Managed tool "${toolId}" version "${requestedVersion}" is not in the trusted catalog.`,
      { toolId, requestedVersion },
    );
  }
  return descriptor;
}

export function resolveManagedToolArtifact(
  descriptor: ManagedToolDescriptor,
  platform: ManagedToolPlatform,
  architecture: ManagedToolArchitecture,
): ManagedToolArtifactDescriptor {
  const matches = descriptor.artifacts.filter(
    (artifact) =>
      artifact.platform === platform && artifact.architecture === architecture,
  );
  if (matches.length !== 1) {
    throw new ManagedToolContractError(
      'PLATFORM_NOT_SUPPORTED',
      `Managed tool "${descriptor.toolId}" has no unique reviewed artifact for ${platform}-${architecture}.`,
      { toolId: descriptor.toolId, platform, architecture },
    );
  }
  return matches[0];
}

