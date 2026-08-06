/**
 * Cross-process SQLite startup lock (TICKET_1289_1 AC7).
 *
 * `PRAGMA journal_mode = WAL` can require an exclusive database lock and may
 * return SQLITE_BUSY immediately when two processes activate WAL on the same
 * fresh file. SQLite's busy handler does not reliably serialize that mode
 * transition, so the shared BEGIN IMMEDIATE migration gate is reached too
 * late.
 *
 * Both database hosts use this short advisory lock around connection creation
 * and WAL activation. The migration batch itself remains protected by the
 * authoritative BEGIN IMMEDIATE + locked version re-read in MigrationManager.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MIGRATION_LOCK_BUSY_TIMEOUT_MS } from './migrations';

const STARTUP_LOCK_RETRY_MS = 25;
const STARTUP_LOCK_STALE_MS = 5_000;
const STARTUP_LOCK_SUFFIX = '.migration-startup.lock';
const STARTUP_LOCK_OWNER_FILE = 'owner.json';
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

interface StartupLockOwner {
  pid: number;
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(SLEEP_BUFFER, 0, 0, milliseconds);
}

function ownerPath(lockPath: string): string {
  return path.join(lockPath, STARTUP_LOCK_OWNER_FILE);
}

function readOwner(lockPath: string): StartupLockOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath(lockPath), 'utf8')) as Partial<StartupLockOwner>;
    return Number.isInteger(parsed.pid) && (parsed.pid ?? 0) > 0
      ? { pid: parsed.pid as number }
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function removeAbandonedLock(lockPath: string): boolean {
  const owner = readOwner(lockPath);
  if (owner && isProcessAlive(owner.pid)) {
    return false;
  }

  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (!owner && ageMs <= STARTUP_LOCK_STALE_MS) {
      return false;
    }
    try {
      fs.unlinkSync(ownerPath(lockPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return false;
      }
    }
    fs.rmdirSync(lockPath);
    return true;
  } catch {
    // The owner released the lock, or another waiter recovered it first.
    return !fs.existsSync(lockPath);
  }
}

function acquireStartupLock(dbPath: string): string {
  const lockPath = `${dbPath}${STARTUP_LOCK_SUFFIX}`;
  const deadline = Date.now() + MIGRATION_LOCK_BUSY_TIMEOUT_MS;

  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(ownerPath(lockPath), JSON.stringify({ pid: process.pid }), {
        encoding: 'utf8',
        flag: 'wx',
      });
      return lockPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        try {
          fs.rmdirSync(lockPath);
        } catch {
          // The directory did not belong to this failed acquisition.
        }
        throw error;
      }
      if (removeAbandonedLock(lockPath)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out acquiring SQLite startup lock ${lockPath} after ` +
            `${MIGRATION_LOCK_BUSY_TIMEOUT_MS}ms`,
        );
      }
      sleepSync(STARTUP_LOCK_RETRY_MS);
    }
  }
}

function releaseStartupLock(lockPath: string): void {
  const owner = readOwner(lockPath);
  if (!owner || owner.pid !== process.pid) {
    return;
  }
  try {
    fs.unlinkSync(ownerPath(lockPath));
    fs.rmdirSync(lockPath);
  } catch {
    // A successful task must not be turned into a startup failure solely
    // because an external actor removed the advisory lock first.
  }
}

/**
 * Run the synchronous SQLite connection/WAL initialization under the shared
 * cross-process startup lock.
 */
export function withDatabaseStartupLock<T>(dbPath: string, task: () => T): T {
  const lockPath = acquireStartupLock(dbPath);
  try {
    return task();
  } finally {
    releaseStartupLock(lockPath);
  }
}
