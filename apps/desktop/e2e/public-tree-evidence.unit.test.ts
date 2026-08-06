import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createP8Evidence, finishP8Evidence } from './p8-evidence';
import { createP9Evidence, finishP9Evidence } from './p9-evidence';
import {
  commandOutput,
  finishEvidence,
  loadPublicTreeIdentity,
  processTreeForPlatform,
  readOptional,
  sha256File,
  validationFailureDetail,
  type BaseWorkflowEvidence,
  type EvidenceState,
  type PublicTreeIdentity,
} from './public-tree-evidence';

const ENVIRONMENT_KEYS = [
  'STRATCRAFT_PUBLIC_MANIFEST_PATH',
  'STRATCRAFT_PUBLIC_RELEASE_EVIDENCE_PATH',
  'STRATCRAFT_PUBLIC_MANIFEST_SHA256',
  'STRATCRAFT_SOURCE_REVISION',
  'STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH',
] as const;

const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const original = originalEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

function identity(digest = 'a'.repeat(64), revision = 'b'.repeat(40)): PublicTreeIdentity {
  return {
    schemaVersion: 1,
    sourceRevision: revision,
    publicManifest: {
      path: 'generated-public-candidate/public-tree-manifest.json',
      sha256: digest,
    },
    publicReleaseEvidence: {
      path: 'generated-public-candidate/public-release-evidence.json',
      status: 'passed',
    },
    dependencyClosureEvidence: { status: 'passed', checkedEntries: 7 },
  };
}

function environment(): NodeJS.ProcessEnv {
  return {
    STRATCRAFT_PUBLIC_MANIFEST_PATH: '/candidate/manifest.json',
    STRATCRAFT_PUBLIC_RELEASE_EVIDENCE_PATH: '/candidate/release.json',
    STRATCRAFT_PUBLIC_MANIFEST_SHA256: 'a'.repeat(64),
    STRATCRAFT_SOURCE_REVISION: 'b'.repeat(40),
  };
}

function realSidecars() {
  const root = mkdtempSync(join(tmpdir(), 'public-tree-evidence-'));
  const files = [{
    path: 'README.md',
    mode: 0o644,
    size: 7,
    sha256: createHash('sha256').update('public\n').digest('hex'),
  }];
  const digest = createHash('sha256').update(`${JSON.stringify(files)}\n`).digest('hex');
  const manifestPath = join(root, 'public-tree-manifest.json');
  const releasePath = join(root, 'public-release-evidence.json');
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, files, manifestSha256: digest }));
  writeFileSync(releasePath, JSON.stringify({
    schemaVersion: 1,
    status: 'passed',
    sourceRevision: 'b'.repeat(40),
    gates: {
      manifest: { status: 'passed', checkedInputs: 1, publicCandidates: 1 },
      dependencyClosure: { status: 'passed', checkedEntries: 7 },
      privateImports: { status: 'passed', checkedFiles: 1 },
      leakage: { status: 'passed', checkedFiles: 1 },
      candidateBuildEntries: { status: 'passed', checkedEntries: 0 },
    },
  }));
  return { root, manifestPath, releasePath, digest };
}

function installRealEnvironment(sidecars: ReturnType<typeof realSidecars>): void {
  process.env.STRATCRAFT_PUBLIC_MANIFEST_PATH = sidecars.manifestPath;
  process.env.STRATCRAFT_PUBLIC_RELEASE_EVIDENCE_PATH = sidecars.releasePath;
  process.env.STRATCRAFT_PUBLIC_MANIFEST_SHA256 = sidecars.digest;
  process.env.STRATCRAFT_SOURCE_REVISION = 'b'.repeat(40);
}

describe('generated-public evidence identity', () => {
  it('passes every required input to the authoritative validator', () => {
    const calls: string[][] = [];
    const result = loadPublicTreeIdentity(environment(), (args) => {
      calls.push(args);
      return JSON.stringify(identity());
    });
    expect(result).toEqual(identity());
    expect(calls).toEqual([[
      '/candidate/manifest.json',
      '/candidate/release.json',
      'a'.repeat(64),
      'b'.repeat(40),
    ]]);
  });

  it('rejects every missing environment input', () => {
    for (const key of ENVIRONMENT_KEYS.slice(0, 4)) {
      const candidate = environment();
      delete candidate[key];
      expect(() => loadPublicTreeIdentity(candidate, () => '')).toThrow(`${key} is required`);
    }
  });

  it('rejects validator failures, invalid JSON, malformed identities, and identity drift', () => {
    expect(() => loadPublicTreeIdentity(environment(), () => {
      throw new Error('validator failed');
    })).toThrow('validator failed');
    expect(() => loadPublicTreeIdentity(environment(), () => '{')).toThrow('invalid JSON');
    const malformedIdentities: unknown[] = [
      {},
      { ...identity(), schemaVersion: 2 },
      { ...identity(), publicReleaseEvidence: { ...identity().publicReleaseEvidence, status: 'failed' } },
      { ...identity(), dependencyClosureEvidence: { status: 'failed', checkedEntries: 7 } },
      { ...identity(), dependencyClosureEvidence: { status: 'passed', checkedEntries: 'seven' } },
      { ...identity(), dependencyClosureEvidence: { status: 'passed', checkedEntries: -1 } },
      { ...identity(), publicManifest: { path: 1, sha256: 'a'.repeat(64) } },
      { ...identity(), publicManifest: { path: 'manifest.json', sha256: 1 } },
      { ...identity(), publicReleaseEvidence: { path: 1, status: 'passed' } },
      { ...identity(), sourceRevision: 1 },
    ];
    for (const malformed of malformedIdentities) {
      expect(() => loadPublicTreeIdentity(
        environment(),
        () => JSON.stringify(malformed),
      )).toThrow('malformed identity');
    }
    expect(() => loadPublicTreeIdentity(
      environment(),
      () => JSON.stringify(identity('c'.repeat(64))),
    )).toThrow('digest does not match');
    expect(() => loadPublicTreeIdentity(
      environment(),
      () => JSON.stringify(identity('a'.repeat(64), 'c'.repeat(40))),
    )).toThrow('revision does not match');
  });

  it('uses the public validator and gives P8 and P9 the same identity', () => {
    const sidecars = realSidecars();
    installRealEnvironment(sidecars);
    const p8 = createP8Evidence('AC-6');
    const p9 = createP9Evidence();
    expect(p8.evidence.publicManifest).toEqual(p9.evidence.publicManifest);
    expect(p8.evidence.dependencyClosureEvidence).toEqual(
      p9.evidence.dependencyClosureEvidence,
    );
    expect(p8.evidence.revision).toBe('b'.repeat(40));

    process.env.STRATCRAFT_PUBLIC_MANIFEST_SHA256 = 'c'.repeat(64);
    expect(() => createP8Evidence('AC-7')).toThrow(
      'Generated-public evidence validation failed',
    );
  });
});

describe('generated-public evidence diagnostics and finalization', () => {
  it('records successful and failed terminal evidence in the requested locations', () => {
    const sidecars = realSidecars();
    installRealEnvironment(sidecars);
    const p8 = createP8Evidence('AC-6');
    const p8Path = join(sidecars.root, 'explicit', 'ac-6.json');
    expect(finishP8Evidence(p8, p8Path)).toBe(p8Path);
    expect(JSON.parse(readFileSync(p8Path, 'utf8')).status).toBe('passed');

    const p9 = createP9Evidence();
    p9.evidence.errors.push({ stage: 'worker', message: 'failed' });
    const p9Path = join(sidecars.root, 'environment', 'ac-8.json');
    process.env.STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH = p9Path;
    expect(finishP9Evidence(p9)).toBe(p9Path);
    expect(JSON.parse(readFileSync(p9Path, 'utf8')).status).toBe('failed');

    delete process.env.STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH;
    const basePath = join(sidecars.root, 'default', 'base.json');
    const base = p8 as EvidenceState<BaseWorkflowEvidence>;
    expect(finishEvidence(base, basePath)).toBe(basePath);
  });

  it('hashes files and keeps optional diagnostic command failures observable', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-tree-diagnostics-'));
    const file = join(root, 'value.txt');
    writeFileSync(file, 'value');
    expect(sha256File(file)).toBe(createHash('sha256').update('value').digest('hex'));
    expect(readOptional(file)).toBe('value');
    expect(readOptional(join(root, 'missing'))).toBeUndefined();
    expect(commandOutput(process.execPath, ['-e', "process.stdout.write('ok')"])).toBe('ok');
    expect(commandOutput(process.execPath, ['-e', "process.stderr.write('bad');process.exit(3)"]))
      .toContain('diagnostic command failed with exit 3');
    expect(commandOutput('definitely-not-a-real-command', [])).toContain(
      'diagnostic command failed with exit unknown',
    );
    expect(validationFailureDetail({ stderr: 'stderr detail', message: 'message detail' }))
      .toBe('stderr detail');
    expect(validationFailureDetail({ message: 'message detail' })).toBe('message detail');
    expect(validationFailureDetail('string detail')).toBe('string detail');

    const calls: Array<[string, string[]]> = [];
    const runner = (command: string, args: string[]) => {
      calls.push([command, args]);
      return command;
    };
    expect(processTreeForPlatform('win32', runner)).toBe('wmic');
    expect(processTreeForPlatform('linux', runner)).toBe('ps');
    expect(calls).toHaveLength(2);
  });
});
