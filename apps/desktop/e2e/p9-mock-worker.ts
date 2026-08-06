/**
 * Builds signed mock research-worker packages for E2E lifecycle testing.
 *
 * Each package contains a real shell script that speaks the stdio-jsonl
 * protocol: responds to --health, performs host-hello/worker-hello negotiation,
 * accepts execute requests, and emits progress -> artifact -> result.
 */

import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

function workerScript(): string {
  return `#!/bin/bash
set -euo pipefail

if [ "\${1:-}" = "--health" ]; then
  echo '{"status":"ok","workerId":"stratcraft-research-worker"}'
  exit 0
fi

# stdio-jsonl protocol speaker
read -r HOST_HELLO

MANIFEST_SHA="\${STRATCRAFT_RESEARCH_PACKAGE_MANIFEST_SHA256:-}"
DECISION_ID="\${STRATCRAFT_RESEARCH_DECISION_ID:-}"

# Send worker-hello
echo '{"type":"worker-hello","protocolVersion":"1.0.0","workerId":"stratcraft-research-worker","capabilities":[{"capabilityId":"research.discovery","contractVersion":"1.0.0"}],"packageManifestSha256":"'"$MANIFEST_SHA"'"}'

# Read execute request
read -r EXECUTE_MSG

REQUEST_ID=$(echo "$EXECUTE_MSG" | grep -o '"requestId":"[^"]*"' | head -1 | cut -d'"' -f4)

# Send accepted
echo '{"type":"accepted","requestId":"'"$REQUEST_ID"'","sequenceNumber":1}'

# Send progress
echo '{"type":"progress","requestId":"'"$REQUEST_ID"'","sequenceNumber":2,"phase":"kernel-execution","completedUnits":50,"totalUnits":100}'

echo '{"type":"progress","requestId":"'"$REQUEST_ID"'","sequenceNumber":3,"phase":"kernel-execution","completedUnits":100,"totalUnits":100}'

# Send result (no artifacts for mock)
echo '{"type":"result","requestId":"'"$REQUEST_ID"'","sequenceNumber":4,"publishedArtifacts":[]}'
`;
}

export interface MockTrustStore {
  schemaVersion: 1;
  keys: Array<{
    publisherId: string;
    keyId: string;
    publicKeyPem: string;
    revoked: boolean;
  }>;
}

export interface MockWorkerFixture {
  trustStorePath: string;
  privateKey: KeyObject;
  trustStore: MockTrustStore;
}

export function createMockTrustStore(fixtureRoot: string): MockWorkerFixture {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const trustStore: MockTrustStore = {
    schemaVersion: 1,
    keys: [{
      publisherId: 'com.stratcraft',
      keyId: 'e2e-ephemeral',
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      revoked: false,
    }],
  };
  mkdirSync(fixtureRoot, { recursive: true });
  const trustStorePath = join(fixtureRoot, 'research-worker-trust.json');
  writeFileSync(trustStorePath, JSON.stringify(trustStore));
  return { trustStorePath, privateKey, trustStore };
}

export function buildMockWorkerPackage(
  outputRoot: string,
  version: string,
  fixture: MockWorkerFixture,
  options: { upgradesFrom?: string[] } = {},
): string {
  const packageRoot = join(outputRoot, `worker-${version}`);
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });

  const executable = Buffer.from(workerScript());
  const executablePath = join(packageRoot, 'bin/stratcraft-research-worker');
  writeFileSync(executablePath, executable);
  chmodSync(executablePath, 0o755);

  const discovery = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    packageId: 'com.stratcraft.quant-lab',
    workerId: 'stratcraft-research-worker',
    packageVersion: version,
    protocol: { minimum: '1.0.0', current: '1.0.0' },
    controlTransport: 'stdio-jsonl',
    executableRelativePath: 'bin/stratcraft-research-worker',
    capabilities: [{
      capabilityId: 'research.discovery',
      contractVersion: '1.0.0',
    }],
  })}\n`);
  writeFileSync(join(packageRoot, 'research-worker-discovery.json'), discovery);
  const hostModule = Buffer.from('exports.registerCommercialHostCapabilities = () => {};');
  mkdirSync(join(packageRoot, 'host'), { recursive: true });
  writeFileSync(join(packageRoot, 'host/register.cjs'), hostModule);

  const platform = process.platform === 'win32' ? 'win32-x64'
    : process.platform === 'darwin'
      ? `darwin-${process.arch}` as const
      : `linux-${process.arch}` as const;

  const manifest = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    packageId: 'com.stratcraft.quant-lab',
    packageVersion: version,
    discoveryDescriptorRelativePath: 'research-worker-discovery.json',
    hostModule: {
      relativePath: 'host/register.cjs',
      sha256: sha256(hostModule),
      contractVersion: '1.0.0',
      operationContractVersion: '1.0.0',
      registerExport: 'registerCommercialHostCapabilities',
      supportedHostRoles: ['electron', 'service-api'],
    },
    protocol: { minimum: '1.0.0', current: '1.0.0' },
    executables: [{
      platform,
      relativePath: 'bin/stratcraft-research-worker',
      sha256: sha256(executable),
    }],
    signedFiles: [
      {
        relativePath: 'bin/stratcraft-research-worker',
        sha256: sha256(executable),
      },
      {
        relativePath: 'research-worker-discovery.json',
        sha256: sha256(discovery),
      },
      {
        relativePath: 'host/register.cjs',
        sha256: sha256(hostModule),
      },
    ],
    signature: {
      algorithm: 'Ed25519',
      publisherId: 'com.stratcraft',
      keyId: 'e2e-ephemeral',
      signatureRelativePath: 'research-worker-package.sig',
    },
    lifecycle: {
      atomicInstall: true,
      healthCheckCommand: ['bin/stratcraft-research-worker', '--health'],
      rollbackSupported: true,
      uninstallRemoves: [
        'bin/stratcraft-research-worker',
        'research-worker-discovery.json',
        'host/register.cjs',
        'research-worker-package.sig',
        'research-worker-package.json',
      ],
    },
    upgradesFrom: options.upgradesFrom ?? [],
  })}\n`);
  writeFileSync(join(packageRoot, 'research-worker-package.json'), manifest);

  writeFileSync(
    join(packageRoot, 'research-worker-package.sig'),
    sign(null, manifest, fixture.privateKey),
  );

  return packageRoot;
}
