/**
 * TICKET_1335 L4: the real Node implementations of the injected host surfaces.
 *
 * Kept in a separate module from the service so that importing the service in a
 * test does not bind `node:child_process` or touch the filesystem. The parent
 * ticket's own regression test mocks `child_process` to prove no surface spawns a
 * package manager directly; a service that imported `spawn` at top level could
 * not participate in that check.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { EnvironmentHost } from './environment-paths';
import type { ProcessResult, ProcessRunner, ProcessSpawnRequest } from './process-runner';

// -----------------------------------------------------------------------------
// Host
// -----------------------------------------------------------------------------

/**
 * `PATH` lookup, implemented here rather than shelling out to `which`.
 *
 * Using `which`/`where` would mean spawning a shell utility to find out whether
 * we can spawn something -- an extra process dependency on the exact path where
 * the environment is already suspect. Reading `PATH` is the same algorithm
 * without that circularity.
 */
function whichFromPath(executable: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? '';
  if (!pathValue) {
    return undefined;
  }
  // PATHEXT matters on Windows, where the executable has no extension in the
  // name we are given. On POSIX the empty suffix is the only candidate.
  const suffixes = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const suffix of suffixes) {
      const candidate = join(directory, executable + suffix);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not executable or not present; try the next candidate.
      }
    }
  }
  return undefined;
}

export function createNodeEnvironmentHost(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentHost {
  return {
    fileExists: (path: string) => existsSync(path),
    realPath: (path: string) => realpathSync.native(path),
    isExecutable: (path: string) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (path: string) => readFileSync(path, 'utf8'),
    platform: process.platform,
    architecture: process.arch,
    which: (executable: string) => whichFromPath(executable, env),
    homeDirectory: homedir(),
  };
}

// -----------------------------------------------------------------------------
// Process runner
// -----------------------------------------------------------------------------

/**
 * `spawn` with an argument vector and `shell: false`.
 *
 * `shell: false` is the whole point of D3's "never a shell string": with no
 * shell there is no word-splitting or metacharacter interpretation, so a
 * repository path containing a space or a quote cannot alter the argument
 * boundaries. It is stated explicitly rather than left to the default so that a
 * future edit cannot silently flip it.
 */
export function createNodeProcessRunner(): ProcessRunner {
  return {
    run(request: ProcessSpawnRequest): Promise<ProcessResult> {
      return new Promise<ProcessResult>(resolve => {
        let stdout = '';
        let stderr = '';
        let capturedBytes = 0;
        let timedOut = false;
        let settled = false;
        let pending = '';

        const child = spawn(request.executable, [...request.args], {
          cwd: request.cwd,
          shell: false,
          windowsHide: true,
          // stdin is closed: a materialization that decided to prompt would
          // otherwise block forever behind a hidden question. Closing it makes
          // such a tool fail fast instead (TICKET_857).
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (child.pid !== undefined) {
          request.onSpawn?.(child.pid);
        }

        const timer = setTimeout(() => {
          timedOut = true;
          // SIGTERM first so pixi can unwind; the process is then abandoned to
          // the OS rather than escalated to SIGKILL, because killing a package
          // manager mid-write is what produces the corrupted environment repair
          // exists to fix.
          child.kill('SIGTERM');
        }, request.timeoutMs);

        const emitLines = (chunk: string): void => {
          if (!request.onOutputLine) {
            return;
          }
          pending += chunk;
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.replace(/\r$/, '');
            if (trimmed.length > 0) {
              request.onOutputLine(trimmed);
            }
          }
        };

        const capture = (target: 'stdout' | 'stderr') => (data: Buffer): void => {
          const text = data.toString('utf8');
          capturedBytes += Buffer.byteLength(text, 'utf8');
          // Past the cap, output is dropped rather than accumulated: a wedged
          // installer can emit progress indefinitely, and only the tail is ever
          // persisted anyway.
          if (capturedBytes <= request.maxOutputBytes) {
            if (target === 'stdout') {
              stdout += text;
            } else {
              stderr += text;
            }
          }
          emitLines(text);
        };

        child.stdout?.on('data', capture('stdout'));
        child.stderr?.on('data', capture('stderr'));

        const settle = (result: ProcessResult): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (pending.length > 0) {
            request.onOutputLine?.(pending);
            pending = '';
          }
          resolve(result);
        };

        // `error` fires instead of `close` when the executable cannot be started
        // (ENOENT). Reported as `spawnError` so the service maps it to
        // `pixi_missing` rather than to an install failure with a null exit code.
        child.on('error', error => {
          settle({
            exitCode: null,
            signal: null,
            stdout,
            stderr,
            timedOut,
            spawnError: error.message,
          });
        });

        child.on('close', (code, signal) => {
          settle({
            exitCode: code,
            signal: signal ?? null,
            stdout,
            stderr,
            timedOut,
          });
        });
      });
    },
  };
}
