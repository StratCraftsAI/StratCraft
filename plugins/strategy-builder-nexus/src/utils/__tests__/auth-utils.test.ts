/**
 * Plugin Auth Utils Unit Tests
 *
 * TICKET_719: Auth-optional user ID for free strategy types.
 * TICKET_494: Full branch coverage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock window.electronAPI
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();

const mockElectronAPI = {
  auth: {
    getUser: mockGetUser,
  },
};

Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: mockElectronAPI },
  writable: true,
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { getCurrentUserId, getCurrentUserIdAsString, getCurrentUserIdOrLocal } from '../auth-utils';

// ---------------------------------------------------------------------------
// getCurrentUserId
// ---------------------------------------------------------------------------

describe('getCurrentUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = mockElectronAPI;
  });

  it('should return user id when authenticated', async () => {
    mockGetUser.mockResolvedValue({ success: true, data: { id: 'user-42' } });
    expect(await getCurrentUserId()).toBe('user-42');
  });

  it('should throw when auth API is not available', async () => {
    (window as any).electronAPI = { auth: undefined };
    await expect(getCurrentUserId()).rejects.toThrow('AUTH_API_UNAVAILABLE');
  });

  it('should throw when result is not successful', async () => {
    mockGetUser.mockResolvedValue({ success: false });
    await expect(getCurrentUserId()).rejects.toThrow('AUTH_NOT_AUTHENTICATED');
  });

  it('should throw when user data has no id', async () => {
    mockGetUser.mockResolvedValue({ success: true, data: {} });
    await expect(getCurrentUserId()).rejects.toThrow('AUTH_NOT_AUTHENTICATED');
  });

  it('should throw when result is null', async () => {
    mockGetUser.mockResolvedValue(null);
    await expect(getCurrentUserId()).rejects.toThrow('AUTH_NOT_AUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
// getCurrentUserIdAsString
// ---------------------------------------------------------------------------

describe('getCurrentUserIdAsString', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = mockElectronAPI;
  });

  it('should return user id as string when authenticated', async () => {
    mockGetUser.mockResolvedValue({ success: true, data: { id: 'user-99' } });
    const result = await getCurrentUserIdAsString();
    expect(result).toBe('user-99');
    expect(typeof result).toBe('string');
  });

  it('should throw when auth API is not available', async () => {
    (window as any).electronAPI = { auth: undefined };
    await expect(getCurrentUserIdAsString()).rejects.toThrow('AUTH_API_UNAVAILABLE');
  });

  it('should throw when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ success: false });
    await expect(getCurrentUserIdAsString()).rejects.toThrow('AUTH_NOT_AUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
// getCurrentUserIdOrLocal (TICKET_719)
// ---------------------------------------------------------------------------

describe('getCurrentUserIdOrLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = mockElectronAPI;
  });

  it('should return authenticated user id when present', async () => {
    mockGetUser.mockResolvedValue({ success: true, data: { id: 'user-77' } });
    expect(await getCurrentUserIdOrLocal()).toBe('user-77');
  });

  it('should return local when auth API is not available', async () => {
    (window as any).electronAPI = { auth: undefined };
    expect(await getCurrentUserIdOrLocal()).toBe('local');
  });

  it('should return local when result is not successful', async () => {
    mockGetUser.mockResolvedValue({ success: false });
    expect(await getCurrentUserIdOrLocal()).toBe('local');
  });

  it('should return local when user data has no id', async () => {
    mockGetUser.mockResolvedValue({ success: true, data: {} });
    expect(await getCurrentUserIdOrLocal()).toBe('local');
  });

  it('should return local when result is null', async () => {
    mockGetUser.mockResolvedValue(null);
    expect(await getCurrentUserIdOrLocal()).toBe('local');
  });

  it('should return local when user id is empty string', async () => {
    mockGetUser.mockResolvedValue({ success: true, data: { id: '' } });
    expect(await getCurrentUserIdOrLocal()).toBe('local');
  });
});
