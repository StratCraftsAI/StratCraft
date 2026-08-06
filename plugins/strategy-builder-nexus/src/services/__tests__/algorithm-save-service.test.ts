/**
 * Algorithm Save Service Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests helper functions (extractClassName, isCppCode, mapConfigToSaveData).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window.electronAPI
vi.stubGlobal('window', {
  electronAPI: {
    hub: {
      invokeEntity: vi.fn(),
    },
  },
  nexus: {
    window: {
      showNotification: vi.fn(),
      showAlert: vi.fn(),
    },
  },
});

import { saveAlgorithm, saveAlgorithmSilent } from '../algorithm-save-service';
import type { AlgorithmGenerationConfig, AlgorithmSaveResult } from '../algorithm-save-service';

// =============================================================================
// Tests
// =============================================================================

describe('AlgorithmSaveService', () => {
  const mockInvokeEntity = window.electronAPI.hub.invokeEntity as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseConfig: AlgorithmGenerationConfig = {
    strategy_name: 'Trend Following',
    strategy_type: 9,
    generated_code: `class TrendFollowingStrategy(StrategyBase):
    def on_bar(self, bar):
        pass`,
    metadata: { regime: 'trend', llm_provider: 'CLAUDE', llm_model: 'claude-4' },
  };

  // =========================================================================
  // saveAlgorithm
  // =========================================================================

  describe('saveAlgorithm', () => {
    it('should save algorithm successfully', async () => {
      mockInvokeEntity.mockResolvedValue({
        success: true,
        data: { id: 1, code: 'ALG001', strategy_name: 'Trend Following' },
      });

      const result = await saveAlgorithm(baseConfig);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockInvokeEntity).toHaveBeenCalledWith(
        'save',
        'nona_algorithm',
        expect.objectContaining({
          strategy_name: 'Trend Following',
          strategy_type: 9,
          code: expect.stringContaining('TrendFollowingStrategy'),
        }),
        'com.stratcraft.strategy-builder-nexus'
      );
    });

    it('should use custom pluginId', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig, 'com.custom.plugin');

      expect(mockInvokeEntity).toHaveBeenCalledWith(
        'save',
        'nona_algorithm',
        expect.anything(),
        'com.custom.plugin'
      );
    });

    it('should handle save failure from API', async () => {
      mockInvokeEntity.mockResolvedValue({
        success: false,
        error: { code: 'DUPLICATE', message: 'Strategy already exists' },
      });

      const result = await saveAlgorithm(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DUPLICATE');
    });

    it('should handle API exception', async () => {
      mockInvokeEntity.mockRejectedValue(new Error('Network error'));

      const result = await saveAlgorithm(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXCEPTION');
      expect(result.error?.message).toBe('Network error');
    });

    it('should extract class name from Python code', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig);

      const savedData = mockInvokeEntity.mock.calls[0][2];
      const metadata = JSON.parse(savedData.classification_metadata);
      expect(metadata.class_name).toBe('TrendFollowingStrategy');
    });

    it('should use default class name when no class found', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm({
        ...baseConfig,
        generated_code: 'def run(): pass',
      });

      const savedData = mockInvokeEntity.mock.calls[0][2];
      const metadata = JSON.parse(savedData.classification_metadata);
      expect(metadata.class_name).toBe('GeneratedStrategy');
    });

    it('should generate correct signal_source from regime type', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig);

      const savedData = mockInvokeEntity.mock.calls[0][2];
      const metadata = JSON.parse(savedData.classification_metadata);
      expect(metadata.signal_source).toBe('indicator_detector_trend');
    });

    it('should default user_id to "default"', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig);

      const savedData = mockInvokeEntity.mock.calls[0][2];
      expect(savedData.user_id).toBe('default');
    });

    it('should always use .cpp extension (TICKET_661: C++ only generation)', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig);

      const savedData = mockInvokeEntity.mock.calls[0][2];
      expect(savedData.file_path).toBe('generated/Trend Following.cpp');
    });

    it('should stringify classification_metadata as JSON', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig);

      const savedData = mockInvokeEntity.mock.calls[0][2];
      expect(typeof savedData.classification_metadata).toBe('string');
      const parsed = JSON.parse(savedData.classification_metadata);
      expect(parsed.strategy_role).toBe('market_regime');
      expect(parsed.trading_style).toBe('neutral');
    });

    it('should stringify strategy_rules as JSON', async () => {
      mockInvokeEntity.mockResolvedValue({ success: true, data: {} });

      await saveAlgorithm(baseConfig);

      const savedData = mockInvokeEntity.mock.calls[0][2];
      expect(typeof savedData.strategy_rules).toBe('string');
      const parsed = JSON.parse(savedData.strategy_rules);
      expect(parsed.regime_type).toBe('trend');
    });
  });

  // =========================================================================
  // saveAlgorithmSilent
  // =========================================================================

  describe('saveAlgorithmSilent', () => {
    it('should save without showing notifications', async () => {
      mockInvokeEntity.mockResolvedValue({
        success: true,
        data: { id: 1, code: 'ALG001', strategy_name: 'Test' },
      });

      const result = await saveAlgorithmSilent(baseConfig);

      expect(result.success).toBe(true);
      expect(window.nexus?.window?.showNotification).not.toHaveBeenCalled();
    });

    it('should handle failure silently', async () => {
      mockInvokeEntity.mockResolvedValue({
        success: false,
        error: { code: 'ERROR', message: 'Failed' },
      });

      const result = await saveAlgorithmSilent(baseConfig);

      expect(result.success).toBe(false);
      expect(window.nexus?.window?.showNotification).not.toHaveBeenCalled();
    });

    it('should handle exceptions silently', async () => {
      mockInvokeEntity.mockRejectedValue(new Error('Crash'));

      const result = await saveAlgorithmSilent(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXCEPTION');
    });
  });
});
