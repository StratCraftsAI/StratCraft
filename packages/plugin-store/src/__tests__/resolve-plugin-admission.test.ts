/**
 * TICKET_1307 -- unit tests for `resolvePluginAdmission`. Covers the four
 * acceptance criteria scenarios: requirement raised (AC1), requirement lowered
 * (AC3), exact match, and the denial-reason message shape (AC2).
 */

import { describe, it, expect } from 'vitest';
import { resolvePluginAdmission, resolveUserTier, type UserTierContext } from '../index';

describe('resolvePluginAdmission', () => {
  it('admits when grantedTier meets requiredTier (exact match)', () => {
    const result = resolvePluginAdmission('gold', 'gold');
    expect(result.admitted).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('admits when grantedTier exceeds requiredTier', () => {
    const result = resolvePluginAdmission('gold', 'pro');
    expect(result.admitted).toBe(true);
  });

  it('denies when grantedTier is below requiredTier (AC1: requirement raised)', () => {
    const result = resolvePluginAdmission('basic', 'gold');
    expect(result.admitted).toBe(false);
    expect(result.grantedTier).toBe('basic');
    expect(result.requiredTier).toBe('gold');
  });

  it('admits after requirement lowered (AC3: upgrade path)', () => {
    const result = resolvePluginAdmission('pro', 'basic');
    expect(result.admitted).toBe(true);
  });

  it('denies free tier against any paid requirement', () => {
    const result = resolvePluginAdmission('free', 'basic');
    expect(result.admitted).toBe(false);
  });

  it('admits free tier against free requirement', () => {
    const result = resolvePluginAdmission('free', 'free');
    expect(result.admitted).toBe(true);
  });

  it('denial reason names both tiers (AC2)', () => {
    const result = resolvePluginAdmission('basic', 'pro');
    expect(result.reason).toContain('PRO');
    expect(result.reason).toContain('BASIC');
  });

  it('is case-insensitive', () => {
    expect(resolvePluginAdmission('GOLD', 'gold').admitted).toBe(true);
    expect(resolvePluginAdmission('gold', 'GOLD').admitted).toBe(true);
    expect(resolvePluginAdmission('Basic', 'PRO').admitted).toBe(false);
  });

  it('treats unknown tiers as level 0 (free equivalent)', () => {
    const result = resolvePluginAdmission('unknown', 'basic');
    expect(result.admitted).toBe(false);
  });
});

/**
 * The granted side of the comparison MUST come from `resolveUserTier`
 * (TICKET_1305), never from the raw grant snapshot. These cover the composed
 * path that the runtime gates actually execute.
 */
describe('admission over resolveUserTier (composed runtime path)', () => {
  const PLUGIN = 'com.stratcraft.quant-lab-nexus';

  function admit(context: UserTierContext, requiredTier: string) {
    return resolvePluginAdmission(resolveUserTier(PLUGIN, context), requiredTier);
  }

  it('AC1: denies a BASIC user after the requirement is raised to GOLD', () => {
    const context: UserTierContext = { plan: 'BASIC' };
    expect(admit(context, 'basic').admitted).toBe(true);
    expect(admit(context, 'gold').admitted).toBe(false);
  });

  it('AC3: a plan upgrade admits immediately, even while the grant entry is stale', () => {
    // The backend has not re-issued the grant (RC3 add-only merge), so the
    // per-plugin override still reads 'basic' from the login snapshot -- but the
    // account plan is now GOLD. Sourcing the granted tier from the grant
    // snapshot alone would wrongly deny a paying user.
    const staleGrantOnly: UserTierContext = { pluginTierOverrides: { [PLUGIN]: 'basic' } };
    expect(admit(staleGrantOnly, 'gold').admitted).toBe(false);

    const upgraded: UserTierContext = { plan: 'GOLD' };
    expect(admit(upgraded, 'gold').admitted).toBe(true);
  });

  it('a per-plugin buyout admits above the account plan', () => {
    const context: UserTierContext = { plan: 'FREE', pluginTierOverrides: { [PLUGIN]: 'gold' } };
    expect(admit(context, 'gold').admitted).toBe(true);
  });

  it('an unauthenticated session is denied any paid requirement (TICKET_638 baseline)', () => {
    expect(admit({}, 'gold').admitted).toBe(false);
    expect(admit({}, 'free').admitted).toBe(true);
  });

  it('AC6: Electron and MCP contexts yield identical verdicts', () => {
    // Electron builds { plan: accountPlanTier, pluginTierOverrides: pluginUserTiers };
    // MCP builds { plan: getSessionUserPlan(), pluginTierOverrides: readEntitledPluginsCache() }.
    // Equivalent inputs must produce byte-identical verdicts.
    const electron: UserTierContext = { plan: 'pro', pluginTierOverrides: { [PLUGIN]: 'pro' } };
    const mcp: UserTierContext = { plan: 'PRO', pluginTierOverrides: { [PLUGIN]: 'PRO' } };
    expect(admit(electron, 'gold')).toEqual(admit(mcp, 'gold'));
    expect(admit(electron, 'pro')).toEqual(admit(mcp, 'pro'));
  });
});
