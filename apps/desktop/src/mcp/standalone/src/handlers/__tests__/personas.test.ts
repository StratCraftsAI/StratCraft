/**
 * Unit tests for persona handler functions.
 * TICKET_992_7: Direct nona_server connection (no Electron bridge).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

import { NONA_TEST_BASE_URL } from '../../__tests__/test-endpoints';

const { mockResolveNonaServer, mockNonaClient } = vi.hoisted(() => ({
  mockResolveNonaServer: vi.fn(),
  mockNonaClient: {
    listPersonas: vi.fn(),
  },
}));

vi.mock('../../nona-server-config', () => ({
  resolveNonaServer: mockResolveNonaServer,
}));

vi.mock('../../nona-client', () => mockNonaClient);

import { handleListPersonas } from '../personas';

const mockNonaConfig = { baseUrl: NONA_TEST_BASE_URL, authToken: null };

function createMockDb(): Database.Database {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(),
      get: vi.fn(),
    })),
  } as unknown as Database.Database;
}

describe('handleListPersonas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveNonaServer.mockReturnValue(mockNonaConfig);
  });

  it('returns data from nona_server on success', async () => {
    const data = [
      { id: 'conservative', name: 'Conservative Trader', risk_profile: 'low' },
      { id: 'aggressive', name: 'Aggressive Trader', risk_profile: 'high' },
    ];
    mockNonaClient.listPersonas.mockResolvedValue({ success: true, data });

    const result = await handleListPersonas(createMockDb(), 'server-token');

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(data);
    expect(mockNonaClient.listPersonas).toHaveBeenCalledWith({
      ...mockNonaConfig,
      authToken: 'server-token',
    });
  });

  it('returns isError when nona_server returns failure', async () => {
    mockNonaClient.listPersonas.mockResolvedValue({ success: false, error: 'Backend unavailable' });

    const result = await handleListPersonas(createMockDb(), 'server-token');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Persona list failed');
    expect(result.content[0].text).toContain('Backend unavailable');
  });

  it('returns isError when nona_server throws exception', async () => {
    mockNonaClient.listPersonas.mockRejectedValue(new Error('Connection reset'));

    const result = await handleListPersonas(createMockDb(), 'server-token');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Persona list error');
    expect(result.content[0].text).toContain('Connection reset');
  });

  it('redacts the server bearer from endpoint errors and exceptions', async () => {
    mockNonaClient.listPersonas.mockResolvedValueOnce({
      success: false,
      error: 'Rejected server-token',
    });
    const failure = await handleListPersonas(createMockDb(), 'server-token');
    expect(failure.content[0].text).toContain('[REDACTED]');
    expect(failure.content[0].text).not.toContain('server-token');

    mockNonaClient.listPersonas.mockRejectedValueOnce(new Error('Leaked server-token'));
    const exception = await handleListPersonas(createMockDb(), 'server-token');
    expect(exception.content[0].text).toContain('[REDACTED]');
    expect(exception.content[0].text).not.toContain('server-token');
  });

  it('refuses missing bearer before making an anonymous request', async () => {
    const result = await handleListPersonas(createMockDb());

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual(expect.objectContaining({
      reason: 'server_bearer_required',
    }));
    expect(mockNonaClient.listPersonas).not.toHaveBeenCalled();
  });
});
