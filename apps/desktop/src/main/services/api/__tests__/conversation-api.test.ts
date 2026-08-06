/**
 * Unit tests for conversation-api.ts
 * TICKET_1235_8 / TICKET_494: per-user conversation list/read/delete over
 * ConversationService -- all branches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockListConversations, mockGetConversation, mockGetMessages, mockDeleteConversation,
  mockCreateConversation, mockAddMessage,
  mockServiceCtor,
  mockGetMainProcessUserId, mockGetDatabaseManager,
  mockLogError,
} = vi.hoisted(() => {
  const mockListConversations = vi.fn();
  const mockGetConversation = vi.fn();
  const mockGetMessages = vi.fn();
  const mockDeleteConversation = vi.fn();
  const mockCreateConversation = vi.fn();
  const mockAddMessage = vi.fn();
  return {
    mockListConversations,
    mockGetConversation,
    mockGetMessages,
    mockDeleteConversation,
    mockCreateConversation,
    mockAddMessage,
    mockServiceCtor: vi.fn(() => ({
      listConversations: mockListConversations,
      getConversation: mockGetConversation,
      getMessages: mockGetMessages,
      deleteConversation: mockDeleteConversation,
      createConversation: mockCreateConversation,
      addMessage: mockAddMessage,
    })),
    mockGetMainProcessUserId: vi.fn(),
    mockGetDatabaseManager: vi.fn(),
    mockLogError: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger', () => ({
  appLog: { error: mockLogError, info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../database/db-manager', () => ({
  getDatabaseManager: mockGetDatabaseManager,
}));

vi.mock('../../../database/services/conversation-service', () => ({
  ConversationService: mockServiceCtor,
}));

vi.mock('../../../utils/auth-utils', () => ({
  getMainProcessUserId: mockGetMainProcessUserId,
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import {
  listConversations,
  getConversation,
  deleteConversation,
  createConversation,
  addMessage,
} from '../conversation-api';

import { IPC_LIST_QUERY_DEFAULT_LIMIT } from '../../../../shared/constants/timing';

// =============================================================================
// listConversations
// =============================================================================

describe('listConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMainProcessUserId.mockReturnValue('user-42');
  });

  it('fails fast when unauthenticated and never touches the service', async () => {
    mockGetMainProcessUserId.mockImplementation(() => {
      throw new Error('User not authenticated');
    });

    const result = await listConversations({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not authenticated');
    expect(mockServiceCtor).not.toHaveBeenCalled();
    expect(mockListConversations).not.toHaveBeenCalled();
  });

  it('queries the authenticated user id with default limit/offset', async () => {
    const rows = [{ id: 1, title: 'First' }];
    mockListConversations.mockResolvedValue(rows);
    const dbSentinel = { db: true };
    mockGetDatabaseManager.mockReturnValue(dbSentinel);

    const result = await listConversations({});
    expect(result.success).toBe(true);
    expect(result.data).toBe(rows);
    // Service constructed over the real DatabaseManager instance
    expect(mockServiceCtor).toHaveBeenCalledWith(dbSentinel);
    expect(mockListConversations).toHaveBeenCalledWith('user-42', {
      limit: IPC_LIST_QUERY_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it('passes explicit numeric limit/offset through', async () => {
    mockListConversations.mockResolvedValue([]);

    const result = await listConversations({ limit: 10, offset: 5 });
    expect(result.success).toBe(true);
    expect(mockListConversations).toHaveBeenCalledWith('user-42', { limit: 10, offset: 5 });
  });

  it('falls back to defaults when limit/offset are not numbers', async () => {
    mockListConversations.mockResolvedValue([]);

    await listConversations({ limit: '10', offset: '5' });
    expect(mockListConversations).toHaveBeenCalledWith('user-42', {
      limit: IPC_LIST_QUERY_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it('returns {success:false, error} when the service throws', async () => {
    mockListConversations.mockRejectedValue(new Error('db locked'));

    const result = await listConversations({});
    expect(result.success).toBe(false);
    expect(result.error).toBe('db locked');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('listConversations error: db locked'),
    );
  });
});

// =============================================================================
// getConversation
// =============================================================================

describe('getConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMainProcessUserId.mockReturnValue('user-42');
  });

  it('rejects a missing id', async () => {
    const result = await getConversation({});
    expect(result.success).toBe(false);
    expect(result.error).toBe('id is required and must be a number');
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id', async () => {
    const result = await getConversation({ id: '7' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('id is required and must be a number');
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  it('reports not-found without fetching messages', async () => {
    mockGetConversation.mockResolvedValue(null);

    const result = await getConversation({ id: 7 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Conversation 7 not found');
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  it('returns the conversation merged with its messages', async () => {
    const conversation = { id: 7, title: 'Strategy chat' };
    const messages = [{ id: 100, role: 'user', content: 'hi' }];
    mockGetConversation.mockResolvedValue(conversation);
    mockGetMessages.mockResolvedValue(messages);

    const result = await getConversation({ id: 7 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 7, title: 'Strategy chat', messages });
    expect(mockGetConversation).toHaveBeenCalledWith('user-42', 7);
    expect(mockGetMessages).toHaveBeenCalledWith('user-42', 7);
  });

  it('returns {success:false, error} when the service throws', async () => {
    mockGetConversation.mockRejectedValue(new Error('read failed'));

    const result = await getConversation({ id: 7 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('read failed');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('getConversation error: read failed'),
    );
  });
});

// =============================================================================
// deleteConversation
// =============================================================================

describe('deleteConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMainProcessUserId.mockReturnValue('user-42');
  });

  it('rejects a missing id', async () => {
    const result = await deleteConversation({ confirm: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe('id is required and must be a number');
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('refuses without confirm=true and never touches the service', async () => {
    const result = await deleteConversation({ id: 7 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('confirm=true');
    expect(mockServiceCtor).not.toHaveBeenCalled();
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it("refuses a truthy non-boolean confirm (string 'true')", async () => {
    const result = await deleteConversation({ id: 7, confirm: 'true' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('confirm=true');
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('reports not-found without deleting', async () => {
    mockGetConversation.mockResolvedValue(null);

    const result = await deleteConversation({ id: 9, confirm: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Conversation 9 not found');
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it('soft-deletes an existing conversation and returns the deleted id', async () => {
    mockGetConversation.mockResolvedValue({ id: 9, title: 'Old chat' });
    mockDeleteConversation.mockResolvedValue(undefined);

    const result = await deleteConversation({ id: 9, confirm: true });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ deleted: 9 });
    expect(mockDeleteConversation).toHaveBeenCalledWith('user-42', 9);
  });

  it('returns {success:false, error} when the delete throws', async () => {
    mockGetConversation.mockResolvedValue({ id: 9 });
    mockDeleteConversation.mockRejectedValue(new Error('delete failed'));

    const result = await deleteConversation({ id: 9, confirm: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe('delete failed');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('deleteConversation error: delete failed'),
    );
  });
});

// =============================================================================
// TICKET_1237_1: createConversation
// =============================================================================

describe('createConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMainProcessUserId.mockReturnValue('user-42');
  });

  it('fails fast when unauthenticated and never touches the service', async () => {
    mockGetMainProcessUserId.mockImplementation(() => {
      throw new Error('User not authenticated');
    });

    const result = await createConversation({ title: 'Chat' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not authenticated');
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it('creates a conversation for the authenticated user and returns its id', async () => {
    mockCreateConversation.mockResolvedValue(31);

    const result = await createConversation({ title: 'Agent chat', preview: 'hello' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 31 });
    expect(mockCreateConversation).toHaveBeenCalledWith({
      user_id: 'user-42',
      title: 'Agent chat',
      preview: 'hello',
    });
  });

  it('treats an empty/whitespace title as unset', async () => {
    mockCreateConversation.mockResolvedValue(32);

    const result = await createConversation({ title: '   ' });
    expect(result.success).toBe(true);
    expect(mockCreateConversation).toHaveBeenCalledWith({
      user_id: 'user-42',
      title: undefined,
      preview: undefined,
    });
  });

  it('returns {success:false, error} when the service throws', async () => {
    mockCreateConversation.mockRejectedValue(new Error('insert failed'));

    const result = await createConversation({ title: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('insert failed');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('createConversation error: insert failed'),
    );
  });
});

// =============================================================================
// TICKET_1237_1: addMessage
// =============================================================================

describe('addMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMainProcessUserId.mockReturnValue('user-42');
  });

  it('rejects a missing conversation_id', async () => {
    const result = await addMessage({ type: 'user', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('conversation_id is required and must be a number');
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('rejects an invalid message type', async () => {
    const result = await addMessage({ conversation_id: 3, type: 'robot', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('type is required');
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('rejects missing content', async () => {
    const result = await addMessage({ conversation_id: 3, type: 'user' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('content is required and must be a string');
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('reports not-found without inserting', async () => {
    mockGetConversation.mockResolvedValue(null);

    const result = await addMessage({ conversation_id: 3, type: 'user', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Conversation 3 not found');
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it('inserts a message with metadata and token_count and returns its id', async () => {
    mockGetConversation.mockResolvedValue({ id: 3 });
    mockAddMessage.mockResolvedValue(77);

    const metadata = JSON.stringify({ mode: 'byok', turn_id: 't1', tool_call_count: 2, status: 'completed' });
    const result = await addMessage({
      conversation_id: 3,
      type: 'assistant',
      content: 'answer',
      metadata,
      token_count: 12,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 77 });
    expect(mockAddMessage).toHaveBeenCalledWith('user-42', {
      conversation_id: 3,
      type: 'assistant',
      content: 'answer',
      metadata,
      token_count: 12,
    });
  });

  it('omits non-string metadata and non-number token_count', async () => {
    mockGetConversation.mockResolvedValue({ id: 3 });
    mockAddMessage.mockResolvedValue(78);

    const result = await addMessage({
      conversation_id: 3,
      type: 'user',
      content: 'hi',
      metadata: { not: 'a-string' },
      token_count: 'many',
    });
    expect(result.success).toBe(true);
    expect(mockAddMessage).toHaveBeenCalledWith('user-42', {
      conversation_id: 3,
      type: 'user',
      content: 'hi',
      metadata: undefined,
      token_count: undefined,
    });
  });

  it('returns {success:false, error} when the insert throws', async () => {
    mockGetConversation.mockResolvedValue({ id: 3 });
    mockAddMessage.mockRejectedValue(new Error('insert failed'));

    const result = await addMessage({ conversation_id: 3, type: 'user', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('insert failed');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('addMessage error: insert failed'),
    );
  });
});
