import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  REQUIRED_NATIVE_PLATFORMS,
  nativePlatformMatrix,
} from '../native-platform-matrix.mjs';
import {
  REPO_ROOT,
  runAudit,
  validatePublicRepositoryThreePlatformCi,
} from '../public-repository-three-platform-ci.mjs';

const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'public-ci.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

function errors(candidate = workflow, platforms = REQUIRED_NATIVE_PLATFORMS) {
  return validatePublicRepositoryThreePlatformCi(candidate, platforms).join('\n');
}

test('accepts the complete public native three-platform CI contract', () => {
  assert.equal(errors(), '');
  assert.deepEqual(nativePlatformMatrix(), { include: REQUIRED_NATIVE_PLATFORMS });
  assert.deepEqual(
    REQUIRED_NATIVE_PLATFORMS.map(({ platform, runner, target, triplet }) => ({
      platform,
      runner,
      target,
      triplet,
    })),
    [
      { platform: 'Linux', runner: 'ubuntu-latest', target: 'linux', triplet: 'x64-linux' },
      { platform: 'Windows', runner: 'windows-2022', target: 'win', triplet: 'x64-windows' },
      { platform: 'macOS', runner: 'macos-15', target: 'mac', triplet: 'arm64-osx' },
    ],
  );
  assert.ok(Object.isFrozen(REQUIRED_NATIVE_PLATFORMS));
  assert.ok(REQUIRED_NATIVE_PLATFORMS.every(Object.isFrozen));
  assert.doesNotThrow(() => runAudit(REPO_ROOT));
});

test('matrix command emits the authoritative GitHub Actions include document', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'ci', 'native-platform-matrix.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), nativePlatformMatrix());
});

test('rejects missing push pull request and manual triggers', () => {
  const candidate = workflow
    .replace('  push:\n    branches: [main]\n', '')
    .replace('  pull_request:\n    branches: [main]\n', '')
    .replace('  workflow_dispatch:\n', '');
  const result = errors(candidate);
  assert.match(result, /pushes to main/);
  assert.match(result, /pull requests targeting main/);
  assert.match(result, /manual workflow dispatch/);
});

test('rejects a copied or bypassed native platform matrix', () => {
  const noOwner = workflow.replace('node scripts/ci/native-platform-matrix.mjs', 'echo copied-matrix');
  assert.match(errors(noOwner), /authoritative native platform matrix/);

  const noExpansion = workflow
    .replace('    needs: native-matrix\n', '')
    .replace('${{ fromJSON(needs.native-matrix.outputs.matrix) }}', '{ include: [] }');
  assert.match(errors(noExpansion), /expand the authoritative matrix output/);

  const wrongRows = REQUIRED_NATIVE_PLATFORMS.slice(0, 2);
  assert.match(errors(workflow, wrongRows), /exactly the authoritative/);
});

test('rejects matrix execution drift and cancellation masking', () => {
  const candidate = workflow
    .replace('    runs-on: ${{ matrix.runner }}\n', '    runs-on: ubuntu-latest\n')
    .replace('      fail-fast: false\n', '      fail-fast: true\n');
  const result = errors(candidate);
  assert.match(result, /matrix runner/);
  assert.match(result, /fail-fast disabled/);
});

test('rejects checkout overrides and recipes outside start.sh', () => {
  const candidate = workflow
    .replace('      - uses: actions/checkout@v5\n\n      - uses: actions/setup-node@v5', [
      '      - uses: actions/checkout@v5',
      '        with:',
      '          repository: ${{ github.repository }}',
      '',
      '      - uses: actions/setup-node@v5',
    ].join('\n'))
    .replace('bash ./start.sh build 2>&1', 'cmake --build packages/executor/build 2>&1')
    .replace('bash ./start.sh verify-ci 2>&1', 'pnpm test 2>&1');
  const result = errors(candidate);
  assert.match(result, /triggering public revision/);
  assert.match(result, /delegate to start\.sh/);
  assert.match(result, /second build or test recipe/);
});

test('rejects every missing native toolchain adapter', () => {
  for (const platform of ['Linux', 'macOS', 'Windows']) {
    const candidate = workflow.replace(`Install native build tools (${platform})`, 'Removed toolchain');
    assert.match(errors(candidate), new RegExp(`missing ${platform} toolchain setup`));
  }
});

test('rejects vcpkg triplet drift and missing exact-SHA evidence', () => {
  const candidate = workflow
    .replaceAll('VCPKG_DEFAULT_TRIPLET: ${{ matrix.triplet }}', 'VCPKG_DEFAULT_TRIPLET: x64-linux')
    .replace('uses: lukka/run-vcpkg@v11', 'uses: example/setup@v1')
    .replace('source-revision=$GITHUB_SHA', 'source-revision=unknown')
    .replace('name: public-native-${{ matrix.platform }}-evidence', 'name: build-evidence');
  const result = errors(candidate);
  assert.match(result, /align vcpkg/);
  assert.match(result, /triggering public SHA/);
});

test('rejects private source names credentials and secrets in a native cell', () => {
  const candidate = workflow.replace(
    '          CI: \'true\'',
    '          CI: \'true\'\n          GH_TOKEN: ${{ secrets.PRIVATE_TOKEN }}',
  );
  assert.match(errors(candidate), /must not consume private source or credentials/);
});

test('rejects an aggregate that omits blocking jobs or terminal execution', () => {
  const candidate = workflow
    .replace('    if: always()\n    needs: [repository-contract, secrets, license, native-matrix, native-build]', '    needs: [native-build]');
  assert.match(errors(candidate), /after every blocking gate and matrix cell/);
});

test('rejects an aggregate that does not require every result to succeed', () => {
  for (const result of [
    'needs.repository-contract.result',
    'needs.secrets.result',
    'needs.license.result',
    'needs.native-matrix.result',
    'needs.native-build.result',
  ]) {
    const candidate = workflow.replace(`test "\${{ ${result} }}" = "success"`, `echo "\${{ ${result} }}"`);
    assert.match(errors(candidate), new RegExp(`must require ${result.replaceAll('.', '\\.')} success`));
  }
});

test('reports a missing native build job and propagates audit failure', () => {
  const candidate = workflow.replace(/^  native-build:[\s\S]*?(?=^  public-ci-result:)/m, '');
  assert.notEqual(errors(candidate), '');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-three-platform-audit-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'public-ci.yml'), candidate);
  assert.throws(() => runAudit(root), /public three-platform CI audit failed/);
});
