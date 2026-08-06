/**
 * Signal Source Service API Unit Tests
 *
 * TICKET_494: Full coverage for signal-source-api.ts
 * TICKET_612: Updated for normalized saved_strategies table
 * Covers listSignalSources.
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

import { listSignalSources } from '../signal-source-api';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('signal-source-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ all: mockAll });
  });

  describe('listSignalSources', () => {
    it('returns signal source rows on success', async () => {
      const rows = [
        { id: 'ss_1', name: 'RSI Signal', source_type: 'workflow', has_exit: 0 },
      ];
      mockAll.mockReturnValue(rows);

      const result = await listSignalSources(5);

      expect(result).toEqual({ success: true, data: rows });
      expect(mockAll).toHaveBeenCalledWith(5);
    });

    it('uses default limit of 50', async () => {
      mockAll.mockReturnValue([]);

      await listSignalSources();

      expect(mockAll).toHaveBeenCalledWith(50);
    });

    it('returns empty array when no sources exist', async () => {
      mockAll.mockReturnValue([]);

      const result = await listSignalSources();

      expect(result).toEqual({ success: true, data: [] });
    });

    it('returns error on database failure', async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('saved_strategies not found');
      });

      const result = await listSignalSources();

      expect(result).toEqual({ success: false, error: 'saved_strategies not found' });
    });

    it('handles non-Error throws', async () => {
      mockPrepare.mockImplementation(() => {
        throw null;
      });

      const result = await listSignalSources();

      expect(result).toEqual({ success: false, error: 'null' });
    });
  });
});
