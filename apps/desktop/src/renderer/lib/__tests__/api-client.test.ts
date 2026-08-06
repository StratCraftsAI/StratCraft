/**
 * ApiClient Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests HTTP requests, token refresh, polling, error handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock window.electronAPI
vi.stubGlobal('window', {
  electronAPI: {
    auth: {
      getAccessToken: vi.fn(),
      refresh: vi.fn(),
    },
    log: vi.fn(),
  },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock AbortController
const mockAbort = vi.fn();
vi.stubGlobal('AbortController', class {
  signal = 'mock-signal';
  abort = mockAbort;
});

import { apiClient } from '../api-client';

// =============================================================================
// Tests
// =============================================================================

describe('ApiClient', () => {
  const mockGetAccessToken = window.electronAPI.auth!.getAccessToken as ReturnType<typeof vi.fn>;
  const mockRefresh = window.electronAPI.auth!.refresh as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetAccessToken.mockResolvedValue({ success: true, data: 'test-token' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // GET Requests
  // =========================================================================

  describe('get', () => {
    it('should make GET request with auth header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      });

      const result = await apiClient.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Client-Type': 'desktop',
            'Authorization': 'Bearer test-token',
          }),
        }),
      );
      expect(result).toEqual({ success: true, data: { id: 1 } });
    });

    it('should skip auth header when no token available', async () => {
      mockGetAccessToken.mockResolvedValue({ success: false });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true }),
      });

      await apiClient.get('/test');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['Authorization']).toBeUndefined();
    });
  });

  // =========================================================================
  // POST Requests
  // =========================================================================

  describe('post', () => {
    it('should make POST request with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true }),
      });

      await apiClient.post('/submit', { name: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/submit'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        }),
      );
    });

    it('should make POST without body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true }),
      });

      await apiClient.post('/action');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/action'),
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        }),
      );
    });
  });

  // =========================================================================
  // PUT / DELETE
  // =========================================================================

  describe('put', () => {
    it('should make PUT request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true }),
      });

      await apiClient.put('/items/1', { name: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/items/1'),
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  describe('delete', () => {
    it('should make DELETE request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true }),
      });

      await apiClient.delete('/items/1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/items/1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // =========================================================================
  // 401 Token Refresh
  // =========================================================================

  describe('401 token refresh (TICKET_165)', () => {
    it('should retry after successful token refresh', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ success: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ success: true, data: 'refreshed' }),
        });

      mockRefresh.mockResolvedValue({ success: true });

      const result = await apiClient.get('/protected');

      expect(mockRefresh).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, data: 'refreshed' });
    });

    it('should return 401 response when refresh fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ success: false, error: 'unauthorized' }),
      });

      mockRefresh.mockResolvedValue({ success: false });

      const result = await apiClient.get('/protected');

      expect(result).toEqual({ success: false, error: 'unauthorized' });
    });
  });

  // =========================================================================
  // Network Errors
  // =========================================================================

  describe('error handling', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      const result = await apiClient.get('/failing');

      expect(result.success).toBe(false);
    });

    it('should handle AbortError (timeout)', async () => {
      const abortError = new Error('Timeout');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await apiClient.get('/slow');

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Health Check
  // =========================================================================

  describe('health', () => {
    it('should return true for healthy status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: true, status: 'healthy' }),
      });

      const healthy = await apiClient.health();
      expect(healthy).toBe(true);
    });

    it('should return false for unhealthy status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ success: false }),
      });

      const healthy = await apiClient.health();
      expect(healthy).toBe(false);
    });
  });
});
