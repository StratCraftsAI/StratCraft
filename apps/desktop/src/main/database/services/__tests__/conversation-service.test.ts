import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  addMessage: vi.fn(),
  deleteMessage: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@StratCraft/user-data-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@StratCraft/user-data-store')>();
  return {
    ...actual,
    ConversationStore: vi.fn(function MockConversationStore() {
      return store;
    }),
  };
});

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { ConversationService } from '../conversation-service';
import type { DatabaseManager } from '../../db-manager';

describe('ConversationService shared-store adapter', () => {
  let service: ConversationService;
  const db = {
    prepare: vi.fn(),
  } as unknown as DatabaseManager;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConversationService(db);
  });

  it('delegates conversation create, get, list, update, delete, and search with owner identity', async () => {
    store.create.mockReturnValue({ id: 7 });
    store.get.mockReturnValue({ id: 7, user_id: 'user-1' });
    store.list.mockReturnValue([{ id: 7 }]);
    store.update.mockReturnValue({ id: 7, title: 'Updated' });
    store.search.mockReturnValue([{ id: 7 }]);

    await expect(service.createConversation({
      user_id: 'user-1',
      title: 'Created',
    })).resolves.toBe(7);
    await expect(service.getConversation('user-1', 7))
      .resolves.toEqual({ id: 7, user_id: 'user-1' });
    await expect(service.listConversations('user-1', {
      limit: 10,
      offset: 2,
      status: 'archived',
    })).resolves.toEqual([{ id: 7 }]);
    await expect(service.updateConversation('user-1', 7, {
      title: 'Updated',
    })).resolves.toBeUndefined();
    await expect(service.deleteConversation('user-1', 7))
      .resolves.toBeUndefined();
    await expect(service.searchConversations('user-1', 'needle', { limit: 5 }))
      .resolves.toEqual([{ id: 7 }]);

    expect(store.create).toHaveBeenCalledWith('user-1', { title: 'Created' });
    expect(store.get).toHaveBeenCalledWith('user-1', 7);
    expect(store.list).toHaveBeenCalledWith('user-1', {
      limit: 10,
      offset: 2,
      status: 'archived',
    });
    expect(store.update).toHaveBeenCalledWith('user-1', 7, { title: 'Updated' });
    expect(store.softDelete).toHaveBeenCalledWith('user-1', 7);
    expect(store.search).toHaveBeenCalledWith('user-1', 'needle', 5);
  });

  it('delegates transactional message writes and owner-scoped reads', async () => {
    store.addMessage.mockReturnValue({ message: { id: 11 } });
    store.get.mockReturnValue({ id: 7 });
    const statement = {
      all: vi.fn().mockReturnValue([{ id: 11 }]),
    };
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(statement);

    await expect(service.addMessage('user-1', {
      conversation_id: 7,
      type: 'user',
      content: 'hello',
    })).resolves.toBe(11);
    await expect(service.getMessages('user-1', 7, {
      limit: 20,
      offset: 5,
    })).resolves.toEqual([{ id: 11 }]);
    await expect(service.deleteMessage('user-1', 11)).resolves.toBeUndefined();

    expect(store.addMessage).toHaveBeenCalledWith('user-1', {
      conversation_id: 7,
      type: 'user',
      content: 'hello',
    });
    expect(store.get).toHaveBeenCalledWith('user-1', 7);
    expect(store.deleteMessage).toHaveBeenCalledWith('user-1', 11);
    expect(statement.all).toHaveBeenCalledWith({
      conversationId: 7,
      limit: 20,
      offset: 5,
    });
  });

  it('does not return messages when the conversation is not owned', async () => {
    store.get.mockReturnValue(null);
    await expect(service.getMessages('user-2', 7)).resolves.toEqual([]);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('uses the default search limit', async () => {
    store.search.mockReturnValue([]);
    await service.searchConversations('user-1', 'query');
    expect(store.search).toHaveBeenCalledWith('user-1', 'query', 20);
  });

  it.each([
    ['create', () => service.createConversation({ user_id: 'user-1' })],
    ['get', () => service.getConversation('user-1', 1)],
    ['list', () => service.listConversations('user-1')],
    ['update', () => service.updateConversation('user-1', 1, { title: 'x' })],
    ['softDelete', () => service.deleteConversation('user-1', 1)],
    ['addMessage', () => service.addMessage('user-1', {
      conversation_id: 1,
      type: 'user',
      content: 'x',
    })],
    ['deleteMessage', () => service.deleteMessage('user-1', 1)],
    ['search', () => service.searchConversations('user-1', 'x')],
  ] as const)('propagates %s store failures', async (method, operation) => {
    store[method].mockImplementationOnce(() => {
      throw new Error(`${method} failed`);
    });
    await expect(operation()).rejects.toThrow(`${method} failed`);
  });
});
