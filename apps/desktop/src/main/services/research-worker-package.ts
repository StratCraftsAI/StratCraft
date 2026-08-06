/**
 * Signed commercial research-worker package discovery (TICKET_1304_5C).
 *
 * This module is public host infrastructure. It verifies the frozen
 * @StratCraft/types package and discovery contracts without importing any
 * commercial implementation, registry, threshold, model, or policy.
 */

import { createHash, createPublicKey, verify as verifySignature } from 'crypto';
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  RESEARCH_WORKER_PROTOCOL_VERSION,
  negotiateResearchWorkerProtocol,
  researchWorkerDiscoveryDescriptorSchema,
  researchWorkerPackageManifestSchema,
  type ResearchWorkerDiscoveryDescriptor,
  type ResearchWorkerHostDiscovery,
  type ResearchWorkerPackageManifest,
} from '@StratCraft/types';
import {
  RESEARCH_WORKER_ACTIVE_POINTER_FILE,
} from '../constants/research-worker';
import { resolveResearchWorkerPackagePaths } from './research-worker-install-root';

interface ActivePackagePointer {
  readonly schemaVersion: 1;
  readonly versionDirectory: string;
  readonly manifestRelativePath: string;
}

interface TrustStoreKey {
  readonly publisherId: 'com.stratcraft';
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly revoked: boolean;
}

interface ResearchWorkerTrustStore {
  readonly schemaVersion: 1;
  readonly keys: readonly TrustStoreKey[];
}

export interface VerifiedResearchWorkerPackage {
  readonly packageRoot: string;
  readonly executablePath: string;
  readonly hostModulePath: string;
  /**
   * TICKET_1304_16 section 22: absolute, containment-checked directories that
   * must be on the worker's runtime loader path. Empty when the executable
   * declares none.
   */
  readonly libraryPaths: readonly string[];
  /**
   * TICKET_1304_16 section 22: absolute, containment-checked `nona_algorithm`
   * root. Undefined when the package ships no Python entry points.
   */
  readonly algorithmRootPath?: string;
  readonly manifestSha256: string;
  readonly manifest: ResearchWorkerPackageManifest;
  readonly discovery: ResearchWorkerDiscoveryDescriptor;
}

export class ResearchWorkerPackageError extends Error {
  constructor(
    readonly code:
      | 'WORKER_SIGNATURE_INVALID'
      | 'WORKER_PROTOCOL_INCOMPATIBLE'
      | 'WORKER_REQUEST_INVALID',
    message: string,
    readonly remediation: string,
  ) {
    super(message);
    this.name = 'ResearchWorkerPackageError';
  }
}

export interface ResearchWorkerPackageVerifierOptions {
  readonly installationRoot?: string;
  readonly trustStorePath?: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      `${label} must be a JSON object.`,
      'Reinstall the Quant Lab package from a trusted source.',
    );
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      `${label} contains missing or unknown fields.`,
      'Reinstall the Quant Lab package from a trusted source.',
    );
  }
}

function parsePortableRelativePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\\')
    || value.includes('\0')
    || value.includes(':')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('//')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      `${label} must be a normalized portable relative path.`,
      'Reinstall the Quant Lab package from a trusted source.',
    );
  }
  return value;
}

function containedPath(root: string, relativePath: string): string {
  return path.resolve(root, relativePath);
}

function parseActivePointer(input: unknown): ActivePackagePointer {
  const value = assertPlainObject(input, 'Research worker active pointer');
  assertExactKeys(
    value,
    ['schemaVersion', 'versionDirectory', 'manifestRelativePath'],
    'Research worker active pointer',
  );
  if (value.schemaVersion !== 1) {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      'Research worker active pointer schemaVersion must be 1.',
      'Upgrade StratCraft or reinstall a compatible Quant Lab package.',
    );
  }
  return {
    schemaVersion: 1,
    versionDirectory: parsePortableRelativePath(
      value.versionDirectory,
      'active pointer versionDirectory',
    ),
    manifestRelativePath: parsePortableRelativePath(
      value.manifestRelativePath,
      'active pointer manifestRelativePath',
    ),
  };
}

function parseTrustStore(input: unknown): ResearchWorkerTrustStore {
  const value = assertPlainObject(input, 'Research worker trust store');
  assertExactKeys(value, ['schemaVersion', 'keys'], 'Research worker trust store');
  if (value.schemaVersion !== 1 || !Array.isArray(value.keys)) {
    throw new ResearchWorkerPackageError(
      'WORKER_SIGNATURE_INVALID',
      'Research worker trust store is malformed.',
      'Repair or reinstall StratCraft before using commercial research capabilities.',
    );
  }
  const keys = value.keys.map((entry, index): TrustStoreKey => {
    const key = assertPlainObject(entry, `Research worker trust key ${index}`);
    assertExactKeys(
      key,
      ['publisherId', 'keyId', 'publicKeyPem', 'revoked'],
      `Research worker trust key ${index}`,
    );
    if (
      key.publisherId !== 'com.stratcraft'
      || typeof key.keyId !== 'string'
      || key.keyId.length === 0
      || typeof key.publicKeyPem !== 'string'
      || key.publicKeyPem.length === 0
      || typeof key.revoked !== 'boolean'
    ) {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        `Research worker trust key ${index} is malformed.`,
        'Repair or reinstall StratCraft before using commercial research capabilities.',
      );
    }
    return {
      publisherId: key.publisherId,
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      revoked: key.revoked,
    };
  });
  if (new Set(keys.map(({ keyId }) => keyId)).size !== keys.length) {
    throw new ResearchWorkerPackageError(
      'WORKER_SIGNATURE_INVALID',
      'Research worker trust store contains duplicate key IDs.',
      'Repair or reinstall StratCraft before using commercial research capabilities.',
    );
  }
  return { schemaVersion: 1, keys };
}

function resolvePlatform(
  platform: NodeJS.Platform,
  architecture: string,
): ResearchWorkerPackageManifest['executables'][number]['platform'] {
  const key = `${platform}-${architecture}`;
  const supported = new Set([
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
    'win32-arm64',
  ]);
  if (!supported.has(key)) {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      `The Quant Lab worker does not support platform ${key}.`,
      'Install StratCraft on a supported platform and architecture.',
    );
  }
  return key as ResearchWorkerPackageManifest['executables'][number]['platform'];
}

async function readJsonFile(filePath: string, label: string): Promise<{
  readonly bytes: Buffer;
  readonly value: unknown;
}> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      `${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      'Reinstall the Quant Lab package from a trusted source.',
    );
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new ResearchWorkerPackageError(
      'WORKER_REQUEST_INVALID',
      `${label} is not valid JSON.`,
      'Reinstall the Quant Lab package from a trusted source.',
    );
  }
}

async function assertRealPathContained(root: string, candidate: string): Promise<string> {
  const [realRoot, realCandidate] = await Promise.all([
    fs.realpath(root),
    fs.realpath(candidate),
  ]);
  if (
    realCandidate === realRoot
    || !realCandidate.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new ResearchWorkerPackageError(
      'WORKER_SIGNATURE_INVALID',
      `Worker package path resolves outside its package root: ${candidate}`,
      'Remove the package and reinstall it from a trusted source.',
    );
  }
  return realCandidate;
}

async function inventoryPackageFiles(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ResearchWorkerPackageError(
          'WORKER_SIGNATURE_INVALID',
          `Research worker package contains a symbolic link: ${relativePath}`,
          'Remove the package and reinstall it from a trusted source.',
        );
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        return;
      }
      if (!entry.isFile()) {
        throw new ResearchWorkerPackageError(
          'WORKER_SIGNATURE_INVALID',
          `Research worker package contains a non-regular file: ${relativePath}`,
          'Remove the package and reinstall it from a trusted source.',
        );
      }
      files.add(relativePath);
    }));
  };
  await visit(root, '');
  return files;
}

export class ResearchWorkerPackageVerifier {
  private readonly installationRoot: string;
  private readonly trustStorePath: string;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;

  constructor(options: ResearchWorkerPackageVerifierOptions = {}) {
    const resolvedPaths = resolveResearchWorkerPackagePaths({
      installationRoot: options.installationRoot,
      trustStorePath: options.trustStorePath,
      userDataPath: () => app.getPath('userData'),
      resourcesPath: () => process.resourcesPath,
      applicationPath: () => app.getAppPath(),
      isPackaged: app.isPackaged,
    });
    this.installationRoot = resolvedPaths.installationRoot;
    this.trustStorePath = resolvedPaths.trustStorePath;
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
  }

  async discover(): Promise<ResearchWorkerHostDiscovery> {
    try {
      const verified = await this.verifyActivePackage();
      if (verified === null) return { state: 'absent' };
      return {
        state: 'ready',
        packageVersion: verified.manifest.packageVersion,
        protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
        capabilities: verified.discovery.capabilities,
        packageManifestSha256: verified.manifestSha256,
      };
    } catch (error) {
      const packageError = error instanceof ResearchWorkerPackageError
        ? error
        : new ResearchWorkerPackageError(
          'WORKER_REQUEST_INVALID',
          error instanceof Error ? error.message : String(error),
          'Reinstall the Quant Lab package from a trusted source.',
        );
      return {
        state: 'error',
        code: packageError.code,
        message: packageError.message,
        remediation: packageError.remediation,
      };
    }
  }

  async verifyActivePackage(): Promise<VerifiedResearchWorkerPackage | null> {
    const activePointerPath = path.join(
      this.installationRoot,
      RESEARCH_WORKER_ACTIVE_POINTER_FILE,
    );
    try {
      await fs.access(activePointerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    const activePointer = parseActivePointer(
      (await readJsonFile(activePointerPath, 'Research worker active pointer')).value,
    );
    const packageRoot = containedPath(this.installationRoot, activePointer.versionDirectory);
    const packageRootStat = await fs.lstat(packageRoot);
    if (!packageRootStat.isDirectory() || packageRootStat.isSymbolicLink()) {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        'Research worker active version is not a regular package directory.',
        'Remove the package and reinstall it from a trusted source.',
      );
    }
    await assertRealPathContained(this.installationRoot, packageRoot);
    const manifestPath = containedPath(packageRoot, activePointer.manifestRelativePath);
    await assertRealPathContained(packageRoot, manifestPath);
    const manifestDocument = await readJsonFile(manifestPath, 'Research worker package manifest');
    const manifestResult = researchWorkerPackageManifestSchema.safeParse(manifestDocument.value);
    if (!manifestResult.success) {
      throw new ResearchWorkerPackageError(
        'WORKER_REQUEST_INVALID',
        `Research worker package manifest is invalid: ${manifestResult.error.message}`,
        'Reinstall a Quant Lab package compatible with this StratCraft version.',
      );
    }
    const manifest = manifestResult.data;
    const manifestSha256 = sha256(manifestDocument.bytes);
    const compatibility = negotiateResearchWorkerProtocol(manifest.protocol);
    if (!compatibility.compatible) {
      throw new ResearchWorkerPackageError(
        compatibility.errorCode,
        compatibility.reason,
        'Install a Quant Lab worker version compatible with this StratCraft version.',
      );
    }

    const packageFiles = await inventoryPackageFiles(packageRoot);
    const declaredFiles = new Set([
      activePointer.manifestRelativePath,
      manifest.signature.signatureRelativePath,
      ...manifest.signedFiles.map(({ relativePath }) => relativePath),
    ]);
    const undeclaredFiles = [...packageFiles].filter((file) => !declaredFiles.has(file));
    const missingFiles = [...declaredFiles].filter((file) => !packageFiles.has(file));
    if (undeclaredFiles.length > 0 || missingFiles.length > 0) {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        'Research worker package files do not match the signed manifest inventory.',
        'Remove the package and reinstall it from a trusted source.',
      );
    }

    const trustDocument = await readJsonFile(
      this.trustStorePath,
      'Research worker trust store',
    );
    const trustStore = parseTrustStore(trustDocument.value);
    const trustKey = trustStore.keys.find(
      ({ publisherId, keyId }) =>
        publisherId === manifest.signature.publisherId
        && keyId === manifest.signature.keyId,
    );
    if (trustKey === undefined || trustKey.revoked) {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        trustKey?.revoked
          ? `Research worker signing key '${manifest.signature.keyId}' is revoked.`
          : `Research worker signing key '${manifest.signature.keyId}' is not trusted.`,
        'Remove the package and install a version signed by an active StratCraft key.',
      );
    }

    const signaturePath = containedPath(packageRoot, manifest.signature.signatureRelativePath);
    const signatureBytes = await fs.readFile(signaturePath);
    let publicKey;
    try {
      publicKey = createPublicKey(trustKey.publicKeyPem);
    } catch {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        `Trusted key '${trustKey.keyId}' is not a valid public key.`,
        'Repair or reinstall StratCraft before using commercial research capabilities.',
      );
    }
    if (
      publicKey.asymmetricKeyType !== 'ed25519'
      || !verifySignature(null, manifestDocument.bytes, publicKey, signatureBytes)
    ) {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        'Research worker package manifest signature verification failed.',
        'Remove the package and reinstall it from a trusted source.',
      );
    }

    await Promise.all(manifest.signedFiles.map(async (signedFile) => {
      const filePath = containedPath(packageRoot, signedFile.relativePath);
      const actual = sha256(await fs.readFile(filePath));
      if (actual !== signedFile.sha256) {
        throw new ResearchWorkerPackageError(
          'WORKER_SIGNATURE_INVALID',
          `Research worker signed file hash mismatch: ${signedFile.relativePath}`,
          'Remove the package and reinstall it from a trusted source.',
        );
      }
    }));

    const discoveryPath = containedPath(
      packageRoot,
      manifest.discoveryDescriptorRelativePath,
    );
    const discoveryDocument = await readJsonFile(
      discoveryPath,
      'Research worker discovery descriptor',
    );
    const discoveryResult = researchWorkerDiscoveryDescriptorSchema.safeParse(
      discoveryDocument.value,
    );
    if (!discoveryResult.success) {
      throw new ResearchWorkerPackageError(
        'WORKER_REQUEST_INVALID',
        `Research worker discovery descriptor is invalid: ${discoveryResult.error.message}`,
        'Reinstall a Quant Lab package compatible with this StratCraft version.',
      );
    }
    const discovery = discoveryResult.data;
    if (
      discovery.packageVersion !== manifest.packageVersion
      || discovery.protocol.minimum !== manifest.protocol.minimum
      || discovery.protocol.current !== manifest.protocol.current
    ) {
      throw new ResearchWorkerPackageError(
        'WORKER_SIGNATURE_INVALID',
        'Research worker manifest and discovery descriptor do not identify the same package.',
        'Remove the package and reinstall it from a trusted source.',
      );
    }

    const platform = resolvePlatform(this.platform, this.architecture);
    const executable = manifest.executables.find((entry) => entry.platform === platform);
    if (executable === undefined || executable.relativePath !== discovery.executableRelativePath) {
      throw new ResearchWorkerPackageError(
        'WORKER_REQUEST_INVALID',
        `Research worker package has no matching ${platform} executable.`,
        'Install the Quant Lab package built for this platform.',
      );
    }
    const executablePath = containedPath(packageRoot, executable.relativePath);
    const executableStat = await fs.stat(executablePath);
    if (
      !executableStat.isFile()
      || (this.platform !== 'win32' && (executableStat.mode & 0o111) === 0)
    ) {
      throw new ResearchWorkerPackageError(
        'WORKER_REQUEST_INVALID',
        'Research worker executable is not a regular executable file.',
        'Reinstall the Quant Lab package from a trusted source.',
      );
    }
    const hostModulePath = containedPath(packageRoot, manifest.hostModule.relativePath);
    await assertRealPathContained(packageRoot, hostModulePath);

    // TICKET_1304_16 section 22: resolve the worker's declared runtime layout
    // here, where every other package path is already resolved and contained.
    // Both are exported into the child environment by
    // `buildResearchWorkerLaunch`; resolving them through `containedPath` +
    // `assertRealPathContained` is what stops a manifest from pointing the
    // loader path or the interpreter's module root outside the signed package.
    const libraryPaths: string[] = [];
    for (const relativePath of executable.libraryRelativePaths ?? []) {
      const libraryPath = containedPath(packageRoot, relativePath);
      await assertRealPathContained(packageRoot, libraryPath);
      libraryPaths.push(libraryPath);
    }

    let algorithmRootPath: string | undefined;
    if (manifest.algorithmRootRelativePath !== undefined) {
      algorithmRootPath = containedPath(packageRoot, manifest.algorithmRootRelativePath);
      await assertRealPathContained(packageRoot, algorithmRootPath);
    }

    return {
      packageRoot,
      executablePath,
      hostModulePath,
      libraryPaths,
      ...(algorithmRootPath === undefined ? {} : { algorithmRootPath }),
      manifestSha256,
      manifest,
      discovery,
    };
  }
}

let verifier: ResearchWorkerPackageVerifier | null = null;

export function getResearchWorkerPackageVerifier(): ResearchWorkerPackageVerifier {
  verifier ??= new ResearchWorkerPackageVerifier();
  return verifier;
}
