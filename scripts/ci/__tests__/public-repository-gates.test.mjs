import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import { auditPublicRepository, CANONICAL_LICENSE, runCli, trackedFiles } from '../public-repository-gates.mjs';

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratcraft-public-gate-'));
  const content = {
    LICENSE: 'Apache License\nVersion 2.0\n',
    'README.md': `Licensed under ${CANONICAL_LICENSE}.\n`,
    'CONTRIBUTING.md': 'Contributions are welcome.\n',
    'SECURITY.md': 'Report vulnerabilities privately.\n',
    'package.json': JSON.stringify({ license: CANONICAL_LICENSE }),
    ...overrides,
  };
  for (const [file, value] of Object.entries(content)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  return { root, files: Object.keys(content) };
}

test('accepts a complete public repository', () => {
  const { root, files } = fixture();
  assert.deepEqual(auditPublicRepository(root, files), { ok: true, checkedFiles: files.length, errors: [] });
});

test('reads tracked files and runs the command entry point', () => {
  const { root, files } = fixture();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  assert.deepEqual(trackedFiles(root).sort(), files.sort());
  assert.equal(runCli(root).ok, true);
});

test('reports every release-contract failure', () => {
  const { root, files } = fixture({
    LICENSE: 'Proprietary',
    'nested/package.json': JSON.stringify({ license: 'MIT' }),
    'apps/desktop/runtime.db-wal': '',
    'docs/private/plan.md': 'internal',
  });
  const result = auditPublicRepository(root, files.filter((file) => file !== 'SECURITY.md'));
  assert.equal(result.ok, false);
  for (const expected of ['missing required file', 'tracked runtime database', 'private release content', 'LICENSE is not', 'expected Apache-2.0']) {
    assert.ok(result.errors.some((error) => error.includes(expected)));
  }
});

test('command entry point propagates failures', () => {
  const { root } = fixture({ LICENSE: 'invalid' });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  assert.throws(() => runCli(root), /Public repository gate failed/);
});
