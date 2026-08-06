/**
 * ConversationService - Service layer for AI Strategy Studio conversations
 *
 * Handles:
 * - Creating and managing conversation sessions
 * - Storing and retrieving chat messages
 * - Managing strategy rules associated with conversations
 *
 * Related:
 * - TICKET_077_19: AI Strategy Studio Components
 */

import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';
import {
  ConversationStore,
  type ConversationRecord,
  type ConversationCreateInput,
  type ConversationUpdateInput,
  type MessageRecord,
  type MessageCreateInput,
  type SqliteDatabase,
} from '@StratCraft/user-data-store';
import { IPC_LIST_QUERY_DEFAULT_LIMIT } from '../../../shared/constants/timing';

// ============================================================================
// Types
// ============================================================================

/**
 * Conversation record from database
 */
export type { ConversationRecord, MessageRecord };

/**
 * Data for creating a new conversation
 */
export interface ConversationInsertData {
  user_id: string;
  title?: string;
  preview?: string;
  token_limit?: number;
  strategy_rules?: string;
}

/**
 * Data for updating a conversation
 */
export type ConversationUpdateData = ConversationUpdateInput;

/**
 * Message record from database
 */
export type MessageInsertData = MessageCreateInput;

// ============================================================================
// ConversationService
// ============================================================================

export class ConversationService {
  private readonly store: ConversationStore;

  constructor(private db: DatabaseManager) {
    this.store = new ConversationStore(db as unknown as SqliteDatabase);
  }

  // --------------------------------------------------------------------------
  // Conversation Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new conversation
   */
  async createConversation(data: ConversationInsertData): Promise<number> {
    try {
      const { user_id, ...input } = data;
      const conversation = this.store.create(user_id, input as ConversationCreateInput);
      dbLog.debug(`[ConversationService] Created conversation with id: ${conversation.id}`);
      return conversation.id;
    } catch (error) {
      dbLog.error('[ConversationService] Failed to create conversation:', error);
      throw error;
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(userId: string, id: number): Promise<ConversationRecord | null> {
    try {
      return this.store.get(userId, id);
    } catch (error) {
      dbLog.error(`[ConversationService] Failed to get conversation ${id}:`, error);
      throw error;
    }
  }

  /**
   * List conversations for a user
   */
  async listConversations(
    userId: string,
    options?: { limit?: number; offset?: number; status?: string }
  ): Promise<ConversationRecord[]> {
    try {
      return this.store.list(userId, {
        limit: options?.limit ?? IPC_LIST_QUERY_DEFAULT_LIMIT,
        offset: options?.offset ?? 0,
        ...(options?.status === 'active' || options?.status === 'archived'
          ? { status: options.status }
          : {}),
      });
    } catch (error) {
      dbLog.error('[ConversationService] Failed to list conversations:', error);
      throw error;
    }
  }

  /**
   * Update a conversation
   */
  async updateConversation(userId: string, id: number, data: ConversationUpdateData): Promise<void> {
    try {
      this.store.update(userId, id, data);
      dbLog.debug(`[ConversationService] Updated conversation ${id}`);
    } catch (error) {
      dbLog.error(`[ConversationService] Failed to update conversation ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a conversation (soft delete)
   */
  async deleteConversation(userId: string, id: number): Promise<void> {
    try {
      this.store.softDelete(userId, id);
      dbLog.debug(`[ConversationService] Soft-deleted conversation ${id}`);
    } catch (error) {
      dbLog.error(`[ConversationService] Failed to delete conversation ${id}:`, error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Message Operations
  // --------------------------------------------------------------------------

  /**
   * Add a message to a conversation
   */
  async addMessage(userId: string, data: MessageInsertData): Promise<number> {
    try {
      const result = this.store.addMessage(userId, data);
      dbLog.debug(`[ConversationService] Added message ${result.message.id} to conversation ${data.conversation_id}`);
      return result.message.id;
    } catch (error) {
      dbLog.error('[ConversationService] Failed to add message:', error);
      throw error;
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    userId: string,
    conversationId: number,
    options?: { limit?: number; offset?: number }
  ): Promise<MessageRecord[]> {
    try {
      if (!this.store.get(userId, conversationId)) {
        return [];
      }
      let query = `
        SELECT * FROM nona_ai_messages
        WHERE conversation_id = @conversationId
        ORDER BY created_at ASC
      `;
      const params: Record<string, unknown> = { conversationId };

      if (options?.limit) {
        query += ` LIMIT @limit`;
        params.limit = options.limit;
      }

      if (options?.offset) {
        query += ` OFFSET @offset`;
        params.offset = options.offset;
      }

      const stmt = this.db.prepare(query);
      return stmt.all(params) as MessageRecord[];
    } catch (error) {
      dbLog.error(`[ConversationService] Failed to get messages for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(userId: string, messageId: number): Promise<void> {
    try {
      this.store.deleteMessage(userId, messageId);
      dbLog.debug(`[ConversationService] Deleted message ${messageId}`);
    } catch (error) {
      dbLog.error(`[ConversationService] Failed to delete message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Search conversations by content
   */
  async searchConversations(
    userId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<ConversationRecord[]> {
    try {
      return this.store.search(userId, query, options?.limit ?? 20);
    } catch (error) {
      dbLog.error('[ConversationService] Failed to search conversations:', error);
      throw error;
    }
  }
}
