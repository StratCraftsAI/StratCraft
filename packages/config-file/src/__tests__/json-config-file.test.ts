import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonConfigFile, updateJsonConfigFile } from '../json-config-file';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-file-test-'));
  file = path.join(dir, 'nested', 'config.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readJsonConfigFile', () => {
  it('returns {} for a missing file', () => {
    expect(readJsonConfigFile(file)).toEqual({});
  });

  it('throws on invalid JSON (TICKET_857 fail fast)', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json', 'utf-8');
    expect(() => readJsonConfigFile(file)).toThrow();
  });

  it('round-trips a document written by updateJsonConfigFile', async () => {
    await updateJsonConfigFile(file, { a: 1, b: 'x' });
    expect(readJsonConfigFile(file)).toEqual({ a: 1, b: 'x' });
  });
});

describe('updateJsonConfigFile', () => {
  it('creates parent directories and merges patches shallowly', async () => {
    await updateJsonConfigFile(file, { a: 1, keep: 'yes' });
    const merged = await updateJsonConfigFile(file, { a: 2 });
    expect(merged).toEqual({ a: 2, keep: 'yes' });
    expect(readJsonConfigFile(file)).toEqual({ a: 2, keep: 'yes' });
  });

  it('leaves no tmp or lock artifacts behind', async () => {
    await updateJsonConfigFile(file, { a: 1 });
    const entries = fs.readdirSync(path.dirname(file));
    expect(entries).toEqual(['config.json']);
  });

  it('serializes concurrent updates without losing keys', async () => {
    // 20 concurrent single-key patches from this process; every key must
    // survive (a lost RMW update would drop some).
    const patches = Array.from({ length: 20 }, (_, i) => ({ [`k${i}`]: i }));
    await Promise.all(patches.map(p => updateJsonConfigFile(file, p)));
    const result = readJsonConfigFile(file);
    for (let i = 0; i < 20; i++) {
      expect(result[`k${i}`]).toBe(i);
    }
  });

  it('takes over a stale lock left by a crashed process', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lockPath = `${file}.lock`;
    fs.mkdirSync(lockPath);
    // Age the lock beyond the stale threshold.
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);

    await updateJsonConfigFile(file, { recovered: true });
    expect(readJsonConfigFile(file)).toEqual({ recovered: true });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('times out on a live (fresh) foreign lock instead of hanging', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lockPath = `${file}.lock`;
    fs.mkdirSync(lockPath);
    // Keep the lock fresh so stale takeover never applies.
    const keepFresh = setInterval(() => {
      const now = new Date();
      try { fs.utimesSync(lockPath, now, now); } catch { /* released */ }
    }, 500);
    try {
      await expect(updateJsonConfigFile(file, { a: 1 })).rejects.toThrow(/Timed out acquiring config lock/);
    } finally {
      clearInterval(keepFresh);
      fs.rmdirSync(lockPath);
    }
  }, 10_000);

  it('cross-process: parallel writers from separate node processes lose no updates', async () => {
    // Drives the BUILT dist entry from real child processes -- the exact
    // Electron-vs-MCP topology the lock exists for. Requires `npm run build`.
    const { execFile } = await import('child_process');
    const script = `
      const { updateJsonConfigFile } = require(${JSON.stringify(path.resolve(__dirname, '..', '..', 'dist', 'index.js'))});
      const [file, prefix] = process.argv.slice(1);
      (async () => {
        for (let i = 0; i < 10; i++) {
          await updateJsonConfigFile(file, { [prefix + i]: i });
        }
      })().catch(e => { console.error(e); process.exit(1); });
    `;
    const child = (prefix: string) =>
      new Promise<void>((resolve, reject) => {
        // With `-e` there is no script-path argv slot: argv = [execPath, ...args].
        execFile(process.execPath, ['-e', script, file, prefix], (err, _out, stderr) => {
          if (err) reject(new Error(`${err.message}\n${stderr}`));
          else resolve();
        });
      });

    await Promise.all([child('a'), child('b'), child('c')]);
    const result = readJsonConfigFile(file);
    for (const prefix of ['a', 'b', 'c']) {
      for (let i = 0; i < 10; i++) {
        expect(result[`${prefix}${i}`]).toBe(i);
      }
    }
  }, 30_000);
});
