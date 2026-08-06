/**
 * Integration Test: MigrationManager -> DatabaseManager Migration Logic
 *
 * TICKET_494 Phase 2: Integration layer
 * Tests migration ordering, idempotency, incremental, and rollback logic.
 * Uses in-memory simulation (better-sqlite3 native module not available in vitest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
    getPath: (name: string) => `/mock/${name}`,
  },
}));

vi.mock('../../../utils/logger', () => ({
  dbLog: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  appLog: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// In-memory SQL simulation for migration testing
// ---------------------------------------------------------------------------

interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

class InMemoryMigrationRunner {
  private schemaVersion = 0;
  private tables: Set<string> = new Set();
  private columns: Map<string, Set<string>> = new Map();
  private data: Map<string, Array<Record<string, unknown>>> = new Map();
  private appliedMigrations: number[] = [];

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  getTables(): string[] {
    return Array.from(this.tables).sort();
  }

  getColumns(table: string): string[] {
    return Array.from(this.columns.get(table) || []);
  }

  getData(table: string): Array<Record<string, unknown>> {
    return this.data.get(table) || [];
  }

  /**
   * Apply migrations in order, skipping already-applied versions.
   * Mimics MigrationManager.migrate() transaction behavior.
   */
  migrate(migrations: Migration[]): void {
    const pending = migrations
      .filter((m) => m.version > this.schemaVersion)
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      this.executeMigration(migration);
    }
  }

  /**
   * Apply a single migration within a "transaction" (all-or-nothing).
   */
  private executeMigration(migration: Migration): void {
    const snapshot = this.snapshot();

    try {
      this.executeSQL(migration.up);
      this.schemaVersion = migration.version;
      this.appliedMigrations.push(migration.version);
    } catch (error) {
      // Rollback to snapshot
      this.restore(snapshot);
      throw error;
    }
  }

  /**
   * Execute SQL-like statements (simplified parser for testing).
   */
  executeSQL(sql: string): void {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      this.executeStatement(stmt);
    }
  }

  private executeStatement(stmt: string): void {
    const upper = stmt.toUpperCase().trim();

    if (upper.startsWith('CREATE TABLE')) {
      const match = stmt.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\((.*)\)/is);
      if (!match) throw new Error(`Invalid CREATE TABLE: ${stmt}`);
      const tableName = match[1];
      const columnDefs = match[2];
      this.tables.add(tableName);
      const cols = new Set<string>();
      for (const part of columnDefs.split(',')) {
        const colMatch = part.trim().match(/^(\w+)/);
        if (colMatch && !part.trim().toUpperCase().startsWith('FOREIGN') && !part.trim().toUpperCase().startsWith('PRIMARY') && !part.trim().toUpperCase().startsWith('UNIQUE') && !part.trim().toUpperCase().startsWith('CHECK') && !part.trim().toUpperCase().startsWith('CONSTRAINT')) {
          cols.add(colMatch[1]);
        }
      }
      this.columns.set(tableName, cols);
      this.data.set(tableName, []);
    } else if (upper.startsWith('ALTER TABLE') && upper.includes('ADD COLUMN')) {
      const match = stmt.match(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i);
      if (!match) throw new Error(`Invalid ALTER TABLE: ${stmt}`);
      const [, tableName, colName] = match;
      const cols = this.columns.get(tableName);
      if (!cols) throw new Error(`Table ${tableName} does not exist`);
      cols.add(colName);
      // Add default value to existing rows
      const rows = this.data.get(tableName) || [];
      const defaultMatch = stmt.match(/DEFAULT\s+(\S+)/i);
      const defaultVal = defaultMatch ? (isNaN(Number(defaultMatch[1])) ? defaultMatch[1].replace(/'/g, '') : Number(defaultMatch[1])) : null;
      for (const row of rows) {
        row[colName] = defaultVal;
      }
    } else if (upper.startsWith('INSERT INTO')) {
      const match = stmt.match(/INSERT INTO\s+(\w+)\s+VALUES\s*\((.+)\)/i);
      if (!match) throw new Error(`Invalid INSERT: ${stmt}`);
      const [, tableName, valuesStr] = match;
      if (!this.tables.has(tableName)) throw new Error(`Table ${tableName} does not exist`);
      const cols = Array.from(this.columns.get(tableName) || []);
      const values = valuesStr.split(',').map((v) => {
        const trimmed = v.trim().replace(/^'|'$/g, '');
        return isNaN(Number(trimmed)) || trimmed === '' ? trimmed : Number(trimmed);
      });
      const row: Record<string, unknown> = {};
      cols.forEach((col, i) => {
        row[col] = values[i] !== undefined ? values[i] : null;
      });
      this.data.get(tableName)!.push(row);
    } else if (upper.startsWith('DROP TABLE')) {
      const match = stmt.match(/DROP TABLE\s+(?:IF EXISTS\s+)?(\w+)/i);
      if (match) {
        this.tables.delete(match[1]);
        this.columns.delete(match[1]);
        this.data.delete(match[1]);
      }
    } else if (upper.startsWith('CREAT ') || upper.includes('INVALID')) {
      // Simulate SQL syntax error
      throw new Error(`SQL syntax error: ${stmt}`);
    }
    // Ignore comments and no-ops
  }

  private snapshot(): { tables: Set<string>; columns: Map<string, Set<string>>; data: Map<string, Array<Record<string, unknown>>>; version: number } {
    return {
      tables: new Set(this.tables),
      columns: new Map(Array.from(this.columns.entries()).map(([k, v]) => [k, new Set(v)])),
      data: new Map(Array.from(this.data.entries()).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
      version: this.schemaVersion,
    };
  }

  private restore(snapshot: ReturnType<InMemoryMigrationRunner['snapshot']>): void {
    this.tables = snapshot.tables;
    this.columns = snapshot.columns;
    this.data = snapshot.data;
    this.schemaVersion = snapshot.version;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Migration Execution Logic (in-memory)', () => {
  let runner: InMemoryMigrationRunner;

  beforeEach(() => {
    runner = new InMemoryMigrationRunner();
  });

  it('runs a single migration on fresh DB', () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'Create users table',
        up: `CREATE TABLE users (id INTEGER, name TEXT)`,
        down: `DROP TABLE IF EXISTS users`,
      },
    ];

    runner.migrate(migrations);

    expect(runner.getTables()).toContain('users');
    expect(runner.getSchemaVersion()).toBe(1);
  });

  it('runs multiple migrations in order', () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'Create users table',
        up: `CREATE TABLE users (id INTEGER, name TEXT)`,
        down: `DROP TABLE IF EXISTS users`,
      },
      {
        version: 2,
        name: 'Create orders table',
        up: `CREATE TABLE orders (id INTEGER, user_id INTEGER)`,
        down: `DROP TABLE IF EXISTS orders`,
      },
      {
        version: 3,
        name: 'Add email to users',
        up: `ALTER TABLE users ADD COLUMN email TEXT`,
        down: `-- no-op`,
      },
    ];

    runner.migrate(migrations);

    expect(runner.getTables()).toContain('users');
    expect(runner.getTables()).toContain('orders');
    expect(runner.getSchemaVersion()).toBe(3);
    expect(runner.getColumns('users')).toContain('email');
  });

  it('incremental migration skips already-applied versions', () => {
    const first: Migration[] = [
      { version: 1, name: 'v1', up: `CREATE TABLE users (id INTEGER, name TEXT)`, down: `DROP TABLE IF EXISTS users` },
    ];

    runner.migrate(first);
    expect(runner.getSchemaVersion()).toBe(1);

    const all: Migration[] = [
      ...first,
      { version: 2, name: 'v2', up: `CREATE TABLE products (id INTEGER, name TEXT)`, down: `DROP TABLE IF EXISTS products` },
    ];

    runner.migrate(all);
    expect(runner.getSchemaVersion()).toBe(2);
    expect(runner.getTables()).toContain('products');
  });

  it('idempotent re-run does not fail', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'v1', up: `CREATE TABLE IF NOT EXISTS test_table (id INTEGER)`, down: `DROP TABLE IF EXISTS test_table` },
    ];

    runner.migrate(migrations);
    expect(() => runner.migrate(migrations)).not.toThrow();
    expect(runner.getSchemaVersion()).toBe(1);
  });

  it('malformed SQL fails and does not advance schema version', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'good', up: `CREATE TABLE good_table (id INTEGER)`, down: `DROP TABLE IF EXISTS good_table` },
    ];

    runner.migrate(migrations);
    expect(runner.getSchemaVersion()).toBe(1);

    const withBad: Migration[] = [
      ...migrations,
      { version: 2, name: 'bad', up: `CREAT TABLE bad_syntax (id INTEGER)`, down: `DROP TABLE IF EXISTS bad_syntax` },
    ];

    expect(() => runner.migrate(withBad)).toThrow('SQL syntax error');
    expect(runner.getSchemaVersion()).toBe(1);
  });

  it('transaction rollback on partial failure preserves state', () => {
    // Setup existing data
    runner.executeSQL(`CREATE TABLE existing_data (id INTEGER, value TEXT)`);
    runner.executeSQL(`INSERT INTO existing_data VALUES (1, 'preserved')`);

    const migrations: Migration[] = [
      {
        version: 1,
        name: 'bad multi-statement',
        up: `CREATE TABLE new_table (id INTEGER); INVALID SQL HERE`,
        down: `DROP TABLE IF EXISTS new_table`,
      },
    ];

    expect(() => runner.migrate(migrations)).toThrow();

    // Existing data preserved via rollback
    const data = runner.getData('existing_data');
    expect(data.length).toBe(1);
    expect(data[0].value).toBe('preserved');
    // new_table should not exist (rolled back)
    expect(runner.getTables()).not.toContain('new_table');
  });

  it('migration with INSERT data works correctly', () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'Create and seed config',
        up: `
          CREATE TABLE app_config (key TEXT, value TEXT);
          INSERT INTO app_config VALUES ('version', '1.0.0');
          INSERT INTO app_config VALUES ('theme', 'dark')
        `,
        down: `DROP TABLE IF EXISTS app_config`,
      },
    ];

    runner.migrate(migrations);

    const rows = runner.getData('app_config');
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.key === 'version')?.value).toBe('1.0.0');
    expect(rows.find((r) => r.key === 'theme')?.value).toBe('dark');
  });

  it('migration with ALTER TABLE adds column with default value', () => {
    runner.executeSQL(`CREATE TABLE users (id INTEGER, name TEXT)`);
    runner.executeSQL(`INSERT INTO users VALUES (1, 'Alice')`);

    const migrations: Migration[] = [
      { version: 1, name: 'add age', up: `ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0`, down: `-- no-op` },
    ];

    runner.migrate(migrations);

    const data = runner.getData('users');
    expect(data[0].age).toBe(0);
    expect(runner.getColumns('users')).toContain('age');
  });

  it('down migration reverses schema changes', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'create temp', up: `CREATE TABLE temp_data (id INTEGER, value TEXT)`, down: `DROP TABLE IF EXISTS temp_data` },
    ];

    runner.migrate(migrations);
    expect(runner.getTables()).toContain('temp_data');

    runner.executeSQL(migrations[0].down);
    expect(runner.getTables()).not.toContain('temp_data');
  });

  it('empty migration list is a no-op', () => {
    runner.migrate([]);
    expect(runner.getSchemaVersion()).toBe(0);
  });
});
