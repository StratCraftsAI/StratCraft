/**
 * Conversation Service (TICKET_077_19)
 *
 * Client-side service for AI Strategy Studio conversation persistence.
 * Communicates with Main Process via IPC for SQLite operations.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// -----------------------------------------------------------------------------
// Logger
// -----------------------------------------------------------------------------

const log = {
  debug: (msg: string) => console.debug(`[ConversationService] ${msg}`),
  info: (msg: string) => console.info(`[ConversationService] ${msg}`),
  error: (msg: string, err?: unknown) => console.error(`[E:STRATEGY:CONVERSATION_SERVICE_ERROR] [ConversationService] ${msg}`, err),
};

// -----------------------------------------------------------------------------
// Conversation Service
// -----------------------------------------------------------------------------

class ConversationService {
  // ---------------------------------------------------------------------------
  // Conversation Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new conversation
   */
  async createConversation(data: {
    userId: string;
    title?: string;
    preview?: string;
    tokenLimit?: number;
    strategyRules?: string;
  }): Promise<ApiResult<ConversationRecord>> {
    try {
      log.debug(`Creating conversation for user ${data.userId}`);
      const result = await window.electronAPI.conversation.create({
        user_id: data.userId,
        title: data.title,
        preview: data.preview,
        token_limit: data.tokenLimit,
        strategy_rules: data.strategyRules,
      });
      if (result.success) {
        log.info(`Created conversation ${result.data?.id}`);
      }
      return result as ApiResult<ConversationRecord>;
    } catch (error) {
      log.error('Failed to create conversation', error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(id: number): Promise<ApiResult<ConversationRecord>> {
    try {
      log.debug(`Getting conversation ${id}`);
      const result = await window.electronAPI.conversation.get(id);
      return result as ApiResult<ConversationRecord>;
    } catch (error) {
      log.error(`Failed to get conversation ${id}`, error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * List conversations for a user
   */
  async listConversations(
    userId: string,
    options?: { limit?: number; offset?: number; status?: string }
  ): Promise<ApiResult<ConversationRecord[]>> {
    try {
      log.debug(`Listing conversations for user ${userId}`);
      const result = await window.electronAPI.conversation.list({
        userId,
        ...options,
      });
      if (result.success) {
        log.debug(`Found ${result.data?.length || 0} conversations`);
      }
      return result as ApiResult<ConversationRecord[]>;
    } catch (error) {
      log.error('Failed to list conversations', error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * Update a conversation
   */
  async updateConversation(
    id: number,
    data: {
      title?: string;
      preview?: string;
      messageCount?: number;
      tokenUsage?: number;
      tokenLimit?: number;
      strategyRules?: string;
      status?: 'active' | 'archived' | 'deleted';
    }
  ): Promise<ApiResult<ConversationRecord>> {
    try {
      log.debug(`Updating conversation ${id}`);
      const result = await window.electronAPI.conversation.update(id, {
        title: data.title,
        preview: data.preview,
        message_count: data.messageCount,
        token_usage: data.tokenUsage,
        token_limit: data.tokenLimit,
        strategy_rules: data.strategyRules,
        status: data.status,
      });
      if (result.success) {
        log.info(`Updated conversation ${id}`);
      }
      return result as ApiResult<ConversationRecord>;
    } catch (error) {
      log.error(`Failed to update conversation ${id}`, error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(id: number): Promise<ApiResult<null>> {
    try {
      log.debug(`Deleting conversation ${id}`);
      const result = await window.electronAPI.conversation.delete(id);
      if (result.success) {
        log.info(`Deleted conversation ${id}`);
      }
      return result as ApiResult<null>;
    } catch (error) {
      log.error(`Failed to delete conversation ${id}`, error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * Search conversations
   */
  async searchConversations(
    userId: string,
    query: string,
    limit?: number
  ): Promise<ApiResult<ConversationRecord[]>> {
    try {
      log.debug(`Searching conversations for "${query}"`);
      const result = await window.electronAPI.conversation.search(userId, query, limit);
      return result as ApiResult<ConversationRecord[]>;
    } catch (error) {
      log.error('Failed to search conversations', error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Message Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a message to a conversation
   */
  async addMessage(data: {
    conversationId: number;
    type: 'user' | 'assistant' | 'system';
    content: string;
    tokenCount?: number;
    metadata?: string;
  }): Promise<ApiResult<{ messageId: number; conversation: ConversationRecord }>> {
    try {
      log.debug(`Adding ${data.type} message to conversation ${data.conversationId}`);
      const result = await window.electronAPI.message.add({
        conversation_id: data.conversationId,
        type: data.type,
        content: data.content,
        token_count: data.tokenCount,
        metadata: data.metadata,
      });
      if (result.success) {
        log.debug(`Added message ${result.data?.messageId}`);
      }
      return result as ApiResult<{ messageId: number; conversation: ConversationRecord }>;
    } catch (error) {
      log.error('Failed to add message', error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * List messages for a conversation
   */
  async listMessages(
    conversationId: number,
    options?: { limit?: number; offset?: number }
  ): Promise<ApiResult<MessageRecord[]>> {
    try {
      log.debug(`Listing messages for conversation ${conversationId}`);
      const result = await window.electronAPI.message.list(conversationId, options);
      if (result.success) {
        log.debug(`Found ${result.data?.length || 0} messages`);
      }
      return result as ApiResult<MessageRecord[]>;
    } catch (error) {
      log.error(`Failed to list messages for conversation ${conversationId}`, error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: number): Promise<ApiResult<null>> {
    try {
      log.debug(`Deleting message ${messageId}`);
      const result = await window.electronAPI.message.delete(messageId);
      if (result.success) {
        log.info(`Deleted message ${messageId}`);
      }
      return result as ApiResult<null>;
    } catch (error) {
      log.error(`Failed to delete message ${messageId}`, error);
      return {
        success: false,
        error: { code: 'INTERNAL', message: String(error) },
      };
    }
  }
}

// -----------------------------------------------------------------------------
// Singleton Export
// -----------------------------------------------------------------------------

export const conversationService = new ConversationService();
