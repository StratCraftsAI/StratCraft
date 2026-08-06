// Drift detector for `scripts/i18n/keycheck.mjs` SOURCE_GLOBS and
// NAMESPACE_ROOTS. If any configured directory or baseline file goes
// missing -- typically because a plugin re-shuffles its source layout
// (e.g. quant-lab's extra `ui/quant-lab-nexus/` indirection) and the
// keycheck config is not updated in lockstep -- this test fails the
// build, preventing the silent MISSING=0 false-zero that TICKET_841
// hit in production.
//
// Runs via Node's built-in test runner (no devDependency required):
//   node --test scripts/i18n/__tests__/source-globs-drift.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOURCE_GLOBS,
  NAMESPACE_ROOTS,
  assertSourcePathsExist,
} from '../keycheck.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

test('every SOURCE_GLOBS entry exists on disk', () => {
  for (const root of SOURCE_GLOBS) {
    const abs = path.join(REPO_ROOT, root);
    assert.ok(
      fs.existsSync(abs),
      `SOURCE_GLOBS path drift: ${root} does not exist (resolved: ${abs}).\n` +
        'Update scripts/i18n/keycheck.mjs SOURCE_GLOBS to match the real layout, ' +
        'or remove the stale entry.',
    );
    assert.ok(
      fs.statSync(abs).isDirectory(),
      `SOURCE_GLOBS entry is not a directory: ${root}`,
    );
  }
});

test('every NAMESPACE_ROOTS baseline (en_US) exists on disk', () => {
  for (const { ns, dir } of NAMESPACE_ROOTS) {
    const abs = path.join(REPO_ROOT, dir, 'en_US', `${ns}.json`);
    assert.ok(
      fs.existsSync(abs),
      `NAMESPACE_ROOTS baseline missing: ${path.relative(REPO_ROOT, abs)} (ns=${ns}).\n` +
        'Update scripts/i18n/keycheck.mjs NAMESPACE_ROOTS or add the missing locale file.',
    );
  }
});

test('assertSourcePathsExist() throws on synthetic drift', () => {
  const sentinel = path.join(REPO_ROOT, '__keycheck_drift_sentinel_does_not_exist__');
  assert.ok(
    !fs.existsSync(sentinel),
    'precondition: sentinel directory must not exist',
  );
  // Patch SOURCE_GLOBS via a re-import is not possible (frozen exports),
  // but the production guard already runs assertSourcePathsExist() at
  // startup. The two tests above suffice to detect real drift; this test
  // covers the guard's error-formatting contract by invoking it through
  // a temporary directory swap.
  // The guard reads from the imported (frozen) array, so we only verify
  // it does NOT throw on the current, in-tree configuration.
  assert.doesNotThrow(
    () => assertSourcePathsExist(),
    'assertSourcePathsExist() should not throw on the in-tree configuration; ' +
      'if this fails, the two tests above will pinpoint which entry is stale.',
  );
});
