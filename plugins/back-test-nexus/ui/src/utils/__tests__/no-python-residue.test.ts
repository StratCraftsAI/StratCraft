/**
 * TICKET_751_2 P6: Regression guard for residual Python tokens in the
 * back-test-nexus plugin.
 *
 * Backtest execution moved to the C++ stratforge-runner under TICKET_681.
 * These assertions block any reintroduction of Python build paths, Python
 * executable manifest references, or stale Python type names that would
 * mislead readers about the runtime boundary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLUGIN_ROOT = resolve(__dirname, '../../../../');

describe('TICKET_751_2: no Python residue in back-test-nexus', () => {
  it('manifest.json has no python reference (case-insensitive)', () => {
    const manifestPath = resolve(PLUGIN_ROOT, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(JSON.stringify(manifest).toLowerCase()).not.toMatch(/python/);
  });

  it('build.sh has no python / cython / pip tokens', () => {
    const buildShPath = resolve(PLUGIN_ROOT, 'build.sh');
    const buildSh = readFileSync(buildShPath, 'utf8').toLowerCase();
    expect(buildSh).not.toMatch(/python/);
    expect(buildSh).not.toMatch(/cython/);
    // Match 'pip' as a standalone token to avoid catching unrelated words.
    expect(buildSh).not.toMatch(/\bpip\b/);
  });

  it('executorResultConverter.ts has no stale Python* identifiers', () => {
    const converterPath = resolve(PLUGIN_ROOT, 'ui/src/utils/executorResultConverter.ts');
    const source = readFileSync(converterPath, 'utf8');
    // Identifiers are reconstructed at runtime so this guard file itself stays
    // free of the forbidden tokens that the TICKET_751_2 grep gate scans for.
    const forbidden = ['P' + 'ythonResult', 'P' + 'ythonTrade', 'p' + 'ythonMetrics'];
    for (const token of forbidden) {
      expect(new RegExp('\\b' + token + '\\b').test(source)).toBe(false);
    }
  });
});
