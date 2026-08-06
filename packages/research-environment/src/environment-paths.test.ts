/**
 * TICKET_1335 L4 tests: environment identity.
 *
 * The lock-parsing tests are not exercising a YAML reader for its own sake. Two
 * specific real-world facts are asserted, both discovered by probing the live
 * locked environment rather than by reading the manifest:
 *
 *   - `gplearn` is pinned as a RANGE (`>=0.4.2`) in the manifest and resolves to
 *     `0.4.3` in the lock. A manifest-derived expected version would be the
 *     literal `">=0.4.2"`, and comparing it to the installed `0.4.3` would report
 *     a healthy environment as drifted.
 *   - `pandas-ta` is spelled with a hyphen everywhere except the contract key.
 *
 * The real `pixi.lock` is parsed at the end so these stay true against the
 * committed file rather than only against fixtures.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RESEARCH_CAPABILITIES } from '@StratCraft/types';

import {
  CAPABILITY_DISTRIBUTION_NAMES,
  RESEARCH_ENV_PATH_ERROR_CODES,
  ResearchEnvironmentPathError,
  hashFile,
  isSupportedPlatform,
  normalizeDistributionName,
  parseLockedVersions,
  readEnvironmentIdentity,
  readLockedVersions,
  resolveEnvironmentPaths,
  resolveProjectionEnvironmentPaths,
  resolveRepositoryRoot,
  resolvePixiExecutable,
  validateEnvironmentRemovalTarget,
  type EnvironmentHost,
} from './environment-paths';

const REPO_ROOT = resolve(process.cwd(), '../..');

interface HostOverrides {
  files?: Record<string, string>;
  executables?: readonly string[];
  platform?: string;
  architecture?: string;
  pathExecutable?: string;
  homeDirectory?: string;
  realPaths?: Record<string, string>;
}

function makeHost(overrides: HostOverrides = {}): EnvironmentHost {
  const files = overrides.files ?? {};
  const executables = new Set(overrides.executables ?? []);
  return {
    fileExists: path => Object.prototype.hasOwnProperty.call(files, path),
    realPath: path => overrides.realPaths?.[path] ?? path,
    isExecutable: path => executables.has(path),
    readFile: path => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return files[path];
    },
    platform: overrides.platform ?? 'linux',
    architecture: overrides.architecture ?? 'x64',
    which: () => overrides.pathExecutable,
    homeDirectory: overrides.homeDirectory,
  };
}

describe('uninstall target containment', () => {
  const repositoryRoot = '/repo';
  const environmentRoot = '/repo/.pixi/envs/default';

  it.each(['default', 'without-gpquant'] as const)(
    'accepts registered projection %s only at its canonical workspace target',
    (projection) => {
      const paths = resolveProjectionEnvironmentPaths({ repositoryRoot, host: makeHost() }, projection);
      const host = makeHost({ files: { [paths.environmentRoot]: '' } });
      expect(() => validateEnvironmentRemovalTarget(host, paths, projection)).not.toThrow();
    },
  );

  it('rejects a symlink target that escapes the workspace environment directory', () => {
    const host = makeHost({
      files: { [environmentRoot]: '' },
      realPaths: {
        '/repo/.pixi/envs': '/repo/.pixi/envs',
        [environmentRoot]: '/shared/valuable-environment',
      },
    });
    expect(() => validateEnvironmentRemovalTarget(
      host,
      { repositoryRoot, environmentRoot },
      'default',
    ))
      .toThrowError(expect.objectContaining({
        code: RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
      }));
  });

  it('does not resolve a target when the environment is already absent', () => {
    const host = makeHost({
      realPaths: { [environmentRoot]: '/shared/valuable-environment' },
    });
    expect(() => validateEnvironmentRemovalTarget(
      host,
      { repositoryRoot, environmentRoot },
      'default',
    )).not.toThrow();
  });

  it.each([
    ['default', '/repo/.pixi/envs/without-gpquant'],
    ['without-gpquant', '/repo/.pixi/envs/default'],
    ['default', '/repo/.pixi/envs/sibling'],
    ['default', '/outside/.pixi/envs/default'],
  ] as const)('rejects projection %s at non-canonical target %s', (projection, target) => {
    const host = makeHost({ files: { [target]: '' } });
    expect(() => validateEnvironmentRemovalTarget(
      host,
      { repositoryRoot, environmentRoot: target },
      projection,
    )).toThrowError(expect.objectContaining({
      code: RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
    }));
  });

  it('rejects an unregistered projection', () => {
    const host = makeHost({ files: { [environmentRoot]: '' } });
    expect(() => validateEnvironmentRemovalTarget(
      host,
      { repositoryRoot, environmentRoot },
      'attacker-selected' as 'default',
    )).toThrowError(expect.objectContaining({
      code: RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
    }));
  });

  it('rejects an ancestor alias that changes the canonical target parent', () => {
    const host = makeHost({
      files: { [environmentRoot]: '' },
      realPaths: {
        '/repo/.pixi/envs': '/shared/environments',
        [environmentRoot]: '/repo/.pixi/envs/default',
      },
    });
    expect(() => validateEnvironmentRemovalTarget(
      host,
      { repositoryRoot, environmentRoot },
      'default',
    )).toThrowError(expect.objectContaining({
      code: RESEARCH_ENV_PATH_ERROR_CODES.TARGET_PATH_ESCAPE,
    }));
  });
});

describe('platform support', () => {
  it('accepts linux-x64, the only platform the committed lock solves for', () => {
    expect(isSupportedPlatform('linux', 'x64')).toBe(true);
  });

  it('rejects other platforms and architectures', () => {
    expect(isSupportedPlatform('darwin', 'arm64')).toBe(false);
    expect(isSupportedPlatform('win32', 'x64')).toBe(false);
    expect(isSupportedPlatform('linux', 'arm64')).toBe(false);
  });
});

describe('path resolution', () => {
  it('derives every canonical path from the repository root', () => {
    const paths = resolveEnvironmentPaths({ repositoryRoot: '/repo', host: makeHost() });
    expect(paths.manifestPath).toBe('/repo/pixi.toml');
    expect(paths.lockPath).toBe('/repo/pixi.lock');
    expect(paths.interpreterPath).toBe('/repo/.pixi/envs/default/bin/python');
  });

  it('uses the Windows interpreter layout on win32', () => {
    const paths = resolveEnvironmentPaths({
      repositoryRoot: 'C:\\repo',
      host: makeHost({ platform: 'win32' }),
    });
    expect(paths.interpreterPath).toContain('python.exe');
    expect(paths.interpreterPath).not.toContain('bin');
  });
});

describe('repository root resolution', () => {
  const rooted = (dir: string) => makeHost({
    files: { [`${dir}/pixi.toml`]: '', [`${dir}/pixi.lock`]: '' },
  });

  it('finds the root when it is the starting directory', () => {
    expect(resolveRepositoryRoot('/repo', rooted('/repo'))).toBe('/repo');
  });

  it('walks upward from a nested build output directory', () => {
    // The real motivation: each host starts somewhere different beneath the
    // root -- Electron's app path, the headless build output, a package dir.
    expect(resolveRepositoryRoot('/repo/apps/desktop/dist/main', rooted('/repo')))
      .toBe('/repo');
  });

  it('requires both governed files, not just the manifest', () => {
    // A manifest with no solved lock is not an approved environment; treating
    // it as the root would resolve something the repository never approved.
    const manifestOnly = makeHost({ files: { '/repo/pixi.toml': '' } });
    expect(resolveRepositoryRoot('/repo/apps', manifestOnly)).toBeNull();
    const lockOnly = makeHost({ files: { '/repo/pixi.lock': '' } });
    expect(resolveRepositoryRoot('/repo/apps', lockOnly)).toBeNull();
  });

  it('returns null rather than defaulting to the starting directory', () => {
    // A packaged install with no source tree is a legitimate state. Falling
    // back to the start dir would spawn pixi in an arbitrary directory.
    expect(resolveRepositoryRoot('/opt/app/resources', makeHost())).toBeNull();
  });

  it('stops at the filesystem root instead of looping', () => {
    expect(resolveRepositoryRoot('/', makeHost())).toBeNull();
  });

  it('selects the nearest root when nested repositories exist', () => {
    const nested = makeHost({
      files: {
        '/repo/pixi.toml': '', '/repo/pixi.lock': '',
        '/repo/vendor/inner/pixi.toml': '', '/repo/vendor/inner/pixi.lock': '',
      },
    });
    expect(resolveRepositoryRoot('/repo/vendor/inner/src', nested))
      .toBe('/repo/vendor/inner');
  });

  it('locates the real committed root from this test file', () => {
    // Not a mock: proves the resolver works against the actual repository
    // layout, which is what every adapter depends on at runtime.
    const real = resolveRepositoryRoot(__dirname, {
      fileExists: (path: string) => existsSync(path),
    });
    expect(real).not.toBeNull();
    expect(existsSync(resolve(real!, 'pixi.lock'))).toBe(true);
  });
});

describe('pixi executable resolution', () => {
  it('prefers a PATH-resolved executable', () => {
    const host = makeHost({ pathExecutable: '/usr/local/bin/pixi' });
    expect(resolvePixiExecutable(host)).toBe('/usr/local/bin/pixi');
  });

  it('falls back to the per-user install directory when PATH lacks pixi', () => {
    // This is the live condition on the development host: pixi 0.75.0 exists at
    // ~/.pixi/bin/pixi but a non-login shell's PATH does not include it. Treating
    // that as "pixi missing" would report a healthy machine as unusable.
    const host = makeHost({
      homeDirectory: '/home/dev',
      executables: ['/home/dev/.pixi/bin/pixi'],
    });
    expect(resolvePixiExecutable(host)).toBe('/home/dev/.pixi/bin/pixi');
  });

  it('throws PIXI_MISSING rather than returning a bare name to spawn', () => {
    // Returning "pixi" would defer the failure into the child process, where it
    // arrives as an opaque ENOENT during install instead of a distinct admission
    // failure carrying remediation.
    const host = makeHost({ homeDirectory: '/home/dev' });
    expect(() => resolvePixiExecutable(host)).toThrow(ResearchEnvironmentPathError);
    try {
      resolvePixiExecutable(host);
    } catch (error) {
      expect((error as ResearchEnvironmentPathError).code)
        .toBe(RESEARCH_ENV_PATH_ERROR_CODES.PIXI_MISSING);
    }
  });

  it('does not consult the fallback when no home directory is known', () => {
    const host = makeHost({ executables: ['/home/dev/.pixi/bin/pixi'] });
    expect(() => resolvePixiExecutable(host)).toThrow(ResearchEnvironmentPathError);
  });
});

describe('hashing', () => {
  it('hashes file content as lowercase hex sha256', () => {
    const host = makeHost({ files: { '/repo/pixi.toml': 'content' } });
    const digest = hashFile(host, '/repo/pixi.toml', RESEARCH_ENV_PATH_ERROR_CODES.MANIFEST_MISSING);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not normalize line endings, so a byte-level edit changes the hash', () => {
    // The hash is bound into a LocalMutationApproval so that editing the manifest
    // while a confirmation dialog is open invalidates it. Normalizing would make a
    // real change invisible to that check.
    const lf = makeHost({ files: { '/f': 'a\nb' } });
    const crlf = makeHost({ files: { '/f': 'a\r\nb' } });
    expect(hashFile(lf, '/f', RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING))
      .not.toBe(hashFile(crlf, '/f', RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING));
  });

  it('reports a missing manifest and a missing lock with distinct codes', () => {
    const host = makeHost({ files: { '/repo/pixi.toml': 'x' } });
    try {
      readEnvironmentIdentity({ repositoryRoot: '/repo', host });
      throw new Error('expected a path error');
    } catch (error) {
      expect((error as ResearchEnvironmentPathError).code)
        .toBe(RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING);
    }

    const noManifest = makeHost({ files: { '/repo/pixi.lock': 'x' } });
    try {
      readEnvironmentIdentity({ repositoryRoot: '/repo', host: noManifest });
      throw new Error('expected a path error');
    } catch (error) {
      expect((error as ResearchEnvironmentPathError).code)
        .toBe(RESEARCH_ENV_PATH_ERROR_CODES.MANIFEST_MISSING);
    }
  });
});

describe('distribution name normalization', () => {
  it('collapses PEP 503 separators case-insensitively', () => {
    expect(normalizeDistributionName('pandas_ta')).toBe('pandas-ta');
    expect(normalizeDistributionName('Pandas.TA')).toBe('pandas-ta');
    expect(normalizeDistributionName('  pandas--ta  ')).toBe('pandas-ta');
  });

  it('maps every contract capability to a distribution name', () => {
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(CAPABILITY_DISTRIBUTION_NAMES[capability]).toBeTruthy();
    }
    // The one entry where the contract key and the distribution name differ.
    expect(CAPABILITY_DISTRIBUTION_NAMES.pandas_ta).toBe('pandas-ta');
  });
});

describe('locked version parsing', () => {
  const lock = `
version: 6
packages:
- pypi: https://example.invalid/histdata_supplementary-0.1.0.whl
  name: histdata-supplementary
  version: 0.1.0
- pypi: https://example.invalid/duckdb-1.5.3.whl
  name: duckdb
  version: 1.5.3
- pypi: https://example.invalid/gplearn-0.4.3.whl
  name: gplearn
  version: 0.4.3
- pypi: https://example.invalid/gpquant-0.1.6.whl
  name: gpquant
  version: 0.1.6
- pypi: https://example.invalid/pysr-1.5.10.whl
  name: pysr
  version: 1.5.10
- pypi: https://example.invalid/pandas_ta-0.4.71b0.whl
  name: pandas-ta
  version: 0.4.71b0
`;

  it('resolves every capability from the lock', () => {
    const versions = parseLockedVersions(lock);
    expect(versions).toEqual({
      histdata: '0.1.0',
      duckdb: '1.5.3',
      gplearn: '0.4.3',
      gpquant: '0.1.6',
      pysr: '1.5.10',
      pandas_ta: '0.4.71b0',
    });
  });

  it('matches the hyphenated distribution name for the pandas_ta contract key', () => {
    expect(parseLockedVersions(lock).pandas_ta).toBe('0.4.71b0');
  });

  it('throws rather than inventing a placeholder when a capability is unresolved', () => {
    // A capability with no locked version cannot be verified against anything.
    // Substituting a value would make `ready` reachable without evidence.
    const partial = lock.replace(/- pypi: \S+pysr\S+\n  name: pysr\n  version: \S+\n/, '');
    try {
      parseLockedVersions(partial);
      throw new Error('expected a path error');
    } catch (error) {
      expect((error as ResearchEnvironmentPathError).code)
        .toBe(RESEARCH_ENV_PATH_ERROR_CODES.LOCK_CAPABILITY_MISSING);
      expect((error as Error).message).toContain('pysr');
    }
  });

  it('does not steal a version from the following entry when one has none', () => {
    const missingVersion = `
- name: pysr
- name: duckdb
  version: 1.5.3
`;
    try {
      parseLockedVersions(missingVersion);
      throw new Error('expected a path error');
    } catch (error) {
      // pysr must be reported missing; it must not silently acquire duckdb's
      // 1.5.3 by scanning past its own entry.
      expect((error as Error).message).toContain('pysr');
    }
  });

  it('takes the first version for a repeated package rather than the last', () => {
    // The real lock lists each package twice: once in the environment's package
    // list and once in the resolved-package section, with identical versions.
    const duplicated = lock + '\n- name: duckdb\n  version: 9.9.9\n';
    expect(parseLockedVersions(duplicated).duckdb).toBe('1.5.3');
  });

  it('reports a missing lock file distinctly from an unresolvable capability', () => {
    const host = makeHost({ files: { '/repo/pixi.toml': 'x' } });
    try {
      readLockedVersions({ repositoryRoot: '/repo', host });
      throw new Error('expected a path error');
    } catch (error) {
      expect((error as ResearchEnvironmentPathError).code)
        .toBe(RESEARCH_ENV_PATH_ERROR_CODES.LOCK_MISSING);
    }
  });
});

describe('the committed pixi.lock', () => {
  /**
   * Parsed from the real file, not a fixture. A fixture-only test would keep
   * passing after a lock update that removed or renamed a capability, which is
   * exactly the drift this parser exists to detect.
   */
  it('resolves a concrete version for all six capabilities', () => {
    const content = readFileSync(resolve(REPO_ROOT, 'pixi.lock'), 'utf8');
    const versions = parseLockedVersions(content);
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(versions[capability]).toMatch(/^\d/);
    }
  });

  it('resolves gplearn to a concrete version even though the manifest pins a range', () => {
    // The manifest says `gplearn = ">=0.4.2"`. This assertion is the reason
    // expected versions come from the lock: a range is not comparable to an
    // installed version, and equality against ">=0.4.2" would fail on a healthy
    // environment.
    const manifest = readFileSync(resolve(REPO_ROOT, 'pixi.toml'), 'utf8');
    expect(manifest).toMatch(/gplearn\s*=\s*">=/);

    const versions = parseLockedVersions(readFileSync(resolve(REPO_ROOT, 'pixi.lock'), 'utf8'));
    expect(versions.gplearn).not.toContain('>=');
    expect(versions.gplearn).toMatch(/^\d+\.\d+/);
  });
});
