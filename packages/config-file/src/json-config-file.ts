/**
 * Cross-process-safe JSON config file access (TICKET_1276).
 *
 * The strategy-builder plugin `config.json` (LLM selection, validation flags)
 * is read-modify-written by BOTH the Electron main process and the MCP
 * standalone server. In-process serialization (the per-plugin promise chain in
 * plugin-settings-file.ts) cannot see the other process, and a bare
 * `writeFileSync` is neither atomic (torn reads parse as invalid JSON) nor
 * safe against interleaved read-modify-write cycles (lost updates).
 *
 * This module is the single owner of that concern:
 *  - WRITES take an advisory lock (a `<file>.lock` directory -- `mkdir` is
 *    atomic on every platform), then write via tmp file + fsync + rename so a
 *    reader can only ever observe a complete document.
 *  - A lock left behind by a crashed process is taken over once it is older
 *    than {@link LOCK_STALE_MS} (normal hold time is single-digit ms).
 *  - READS need no lock: rename is atomic, so a plain read sees either the
 *    old or the new complete file.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Poll interval while waiting for a contended lock. */
const LOCK_RETRY_MS = 25;
/** Give up acquiring the lock after this long (TICKET_857 -- surface, not hang). */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
/** A lock directory older than this belongs to a crashed process. */
const LOCK_STALE_MS = 5_000;

function lockPathOf(filePath: string): string {
  return `${filePath}.lock`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireLock(filePath: string): Promise<string> {
  const lockPath = lockPathOf(filePath);
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      return lockPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Held by someone. Take over only if it is stale (crashed holder).
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) {
          fs.rmdirSync(lockPath);
          continue;
        }
      } catch {
        // Lock vanished between mkdir and stat -- retry immediately.
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring config lock ${lockPath} after ${LOCK_ACQUIRE_TIMEOUT_MS}ms`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lockPath: string): void {
  try {
    fs.rmdirSync(lockPath);
  } catch {
    // Already removed (stale takeover by a peer after our timeout) -- the next
    // writer re-creates it; nothing to surface.
  }
}

export async function withConfigFileLock<T>(
  filePath: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const lockPath = await acquireLock(filePath);
  try {
    return await operation();
  } finally {
    releaseLock(lockPath);
  }
}

export function writeConfigFileAtomically(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

/**
 * Read a JSON config file. Missing file -> `{}`. Invalid JSON throws
 * (TICKET_857 fail fast -- callers surface the error instead of silently
 * resetting user settings). Torn documents cannot occur because every writer
 * goes through the atomic rename in {@link updateJsonConfigFile}.
 */
export function readJsonConfigFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Shallow-merge `patch` into a JSON config file under the cross-process
 * advisory lock, writing atomically (tmp + fsync + rename). Returns the merged
 * document as written.
 */
export async function updateJsonConfigFile(
  filePath: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return withConfigFileLock(filePath, () => {
    const config = readJsonConfigFile(filePath);
    Object.assign(config, patch);

    writeConfigFileAtomically(filePath, JSON.stringify(config, null, 2));

    return config;
  });
}
