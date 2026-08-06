/**
 * SQLite startup advisory-lock tests (TICKET_1289_1 AC7).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withDatabaseStartupLock } from './startup-lock';

const STARTUP_LOCK_SUFFIX = '.migration-startup.lock';
const OWNER_FILE = 'owner.json';
const ABANDONED_PID = 999_999;

let tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-startup-lock-'));
  tempDirs.push(dir);
  return path.join(dir, 'StratCraft.db');
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('withDatabaseStartupLock', () => {
  it('holds the lock during the task and removes it afterward', () => {
    const dbPath = tempDbPath();
    const lockPath = `${dbPath}${STARTUP_LOCK_SUFFIX}`;

    const result = withDatabaseStartupLock(dbPath, () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      const owner = JSON.parse(
        fs.readFileSync(path.join(lockPath, OWNER_FILE), 'utf8'),
      ) as { pid: number };
      expect(owner.pid).toBe(process.pid);
      return 'complete';
    });

    expect(result).toBe('complete');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('releases the lock when connection initialization throws', () => {
    const dbPath = tempDbPath();
    const lockPath = `${dbPath}${STARTUP_LOCK_SUFFIX}`;

    expect(() =>
      withDatabaseStartupLock(dbPath, () => {
        throw new Error('WAL activation failed');
      }),
    ).toThrow('WAL activation failed');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('recovers a lock whose recorded owner process no longer exists', () => {
    const dbPath = tempDbPath();
    const lockPath = `${dbPath}${STARTUP_LOCK_SUFFIX}`;
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
      path.join(lockPath, OWNER_FILE),
      JSON.stringify({ pid: ABANDONED_PID }),
      'utf8',
    );

    expect(withDatabaseStartupLock(dbPath, () => 'recovered')).toBe('recovered');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('recovers an old ownerless lock left between mkdir and owner write', () => {
    const dbPath = tempDbPath();
    const lockPath = `${dbPath}${STARTUP_LOCK_SUFFIX}`;
    fs.mkdirSync(lockPath);
    fs.utimesSync(lockPath, 0, 0);

    expect(withDatabaseStartupLock(dbPath, () => 'recovered')).toBe('recovered');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('recovers an old lock with a malformed owner record', () => {
    const dbPath = tempDbPath();
    const lockPath = `${dbPath}${STARTUP_LOCK_SUFFIX}`;
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, OWNER_FILE), '{invalid', 'utf8');
    fs.utimesSync(lockPath, 0, 0);

    expect(withDatabaseStartupLock(dbPath, () => 'recovered')).toBe('recovered');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
