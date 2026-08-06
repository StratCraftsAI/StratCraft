/**
 * useDistribution Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests distribution detection hook type contracts and logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tanstack/react-query
const mockQueryFn = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryFn, queryKey }: any) => {
    mockQueryFn.mockImplementation(queryFn);
    return { data: mockQueryData, isLoading: false };
  },
}));

let mockQueryData: string | undefined;

// Mock shared constants
vi.mock('@shared/constants/distribution', () => ({
  DEFAULT_DISTRIBUTION: 'full',
}));

describe('useDistribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryData = undefined;
    // Reset modules to re-import with fresh mocks
    vi.resetModules();
  });

  describe('fetchDistribution', () => {
    it('should return DEFAULT_DISTRIBUTION when window is undefined', async () => {
      vi.stubGlobal('window', undefined);
      const { useDistribution } = await import('../useDistribution');
      mockQueryData = undefined;
      const result = useDistribution();
      expect(result).toBe('full');
    });

    it('should return DEFAULT_DISTRIBUTION when electronAPI.distribution is not available', async () => {
      vi.stubGlobal('window', { electronAPI: {} });
      const { useDistribution } = await import('../useDistribution');
      mockQueryData = undefined;
      const result = useDistribution();
      expect(result).toBe('full');
    });

    it('should return distribution from query data when available', async () => {
      vi.stubGlobal('window', {
        electronAPI: { distribution: { getDistribution: vi.fn().mockResolvedValue('public') } },
      });
      const { useDistribution } = await import('../useDistribution');
      mockQueryData = 'public';
      const result = useDistribution();
      expect(result).toBe('public');
    });
  });

  describe('useIsPublicRelease', () => {
    it('should return true when distribution is public', async () => {
      vi.stubGlobal('window', { electronAPI: {} });
      const { useIsPublicRelease } = await import('../useDistribution');
      mockQueryData = 'public';
      const result = useIsPublicRelease();
      expect(result).toBe(true);
    });

    it('should return false when distribution is full', async () => {
      vi.stubGlobal('window', { electronAPI: {} });
      const { useIsPublicRelease } = await import('../useDistribution');
      mockQueryData = 'full';
      const result = useIsPublicRelease();
      expect(result).toBe(false);
    });

    it('should return false by default', async () => {
      vi.stubGlobal('window', { electronAPI: {} });
      const { useIsPublicRelease } = await import('../useDistribution');
      mockQueryData = undefined;
      const result = useIsPublicRelease();
      expect(result).toBe(false);
    });
  });
});
