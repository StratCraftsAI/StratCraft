/**
 * Entitlement Tier Constants
 *
 * TICKET_544: Single source of truth for entitlement tier mapping.
 * Previously scattered across auth-service.ts, entitlement-sync-service.ts,
 * and plugin-config-manager.ts.
 *
 * Two dimensions:
 * - Display tier (AuthPlan): FREE, PRO, GOLD - shown in UI badge
 * - Entitlement tier: free (level 0), pro/gold (level 1) - used for feature gating
 *
 * TICKET_579: Three-level tier system: FREE=0, PRO=1, GOLD=2.
 * GOLD has higher entitlement than PRO for Phase 2/3 bundle differentiation.
 */
import type { AuthPlan } from '../types/auth';
/**
 * Numeric entitlement levels for tier comparison.
 * Used by PluginConfigManager.resolveServiceState() to determine locked state.
 */
export declare const ENTITLEMENT_TIER_LEVELS: Record<string, number>;
/**
 * Map backend user_level string to AuthPlan display tier.
 * Backend values: basic, pro, gold, test
 * Display values: FREE, PRO, GOLD
 */
export declare function normalizeUserLevel(level: string | undefined): AuthPlan;
/**
 * TICKET_707: Check if a plan meets or exceeds the required tier level.
 */
export declare function meetsRequiredTier(currentPlan: string | null | undefined, requiredTier: string): boolean;
//# sourceMappingURL=entitlement.d.ts.map