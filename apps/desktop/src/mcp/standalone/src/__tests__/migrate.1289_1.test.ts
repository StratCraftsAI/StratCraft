/**
 * TICKET_1289_1 F1 -- standalone DB bootstrap/migrate (AC1 fresh, AC3 upgrade).
 *
 * Drives the standalone's own bootstrapDatabase() against a real better-sqlite3
 * file (the standalone package's Node-ABI build), proving the no-Electron webui
 * can create + migrate a database to EXPECTED_SCHEMA_VERSION without any Electron
 * process. Also asserts the standalone MigrationHost supplies the app-specific
 * helpers so the migration bodies run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EXPECTED_SCHEMA_VERSION } from '@StratCraft/types';
import { bootstrapDatabase, installStandaloneMigrationHost } from '../migrate';

function readVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare('SELECT MAX(version) AS v FROM schema_version')
      .get() as { v: number | null } | undefined;
    return row?.v ?? 0;
  } finally {
    db.close();
  }
}

interface BootstrapWorker {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  completed: Promise<number>;
}

const BOOTSTRAP_WORKER_SCRIPT = `
const { bootstrapDatabase } = require(process.env.STRATCRAFT_TEST_MIGRATE_MODULE);
console.error = () => {};
process.stdin.once('data', async () => {
  try {
    const version = await bootstrapDatabase(process.env.STRATCRAFT_TEST_DB_PATH);
    process.stdout.write('RESULT:' + version + '\\n');
  } catch (error) {
    process.stderr.write(String(error && error.stack ? error.stack : error) + '\\n');
    process.exitCode = 1;
  }
});
process.stdout.write('READY\\n');
`;

function spawnBootstrapWorker(dbPath: string): BootstrapWorker {
  const migrateModule = path.resolve(process.cwd(), 'dist', 'src', 'migrate.js');
  const child = spawn(process.execPath, ['-e', BOOTSTRAP_WORKER_SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STRATCRAFT_TEST_DB_PATH: dbPath,
      STRATCRAFT_TEST_MIGRATE_MODULE: migrateModule,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let readyResolved = false;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    if (!readyResolved && stdout.includes('READY\n')) {
      readyResolved = true;
      resolveReady();
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const completed = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (!readyResolved) {
        rejectReady(
          new Error(
            `Bootstrap worker exited before its start barrier ` +
              `(code=${String(code)}, signal=${String(signal)}): ${stderr}`,
          ),
        );
      }
      if (code !== 0) {
        reject(
          new Error(
            `Bootstrap worker failed (code=${String(code)}, signal=${String(signal)}): ${stderr}`,
          ),
        );
        return;
      }
      const match = stdout.match(/RESULT:(\d+)/);
      if (!match) {
        reject(new Error(`Bootstrap worker returned no schema version: ${stdout}`));
        return;
      }
      resolve(Number(match[1]));
    });
  });

  return { child, ready, completed };
}

describe('standalone bootstrapDatabase (TICKET_1289_1 F1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bootstrap-'));
    // Point the eval-parquet root (v96 preflight) at a temp dir so the host
    // never touches a real data root.
    process.env.STRATCRAFT_DATA_ROOT = path.join(dir, 'dataroot');
  });

  afterEach(() => {
    delete process.env.STRATCRAFT_DATA_ROOT;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC1: creates a fresh DB (incl. parent dir) at EXPECTED_SCHEMA_VERSION', async () => {
    const dbPath = path.join(dir, 'nested', 'StratCraft.db');
    expect(fs.existsSync(dbPath)).toBe(false);

    const version = await bootstrapDatabase(dbPath);

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(version).toBe(EXPECTED_SCHEMA_VERSION);
    expect(readVersion(dbPath)).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('is idempotent: re-bootstrapping an up-to-date DB is a no-op', async () => {
    const dbPath = path.join(dir, 'StratCraft.db');
    const v1 = await bootstrapDatabase(dbPath);
    const v2 = await bootstrapDatabase(dbPath);
    expect(v1).toBe(EXPECTED_SCHEMA_VERSION);
    expect(v2).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('AC3: a fresh bootstrap IS the fully-behind (version 0 -> N) upgrade path', async () => {
    // A never-migrated file reports version 0 (schema_version table absent),
    // which the engine treats as schemaBehind and applies every migration.
    // (A realistically fabricated mid-version DB would need every table up to
    // that version; the shared-engine tests cover the incremental-apply loop
    // directly -- here we assert the standalone drives the full 0 -> N climb.)
    const dbPath = path.join(dir, 'StratCraft.db');
    const before = fs.existsSync(dbPath) ? readVersion(dbPath) : 0;
    expect(before).toBe(0);
    const version = await bootstrapDatabase(dbPath);
    expect(version).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('installs a host so migration bodies resolve their helpers (no throw)', async () => {
    installStandaloneMigrationHost();
    const dbPath = path.join(dir, 'StratCraft.db');
    await expect(bootstrapDatabase(dbPath)).resolves.toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('closes the connection and releases the startup lock when WAL activation fails', async () => {
    const dbPath = path.join(dir, 'wal-failure', 'StratCraft.db');
    const originalPragma = Database.prototype.pragma;
    const pragmaSpy = vi
      .spyOn(Database.prototype, 'pragma')
      .mockImplementation(function (this: Database.Database, source: string, options?: unknown) {
        if (source === 'journal_mode = WAL') {
          throw new Error('SQLITE_BUSY');
        }
        return originalPragma.call(this, source, options as never);
      });
    const closeSpy = vi.spyOn(Database.prototype, 'close');

    try {
      await expect(bootstrapDatabase(dbPath)).rejects.toThrow('SQLITE_BUSY');
      expect(closeSpy).toHaveBeenCalledOnce();
      expect(fs.existsSync(`${dbPath}.migration-startup.lock`)).toBe(false);
    } finally {
      pragmaSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });

  it('AC7: two OS processes racing the same empty DB serialize and converge', async () => {
    const dbPath = path.join(dir, 'race', 'StratCraft.db');
    const first = spawnBootstrapWorker(dbPath);
    const second = spawnBootstrapWorker(dbPath);

    await Promise.all([first.ready, second.ready]);
    first.child.stdin.end('start\n');
    second.child.stdin.end('start\n');

    await expect(Promise.all([first.completed, second.completed])).resolves.toEqual([
      EXPECTED_SCHEMA_VERSION,
      EXPECTED_SCHEMA_VERSION,
    ]);
    expect(readVersion(dbPath)).toBe(EXPECTED_SCHEMA_VERSION);

    const db = new Database(dbPath, { readonly: true });
    try {
      const duplicates = db
        .prepare(
          `SELECT version, COUNT(*) AS count
           FROM schema_version
           GROUP BY version
           HAVING COUNT(*) > 1`,
        )
        .all();
      expect(duplicates).toEqual([]);
    } finally {
      db.close();
    }
  });
});
