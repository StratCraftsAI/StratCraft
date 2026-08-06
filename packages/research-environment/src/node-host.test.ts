/**
 * TICKET_1335 AC13: the Node host and process runner.
 *
 * This module was at 0 percent coverage while owning the only real `spawn` in
 * the package -- the timeout, the output cap, the ENOENT path, and `shell:
 * false` were all unexercised. Every other suite injects fakes for exactly this
 * seam, so nothing else could have covered it: the fakes are what the rest of
 * the package tests *instead of* this file.
 *
 * These tests spawn real short-lived processes rather than mocking
 * `child_process`. Mocking it here would assert that the mock was called with
 * the right arguments while leaving the actual stream, timer, and exit
 * behaviours -- the reason this module exists -- untested. The processes are
 * `node -e` one-liners bounded to milliseconds.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

import { createNodeEnvironmentHost, createNodeProcessRunner } from './node-host';
import type { ProcessSpawnRequest } from './process-runner';

const NODE = process.execPath;

function request(overrides: Partial<ProcessSpawnRequest> = {}): ProcessSpawnRequest {
  return {
    executable: NODE,
    args: ['-e', 'process.stdout.write("hi")'],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    maxOutputBytes: 1_000_000,
    ...overrides,
  };
}

describe('createNodeProcessRunner (TICKET_1335 L4)', () => {
  const runner = createNodeProcessRunner();

  it('captures stdout, stderr, and a zero exit code', async () => {
    let spawnedPid: number | undefined;
    const result = await runner.run(request({
      args: ['-e', 'process.stdout.write("out");process.stderr.write("err")'],
      onSpawn: pid => { spawnedPid = pid; },
    }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
    expect(spawnedPid).toBeGreaterThan(0);
  });

  it('reports a non-zero exit code rather than throwing', async () => {
    // The service maps exit codes onto failure categories, so a throw here would
    // bypass that mapping entirely.
    const result = await runner.run(request({ args: ['-e', 'process.exit(3)'] }));
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('reports a missing executable as spawnError, not as an exit code', async () => {
    // `error` fires instead of `close` on ENOENT. The service relies on
    // `spawnError` to map this to `pixi_missing` rather than to an install
    // failure with a null exit code.
    const result = await runner.run(request({
      executable: join(tmpdir(), 'qnx-1335-definitely-not-here'),
      args: [],
    }));

    expect(result.spawnError).toBeTruthy();
    expect(result.exitCode).toBeNull();
  });

  it('times out a hung process and marks timedOut without escalating to SIGKILL', async () => {
    // A package manager killed mid-write is what produces the corrupted
    // environment repair exists to fix, so the runner sends SIGTERM and lets the
    // process unwind.
    const result = await runner.run(request({
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 150,
    }));

    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGTERM');
  });

  it('stops accumulating output past the cap but still reports success', async () => {
    // A wedged installer can emit progress indefinitely; only the tail is ever
    // persisted, so the cap must bound memory without failing the operation.
    const result = await runner.run(request({
      args: ['-e', 'process.stdout.write("x".repeat(5000))'],
      maxOutputBytes: 100,
    }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeLessThan(5000);
  });

  it('emits complete output lines to the live log tail', async () => {
    const lines: string[] = [];
    await runner.run(request({
      args: ['-e', 'process.stdout.write("alpha\\nbeta\\n")'],
      onOutputLine: line => lines.push(line),
    }));

    expect(lines).toContain('alpha');
    expect(lines).toContain('beta');
  });

  it('flushes a trailing line that never received a newline', async () => {
    // Pixi's final progress line often lacks a trailing newline. Dropping it
    // would lose precisely the line that says what went wrong.
    const lines: string[] = [];
    await runner.run(request({
      args: ['-e', 'process.stdout.write("no-trailing-newline")'],
      onOutputLine: line => lines.push(line),
    }));

    expect(lines).toContain('no-trailing-newline');
  });

  it('strips carriage returns and drops blank lines from the tail', async () => {
    const lines: string[] = [];
    await runner.run(request({
      args: ['-e', 'process.stdout.write("a\\r\\n\\n\\nb\\r\\n")'],
      onOutputLine: line => lines.push(line),
    }));

    expect(lines).toEqual(['a', 'b']);
  });

  it('does not interpret shell metacharacters in arguments (D3)', async () => {
    // `shell: false` is the whole point: with no shell there is no
    // word-splitting, so an argument containing `;` or `$(...)` reaches the
    // child verbatim instead of being executed.
    const injected = 'a b; echo pwned $(echo sub)';
    const result = await runner.run(request({
      args: ['-e', 'process.stdout.write(process.argv[1] ?? "")', injected],
    }));

    expect(result.stdout).toBe(injected);
    expect(result.stdout).not.toContain('pwned\n');
  });

  it('closes stdin so a prompting tool fails fast instead of hanging', async () => {
    // Left open, a materialization that decided to ask a question would block
    // forever behind a hidden prompt (TICKET_857).
    const result = await runner.run(request({
      args: ['-e', 'process.stdin.on("end", () => process.stdout.write("stdin-closed"))'
        + ';process.stdin.resume()'],
      timeoutMs: 5_000,
    }));

    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe('stdin-closed');
  });
});

describe('createNodeEnvironmentHost (TICKET_1335 L4)', () => {
  it('reports the running platform and architecture', () => {
    const host = createNodeEnvironmentHost();
    expect(host.platform).toBe(process.platform);
    expect(host.architecture).toBe(process.arch);
    expect(host.homeDirectory).toBeTruthy();
  });

  it('detects existing and missing files, and reads content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qnx-1335-host-'));
    try {
      const file = join(dir, 'pixi.toml');
      writeFileSync(file, 'content', 'utf8');
      const host = createNodeEnvironmentHost();

      expect(host.fileExists(file)).toBe(true);
      expect(host.fileExists(join(dir, 'absent.toml'))).toBe(false);
      expect(host.readFile(file)).toBe('content');
      expect(host.realPath(file)).toBe(realpathSync.native(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distinguishes an executable file from a merely present one', () => {
    // This is what stands between resolving a real interpreter and reporting a
    // data file as one.
    const dir = mkdtempSync(join(tmpdir(), 'qnx-1335-host-'));
    try {
      const exe = join(dir, 'runnable');
      const plain = join(dir, 'plain');
      writeFileSync(exe, '#!/bin/sh\n', 'utf8');
      writeFileSync(plain, 'data', 'utf8');
      chmodSync(exe, 0o755);
      chmodSync(plain, 0o644);
      const host = createNodeEnvironmentHost();

      expect(host.isExecutable(exe)).toBe(true);
      expect(host.isExecutable(plain)).toBe(false);
      expect(host.isExecutable(join(dir, 'absent'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves an executable from PATH without shelling out to which', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qnx-1335-path-'));
    try {
      const exe = join(dir, 'pixi');
      writeFileSync(exe, '#!/bin/sh\n', 'utf8');
      chmodSync(exe, 0o755);
      const host = createNodeEnvironmentHost({ PATH: dir });

      expect(host.which('pixi')).toBe(exe);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips non-executable candidates and empty PATH segments', () => {
    // An earlier PATH entry holding a NON-executable file of the same name must
    // not shadow the real one, or resolution would return a path that cannot be
    // spawned.
    const shadow = mkdtempSync(join(tmpdir(), 'qnx-1335-shadow-'));
    const real = mkdtempSync(join(tmpdir(), 'qnx-1335-real-'));
    try {
      writeFileSync(join(shadow, 'pixi'), 'not executable', 'utf8');
      chmodSync(join(shadow, 'pixi'), 0o644);
      const exe = join(real, 'pixi');
      writeFileSync(exe, '#!/bin/sh\n', 'utf8');
      chmodSync(exe, 0o755);

      // The empty segment exercises the `if (!directory) continue` branch.
      const host = createNodeEnvironmentHost({
        PATH: [shadow, '', real].join(delimiter),
      });
      expect(host.which('pixi')).toBe(exe);
    } finally {
      rmSync(shadow, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('returns undefined when the executable is absent from PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qnx-1335-path-'));
    try {
      expect(createNodeEnvironmentHost({ PATH: dir }).which('pixi')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when PATH is unset or empty', () => {
    // Guarded explicitly: `''.split(delimiter)` yields `['']`, which would
    // otherwise probe the process working directory.
    expect(createNodeEnvironmentHost({}).which('pixi')).toBeUndefined();
    expect(createNodeEnvironmentHost({ PATH: '' }).which('pixi')).toBeUndefined();
  });

  it('falls back to the Path spelling used on Windows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qnx-1335-path-'));
    try {
      const exe = join(dir, 'pixi');
      writeFileSync(exe, '#!/bin/sh\n', 'utf8');
      chmodSync(exe, 0o755);
      expect(createNodeEnvironmentHost({ Path: dir }).which('pixi')).toBe(exe);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
