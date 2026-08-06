import { generateKeyPairSync, sign, createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getResearchWorkerPackageVerifier,
  ResearchWorkerPackageVerifier,
} from '../research-worker-package';

const fsFailure = vi.hoisted(() => ({
  enabled: false,
  reason: undefined as unknown,
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => (
      fsFailure.enabled
        ? Promise.reject(fsFailure.reason)
        : actual.readFile(...args)
    ),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}));

const roots: string[] = [];
const hash = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex');

async function fixture(overrides: {
  protocol?: { minimum: string; current: string };
  keyId?: string;
  revoked?: boolean;
  corruptExecutable?: boolean;
  discoveryVersion?: string;
  malformedDiscovery?: boolean;
  discoveryExecutable?: string;
  platform?: string;
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qnx-worker-package-'));
  roots.push(root);
  const installationRoot = path.join(root, 'install');
  const packageRoot = path.join(installationRoot, 'versions', '1.0.0');
  const trustStorePath = path.join(root, 'trust.json');
  await fs.mkdir(path.join(packageRoot, 'worker', 'bin'), { recursive: true });
  await fs.writeFile(path.join(installationRoot, 'active.json'), JSON.stringify({
    schemaVersion: 1,
    versionDirectory: 'versions/1.0.0',
    manifestRelativePath: 'research-worker-package.json',
  }));
  const executable = Buffer.from('#!/bin/sh\nexit 0\n');
  await fs.writeFile(path.join(packageRoot, 'worker/bin/research-worker'), executable);
  await fs.chmod(path.join(packageRoot, 'worker/bin/research-worker'), 0o755);
  const protocol = overrides.protocol ?? { minimum: '1.0.0', current: '1.0.0' };
  const discovery = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    packageId: 'com.stratcraft.quant-lab',
    workerId: 'stratcraft-research-worker',
    packageVersion: overrides.discoveryVersion ?? '1.0.0',
    protocol,
    controlTransport: 'stdio-jsonl',
    executableRelativePath:
      overrides.discoveryExecutable ?? 'worker/bin/research-worker',
    capabilities: overrides.malformedDiscovery ? [] : [{
      capabilityId: 'research.discovery',
      contractVersion: '1.0.0',
    }],
  }));
  await fs.writeFile(path.join(packageRoot, 'discovery.json'), discovery);
  const hostModule = Buffer.from('exports.registerCommercialHostCapabilities = () => {};');
  await fs.mkdir(path.join(packageRoot, 'host'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'host/register.cjs'), hostModule);
  const keyId = overrides.keyId ?? 'release-1';
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    packageId: 'com.stratcraft.quant-lab',
    packageVersion: '1.0.0',
    discoveryDescriptorRelativePath: 'discovery.json',
    hostModule: {
      relativePath: 'host/register.cjs',
      sha256: hash(hostModule),
      contractVersion: '1.0.0',
      operationContractVersion: '1.0.0',
      registerExport: 'registerCommercialHostCapabilities',
      supportedHostRoles: ['electron', 'service-api'],
    },
    protocol,
    executables: [{
      platform: overrides.platform ?? 'linux-x64',
      relativePath: 'worker/bin/research-worker',
      sha256: hash(executable),
    }],
    signedFiles: [
      { relativePath: 'discovery.json', sha256: hash(discovery) },
      { relativePath: 'worker/bin/research-worker', sha256: hash(executable) },
      { relativePath: 'host/register.cjs', sha256: hash(hostModule) },
    ],
    signature: {
      algorithm: 'Ed25519',
      publisherId: 'com.stratcraft',
      keyId,
      signatureRelativePath: 'manifest.sig',
    },
    lifecycle: {
      atomicInstall: true,
      healthCheckCommand: ['worker/bin/research-worker', '--health'],
      rollbackSupported: true,
      uninstallRemoves: ['worker', 'discovery.json'],
    },
    upgradesFrom: [],
  }));
  await fs.writeFile(path.join(packageRoot, 'research-worker-package.json'), manifest);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await fs.writeFile(path.join(packageRoot, 'manifest.sig'), sign(null, manifest, privateKey));
  await fs.writeFile(trustStorePath, JSON.stringify({
    schemaVersion: 1,
    keys: [{
      publisherId: 'com.stratcraft',
      keyId,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      revoked: overrides.revoked ?? false,
    }],
  }));
  if (overrides.corruptExecutable) {
    await fs.appendFile(path.join(packageRoot, 'worker/bin/research-worker'), 'tampered');
  }
  return { installationRoot, trustStorePath, packageRoot, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe('TICKET_1304_5C signed worker package discovery', () => {
  it('treats an absent active pointer as the valid open-foundation state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qnx-worker-absent-'));
    roots.push(root);
    const verifier = new ResearchWorkerPackageVerifier({
      installationRoot: path.join(root, 'missing'),
      trustStorePath: path.join(root, 'missing-trust.json'),
      platform: 'linux',
      architecture: 'x64',
    });
    await expect(verifier.verifyActivePackage()).resolves.toBeNull();
    await expect(verifier.discover()).resolves.toEqual({ state: 'absent' });
  });

  it('verifies signature, every file hash, protocol, platform, and public discovery', async () => {
    const built = await fixture();
    const verifier = new ResearchWorkerPackageVerifier({
      ...built,
      platform: 'linux',
      architecture: 'x64',
    });
    const verified = await verifier.verifyActivePackage();
    expect(verified).toMatchObject({
      packageRoot: built.packageRoot,
      hostModulePath: path.join(built.packageRoot, 'host/register.cjs'),
      manifestSha256: hash(built.manifest),
      discovery: {
        capabilities: [{
          capabilityId: 'research.discovery',
          contractVersion: '1.0.0',
        }],
      },
    });
    await expect(verifier.discover()).resolves.toMatchObject({
      state: 'ready',
      packageVersion: '1.0.0',
      protocolVersion: '1.0.0',
      packageManifestSha256: hash(built.manifest),
    });
  });

  it.each([
    {
      name: 'revoked key',
      build: { revoked: true },
      code: 'WORKER_SIGNATURE_INVALID',
    },
    {
      name: 'tampered executable',
      build: { corruptExecutable: true },
      code: 'WORKER_SIGNATURE_INVALID',
    },
    {
      name: 'incompatible protocol',
      build: { protocol: { minimum: '2.0.0', current: '2.0.0' } },
      code: 'WORKER_PROTOCOL_INCOMPATIBLE',
    },
    {
      name: 'descriptor identity drift',
      build: { discoveryVersion: '1.0.1' },
      code: 'WORKER_SIGNATURE_INVALID',
    },
    {
      name: 'missing platform executable',
      build: { platform: 'darwin-x64' },
      code: 'WORKER_REQUEST_INVALID',
    },
  ])('reports $name as an actionable discovery error', async ({ build, code }) => {
    const built = await fixture(build);
    const verifier = new ResearchWorkerPackageVerifier({
      ...built,
      platform: 'linux',
      architecture: 'x64',
    });
    await expect(verifier.discover()).resolves.toMatchObject({
      state: 'error',
      code,
      remediation: expect.any(String),
    });
  });

  it('rejects pointer traversal before reading a package file', async () => {
    const built = await fixture();
    await fs.writeFile(
      path.join(built.installationRoot, 'active.json'),
      JSON.stringify({
        schemaVersion: 1,
        versionDirectory: '../escape',
        manifestRelativePath: 'manifest.json',
      }),
    );
    const verifier = new ResearchWorkerPackageVerifier({
      ...built,
      platform: 'linux',
      architecture: 'x64',
    });
    await expect(verifier.discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });
  });

  it.each([
    null,
    {},
    { schemaVersion: 2, versionDirectory: 'versions/1.0.0', manifestRelativePath: 'x' },
    {
      schemaVersion: 1,
      versionDirectory: 'versions/1.0.0',
      manifestRelativePath: 'x',
      unknown: true,
    },
    { schemaVersion: 1, versionDirectory: '', manifestRelativePath: 'x' },
    { schemaVersion: 1, versionDirectory: '/absolute', manifestRelativePath: 'x' },
    { schemaVersion: 1, versionDirectory: 'a\\b', manifestRelativePath: 'x' },
    { schemaVersion: 1, versionDirectory: 'a:b', manifestRelativePath: 'x' },
    { schemaVersion: 1, versionDirectory: 'a//b', manifestRelativePath: 'x' },
    { schemaVersion: 1, versionDirectory: 'a/', manifestRelativePath: 'x' },
    { schemaVersion: 1, versionDirectory: 'a/./b', manifestRelativePath: 'x' },
  ])('rejects malformed active pointer %#', async (pointer) => {
    const built = await fixture();
    await fs.writeFile(
      path.join(built.installationRoot, 'active.json'),
      JSON.stringify(pointer),
    );
    const verifier = new ResearchWorkerPackageVerifier({
      ...built,
      platform: 'linux',
      architecture: 'x64',
    });
    await expect(verifier.discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });
  });

  it('rejects invalid JSON, undeclared files, symlinks, and non-executable workers', async () => {
    const invalidJson = await fixture();
    await fs.writeFile(path.join(invalidJson.installationRoot, 'active.json'), '{');
    await expect(new ResearchWorkerPackageVerifier({
      ...invalidJson,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({ state: 'error' });

    const extra = await fixture();
    await fs.writeFile(path.join(extra.packageRoot, 'undeclared.bin'), 'private');
    await expect(new ResearchWorkerPackageVerifier({
      ...extra,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_SIGNATURE_INVALID',
    });

    const symlink = await fixture();
    await fs.symlink(
      path.join(symlink.packageRoot, 'discovery.json'),
      path.join(symlink.packageRoot, 'link.json'),
    );
    await expect(new ResearchWorkerPackageVerifier({
      ...symlink,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_SIGNATURE_INVALID',
    });

    const nonExecutable = await fixture();
    await fs.chmod(path.join(nonExecutable.packageRoot, 'worker/bin/research-worker'), 0o644);
    await expect(new ResearchWorkerPackageVerifier({
      ...nonExecutable,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });
  });

  it('rejects malformed discovery and descriptor executable drift', async () => {
    for (const build of [
      { malformedDiscovery: true },
      { discoveryExecutable: 'worker/bin/other' },
    ]) {
      const built = await fixture(build);
      await expect(new ResearchWorkerPackageVerifier({
        ...built,
        platform: 'linux',
        architecture: 'x64',
      }).discover()).resolves.toMatchObject({
        state: 'error',
        code: 'WORKER_REQUEST_INVALID',
      });
    }
  });

  it('rejects unknown, duplicate, malformed, invalid, and non-Ed25519 trust keys', async () => {
    const cases: Array<(built: Awaited<ReturnType<typeof fixture>>) => Promise<void>> = [
      async ({ trustStorePath }) => {
        await fs.writeFile(trustStorePath, JSON.stringify({ schemaVersion: 1, keys: [] }));
      },
      async ({ trustStorePath }) => {
        const trust = JSON.parse(await fs.readFile(trustStorePath, 'utf8'));
        trust.keys.push(trust.keys[0]);
        await fs.writeFile(trustStorePath, JSON.stringify(trust));
      },
      async ({ trustStorePath }) => {
        await fs.writeFile(trustStorePath, JSON.stringify({ schemaVersion: 2, keys: [] }));
      },
      async ({ trustStorePath }) => {
        await fs.writeFile(trustStorePath, JSON.stringify({
          schemaVersion: 1,
          keys: [{ publisherId: 'wrong', keyId: '', publicKeyPem: '', revoked: 'no' }],
        }));
      },
      async ({ trustStorePath }) => {
        const trust = JSON.parse(await fs.readFile(trustStorePath, 'utf8'));
        trust.keys[0].publicKeyPem = 'not-a-key';
        await fs.writeFile(trustStorePath, JSON.stringify(trust));
      },
      async ({ trustStorePath }) => {
        const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const trust = JSON.parse(await fs.readFile(trustStorePath, 'utf8'));
        trust.keys[0].publicKeyPem =
          publicKey.export({ type: 'spki', format: 'pem' }).toString();
        await fs.writeFile(trustStorePath, JSON.stringify(trust));
      },
    ];
    for (const mutate of cases) {
      const built = await fixture();
      await mutate(built);
      await expect(new ResearchWorkerPackageVerifier({
        ...built,
        platform: 'linux',
        architecture: 'x64',
      }).discover()).resolves.toMatchObject({
        state: 'error',
        code: 'WORKER_SIGNATURE_INVALID',
      });
    }
  });

  it('rejects an invalid detached signature and unsupported host architecture', async () => {
    const signature = await fixture();
    await fs.writeFile(path.join(signature.packageRoot, 'manifest.sig'), Buffer.alloc(64));
    await expect(new ResearchWorkerPackageVerifier({
      ...signature,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_SIGNATURE_INVALID',
    });

    const architecture = await fixture();
    await expect(new ResearchWorkerPackageVerifier({
      ...architecture,
      platform: 'linux',
      architecture: 's390x',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });
  });

  it('rejects missing trust state, invalid manifests, non-directory versions, and symlink escapes', async () => {
    const missingTrust = await fixture();
    await fs.rm(missingTrust.trustStorePath);
    await expect(new ResearchWorkerPackageVerifier({
      ...missingTrust,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });

    const invalidManifest = await fixture();
    await fs.writeFile(
      path.join(invalidManifest.packageRoot, 'research-worker-package.json'),
      '{}',
    );
    await expect(new ResearchWorkerPackageVerifier({
      ...invalidManifest,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });

    const nonDirectory = await fixture();
    await fs.rm(nonDirectory.packageRoot, { recursive: true });
    await fs.writeFile(nonDirectory.packageRoot, 'file');
    await expect(new ResearchWorkerPackageVerifier({
      ...nonDirectory,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_SIGNATURE_INVALID',
    });

    const escaped = await fixture();
    const outside = path.join(path.dirname(escaped.installationRoot), 'outside', '1.0.0');
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.rename(escaped.packageRoot, outside);
    await fs.rm(path.join(escaped.installationRoot, 'versions'), { recursive: true });
    await fs.symlink(path.dirname(outside), path.join(escaped.installationRoot, 'versions'));
    await expect(new ResearchWorkerPackageVerifier({
      ...escaped,
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_SIGNATURE_INVALID',
    });
  });

  it('rejects non-regular package inventory entries', async () => {
    const built = await fixture();
    const socketPath = path.join(built.packageRoot, 'unexpected.sock');
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      await expect(new ResearchWorkerPackageVerifier({
        ...built,
        platform: 'linux',
        architecture: 'x64',
      }).discover()).resolves.toMatchObject({
        state: 'error',
        code: 'WORKER_SIGNATURE_INVALID',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('normalizes unexpected discovery failures and constructs the production singleton once', async () => {
    const built = await fixture();
    const verifier = new ResearchWorkerPackageVerifier({
      ...built,
      platform: 'linux',
      architecture: 'x64',
    });
    verifier.verifyActivePackage = vi.fn(async () => {
      throw 'unexpected';
    });
    await expect(verifier.discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
      message: 'unexpected',
    });
    Object.defineProperty(process, 'resourcesPath', {
      value: '/tmp',
      configurable: true,
    });
    expect(getResearchWorkerPackageVerifier()).toBe(getResearchWorkerPackageVerifier());
  });

  it('normalizes non-Error package file read failures', async () => {
    const built = await fixture();
    fsFailure.enabled = true;
    fsFailure.reason = 'read failed';
    try {
      await expect(new ResearchWorkerPackageVerifier({
        ...built,
        platform: 'linux',
        architecture: 'x64',
      }).discover()).resolves.toMatchObject({
        state: 'error',
        code: 'WORKER_REQUEST_INVALID',
        message: expect.stringContaining('read failed'),
      });
    } finally {
      fsFailure.enabled = false;
      fsFailure.reason = undefined;
    }
  });

  it('propagates a non-ENOENT active-pointer access failure into discovery error handling', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qnx-worker-access-'));
    roots.push(root);
    const installationRoot = path.join(root, 'install');
    await fs.mkdir(installationRoot);
    await fs.symlink('active.json', path.join(installationRoot, 'active.json'));
    await expect(new ResearchWorkerPackageVerifier({
      installationRoot,
      trustStorePath: path.join(root, 'trust.json'),
      platform: 'linux',
      architecture: 'x64',
    }).discover()).resolves.toMatchObject({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });
  });
});
