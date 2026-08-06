/**
 * TICKET_1317: durable AI Studio workflow binding persistence.
 *
 * AC5 (isolation and lifecycle), AC7 (bounded, secret-free persistence with
 * compare-and-swap writes and conversation-deletion cascade).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
// The standalone MCP owns the Node-ABI build used by this package's SQLite
// integration tests; the root build targets the Electron ABI and cannot load
// under plain Node (see src/index.test.ts for the same import).
// @ts-expect-error the nested runtime package has no separately discoverable d.ts
import StandaloneDatabase from '../../../apps/desktop/src/mcp/standalone/node_modules/better-sqlite3';

import {
  AiStudioWorkflowBindingStore,
  UserDataConflictError,
  type AiStudioWorkflowBindingInput,
  type SqliteDatabase,
} from './index';

const SUBJECT = 'subject-a';
const OTHER_SUBJECT = 'subject-b';
const CONVERSATION = '77';

/** The migration v135 DDL, kept byte-equivalent to packages/db-migrations. */
const SCHEMA = `
CREATE TABLE ai_studio_workflow_binding (
  subject_id              TEXT NOT NULL,
  conversation_id         TEXT NOT NULL,
  session_id              TEXT NOT NULL,
  workflow_revision       INTEGER NOT NULL CHECK (workflow_revision >= 1),
  rules_hash              TEXT NOT NULL,
  strategy_rules_json     TEXT CHECK (strategy_rules_json IS NULL OR json_valid(strategy_rules_json)),
  available_actions_json  TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(available_actions_json)),
  expires_at              REAL NOT NULL DEFAULT 0,
  generated_artifact_hash TEXT,
  generated_class_name    TEXT,
  row_revision            INTEGER NOT NULL CHECK (row_revision >= 1),
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  PRIMARY KEY (subject_id, conversation_id)
);
CREATE INDEX idx_ai_studio_workflow_binding_session
  ON ai_studio_workflow_binding(session_id);
CREATE INDEX idx_ai_studio_workflow_binding_conversation
  ON ai_studio_workflow_binding(conversation_id);
`;

function input(overrides: Partial<AiStudioWorkflowBindingInput> = {}): AiStudioWorkflowBindingInput {
  return {
    session_id: 'studio-1',
    workflow_revision: 1,
    rules_hash: 'hash-1',
    strategy_rules_json: JSON.stringify({ risk_management: { take_profit_pct: 6 } }),
    available_actions_json: JSON.stringify(['generate_code']),
    expires_at: 0,
    generated_artifact_hash: null,
    generated_class_name: null,
    ...overrides,
  };
}

describe('persists_versioned_state_with_compare_and_swap', () => {
  let db: Database.Database;
  let store: AiStudioWorkflowBindingStore;

  beforeEach(() => {
    db = new StandaloneDatabase(':memory:');
    db.exec(SCHEMA);
    store = new AiStudioWorkflowBindingStore(db as unknown as SqliteDatabase);
  });

  it('returns null before any binding exists', () => {
    expect(store.get(SUBJECT, CONVERSATION)).toBeNull();
  });

  it('creates the first binding at row revision 1', () => {
    const record = store.commit(SUBJECT, CONVERSATION, input(), 0);
    expect(record.row_revision).toBe(1);
    expect(record.session_id).toBe('studio-1');
    expect(record.workflow_revision).toBe(1);
  });

  it('advances row revision on each successful commit', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    const second = store.commit(
      SUBJECT, CONVERSATION, input({ workflow_revision: 2, rules_hash: 'hash-2' }), 1,
    );
    expect(second.row_revision).toBe(2);
    expect(second.workflow_revision).toBe(2);
    expect(second.rules_hash).toBe('hash-2');
  });

  it('refuses a stale writer instead of clobbering newer state', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    store.commit(SUBJECT, CONVERSATION, input({ workflow_revision: 2 }), 1);

    // A concurrent writer that still believes row revision 1 is current.
    expect(() => store.commit(
      SUBJECT, CONVERSATION, input({ workflow_revision: 3 }), 1,
    )).toThrow(UserDataConflictError);

    // The newer state survived untouched.
    expect(store.get(SUBJECT, CONVERSATION)!.workflow_revision).toBe(2);
  });

  it('refuses an insert that expects an existing row', () => {
    expect(() => store.commit(SUBJECT, CONVERSATION, input(), 3))
      .toThrow(UserDataConflictError);
  });

  it('reports both the expected and the actual row revision on conflict', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    try {
      store.commit(SUBJECT, CONVERSATION, input(), 0);
      expect.unreachable('expected a compare-and-swap conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(UserDataConflictError);
      const conflict = error as UserDataConflictError;
      expect(conflict.expectedRowRevision).toBe(0);
      expect(conflict.actualRowRevision).toBe(1);
    }
  });

  it('rejects an empty subject id', () => {
    expect(() => store.commit('   ', CONVERSATION, input(), 0)).toThrow();
  });

  it('round-trips a null rule object', () => {
    const record = store.commit(
      SUBJECT, CONVERSATION, input({ strategy_rules_json: null }), 0,
    );
    expect(record.strategy_rules_json).toBeNull();
  });

  it('persists generated-artifact identity once code exists', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    const record = store.commit(SUBJECT, CONVERSATION, input({
      workflow_revision: 2,
      generated_artifact_hash: 'artifact-hash',
      generated_class_name: 'LarryWilliams',
    }), 1);
    expect(record.generated_artifact_hash).toBe('artifact-hash');
    expect(record.generated_class_name).toBe('LarryWilliams');
  });

  it('rejects a workflow revision below the contract minimum', () => {
    expect(() => store.commit(SUBJECT, CONVERSATION, input({ workflow_revision: 0 }), 0))
      .toThrow();
  });

  it('rejects non-JSON rule and action payloads at the schema boundary', () => {
    expect(() => store.commit(
      SUBJECT, CONVERSATION, input({ strategy_rules_json: 'not json' }), 0,
    )).toThrow();
    expect(() => store.commit(
      SUBJECT, CONVERSATION, input({ available_actions_json: 'not json' }), 0,
    )).toThrow();
  });
});

describe('excludes_secrets_and_cascades_conversation_deletion', () => {
  let db: Database.Database;
  let store: AiStudioWorkflowBindingStore;

  beforeEach(() => {
    db = new StandaloneDatabase(':memory:');
    db.exec(SCHEMA);
    store = new AiStudioWorkflowBindingStore(db as unknown as SqliteDatabase);
  });

  it('has no column able to hold a credential, bearer, or transcript (AC7)', () => {
    const columns = (db.prepare(
      "SELECT name FROM pragma_table_info('ai_studio_workflow_binding')",
    ).all() as Array<{ name: string }>).map((row) => row.name);

    // The bound is structural: a forbidden value has nowhere to be written.
    expect(columns).toEqual([
      'subject_id',
      'conversation_id',
      'session_id',
      'workflow_revision',
      'rules_hash',
      'strategy_rules_json',
      'available_actions_json',
      'expires_at',
      'generated_artifact_hash',
      'generated_class_name',
      'row_revision',
      'created_at',
      'updated_at',
    ]);
    for (const forbidden of ['api_key', 'bearer', 'token', 'credential', 'messages', 'reasoning']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('isolates bindings across subjects sharing a conversation id', () => {
    store.commit(SUBJECT, CONVERSATION, input({ session_id: 'studio-a' }), 0);
    store.commit(OTHER_SUBJECT, CONVERSATION, input({ session_id: 'studio-b' }), 0);

    expect(store.get(SUBJECT, CONVERSATION)!.session_id).toBe('studio-a');
    expect(store.get(OTHER_SUBJECT, CONVERSATION)!.session_id).toBe('studio-b');
  });

  it('isolates bindings across conversations for one subject', () => {
    store.commit(SUBJECT, '1', input({ session_id: 'studio-1' }), 0);
    store.commit(SUBJECT, '2', input({ session_id: 'studio-2' }), 0);

    expect(store.get(SUBJECT, '1')!.session_id).toBe('studio-1');
    expect(store.get(SUBJECT, '2')!.session_id).toBe('studio-2');
  });

  it('retires a single binding on explicit reset or strategy switch', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    store.delete(SUBJECT, CONVERSATION);
    expect(store.get(SUBJECT, CONVERSATION)).toBeNull();
  });

  it('deleting one subject binding leaves another subject untouched', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    store.commit(OTHER_SUBJECT, CONVERSATION, input(), 0);
    store.delete(SUBJECT, CONVERSATION);

    expect(store.get(SUBJECT, CONVERSATION)).toBeNull();
    expect(store.get(OTHER_SUBJECT, CONVERSATION)).not.toBeNull();
  });

  it('cascades conversation deletion across every owning subject', () => {
    store.commit(SUBJECT, CONVERSATION, input(), 0);
    store.commit(OTHER_SUBJECT, CONVERSATION, input(), 0);
    store.commit(SUBJECT, '999', input(), 0);

    expect(store.deleteForConversation(CONVERSATION)).toBe(2);
    expect(store.get(SUBJECT, CONVERSATION)).toBeNull();
    expect(store.get(OTHER_SUBJECT, CONVERSATION)).toBeNull();
    // A different conversation is unaffected.
    expect(store.get(SUBJECT, '999')).not.toBeNull();
  });

  it('cascade on an unknown conversation removes nothing and does not throw', () => {
    expect(store.deleteForConversation('does-not-exist')).toBe(0);
  });

  it('allows a fresh start after a reset (AC5 explicit new binding)', () => {
    store.commit(SUBJECT, CONVERSATION, input({ session_id: 'studio-old' }), 0);
    store.delete(SUBJECT, CONVERSATION);
    const fresh = store.commit(SUBJECT, CONVERSATION, input({ session_id: 'studio-new' }), 0);
    expect(fresh.session_id).toBe('studio-new');
    expect(fresh.row_revision).toBe(1);
  });
});
