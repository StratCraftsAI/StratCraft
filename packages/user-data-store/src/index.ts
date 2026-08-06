import {
  PROVIDER_ALPACA,
  PROVIDER_ALPHA_VANTAGE,
  PROVIDER_POLYGON,
} from '@StratCraft/types';

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  transaction<T>(fn: () => T): () => T;
}

export interface ConversationRecord {
  id: number;
  user_id: string;
  title: string;
  preview: string | null;
  message_count: number;
  token_usage: number;
  token_limit: number;
  strategy_rules: string | null;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface MessageRecord {
  id: number;
  conversation_id: number;
  type: 'user' | 'assistant' | 'system';
  content: string;
  token_count: number;
  metadata: string | null;
  created_at: string;
}

export interface ConversationCreateInput {
  title?: string;
  preview?: string;
  token_limit?: number;
  strategy_rules?: string;
}

export interface ConversationUpdateInput {
  title?: string;
  preview?: string | null;
  message_count?: number;
  token_usage?: number;
  token_limit?: number;
  strategy_rules?: string | null;
  status?: 'active' | 'archived' | 'deleted';
}

export interface MessageCreateInput {
  conversation_id: number;
  type: 'user' | 'assistant' | 'system';
  content: string;
  token_count?: number;
  metadata?: string | null;
}

export class UserDataNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserDataNotFoundError';
  }
}

export class UserDataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserDataValidationError';
  }
}

function requireUserId(userId: string): void {
  if (userId.trim().length === 0) {
    throw new UserDataValidationError('userId must be a non-empty string');
  }
}

function toIntegerId(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export class ConversationStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(userId: string, input: ConversationCreateInput = {}): ConversationRecord {
    requireUserId(userId);
    return this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO nona_ai_conversations
          (user_id, title, preview, token_limit, strategy_rules)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId,
        input.title?.trim() || 'New Strategy',
        input.preview ?? null,
        input.token_limit ?? 128000,
        input.strategy_rules ?? null,
      );
      return this.getOwnedOrThrow(userId, toIntegerId(result.lastInsertRowid));
    })();
  }

  get(userId: string, id: number): ConversationRecord | null {
    requireUserId(userId);
    return (this.db.prepare(`
      SELECT * FROM nona_ai_conversations
      WHERE id = ? AND user_id = ? AND status != 'deleted'
    `).get(id, userId) as ConversationRecord | undefined) ?? null;
  }

  getWithMessages(
    userId: string,
    id: number,
  ): (ConversationRecord & { messages: MessageRecord[] }) | null {
    const conversation = this.get(userId, id);
    if (!conversation) return null;
    const messages = this.db.prepare(`
      SELECT * FROM nona_ai_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(id) as MessageRecord[];
    return { ...conversation, messages };
  }

  list(
    userId: string,
    options: { limit: number; offset: number; status?: 'active' | 'archived' },
  ): ConversationRecord[] {
    requireUserId(userId);
    const statusClause = options.status ? ' AND status = @status' : '';
    return this.db.prepare(`
      SELECT * FROM nona_ai_conversations
      WHERE user_id = @userId AND status != 'deleted'${statusClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT @limit OFFSET @offset
    `).all({
      userId,
      status: options.status,
      limit: options.limit,
      offset: options.offset,
    }) as ConversationRecord[];
  }

  update(
    userId: string,
    id: number,
    input: ConversationUpdateInput,
  ): ConversationRecord {
    requireUserId(userId);
    const entries = Object.entries(input).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return this.getOwnedOrThrow(userId, id);
    }
    const allowed = new Set([
      'title',
      'preview',
      'message_count',
      'token_usage',
      'token_limit',
      'strategy_rules',
      'status',
    ]);
    if (entries.some(([key]) => !allowed.has(key))) {
      throw new UserDataValidationError('Conversation update contains an unsupported field');
    }
    return this.db.transaction(() => {
      this.getOwnedOrThrow(userId, id);
      const setters = entries.map(([key]) => `${key} = @${key}`).join(', ');
      this.db.prepare(`
        UPDATE nona_ai_conversations
        SET ${setters}, updated_at = datetime('now')
        WHERE id = @id AND user_id = @userId AND status != 'deleted'
      `).run({ id, userId, ...input });
      return this.getOwnedOrThrow(userId, id);
    })();
  }

  search(userId: string, query: string, limit: number): ConversationRecord[] {
    requireUserId(userId);
    if (query.trim().length === 0) {
      throw new UserDataValidationError('query must be a non-empty string');
    }
    return this.db.prepare(`
      SELECT DISTINCT c.* FROM nona_ai_conversations c
      LEFT JOIN nona_ai_messages m ON m.conversation_id = c.id
      WHERE c.user_id = @userId
        AND c.status != 'deleted'
        AND (c.title LIKE @pattern ESCAPE '\\' OR m.content LIKE @pattern ESCAPE '\\')
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT @limit
    `).all({
      userId,
      pattern: `%${query.replace(/[\\%_]/g, '\\$&')}%`,
      limit,
    }) as ConversationRecord[];
  }

  softDelete(userId: string, id: number): void {
    requireUserId(userId);
    const result = this.db.prepare(`
      UPDATE nona_ai_conversations
      SET status = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status != 'deleted'
    `).run(id, userId);
    if (result.changes !== 1) {
      throw new UserDataNotFoundError(`Conversation ${id} not found`);
    }
  }

  addMessage(
    userId: string,
    input: MessageCreateInput,
  ): { message: MessageRecord; conversation: ConversationRecord } {
    requireUserId(userId);
    return this.db.transaction(() => {
      this.getOwnedOrThrow(userId, input.conversation_id);
      const tokenCount = input.token_count ?? 0;
      const result = this.db.prepare(`
        INSERT INTO nona_ai_messages
          (conversation_id, type, content, token_count, metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        input.conversation_id,
        input.type,
        input.content,
        tokenCount,
        input.metadata ?? null,
      );
      const messageId = toIntegerId(result.lastInsertRowid);
      this.db.prepare(`
        UPDATE nona_ai_conversations
        SET message_count = message_count + 1,
            token_usage = token_usage + ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(tokenCount, input.conversation_id, userId);
      const message = this.db.prepare(
        'SELECT * FROM nona_ai_messages WHERE id = ?',
      ).get(messageId) as MessageRecord;
      return {
        message,
        conversation: this.getOwnedOrThrow(userId, input.conversation_id),
      };
    })();
  }

  deleteMessage(userId: string, messageId: number): { conversation: ConversationRecord } {
    requireUserId(userId);
    return this.db.transaction(() => {
      const message = this.db.prepare(`
        SELECT m.* FROM nona_ai_messages m
        JOIN nona_ai_conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND c.user_id = ? AND c.status != 'deleted'
      `).get(messageId, userId) as MessageRecord | undefined;
      if (!message) {
        throw new UserDataNotFoundError(`Message ${messageId} not found`);
      }
      this.db.prepare('DELETE FROM nona_ai_messages WHERE id = ?').run(messageId);
      this.db.prepare(`
        UPDATE nona_ai_conversations
        SET message_count = MAX(0, message_count - 1),
            token_usage = MAX(0, token_usage - ?),
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(message.token_count, message.conversation_id, userId);
      return { conversation: this.getOwnedOrThrow(userId, message.conversation_id) };
    })();
  }

  private getOwnedOrThrow(userId: string, id: number): ConversationRecord {
    const conversation = this.get(userId, id);
    if (!conversation) {
      throw new UserDataNotFoundError(`Conversation ${id} not found`);
    }
    return conversation;
  }
}

// ===========================================================================
// TICKET_1317: durable AI Studio workflow binding
// ===========================================================================

/**
 * One conversation's binding to a backend AI Studio workflow snapshot.
 *
 * Persisted fields are exactly the validated snapshot mirror needed for
 * deterministic dispatch. AC7 forbids storing provider credentials, bearers,
 * raw provider-native messages, arbitrary tool arguments/results, absolute
 * credential paths, or hidden reasoning -- none of those have a column here,
 * so the schema itself enforces the bound rather than a runtime filter.
 */
export interface AiStudioWorkflowBindingRecord {
  subject_id: string;
  conversation_id: string;
  session_id: string;
  workflow_revision: number;
  rules_hash: string;
  strategy_rules_json: string | null;
  available_actions_json: string;
  expires_at: number;
  generated_artifact_hash: string | null;
  generated_class_name: string | null;
  row_revision: number;
  created_at: number;
  updated_at: number;
}

export interface AiStudioWorkflowBindingInput {
  session_id: string;
  workflow_revision: number;
  rules_hash: string;
  strategy_rules_json: string | null;
  available_actions_json: string;
  expires_at: number;
  generated_artifact_hash: string | null;
  generated_class_name: string | null;
}

/**
 * Raised when a compare-and-swap write loses to a concurrent writer.
 *
 * TICKET_1317 section 6.2: a stale writer must receive an explicit conflict
 * and reload -- it must never overwrite a newer snapshot.
 */
export class UserDataConflictError extends Error {
  constructor(
    message: string,
    readonly expectedRowRevision: number,
    readonly actualRowRevision: number | null,
  ) {
    super(message);
    this.name = 'UserDataConflictError';
  }
}

export class AiStudioWorkflowBindingStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(subjectId: string, conversationId: string): AiStudioWorkflowBindingRecord | null {
    requireUserId(subjectId);
    return (this.db.prepare(`
      SELECT * FROM ai_studio_workflow_binding
      WHERE subject_id = ? AND conversation_id = ?
    `).get(subjectId, conversationId) as AiStudioWorkflowBindingRecord | undefined) ?? null;
  }

  /**
   * Compare-and-swap commit.
   *
   * `expectedRowRevision` is the row revision the caller read. 0 means "no row
   * yet". A mismatch means another writer committed in between, so this write
   * is refused rather than silently clobbering the newer state.
   */
  commit(
    subjectId: string,
    conversationId: string,
    input: AiStudioWorkflowBindingInput,
    expectedRowRevision: number,
  ): AiStudioWorkflowBindingRecord {
    requireUserId(subjectId);
    return this.db.transaction(() => {
      const existing = this.get(subjectId, conversationId);
      const actual = existing?.row_revision ?? 0;
      if (actual !== expectedRowRevision) {
        throw new UserDataConflictError(
          `AI Studio workflow binding for conversation ${conversationId} changed `
          + `concurrently (expected row revision ${expectedRowRevision}, found ${actual}). `
          + 'Reload the current snapshot and retry.',
          expectedRowRevision,
          existing ? existing.row_revision : null,
        );
      }

      const now = Date.now();
      const nextRowRevision = actual + 1;

      if (existing) {
        this.db.prepare(`
          UPDATE ai_studio_workflow_binding
          SET session_id = @session_id,
              workflow_revision = @workflow_revision,
              rules_hash = @rules_hash,
              strategy_rules_json = @strategy_rules_json,
              available_actions_json = @available_actions_json,
              expires_at = @expires_at,
              generated_artifact_hash = @generated_artifact_hash,
              generated_class_name = @generated_class_name,
              row_revision = @row_revision,
              updated_at = @updated_at
          WHERE subject_id = @subject_id
            AND conversation_id = @conversation_id
            AND row_revision = @expected_row_revision
        `).run({
          ...input,
          subject_id: subjectId,
          conversation_id: conversationId,
          row_revision: nextRowRevision,
          expected_row_revision: actual,
          updated_at: now,
        });
      } else {
        this.db.prepare(`
          INSERT INTO ai_studio_workflow_binding
            (subject_id, conversation_id, session_id, workflow_revision, rules_hash,
             strategy_rules_json, available_actions_json, expires_at,
             generated_artifact_hash, generated_class_name, row_revision,
             created_at, updated_at)
          VALUES
            (@subject_id, @conversation_id, @session_id, @workflow_revision, @rules_hash,
             @strategy_rules_json, @available_actions_json, @expires_at,
             @generated_artifact_hash, @generated_class_name, @row_revision,
             @created_at, @updated_at)
        `).run({
          ...input,
          subject_id: subjectId,
          conversation_id: conversationId,
          row_revision: nextRowRevision,
          created_at: now,
          updated_at: now,
        });
      }

      const committed = this.get(subjectId, conversationId);
      if (!committed) {
        throw new UserDataNotFoundError(
          `AI Studio workflow binding for conversation ${conversationId} vanished during commit`,
        );
      }
      return committed;
    })();
  }

  /** Retire a binding (explicit reset, strategy switch, or logout deny). */
  delete(subjectId: string, conversationId: string): void {
    requireUserId(subjectId);
    this.db.prepare(`
      DELETE FROM ai_studio_workflow_binding
      WHERE subject_id = ? AND conversation_id = ?
    `).run(subjectId, conversationId);
  }

  /**
   * Cascade for conversation deletion.
   *
   * `nona_ai_conversations.id` is an INTEGER while the binding stores the
   * Guide conversation id as TEXT (admission renders it as a string), so the
   * cascade is explicit here rather than a SQL foreign key.
   */
  deleteForConversation(conversationId: string): number {
    const result = this.db.prepare(`
      DELETE FROM ai_studio_workflow_binding WHERE conversation_id = ?
    `).run(conversationId);
    return result.changes;
  }
}

export const SUPPORTED_DEFAULT_DOMAINS = ['us_equity'] as const;
export type DefaultDomain = (typeof SUPPORTED_DEFAULT_DOMAINS)[number];
export type DataProviderDefaults = Partial<Record<DefaultDomain, string>>;

const DOMAIN_PROVIDER_ALLOWLIST: Record<DefaultDomain, readonly string[]> = {
  us_equity: [PROVIDER_ALPACA, PROVIDER_ALPHA_VANTAGE, PROVIDER_POLYGON],
};

export class DataProviderDefaultsStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(): DataProviderDefaults {
    const rows = this.db.prepare(
      'SELECT domain, provider_id FROM data_provider_defaults ORDER BY domain',
    ).all() as Array<{ domain: string; provider_id: string }>;
    const result: DataProviderDefaults = {};
    for (const row of rows) {
      if (
        this.isSupportedDomain(row.domain)
        && DOMAIN_PROVIDER_ALLOWLIST[row.domain].includes(row.provider_id)
      ) {
        result[row.domain] = row.provider_id;
      }
    }
    return result;
  }

  set(domain: string, providerId: string | null): DataProviderDefaults {
    if (!this.isSupportedDomain(domain)) {
      throw new UserDataValidationError(`Unsupported domain '${domain}'`);
    }
    if (
      providerId !== null
      && !DOMAIN_PROVIDER_ALLOWLIST[domain].includes(providerId)
    ) {
      throw new UserDataValidationError(
        `Provider '${providerId}' is not a valid default for domain '${domain}'`,
      );
    }
    return this.db.transaction(() => {
      if (providerId === null) {
        this.db.prepare(
          'DELETE FROM data_provider_defaults WHERE domain = ?',
        ).run(domain);
      } else {
        this.db.prepare(`
          INSERT INTO data_provider_defaults (domain, provider_id, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(domain) DO UPDATE SET
            provider_id = excluded.provider_id,
            updated_at = excluded.updated_at
        `).run(domain, providerId);
      }
      return this.get();
    })();
  }

  private isSupportedDomain(domain: string): domain is DefaultDomain {
    return (SUPPORTED_DEFAULT_DOMAINS as readonly string[]).includes(domain);
  }
}

export interface StartupAuditRecord {
  id: number;
  session_id: string;
  migration_561_status: string | null;
  migration_561_dirs_copied: number;
  migration_561_files_copied: number;
  migration_561_files_skipped: number;
  migration_561_error: string | null;
  db_schema_version: number | null;
  db_migrations_applied: number;
  db_integrity_ok: number;
  db_recovery_attempted: number;
  plugins_discovered: number;
  plugins_loaded: number;
  plugins_failed: string | null;
  python_path: string | null;
  executor_available: number;
  node_version: string | null;
  electron_version: string | null;
  platform: string | null;
  startup_duration_ms: number | null;
  phase_durations: string | null;
  status: string;
  warnings: string | null;
  create_time: string;
}

export class StartupAuditStore {
  constructor(private readonly db: SqliteDatabase) {}

  getLatest(): StartupAuditRecord | null {
    return (this.db.prepare(`
      SELECT * FROM startup_audit
      ORDER BY create_time DESC, id DESC
      LIMIT 1
    `).get() as StartupAuditRecord | undefined) ?? null;
  }

  list(limit: number, offset: number): StartupAuditRecord[] {
    return this.db.prepare(`
      SELECT * FROM startup_audit
      ORDER BY create_time DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as StartupAuditRecord[];
  }
}
