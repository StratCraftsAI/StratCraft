/**
 * Conversation API
 *
 * TICKET_1235_8: HTTP API endpoints for AI conversation persistence.
 * Bridges MCP HTTP requests into ConversationService (same DB service
 * used by the conversation IPC handlers).
 */

import { appLog } from '../../utils/logger';
import { getDatabaseManager } from '../../database/db-manager';
import { ConversationService } from '../../database/services/conversation-service';
import { getMainProcessUserId } from '../../utils/auth-utils';
import { IPC_LIST_QUERY_DEFAULT_LIMIT } from '../../../shared/constants/timing';

type ApiResult = { success: boolean; data?: unknown; error?: string };

function getService(): ConversationService {
  return new ConversationService(getDatabaseManager());
}

export async function listConversations(
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const limit = typeof body.limit === 'number' ? body.limit : IPC_LIST_QUERY_DEFAULT_LIMIT;
  const offset = typeof body.offset === 'number' ? body.offset : 0;

  // Conversations are stored per authenticated user id (AI Strategy Studio
  // passes auth:getUser id to conversation:create/list), so the MCP surface
  // must query the same key. Fail-fast when unauthenticated, mirroring the
  // renderer's AUTH_NOT_AUTHENTICATED behaviour.
  let userId: string;
  try {
    userId = getMainProcessUserId();
  } catch {
    return {
      success: false,
      error: 'Not authenticated: conversations are stored per user. Log in to the desktop app first.',
    };
  }

  try {
    const svc = getService();
    const conversations = await svc.listConversations(userId, { limit, offset });
    return { success: true, data: conversations };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1235_8] listConversations error: ${message}`);
    return { success: false, error: message };
  }
}

// ── TICKET_1237_1: conversation writes for the chat agent core ───────────────
// Bridge-only endpoints (NOT MCP tools -- TICKET_1237 non-goal): the agent
// session persists user/assistant turns through the same ConversationService
// the IPC handlers use, so history survives mode switches (invariant 7).

export async function createConversation(
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const title = typeof body.title === 'string' && body.title.trim().length > 0
    ? body.title
    : undefined;
  const preview = typeof body.preview === 'string' ? body.preview : undefined;

  let userId: string;
  try {
    userId = getMainProcessUserId();
  } catch {
    return {
      success: false,
      error: 'Not authenticated: conversations are stored per user. Log in to the desktop app first.',
    };
  }

  try {
    const svc = getService();
    const id = await svc.createConversation({ user_id: userId, title, preview });
    return { success: true, data: { id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1237_1] createConversation error: ${message}`);
    return { success: false, error: message };
  }
}

const MESSAGE_TYPES = ['user', 'assistant', 'system'] as const;
type MessageType = (typeof MESSAGE_TYPES)[number];

function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

export async function addMessage(
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const conversationId = typeof body.conversation_id === 'number' ? body.conversation_id : NaN;
  if (Number.isNaN(conversationId)) {
    return { success: false, error: 'conversation_id is required and must be a number' };
  }
  if (!isMessageType(body.type)) {
    return { success: false, error: `type is required and must be one of: ${MESSAGE_TYPES.join(', ')}` };
  }
  if (typeof body.content !== 'string') {
    return { success: false, error: 'content is required and must be a string' };
  }
  const metadata = typeof body.metadata === 'string' ? body.metadata : undefined;
  const tokenCount = typeof body.token_count === 'number' ? body.token_count : undefined;

  let userId: string;
  try {
    userId = getMainProcessUserId();
  } catch {
    return {
      success: false,
      error: 'Not authenticated: conversations are stored per user. Log in to the desktop app first.',
    };
  }

  try {
    const svc = getService();
    const existing = await svc.getConversation(userId, conversationId);
    if (!existing) {
      return { success: false, error: `Conversation ${conversationId} not found` };
    }
    const id = await svc.addMessage(userId, {
      conversation_id: conversationId,
      type: body.type,
      content: body.content,
      metadata,
      token_count: tokenCount,
    });
    return { success: true, data: { id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1237_1] addMessage error: ${message}`);
    return { success: false, error: message };
  }
}

export async function getConversation(
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const id = typeof body.id === 'number' ? body.id : NaN;
  if (Number.isNaN(id)) {
    return { success: false, error: 'id is required and must be a number' };
  }

  let userId: string;
  try {
    userId = getMainProcessUserId();
  } catch {
    return {
      success: false,
      error: 'Not authenticated: conversations are stored per user. Log in to the desktop app first.',
    };
  }

  try {
    const svc = getService();
    const conversation = await svc.getConversation(userId, id);
    if (!conversation) {
      return { success: false, error: `Conversation ${id} not found` };
    }
    const messages = await svc.getMessages(userId, id);
    return {
      success: true,
      data: { ...conversation, messages },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1235_8] getConversation error: ${message}`);
    return { success: false, error: message };
  }
}

export async function deleteConversation(
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const id = typeof body.id === 'number' ? body.id : NaN;
  const confirm = body.confirm === true;

  if (Number.isNaN(id)) {
    return { success: false, error: 'id is required and must be a number' };
  }
  if (!confirm) {
    return { success: false, error: 'delete_conversation requires confirm=true. This is a destructive operation that soft-deletes a conversation and its messages.' };
  }

  let userId: string;
  try {
    userId = getMainProcessUserId();
  } catch {
    return {
      success: false,
      error: 'Not authenticated: conversations are stored per user. Log in to the desktop app first.',
    };
  }

  try {
    const svc = getService();
    const existing = await svc.getConversation(userId, id);
    if (!existing) {
      return { success: false, error: `Conversation ${id} not found` };
    }
    await svc.deleteConversation(userId, id);
    return { success: true, data: { deleted: id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appLog.error(`[TICKET_1235_8] deleteConversation error: ${message}`);
    return { success: false, error: message };
  }
}
