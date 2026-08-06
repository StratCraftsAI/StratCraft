#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_NATIVE_PLATFORMS } from './native-platform-matrix.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

function jobBody(workflow, jobName, nextJobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  if (start < 0) return '';
  const end = nextJobName ? workflow.indexOf(`  ${nextJobName}:`, start + 1) : -1;
  return workflow.slice(start, end < 0 ? workflow.length : end);
}

export function validatePublicRepositoryThreePlatformCi(workflow, platforms) {
  const errors = [];
  const nativeBuild = jobBody(workflow, 'native-build', 'public-ci-result');
  const aggregate = jobBody(workflow, 'public-ci-result');

  if (!/^  push:\s*\n    branches: \[main\]$/m.test(workflow)) {
    errors.push('public CI must run for pushes to main');
  }
  if (!/^  pull_request:\s*\n    branches: \[main\]$/m.test(workflow)) {
    errors.push('public CI must run for pull requests targeting main');
  }
  if (!/^  workflow_dispatch:\s*$/m.test(workflow)) {
    errors.push('public CI must support manual workflow dispatch');
  }
  if (!/native-matrix:[\s\S]*native-platform-matrix\.mjs[\s\S]*GITHUB_OUTPUT/.test(workflow)) {
    errors.push('public CI must load the authoritative native platform matrix');
  }
  if (!/needs: native-matrix/.test(nativeBuild)
      || !/matrix: \$\{\{ fromJSON\(needs\.native-matrix\.outputs\.matrix\) \}\}/.test(nativeBuild)) {
    errors.push('native build must expand the authoritative matrix output');
  }
  if (!/runs-on: \$\{\{ matrix\.runner \}\}/.test(nativeBuild)) {
    errors.push('native build cells must use their matrix runner');
  }
  if (!/strategy:\s*\n\s*fail-fast: false/.test(nativeBuild)) {
    errors.push('native build matrix must keep fail-fast disabled');
  }
  if (!/uses: actions\/checkout@v\d+/.test(nativeBuild)
      || /^\s+(?:repository|ref|token):/m.test(nativeBuild)) {
    errors.push('native build cells must check out the triggering public revision');
  }
  if (!/bash \.\/start\.sh build/.test(nativeBuild)
      || !/bash \.\/start\.sh verify-ci/.test(nativeBuild)) {
    errors.push('native compilation and verification must delegate to start.sh');
  }
  if (/run:\s*(?:cmake|ctest|pnpm (?:run )?(?:build|test|typecheck)|electron-builder)/.test(nativeBuild)) {
    errors.push('native build job must not define a second build or test recipe');
  }
  for (const platform of ['Linux', 'macOS', 'Windows']) {
    if (!nativeBuild.includes(`Install native build tools (${platform})`)) {
      errors.push(`native build is missing ${platform} toolchain setup`);
    }
  }
  if (!/VCPKG_DEFAULT_TRIPLET: \$\{\{ matrix\.triplet \}\}/.test(nativeBuild)
      || !/uses: lukka\/run-vcpkg@v\d+/.test(nativeBuild)) {
    errors.push('native build must align vcpkg with the matrix triplet');
  }
  if (!/source-revision=\$GITHUB_SHA/.test(nativeBuild)
      || !/name: public-native-\$\{\{ matrix\.platform \}\}-evidence/.test(nativeBuild)) {
    errors.push('every native cell must retain evidence for the triggering public SHA');
  }
  if (/GITHUB_STRATCRAFT_AI|GH_TOKEN|secrets\./.test(nativeBuild)) {
    errors.push('public native builds must not consume private source or credentials');
  }
  if (!/if: always\(\)/.test(aggregate)
      || !/needs: \[repository-contract, secrets, license, native-matrix, native-build\]/.test(aggregate)) {
    errors.push('aggregate public result must run after every blocking gate and matrix cell');
  }
  for (const result of [
    'needs.repository-contract.result',
    'needs.secrets.result',
    'needs.license.result',
    'needs.native-matrix.result',
    'needs.native-build.result',
  ]) {
    if (!aggregate.includes(`${result} }}" = "success"`)) {
      errors.push(`aggregate public result must require ${result} success`);
    }
  }

  const expected = JSON.stringify(REQUIRED_NATIVE_PLATFORMS);
  if (JSON.stringify(platforms) !== expected) {
    errors.push('native platform matrix must contain exactly the authoritative Linux Windows and macOS rows');
  }
  return errors;
}

export function runAudit(repoRoot = REPO_ROOT) {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/public-ci.yml'), 'utf8');
  const errors = validatePublicRepositoryThreePlatformCi(workflow, REQUIRED_NATIVE_PLATFORMS);
  if (errors.length > 0) {
    throw new Error(`TICKET_1372_5 public three-platform CI audit failed:\n- ${errors.join('\n- ')}`);
  }
}

/* node:coverage ignore next 10 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runAudit();
    process.stdout.write('TICKET_1372_5 public three-platform CI audit passed.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
