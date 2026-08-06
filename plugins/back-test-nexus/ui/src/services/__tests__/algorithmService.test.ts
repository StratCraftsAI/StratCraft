/**
 * TICKET_499: algorithmService unit tests
 * TICKET_716: Removed auth dependency - algorithms are machine-scoped (TICKET_670)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../algorithmCodeRegistry', () => ({
  algorithmCodeRegistry: {
    getValidCode: vi.fn((_name: string, code: string) => code),
  },
}));

// Mock window.electronAPI
const mockGetAlgorithms = vi.fn();
Object.defineProperty(globalThis, 'window', {
  value: {
    electronAPI: {
      database: {
        getAlgorithms: mockGetAlgorithms,
      },
    },
  },
  writable: true,
});

describe('algorithmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAILiberoAlgorithms', () => {
    it('should call IPC with strategy_type=1 and signalSourcePrefix=aiLibero', async () => {
      const { algorithmService } = await import('../algorithmService');

      mockGetAlgorithms.mockResolvedValue({
        success: true,
        data: [
          {
            id: 1,
            code: 'ai_libero_strategy_001',
            strategyName: 'AI Libero Test',
            strategyType: 1,
            description: 'Test strategy',
            classificationMetadata: null,
          },
        ],
      });

      const result = await algorithmService.getAILiberoAlgorithms();

      // TICKET_716: No userId - algorithms are machine-scoped (TICKET_670)
      expect(mockGetAlgorithms).toHaveBeenCalledWith({
        strategyType: 1,
        signalSourcePrefix: 'aiLibero',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        code: 'ai_libero_strategy_001',
        strategyName: 'AI Libero Test',
        strategyType: 1,
        description: 'Test strategy',
        classificationMetadata: undefined,
      });
    });

    it('should return empty array on IPC failure', async () => {
      const { algorithmService } = await import('../algorithmService');

      mockGetAlgorithms.mockResolvedValue({
        success: false,
        error: { code: 'DB_ERROR', message: 'Query failed' },
      });

      const result = await algorithmService.getAILiberoAlgorithms();

      expect(result).toEqual([]);
    });

    it('should return empty array when data is null', async () => {
      const { algorithmService } = await import('../algorithmService');

      mockGetAlgorithms.mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await algorithmService.getAILiberoAlgorithms();

      expect(result).toEqual([]);
    });
  });

  describe('getCatalogAlgorithms', () => {
    it('should call IPC with strategy_type=1 and signalSourcePrefix=strategy_catalog_', async () => {
      const { algorithmService } = await import('../algorithmService');

      mockGetAlgorithms.mockResolvedValue({ success: true, data: [] });

      await algorithmService.getCatalogAlgorithms();

      expect(mockGetAlgorithms).toHaveBeenCalledWith(
        expect.objectContaining({
          strategyType: 1,
          signalSourcePrefix: 'strategy_catalog_',
        })
      );
    });

    it('should return empty array on IPC failure', async () => {
      const { algorithmService } = await import('../algorithmService');

      mockGetAlgorithms.mockResolvedValue({
        success: false,
        error: { code: 'DB_ERROR', message: 'fail' },
      });

      const result = await algorithmService.getCatalogAlgorithms();
      expect(result).toEqual([]);
    });
  });

  describe('getLLMTraderAlgorithms', () => {
    it('should call IPC with strategy_type=1 and signalSourcePrefix=llmtrader', async () => {
      const { algorithmService } = await import('../algorithmService');

      mockGetAlgorithms.mockResolvedValue({
        success: true,
        data: [],
      });

      await algorithmService.getLLMTraderAlgorithms();

      expect(mockGetAlgorithms).toHaveBeenCalledWith(
        expect.objectContaining({
          strategyType: 1,
          signalSourcePrefix: 'llmtrader',
        })
      );
    });
  });
});
