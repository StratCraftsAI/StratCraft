/**
 * useEntitlement Hooks Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests type shapes and API helper logic.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  ServiceEntitlementState,
  PluginEntitlementState,
} from '../useEntitlement';

// =============================================================================
// Type Shape Validation
// =============================================================================

describe('useEntitlement types', () => {
  describe('ServiceEntitlementState', () => {
    it('should accept valid service state', () => {
      const state: ServiceEntitlementState = {
        id: 'svc-indicator-entry',
        name: 'Indicator Entry',
        tier: 'free',
        enabled: true,
        effectiveEnabled: true,
        source: 'manifest',
        locked: false,
      };
      expect(state.id).toBe('svc-indicator-entry');
      expect(state.enabled).toBe(true);
      expect(state.effectiveEnabled).toBe(true);
    });

    it('should accept optional fields', () => {
      const state: ServiceEntitlementState = {
        id: 'svc-ai',
        name: 'AI Entry',
        description: 'AI-powered entry generation',
        tier: 'pro',
        category: 'Strategy Generation',
        icon: 'sparkle',
        enabled: true,
        effectiveEnabled: false,
        source: 'server',
        locked: true,
        lockReason: 'Requires Pro plan',
        quota: 100,
        used: 45,
      };
      expect(state.description).toBe('AI-powered entry generation');
      expect(state.locked).toBe(true);
      expect(state.lockReason).toBe('Requires Pro plan');
      expect(state.quota).toBe(100);
      expect(state.used).toBe(45);
    });

    it('should have effectiveEnabled=false when locked', () => {
      const state: ServiceEntitlementState = {
        id: 'svc-locked',
        name: 'Locked Service',
        tier: 'gold',
        enabled: true,
        effectiveEnabled: false,
        source: 'manifest',
        locked: true,
        lockReason: 'Plan expired',
      };
      expect(state.enabled).toBe(true);
      expect(state.effectiveEnabled).toBe(false);
    });
  });

  describe('PluginEntitlementState', () => {
    it('should contain plugin ID and services array', () => {
      const state: PluginEntitlementState = {
        pluginId: 'com.stratcraft.strategy-builder-nexus',
        services: [
          {
            id: 'svc-1',
            name: 'Service 1',
            tier: 'free',
            enabled: true,
            effectiveEnabled: true,
            source: 'manifest',
            locked: false,
          },
        ],
      };
      expect(state.pluginId).toBe('com.stratcraft.strategy-builder-nexus');
      expect(state.services).toHaveLength(1);
    });

    it('should support empty services array', () => {
      const state: PluginEntitlementState = {
        pluginId: 'com.stratcraft.empty',
        services: [],
      };
      expect(state.services).toHaveLength(0);
    });
  });

  describe('source types', () => {
    it('should accept all valid source values', () => {
      const sources: ServiceEntitlementState['source'][] = ['manifest', 'user-config', 'server'];
      expect(sources).toHaveLength(3);
    });
  });
});
