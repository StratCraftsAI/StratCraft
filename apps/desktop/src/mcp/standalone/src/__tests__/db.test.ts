/**
 * Unit tests for MCP Database resolution and initialization
 *
 * Tests resolveDbPath() and openDatabase() from db.ts:
 * - CLI arg --db-path (highest precedence)
 * - Env var StratCraft_DB_PATH (second)
 * - Dev path (existsSync true, third)
 * - Production paths by platform (darwin, win32, linux)
 * - openDatabase: creates Database with readonly, sets pragma
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ---------------------------------------------------------------------------
// Mocks -- vi.mock factories are hoisted, so we use vi.hoisted() for shared
// state that needs to be available in the factory.
// ---------------------------------------------------------------------------

const { mockPragma, MockDatabase } = vi.hoisted(() => {
  const mockPragma = vi.fn();
  const mockInstance = { pragma: mockPragma };
  const MockDatabase = vi.fn().mockReturnValue(mockInstance);
  return { mockPragma, MockDatabase, mockInstance };
});

vi.mock('better-sqlite3', () => ({
  default: MockDatabase,
}));

vi.mock('@StratCraft/db-migrations', () => ({
  MIGRATION_LOCK_BUSY_TIMEOUT_MS: 120_000,
  withDatabaseStartupLock: (_dbPath: string, task: () => unknown) => task(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
  },
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('os', () => ({
  default: {
    platform: vi.fn().mockReturnValue('linux'),
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  },
  platform: vi.fn().mockReturnValue('linux'),
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}));

import { resolveDbPath, openDatabase, openDatabaseRW } from '../db';
import { MIGRATION_LOCK_BUSY_TIMEOUT_MS } from '@StratCraft/db-migrations';
import fs from 'fs';
import os from 'os';

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

let savedArgv: string[];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  MockDatabase.mockReturnValue({ pragma: mockPragma });
  (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (os.platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
  (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue('/home/testuser');

  savedArgv = [...process.argv];
  savedEnv = { ...process.env };
  delete process.env.StratCraft_DB_PATH;
  delete process.env.APPDATA;
  // Reset argv to a clean state (node + script only)
  process.argv = ['node', 'script.js'];
});

afterEach(() => {
  process.argv = savedArgv;
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// resolveDbPath
// ---------------------------------------------------------------------------

describe('resolveDbPath', () => {
  describe('precedence order', () => {
    it('CLI arg --db-path takes highest precedence', () => {
      process.argv = ['node', 'script.js', '--db-path', '/cli/path/StratCraft.db'];
      process.env.StratCraft_DB_PATH = '/env/path/StratCraft.db';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = resolveDbPath();

      expect(result).toBe('/cli/path/StratCraft.db');
    });

    it('env var StratCraft_DB_PATH is second precedence when no CLI arg', () => {
      process.env.StratCraft_DB_PATH = '/env/path/StratCraft.db';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = resolveDbPath();

      expect(result).toBe('/env/path/StratCraft.db');
    });

    it('dev path is third precedence when no CLI arg or env var', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
        // Dev path contains 'data/StratCraft.db'
        if (typeof p === 'string' && p.includes(path.join('data', 'StratCraft.db'))) {
          return true;
        }
        return false;
      });

      const result = resolveDbPath();

      expect(result).toContain(path.join('data', 'StratCraft.db'));
    });
  });

  describe('CLI arg --db-path', () => {
    it('returns the path following --db-path flag', () => {
      process.argv = ['node', 'index.js', '--db-path', '/custom/db.sqlite'];

      const result = resolveDbPath();

      expect(result).toBe('/custom/db.sqlite');
    });

    it('ignores --db-path if no value follows', () => {
      process.argv = ['node', 'index.js', '--db-path'];
      // Should fall through to env / dev / production
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = resolveDbPath();

      // Falls through to dev path fallback (no existsSync match)
      expect(result).toContain('StratCraft.db');
    });
  });

  describe('production paths by platform', () => {
    it('resolves darwin path', () => {
      (os.platform as ReturnType<typeof vi.fn>).mockReturnValue('darwin');
      (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue('/Users/testuser');
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('Library')) {
          return true;
        }
        return false;
      });

      const result = resolveDbPath();

      expect(result).toBe(
        path.join('/Users/testuser', 'Library', 'Application Support', '@StratCraft', 'desktop', 'data', 'StratCraft.db'),
      );
    });

    it('resolves win32 path using APPDATA', () => {
      (os.platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
      (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue('C:\\Users\\testuser');
      process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('@StratCraft')) {
          return true;
        }
        return false;
      });

      const result = resolveDbPath();

      expect(result).toBe(
        path.win32.join('C:\\Users\\testuser\\AppData\\Roaming', '@StratCraft', 'desktop', 'data', 'StratCraft.db'),
      );
    });

    it('resolves win32 path without APPDATA falls back to homedir', () => {
      (os.platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
      (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue('C:\\Users\\testuser');
      delete process.env.APPDATA;
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('@StratCraft')) {
          return true;
        }
        return false;
      });

      const result = resolveDbPath();

      expect(result).toBe(
        path.win32.join('C:\\Users\\testuser', 'AppData', 'Roaming', '@StratCraft', 'desktop', 'data', 'StratCraft.db'),
      );
    });

    it('resolves linux path', () => {
      (os.platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
      (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue('/home/testuser');
      (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('.config')) {
          return true;
        }
        return false;
      });

      const result = resolveDbPath();

      expect(result).toBe(
        path.join('/home/testuser', '.config', '@StratCraft', 'desktop', 'data', 'StratCraft.db'),
      );
    });
  });

  describe('fallback behavior', () => {
    it('returns dev path as fallback when no path exists', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = resolveDbPath();

      // Falls back to devPath even though it does not exist
      expect(result).toContain(path.join('data', 'StratCraft.db'));
    });
  });
});

// ---------------------------------------------------------------------------
// openDatabase
// ---------------------------------------------------------------------------

describe('openDatabase', () => {
  it('creates Database with readonly option', () => {
    openDatabase('/path/to/db.sqlite');

    expect(MockDatabase).toHaveBeenCalledWith('/path/to/db.sqlite', { readonly: true });
  });

  it('sets foreign_keys pragma to ON', () => {
    openDatabase('/path/to/db.sqlite');

    expect(mockPragma).toHaveBeenCalledWith('foreign_keys = ON');
  });

  it('returns the database instance', () => {
    const instance = { pragma: mockPragma };
    MockDatabase.mockReturnValue(instance);

    const db = openDatabase('/path/to/db.sqlite');

    expect(db).toBe(instance);
  });

  it('propagates errors from Database constructor', () => {
    MockDatabase.mockImplementation(() => {
      throw new Error('SQLITE_CANTOPEN: unable to open database file');
    });

    expect(() => openDatabase('/nonexistent/path.db')).toThrow('SQLITE_CANTOPEN');
  });
});

describe('openDatabaseRW', () => {
  it('sets the shared busy timeout before activating WAL (AC7)', () => {
    openDatabaseRW('/path/to/db.sqlite');

    expect(mockPragma.mock.calls.slice(0, 2)).toEqual([
      [`busy_timeout = ${MIGRATION_LOCK_BUSY_TIMEOUT_MS}`],
      ['journal_mode = WAL'],
    ]);
  });

  it('closes the connection when WAL activation fails', () => {
    const close = vi.fn();
    mockPragma.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY');
    });
    MockDatabase.mockReturnValue({ pragma: mockPragma, close });

    expect(() => openDatabaseRW('/path/to/db.sqlite')).toThrow('SQLITE_BUSY');
    expect(close).toHaveBeenCalledOnce();
  });
});
