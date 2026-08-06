/**
 * TICKET_1335 L4 tests: argument vectors and failure classification.
 *
 * The argument-vector assertions are the executable form of D3. `--locked` being
 * mandatory is not a style preference: the ticket's D3 record documents that bare
 * `pixi install` silently re-solves and rewrites `pixi.lock` on manifest drift,
 * and that this hole existed at `start.sh:224`. A test that only checked "the
 * args contain install" would let that regression back in.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  PIXI_INSTALL_TIMEOUT_MS,
  PIXI_MANIFEST_PATH_FLAG,
  RESEARCH_ENV_VERIFY_TIMEOUT_MS,
} from './constants';
import { PROBE_PROGRAM } from './probe-program';
import {
  buildInstallArgs,
  buildRepairArgs,
  buildUninstallArgs,
  buildVersionArgs,
  looksLikeLockDrift,
  looksLikeNetworkFailure,
  runPixiInstall,
  runPixiRepair,
  runPixiUninstall,
  runReadinessProbe,
  type ProcessResult,
  type ProcessRunner,
  type ProcessSpawnRequest,
} from './process-runner';

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, ...overrides,
  };
}

function recordingRunner(): { runner: ProcessRunner; calls: ProcessSpawnRequest[] } {
  const calls: ProcessSpawnRequest[] = [];
  return {
    calls,
    runner: {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        calls.push(request);
        return result();
      }),
    },
  };
}

describe('argument vectors', () => {
  it('always passes --locked for install', () => {
    const args = buildInstallArgs('/repo/pixi.toml');
    expect(args).toEqual([
      'install', '--locked', '--environment', 'default', PIXI_MANIFEST_PATH_FLAG, '/repo/pixi.toml',
    ]);
  });

  it('always passes --locked for repair, and uses the reinstall subcommand', () => {
    // `reinstall` is what makes repair a distinct operation rather than install
    // relabelled: plain install is a no-op against an environment pixi already
    // considers materialized, so it would skip the very artifacts suspected of
    // being damaged.
    //
    // Asserted as the exact subcommand, not merely "contains a flag": the
    // previous spelling (`install --locked --revalidate`) satisfied a
    // contains-check while being rejected outright by real pixi. Only pinning
    // the subcommand catches that class of error here.
    const args = buildRepairArgs('/repo/pixi.toml');
    expect(args[0]).toBe('reinstall');
    expect(args).toContain('--locked');
    expect(args).not.toContain('--revalidate');
  });

  it('never produces an unlocked materialization variant', () => {
    // Both forms carry `--locked` and exactly one leading subcommand. Bare
    // `pixi install`/`pixi reinstall` silently re-solve and rewrite `pixi.lock`,
    // turning an in-app operation into an unreviewed dependency change.
    for (const args of [buildInstallArgs('/m'), buildRepairArgs('/m')]) {
      expect(args).toContain('--locked');
      expect(['install', 'reinstall']).toContain(args[0]);
      expect(args.filter(arg => arg === 'install' || arg === 'reinstall')).toHaveLength(1);
    }
  });

  it('passes the manifest path explicitly rather than relying on the cwd', () => {
    // pixi discovers a manifest by walking up from the cwd, so an ambient cwd
    // could silently select a different repository's manifest.
    expect(buildInstallArgs('/repo/pixi.toml')).toContain('/repo/pixi.toml');
  });

  it('cleans only the fixed default environment through the governed manifest', () => {
    expect(buildUninstallArgs('/repo/pixi.toml')).toEqual([
      'clean', '--environment', 'default', '--manifest-path', '/repo/pixi.toml',
    ]);
  });

  it('exposes a version query with no side effects', () => {
    expect(buildVersionArgs()).toEqual(['--version']);
  });
});

describe('spawn requests', () => {
  it('runs install from the repository root with the install timeout', async () => {
    const { runner, calls } = recordingRunner();
    await runPixiInstall({
      runner,
      pixiExecutable: '/home/dev/.pixi/bin/pixi',
      manifestPath: '/repo/pixi.toml',
      repositoryRoot: '/repo',
    });
    expect(calls[0].executable).toBe('/home/dev/.pixi/bin/pixi');
    expect(calls[0].cwd).toBe('/repo');
    expect(calls[0].timeoutMs).toBe(PIXI_INSTALL_TIMEOUT_MS);
    expect(calls[0].args).toContain('--locked');
  });

  it('runs repair through the reinstall subcommand', async () => {
    const { runner, calls } = recordingRunner();
    await runPixiRepair({
      runner, pixiExecutable: '/p', manifestPath: '/repo/pixi.toml', repositoryRoot: '/repo',
    });
    expect(calls[0].args[0]).toBe('reinstall');
    expect(calls[0].args).toContain('--locked');
  });

  it('runs uninstall through pixi clean without a package, path, or force argument', async () => {
    const { runner, calls } = recordingRunner();
    await runPixiUninstall({
      runner, pixiExecutable: '/p', manifestPath: '/repo/pixi.toml', repositoryRoot: '/repo',
    });
    expect(calls[0].args).toEqual([
      'clean', '--environment', 'default', '--manifest-path', '/repo/pixi.toml',
    ]);
    expect(calls[0].args).not.toContain('gpquant');
    expect(calls[0].args).not.toContain('--force');
  });

  it('runs the verifier with the locked interpreter in isolated mode', async () => {
    const { runner, calls } = recordingRunner();
    await runReadinessProbe({
      runner,
      interpreterPath: '/repo/.pixi/envs/default/bin/python',
      repositoryRoot: '/repo',
      program: PROBE_PROGRAM,
    });
    // Never ambient python/pip: the ticket's root cause was an ambient pip exit
    // code treated as readiness for a different interpreter than research jobs use.
    expect(calls[0].executable).toBe('/repo/.pixi/envs/default/bin/python');
    // -I prevents PYTHONPATH or a stray repo-root module from satisfying an
    // import the locked environment does not actually provide.
    expect(calls[0].args[0]).toBe('-I');
    expect(calls[0].args[1]).toBe('-c');
    expect(calls[0].timeoutMs).toBe(RESEARCH_ENV_VERIFY_TIMEOUT_MS);
  });

  it('passes the probe program itself, not a file path', async () => {
    const { runner, calls } = recordingRunner();
    await runReadinessProbe({
      runner, interpreterPath: '/p', repositoryRoot: '/repo', program: PROBE_PROGRAM,
    });
    expect(calls[0].args[2]).toContain('STRATCRAFT_RESEARCH_PROBE_BEGIN');
  });
});

describe('network failure classification', () => {
  it.each([
    'error sending request for url',
    'failed to download package',
    'Temporary failure in name resolution',
    'Connection refused',
    'certificate verify failed',
  ])('recognizes %j', text => {
    expect(looksLikeNetworkFailure(result({ exitCode: 1, stderr: text }))).toBe(true);
  });

  it('inspects stdout as well as stderr', () => {
    expect(looksLikeNetworkFailure(result({ stdout: 'failed to download foo' }))).toBe(true);
  });

  it('does not classify an ordinary solve failure as a network failure', () => {
    // A missed match degrades to install_failed, which is still actionable and
    // still shows the log tail; it never silently succeeds.
    expect(looksLikeNetworkFailure(result({ stderr: 'No candidates were found for onnxruntime' })))
      .toBe(false);
  });
});

describe('lock drift classification', () => {
  it('recognizes the message pixi emits when the lock is stale', () => {
    // Verified behaviourally in the ticket's D3 record with a deliberately
    // drifted manifest: pixi exits 1 and leaves pixi.lock byte-identical.
    expect(looksLikeLockDrift(result({
      exitCode: 1, stderr: 'lock file not up-to-date with the workspace',
    }))).toBe(true);
  });

  it('does not classify a network failure as drift', () => {
    expect(looksLikeLockDrift(result({ stderr: 'failed to download package' }))).toBe(false);
  });
});
