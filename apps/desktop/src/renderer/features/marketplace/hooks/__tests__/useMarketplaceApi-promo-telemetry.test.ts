/**
 * Promo Telemetry decision helpers (TICKET_805_2)
 *
 * Exercises the three exported test-only helpers in useMarketplaceApi.ts:
 *   - __isPromoToBuyoutTransitionForTests: synchronous decision
 *   - __runPromoConvertedForTests: async runner for marketplace.promo.converted
 *   - __runPromoFirstRunForTests: async runner for marketplace.promo.first_run
 *
 * These cover P2.3 (first_run) and P2.5 (converted) decision + emit logic
 * without requiring React DOM or Sentry. The IPC-side persistence is covered
 * separately in apps/desktop/src/main/services/__tests__/plugin-telemetry-state-service.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __isPromoToBuyoutTransitionForTests,
  __runPromoConvertedForTests,
  __runPromoFirstRunForTests,
} from '../useMarketplaceApi';
import type { EntitlementStatus } from '@shared/types/marketplace';

const PLUGIN = 'com.stratcraft.signal-generator-nexus';

function ent(overrides: Partial<EntitlementStatus> = {}): EntitlementStatus {
  return {
    pluginId: PLUGIN,
    entitled: true,
    status: 'active',
    purchasedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('TICKET_805_2: __isPromoToBuyoutTransitionForTests', () => {
  it('returns true when prev has expiresAt and next has expiresAt null (promo -> buyout)', () => {
    const prev = ent({ expiresAt: '2026-08-01 00:00:00' });
    const next = ent({ expiresAt: null });
    expect(__isPromoToBuyoutTransitionForTests(prev, next)).toBe(true);
  });

  it('returns false when prev is undefined (no prior entitlement -- fresh buyout, not a transition)', () => {
    const next = ent({ expiresAt: null });
    expect(__isPromoToBuyoutTransitionForTests(undefined, next)).toBe(false);
  });

  it('returns false when prev was already permanent (buyout -> buyout)', () => {
    const prev = ent({ expiresAt: null });
    const next = ent({ expiresAt: null });
    expect(__isPromoToBuyoutTransitionForTests(prev, next)).toBe(false);
  });

  it('returns false when next is still a promo (no transition yet)', () => {
    const prev = ent({ expiresAt: '2026-08-01 00:00:00' });
    const next = ent({ expiresAt: '2026-09-01 00:00:00' });
    expect(__isPromoToBuyoutTransitionForTests(prev, next)).toBe(false);
  });

  it('returns false when prev was unentitled (churn -> buyout is not a promo conversion)', () => {
    const prev = ent({ entitled: false, expiresAt: '2026-08-01 00:00:00' });
    const next = ent({ expiresAt: null });
    expect(__isPromoToBuyoutTransitionForTests(prev, next)).toBe(false);
  });

  it('returns false when next is unentitled', () => {
    const prev = ent({ expiresAt: '2026-08-01 00:00:00' });
    const next = ent({ entitled: false, expiresAt: null });
    expect(__isPromoToBuyoutTransitionForTests(prev, next)).toBe(false);
  });
});

describe('TICKET_805_2: __runPromoConvertedForTests', () => {
  const NOW = 1_700_000_000_000;
  const INSTALL = NOW - 3 * 86400000 - 1000; // 3 days + a sliver ago

  let emit: ReturnType<typeof vi.fn>;
  let getInstallWithPromoAt: ReturnType<typeof vi.fn>;
  let clearInstallWithPromoAt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emit = vi.fn();
    getInstallWithPromoAt = vi.fn();
    clearInstallWithPromoAt = vi.fn().mockResolvedValue({ success: true });
  });

  it('emits converted with floored days_since_install and clears the timestamp on success', async () => {
    getInstallWithPromoAt.mockResolvedValue({ success: true, installWithPromoAt: INSTALL });
    await __runPromoConvertedForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      clearInstallWithPromoAt: clearInstallWithPromoAt as never,
      emit,
      now: () => NOW,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('marketplace.promo.converted', {
      plugin_id: PLUGIN,
      days_since_install: 3,
    });
    expect(clearInstallWithPromoAt).toHaveBeenCalledWith(PLUGIN);
  });

  it('does nothing when install_with_promo_at is null (this user was never on promo)', async () => {
    getInstallWithPromoAt.mockResolvedValue({ success: true, installWithPromoAt: null });
    await __runPromoConvertedForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      clearInstallWithPromoAt: clearInstallWithPromoAt as never,
      emit,
      now: () => NOW,
    });
    expect(emit).not.toHaveBeenCalled();
    expect(clearInstallWithPromoAt).not.toHaveBeenCalled();
  });

  it('does nothing when the IPC response is undefined (API surface absent)', async () => {
    getInstallWithPromoAt.mockResolvedValue(undefined);
    await __runPromoConvertedForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      clearInstallWithPromoAt: clearInstallWithPromoAt as never,
      emit,
      now: () => NOW,
    });
    expect(emit).not.toHaveBeenCalled();
    expect(clearInstallWithPromoAt).not.toHaveBeenCalled();
  });

  it('swallows IPC read errors -- never throws into the entitlement-change handler', async () => {
    getInstallWithPromoAt.mockRejectedValue(new Error('IPC down'));
    await expect(
      __runPromoConvertedForTests(PLUGIN, {
        getInstallWithPromoAt: getInstallWithPromoAt as never,
        clearInstallWithPromoAt: clearInstallWithPromoAt as never,
        emit,
        now: () => NOW,
      })
    ).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('swallows clear errors but still emits (telemetry is best-effort)', async () => {
    getInstallWithPromoAt.mockResolvedValue({ success: true, installWithPromoAt: INSTALL });
    clearInstallWithPromoAt.mockRejectedValue(new Error('clear failed'));
    await __runPromoConvertedForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      clearInstallWithPromoAt: clearInstallWithPromoAt as never,
      emit,
      now: () => NOW,
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('floors days_since_install: 23h since install reports 0 days, not 1', async () => {
    getInstallWithPromoAt.mockResolvedValue({
      success: true,
      installWithPromoAt: NOW - 23 * 3600000,
    });
    await __runPromoConvertedForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      clearInstallWithPromoAt: clearInstallWithPromoAt as never,
      emit,
      now: () => NOW,
    });
    expect(emit).toHaveBeenCalledWith('marketplace.promo.converted', {
      plugin_id: PLUGIN,
      days_since_install: 0,
    });
  });
});

describe('TICKET_805_2: __runPromoFirstRunForTests', () => {
  let emit: ReturnType<typeof vi.fn>;
  let getInstallWithPromoAt: ReturnType<typeof vi.fn>;
  let markFirstRunIfFirst: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emit = vi.fn();
    getInstallWithPromoAt = vi.fn();
    markFirstRunIfFirst = vi.fn();
  });

  it('emits first_run when install_with_promo is set AND markFirstRunIfFirst returns true', async () => {
    getInstallWithPromoAt.mockResolvedValue({ success: true, installWithPromoAt: 100 });
    markFirstRunIfFirst.mockResolvedValue({ success: true, isFirstRun: true });
    await __runPromoFirstRunForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      markFirstRunIfFirst: markFirstRunIfFirst as never,
      emit,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('marketplace.promo.first_run', { plugin_id: PLUGIN });
  });

  it('does not emit when install_with_promo is null (plugin was never on promo)', async () => {
    getInstallWithPromoAt.mockResolvedValue({ success: true, installWithPromoAt: null });
    await __runPromoFirstRunForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      markFirstRunIfFirst: markFirstRunIfFirst as never,
      emit,
    });
    expect(markFirstRunIfFirst).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not emit when markFirstRunIfFirst reports already-emitted', async () => {
    getInstallWithPromoAt.mockResolvedValue({ success: true, installWithPromoAt: 100 });
    markFirstRunIfFirst.mockResolvedValue({ success: true, isFirstRun: false });
    await __runPromoFirstRunForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      markFirstRunIfFirst: markFirstRunIfFirst as never,
      emit,
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('swallows IPC errors -- never throws into the activation handler', async () => {
    getInstallWithPromoAt.mockRejectedValue(new Error('IPC down'));
    await expect(
      __runPromoFirstRunForTests(PLUGIN, {
        getInstallWithPromoAt: getInstallWithPromoAt as never,
        markFirstRunIfFirst: markFirstRunIfFirst as never,
        emit,
      })
    ).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not emit when the read returns undefined (API surface absent)', async () => {
    getInstallWithPromoAt.mockResolvedValue(undefined);
    await __runPromoFirstRunForTests(PLUGIN, {
      getInstallWithPromoAt: getInstallWithPromoAt as never,
      markFirstRunIfFirst: markFirstRunIfFirst as never,
      emit,
    });
    expect(markFirstRunIfFirst).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
