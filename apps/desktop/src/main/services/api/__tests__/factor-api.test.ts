/**
 * Factor Service API Unit Tests
 *
 * TICKET_494: Full coverage for factor-api.ts
 * Covers listFactors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockPrepare, mockAll } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockAll: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../database/db-manager', () => ({
  getDatabaseManager: () => ({
    prepare: mockPrepare,
  }),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { listFactors } from '../factor-api';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('factor-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll });
  });

  describe('listFactors', () => {
    it('returns factor rows on success', async () => {
      const rows = [
        { id: 1, factor_id: 'f1', name: 'Momentum', ic: 0.05, sharpe: 1.2 },
        { id: 2, factor_id: 'f2', name: 'Value', ic: 0.03, sharpe: 0.8 },
      ];
      mockAll.mockReturnValue(rows);

      const result = await listFactors(10);

      expect(result).toEqual({ success: true, data: rows });
      expect(mockAll).toHaveBeenCalledWith(10);
    });

    it('uses default limit of 50', async () => {
      mockAll.mockReturnValue([]);

      await listFactors();

      expect(mockAll).toHaveBeenCalledWith(50);
    });

    it('returns empty array when no factors exist', async () => {
      mockAll.mockReturnValue([]);

      const result = await listFactors();

      expect(result).toEqual({ success: true, data: [] });
    });

    it('returns error on database failure', async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('nona_factors table not found');
      });

      const result = await listFactors();

      expect(result).toEqual({ success: false, error: 'nona_factors table not found' });
    });

    it('handles non-Error throws', async () => {
      mockPrepare.mockImplementation(() => {
        throw 42;
      });

      const result = await listFactors();

      expect(result).toEqual({ success: false, error: '42' });
    });
  });
});
