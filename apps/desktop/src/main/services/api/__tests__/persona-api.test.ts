/**
 * Persona Service API Unit Tests
 *
 * TICKET_494: Full coverage for persona-api.ts
 * Covers listPersonas.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAuthenticatedJsonFetch } = vi.hoisted(() => ({
  mockAuthenticatedJsonFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/api-request', () => ({
  authenticatedJsonFetch: mockAuthenticatedJsonFetch,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { listPersonas } from '../persona-api';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persona-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPersonas', () => {
    it('returns personas on successful backend response', async () => {
      const personas = [
        {
          id: 'swing_trader',
          label: 'Swing Trader',
          description: {
            must_include: ['momentum'],
            regime_bias: ['trend'],
            holding_period: '2-10 days',
            risk_style: 'moderate',
            forbidden: ['scalping'],
          },
        },
      ];

      mockAuthenticatedJsonFetch.mockResolvedValue({
        success: true,
        personas,
        total: 1,
      });

      const result = await listPersonas();

      expect(result).toEqual({ success: true, data: personas });
      expect(mockAuthenticatedJsonFetch).toHaveBeenCalledWith(
        '/api/persona/list',
        { method: 'GET' },
      );
    });

    it('returns error when backend returns unsuccessful response', async () => {
      mockAuthenticatedJsonFetch.mockResolvedValue({
        success: false,
        personas: [],
        total: 0,
      });

      const result = await listPersonas();

      expect(result).toEqual({
        success: false,
        error: 'Backend returned unsuccessful response',
      });
    });

    it('returns error on network failure', async () => {
      mockAuthenticatedJsonFetch.mockRejectedValue(new Error('Network timeout'));

      const result = await listPersonas();

      expect(result).toEqual({ success: false, error: 'Network timeout' });
    });

    it('returns error on authentication failure', async () => {
      mockAuthenticatedJsonFetch.mockRejectedValue(new Error('Not authenticated'));

      const result = await listPersonas();

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
    });

    it('handles non-Error throws', async () => {
      mockAuthenticatedJsonFetch.mockRejectedValue('unexpected');

      const result = await listPersonas();

      expect(result).toEqual({ success: false, error: 'unexpected' });
    });

    it('returns empty personas array when backend has none', async () => {
      mockAuthenticatedJsonFetch.mockResolvedValue({
        success: true,
        personas: [],
        total: 0,
      });

      const result = await listPersonas();

      expect(result).toEqual({ success: true, data: [] });
    });
  });
});
