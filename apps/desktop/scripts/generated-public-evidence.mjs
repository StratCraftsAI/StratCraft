#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const REQUIRED_STAGE_GATES = [
  'manifest',
  'dependencyClosure',
  'privateImports',
  'leakage',
  'candidateBuildEntries',
];
const PUBLIC_MANIFEST_LOGICAL_PATH = 'generated-public-candidate/public-tree-manifest.json';
const RELEASE_EVIDENCE_LOGICAL_PATH = 'generated-public-candidate/public-release-evidence.json';

function sha256File(path) {
  const hash = createHash('sha256');
  return pipeline(createReadStream(path), hash).then(() => hash.digest('hex'));
}

function walk(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    if (current === root && name === '.git') continue;
    const absolute = resolve(current, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) files.push(...walk(root, absolute));
    else if (stat.isFile()) files.push(absolute);
    else if (stat.isSymbolicLink()) {
      throw new Error(`Generated public tree contains unsupported symbolic link: ${relative(root, absolute)}`);
    }
  }
  return files;
}

export async function treeManifest(root) {
  const files = [];
  for (const absolute of walk(root)) {
    const stat = lstatSync(absolute);
    files.push({
      path: relative(root, absolute).replaceAll('\\', '/'),
      mode: stat.mode & 0o777,
      size: stat.size,
      sha256: await sha256File(absolute),
    });
  }
  const canonical = `${JSON.stringify(files)}\n`;
  return {
    schemaVersion: 1,
    files,
    manifestSha256: createHash('sha256').update(canonical).digest('hex'),
  };
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return resolve(value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${path}: ${error.message}`);
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateManifestDocument(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error('Generated public manifest schemaVersion must equal 1');
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('Generated public manifest files must be an array');
  }
  for (const [index, file] of manifest.files.entries()) {
    if (
      typeof file?.path !== 'string'
      || file.path.length === 0
      || !isNonNegativeInteger(file.mode)
      || !isNonNegativeInteger(file.size)
      || !SHA256_PATTERN.test(file.sha256 ?? '')
    ) {
      throw new Error(`Generated public manifest files[${index}] is malformed`);
    }
  }
  const canonical = `${JSON.stringify(manifest.files)}\n`;
  const computed = createHash('sha256').update(canonical).digest('hex');
  if (manifest.manifestSha256 !== computed) {
    throw new Error('Immutable manifest hash does not match its file inventory');
  }
  return computed;
}

function validateStageEvidenceDocument(evidence, expectedRevision) {
  if (evidence?.schemaVersion !== 1) {
    throw new Error('Public release evidence schemaVersion must equal 1');
  }
  if (evidence.status !== 'passed') {
    throw new Error(`Public release evidence status must be passed, got ${evidence.status ?? 'missing'}`);
  }
  if (!GIT_REVISION_PATTERN.test(expectedRevision ?? '')) {
    throw new Error('Expected source revision must be a lowercase 40-character Git SHA');
  }
  if (evidence.sourceRevision !== expectedRevision) {
    throw new Error(
      `Public release evidence source revision ${evidence.sourceRevision ?? 'missing'} `
      + `does not match expected ${expectedRevision}`,
    );
  }
  for (const gateName of REQUIRED_STAGE_GATES) {
    const gate = evidence.gates?.[gateName];
    if (gate?.status !== 'passed') {
      throw new Error(
        `Public release evidence gate ${gateName} must be passed, got ${gate?.status ?? 'missing'}`,
      );
    }
  }
  const dependencyClosure = evidence.gates.dependencyClosure;
  if (!isNonNegativeInteger(dependencyClosure.checkedEntries)) {
    throw new Error('Dependency-closure evidence checkedEntries must be a non-negative integer');
  }
  return dependencyClosure;
}

export function validateAcceptanceEvidence(
  manifestPath,
  releaseEvidencePath,
  expectedDigest,
  expectedRevision,
) {
  if (!SHA256_PATTERN.test(expectedDigest ?? '')) {
    throw new Error('Expected public manifest digest must be a lowercase SHA-256 value');
  }
  const manifest = readJson(manifestPath, 'Generated public manifest');
  const computedDigest = validateManifestDocument(manifest);
  if (computedDigest !== expectedDigest) {
    throw new Error(
      `Generated public manifest digest ${computedDigest} does not match expected ${expectedDigest}`,
    );
  }
  const releaseEvidence = readJson(releaseEvidencePath, 'Public release evidence');
  const dependencyClosure = validateStageEvidenceDocument(
    releaseEvidence,
    expectedRevision,
  );
  return {
    schemaVersion: 1,
    sourceRevision: expectedRevision,
    publicManifest: {
      path: PUBLIC_MANIFEST_LOGICAL_PATH,
      sha256: computedDigest,
    },
    publicReleaseEvidence: {
      path: RELEASE_EVIDENCE_LOGICAL_PATH,
      status: 'passed',
    },
    dependencyClosureEvidence: {
      status: 'passed',
      checkedEntries: dependencyClosure.checkedEntries,
    },
  };
}

export async function createManifest(root, output) {
  const manifest = await treeManifest(root);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${manifest.manifestSha256}\n`);
}

export async function verifyManifest(root, input, platform = process.platform) {
  const expected = readJson(input, 'Generated public manifest');
  const actual = await treeManifest(root);
  validateManifestDocument(expected);
  const comparableActual = platform === 'win32'
    ? actual.files.map(({ mode: _mode, ...file }) => file)
    : actual.files;
  const comparableExpected = platform === 'win32'
    ? expected.files.map(({ mode: _mode, ...file }) => file)
    : expected.files;
  if (JSON.stringify(comparableActual) !== JSON.stringify(comparableExpected)) {
    throw new Error(
      `Generated public tree does not match immutable manifest ${expected.manifestSha256}`,
    );
  }
  for (const file of expected.files) {
    if ((file.mode & 0o111) !== 0) chmodSync(resolve(root, file.path), file.mode);
  }
  process.stdout.write(`${actual.manifestSha256}\n`);
}

export async function resultManifest(root, output, platform = process.platform) {
  const evidenceDir = required(process.env.STRATCRAFT_EVIDENCE_DIR, 'STRATCRAFT_EVIDENCE_DIR');
  const publicManifestSha256 = process.env.STRATCRAFT_PUBLIC_MANIFEST_SHA256;
  if (!publicManifestSha256) throw new Error('Public manifest hash is missing');
  const sourceRevision = process.env.STRATCRAFT_SOURCE_REVISION;
  if (!sourceRevision) throw new Error('Source revision is missing');
  const packages = [];
  for (const absolute of walk(resolve(root, 'apps/desktop/release'))) {
    if (!/\.(?:AppImage|deb|dmg|exe|zip)$/.test(absolute)) continue;
    packages.push({
      path: relative(root, absolute).replaceAll('\\', '/'),
      sha256: await sha256File(absolute),
      size: lstatSync(absolute).size,
    });
  }
  const packagePaths = packages.map((entry) => entry.path);
  const requiredExtensions = platform === 'win32'
    ? ['.exe', '.exe']
    : platform === 'darwin'
      ? ['.dmg', '.zip']
      : ['.AppImage', '.deb', '.zip'];
  const remainingPaths = [...packagePaths];
  for (const extension of requiredExtensions) {
    const index = remainingPaths.findIndex((candidate) => candidate.endsWith(extension));
    if (index < 0) throw new Error(`Required ${extension} package is missing`);
    remainingPaths.splice(index, 1);
  }
  const runtimePath = resolve(evidenceDir, 'runtime-smoke.json');
  if (!existsSync(runtimePath)) throw new Error('Packaged runtime smoke evidence is missing');
  const acceptancePath = required(
    process.env.STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH,
    'STRATCRAFT_ACCEPTANCE_EVIDENCE_PATH',
  );
  const acceptanceEvidence = readJson(acceptancePath, 'AC-6 acceptance evidence');
  if (acceptanceEvidence.status !== 'passed' || acceptanceEvidence.errors?.length !== 0) {
    throw new Error('AC-6 acceptance evidence must have passed with an empty error list');
  }
  if (acceptanceEvidence.publicManifest?.sha256 !== publicManifestSha256) {
    throw new Error('AC-6 acceptance evidence public manifest digest does not match the platform result');
  }
  if (acceptanceEvidence.revision !== sourceRevision) {
    throw new Error('AC-6 acceptance evidence source revision does not match the platform result');
  }
  const result = {
    schemaVersion: 1,
    status: 'passed',
    publicManifestSha256,
    sourceRevision,
    platform,
    arch: process.arch,
    node: process.version,
    packages,
    runtimeEvidence: {
      path: relative(root, runtimePath).replaceAll('\\', '/'),
      sha256: await sha256File(runtimePath),
    },
    acceptanceEvidence: {
      path: relative(root, acceptancePath).replaceAll('\\', '/'),
      sha256: await sha256File(acceptancePath),
    },
  };
  if (packages.length === 0) throw new Error('No release packages were found');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

export async function main(argv) {
  const [command, rootValue, fileValue, expectedDigest, expectedRevision] = argv;
  if (command === 'acceptance') {
    const manifestPath = required(rootValue, 'manifest path');
    const releaseEvidencePath = required(fileValue, 'release evidence path');
    const identity = validateAcceptanceEvidence(
      manifestPath,
      releaseEvidencePath,
      expectedDigest,
      expectedRevision,
    );
    process.stdout.write(`${JSON.stringify(identity)}\n`);
    return;
  }
  const root = required(rootValue, 'tree root');
  const file = required(fileValue, 'manifest path');
  if (command === 'create') await createManifest(root, file);
  else if (command === 'verify') await verifyManifest(root, file);
  else if (command === 'result') await resultManifest(root, file);
  else throw new Error('Expected create, verify, result, or acceptance command');
}

/* node:coverage ignore next 7 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
