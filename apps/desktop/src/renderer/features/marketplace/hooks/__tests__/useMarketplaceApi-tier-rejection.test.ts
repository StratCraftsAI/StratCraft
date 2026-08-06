/**
 * useMarketplaceApi tier-rejection parser tests (TICKET_799)
 *
 * Covers parseTierRejection -- the renderer-side decoder for the
 * `TIER_INSUFFICIENT:<json>: <human>` sentinel thrown by
 * plugin-market-service.checkPaidPluginGates(). The parser routes structured
 * tier failures into the store's tierRejection slot so MarketplacePage opens
 * the acquisition-choice dialog instead of dumping the raw wire message into
 * the dead-end red banner.
 */

import { describe, it, expect } from 'vitest';
import { __parseTierRejectionForTests as parseTierRejection } from '../useMarketplaceApi';

describe('TICKET_799: parseTierRejection', () => {
  describe('happy path', () => {
    it('parses a well-formed TIER_INSUFFICIENT sentinel into a TierRejection', () => {
      const raw = `TIER_INSUFFICIENT:${JSON.stringify({
        pluginId: 'com.stratcraft.signal-generator-nexus',
        requiredTier: 'gold',
        currentTier: 'pro',
      })}: This plugin requires gold tier or higher. Your current tier: pro. Please upgrade your plan.`;

      expect(parseTierRejection(raw)).toEqual({
        pluginId: 'com.stratcraft.signal-generator-nexus',
        requiredTier: 'gold',
        currentTier: 'pro',
      });
    });

    it('parses a payload with currentTier="free" (unauthenticated edge case)', () => {
      const raw = `TIER_INSUFFICIENT:${JSON.stringify({
        pluginId: 'com.stratcraft.quant-lab-nexus',
        requiredTier: 'gold',
        currentTier: 'free',
      })}: ...`;

      expect(parseTierRejection(raw)).toEqual({
        pluginId: 'com.stratcraft.quant-lab-nexus',
        requiredTier: 'gold',
        currentTier: 'free',
      });
    });
  });

  describe('non-matching input -- caller falls back to raw message banner', () => {
    it('returns null for an unrelated error message', () => {
      expect(parseTierRejection('Network timeout. Please try again.')).toBeNull();
    });

    it('returns null for a MSG_ code (preserved for i18n banner path)', () => {
      expect(parseTierRejection('MSG_MARKETPLACE_INSTALL_FAILED')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseTierRejection('')).toBeNull();
    });

    it('returns null for a message that merely mentions "tier" but lacks the sentinel', () => {
      expect(parseTierRejection('Your tier is insufficient.')).toBeNull();
    });
  });

  describe('malformed sentinel -- safe fallback, no throw', () => {
    it('returns null when the JSON payload is malformed', () => {
      const raw = 'TIER_INSUFFICIENT:{not-valid-json}: human fallback';
      expect(parseTierRejection(raw)).toBeNull();
    });

    it('returns null when the JSON lacks pluginId', () => {
      const raw = `TIER_INSUFFICIENT:${JSON.stringify({
        requiredTier: 'gold',
        currentTier: 'pro',
      })}: ...`;
      expect(parseTierRejection(raw)).toBeNull();
    });

    it('returns null when the JSON lacks requiredTier', () => {
      const raw = `TIER_INSUFFICIENT:${JSON.stringify({
        pluginId: 'x',
        currentTier: 'pro',
      })}: ...`;
      expect(parseTierRejection(raw)).toBeNull();
    });

    it('returns null when the JSON lacks currentTier', () => {
      const raw = `TIER_INSUFFICIENT:${JSON.stringify({
        pluginId: 'x',
        requiredTier: 'gold',
      })}: ...`;
      expect(parseTierRejection(raw)).toBeNull();
    });

    it('returns null when a required field is the wrong type', () => {
      const raw = `TIER_INSUFFICIENT:${JSON.stringify({
        pluginId: 123,
        requiredTier: 'gold',
        currentTier: 'pro',
      })}: ...`;
      expect(parseTierRejection(raw)).toBeNull();
    });

    it('returns null when the prefix is present but the JSON object is unterminated', () => {
      const raw = 'TIER_INSUFFICIENT:{"pluginId":"x"';
      expect(parseTierRejection(raw)).toBeNull();
    });
  });

  describe('round-trip with the backend format', () => {
    // Locks the wire contract: any change to the encoder in
    // plugin-market-service.ts that breaks this round-trip is a behaviour
    // break, not a refactor.
    it('decodes the exact format emitted by plugin-market-service', () => {
      const pluginId = 'com.stratcraft.signal-generator-nexus';
      const requiredTier = 'gold';
      const currentTier = 'pro';

      const payload = JSON.stringify({ pluginId, requiredTier, currentTier });
      const raw = `TIER_INSUFFICIENT:${payload}: This plugin requires ${requiredTier} tier or higher. Your current tier: ${currentTier}. Please upgrade your plan.`;

      const parsed = parseTierRejection(raw);
      expect(parsed).toEqual({ pluginId, requiredTier, currentTier });
    });
  });
});
