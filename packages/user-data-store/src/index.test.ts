import type Database from 'better-sqlite3';
// The standalone MCP owns the Node-ABI build used by its SQLite integration
// tests; the package itself remains driver-agnostic and imports only DB types.
// @ts-expect-error the nested runtime package has no separately discoverable d.ts
import StandaloneDatabase from '../../../apps/desktop/src/mcp/standalone/node_modules/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationStore,
  DataProviderDefaultsStore,
  StartupAuditStore,
  UserDataNotFoundError,
  UserDataValidationError,
} from './index';

describe('user-data-store', () => {
  let db: Database.Database;
  let conversations: ConversationStore;

  beforeEach(() => {
    db = new StandaloneDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE nona_ai_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Strategy',
        preview TEXT,
        message_count INTEGER DEFAULT 0,
        token_usage INTEGER DEFAULT 0,
        token_limit INTEGER DEFAULT 128000,
        strategy_rules TEXT,
        status TEXT DEFAULT 'active'
          CHECK(status IN ('active', 'archived', 'deleted')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );
      CREATE TABLE nona_ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        token_count INTEGER DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(conversation_id) REFERENCES nona_ai_conversations(id)
          ON DELETE CASCADE
      );
      CREATE TABLE data_provider_defaults (
        domain TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE startup_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        migration_561_status TEXT,
        migration_561_dirs_copied INTEGER DEFAULT 0,
        migration_561_files_copied INTEGER DEFAULT 0,
        migration_561_files_skipped INTEGER DEFAULT 0,
        migration_561_error TEXT,
        db_schema_version INTEGER,
        db_migrations_applied INTEGER DEFAULT 0,
        db_integrity_ok INTEGER DEFAULT 1,
        db_recovery_attempted INTEGER DEFAULT 0,
        plugins_discovered INTEGER DEFAULT 0,
        plugins_loaded INTEGER DEFAULT 0,
        plugins_failed TEXT,
        python_path TEXT,
        executor_available INTEGER DEFAULT 0,
        node_version TEXT,
        electron_version TEXT,
        platform TEXT,
        startup_duration_ms INTEGER,
        phase_durations TEXT,
        status TEXT NOT NULL,
        warnings TEXT,
        create_time TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    conversations = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('owns conversation CRUD, ordering, pagination, and escaped search by user', () => {
    const first = conversations.create('user-a', {
      title: 'First_100%',
      preview: 'preview',
      token_limit: 4096,
      strategy_rules: 'rule',
    });
    const second = conversations.create('user-a', { title: 'Second' });
    conversations.create('user-b', { title: 'First_100%' });

    expect(conversations.get('user-a', first.id)?.title).toBe('First_100%');
    expect(conversations.get('user-b', first.id)).toBeNull();
    expect(conversations.list('user-a', { limit: 1, offset: 0 })).toHaveLength(1);
    expect(conversations.list('user-a', { limit: 5, offset: 1 })).toHaveLength(1);
    expect(conversations.search('user-a', 'First_100%', 10).map(row => row.id))
      .toEqual([first.id]);

    const unchanged = conversations.update('user-a', second.id, {});
    expect(unchanged.id).toBe(second.id);
    const updated = conversations.update('user-a', second.id, {
      title: 'Updated',
      preview: null,
      message_count: 3,
      token_usage: 7,
      token_limit: 8192,
      strategy_rules: null,
      status: 'archived',
    });
    expect(updated).toMatchObject({
      title: 'Updated',
      preview: null,
      message_count: 3,
      token_usage: 7,
      token_limit: 8192,
      strategy_rules: null,
      status: 'archived',
    });
    expect(conversations.list('user-a', {
      limit: 10,
      offset: 0,
      status: 'archived',
    }).map(row => row.id)).toEqual([second.id]);

    conversations.softDelete('user-a', first.id);
    expect(conversations.get('user-a', first.id)).toBeNull();
    expect(() => conversations.softDelete('user-a', first.id))
      .toThrow(UserDataNotFoundError);
  });

  it('validates user and update/search inputs', () => {
    const row = conversations.create('user-a');
    expect(row.title).toBe('New Strategy');
    expect(() => conversations.get('', row.id)).toThrow(UserDataValidationError);
    expect(() => conversations.search('user-a', ' ', 10))
      .toThrow(UserDataValidationError);
    expect(() => conversations.update(
      'user-a',
      row.id,
      { unexpected: true } as never,
    )).toThrow(UserDataValidationError);
    expect(() => conversations.update('user-b', row.id, { title: 'No' }))
      .toThrow(UserDataNotFoundError);
  });

  it('normalizes bigint SQLite insert identifiers', () => {
    const fakeDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({
          run: () => ({ changes: 1, lastInsertRowid: 9n }),
        })
        .mockReturnValueOnce({
          get: () => ({
            id: 9,
            user_id: 'user-a',
            title: 'Bigint ID',
            status: 'active',
          }),
        }),
      transaction: <T>(fn: () => T) => fn,
    };
    const row = new ConversationStore(fakeDb as never)
      .create('user-a', { title: 'Bigint ID' });
    expect(row.id).toBe(9);
  });

  it('adds and deletes owned messages atomically and maintains counters', () => {
    const conversation = conversations.create('user-a', { title: 'Chat' });
    const added = conversations.addMessage('user-a', {
      conversation_id: conversation.id,
      type: 'user',
      content: 'hello',
      token_count: 4,
      metadata: '{"source":"test"}',
    });
    expect(added.message).toMatchObject({ content: 'hello', token_count: 4 });
    expect(added.conversation).toMatchObject({ message_count: 1, token_usage: 4 });
    expect(conversations.getWithMessages('user-a', conversation.id)?.messages)
      .toHaveLength(1);
    expect(conversations.getWithMessages('user-b', conversation.id)).toBeNull();

    const deleted = conversations.deleteMessage('user-a', added.message.id);
    expect(deleted.conversation).toMatchObject({ message_count: 0, token_usage: 0 });
    expect(() => conversations.deleteMessage('user-a', added.message.id))
      .toThrow(UserDataNotFoundError);
    expect(() => conversations.addMessage('user-b', {
      conversation_id: conversation.id,
      type: 'assistant',
      content: 'foreign',
    })).toThrow(UserDataNotFoundError);
  });

  it('rolls back an invalid message without changing conversation counters', () => {
    const conversation = conversations.create('user-a');
    expect(() => conversations.addMessage('user-a', {
      conversation_id: conversation.id,
      type: 'invalid',
      content: 'bad',
    } as never)).toThrow();
    expect(conversations.get('user-a', conversation.id))
      .toMatchObject({ message_count: 0, token_usage: 0 });
  });

  it('validates, persists, replaces, filters, and clears provider defaults', () => {
    const defaults = new DataProviderDefaultsStore(db);
    expect(defaults.get()).toEqual({});
    expect(defaults.set('us_equity', 'alpaca')).toEqual({ us_equity: 'alpaca' });
    expect(defaults.set('us_equity', 'polygon')).toEqual({ us_equity: 'polygon' });
    db.prepare(
      'UPDATE data_provider_defaults SET provider_id = ? WHERE domain = ?',
    ).run('stale-provider', 'us_equity');
    expect(defaults.get()).toEqual({});
    expect(() => defaults.set('crypto', 'alpaca'))
      .toThrow(UserDataValidationError);
    expect(() => defaults.set('us_equity', 'invalid'))
      .toThrow(UserDataValidationError);
    expect(defaults.set('us_equity', null)).toEqual({});
  });

  it('reads startup audits deterministically with null and paginated paths', () => {
    const audits = new StartupAuditStore(db);
    expect(audits.getLatest()).toBeNull();
    db.prepare(`
      INSERT INTO startup_audit (session_id, status, create_time)
      VALUES (?, ?, ?)
    `).run('older', 'success', '2026-01-01 00:00:00');
    db.prepare(`
      INSERT INTO startup_audit (session_id, status, create_time)
      VALUES (?, ?, ?)
    `).run('newer', 'warning', '2026-01-02 00:00:00');
    expect(audits.getLatest()?.session_id).toBe('newer');
    expect(audits.list(1, 1).map(row => row.session_id)).toEqual(['older']);
  });
});
