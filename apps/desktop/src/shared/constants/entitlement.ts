/**
 * Entitlement Tier Constants
 *
 * TICKET_544: Single source of truth for entitlement tier mapping.
 * Previously scattered across auth-service.ts, entitlement-sync-service.ts,
 * and plugin-config-manager.ts.
 *
 * Four-tier system:
 * - FREE (0): No login / unknown
 * - BASIC (1): Basic plan with BYOK keys
 * - PRO (2): Professional plan with hosted services
 * - GOLD (3): Premium plan
 */

import type { AuthPlan } from '../types/auth';

/**
 * Numeric entitlement levels for tier comparison.
 * Used by PluginConfigManager.resolveServiceState() to determine locked state.
 */
export const ENTITLEMENT_TIER_LEVELS: Record<string, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  gold: 3,
} as const;

/**
 * Map backend user_level string to AuthPlan display tier.
 * Backend values: basic, pro, gold, test
 * Display values: FREE, BASIC, PRO, GOLD
 */
export function normalizeUserLevel(level: string | undefined): AuthPlan {
  if (!level) return 'FREE';
  const normalized = level.toLowerCase();
  if (normalized === 'gold' || normalized === 'test') return 'GOLD';
  if (normalized === 'pro' || normalized === 'professional') return 'PRO';
  if (normalized === 'basic') return 'BASIC';
  return 'FREE';  // free or unknown
}

/**
 * TICKET_707: Check if a plan meets or exceeds the required tier level.
 * Works with both AuthPlan (uppercase) and entitlement tier (lowercase) formats.
 *
 * Centralizes scattered `userTier === 'pro' || userTier === 'gold'` comparisons
 * into a single utility backed by ENTITLEMENT_TIER_LEVELS.
 */
export function meetsRequiredTier(
  currentPlan: string | null | undefined,
  requiredTier: string
): boolean {
  if (!currentPlan) return false;
  const current = ENTITLEMENT_TIER_LEVELS[currentPlan.toLowerCase()] ?? 0;
  const required = ENTITLEMENT_TIER_LEVELS[requiredTier.toLowerCase()] ?? 0;
  return current >= required;
}
