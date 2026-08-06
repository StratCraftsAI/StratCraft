import { describe, expect, it } from 'vitest';
import {
  deriveFactorMiningLaunch,
  FACTOR_MINING_CONFIRM_TOOL,
  FACTOR_MINING_START_TOOL,
  projectAgentToolVisualization,
} from '../agent-tool-visualization';

/**
 * TICKET_1379: `confirm_factor_mining` returns the immutable plan that
 * `start_factor_mining` consumes -- it does not launch anything itself. A
 * surface that dispatched confirm and stopped produced a plan document and
 * discarded it, so no mining run ever existed.
 */
const FINGERPRINT = 'a'.repeat(64);

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: '1.0.0',
    specificationId: 'quantnexus.factor-mining',
    specificationVersion: '1.0.0',
    derivedContextVersion: '2026.08',
    parameters: [
      { id: 'engine', value: 'gpquant', provenance: 'explicit', editable: true, impact: ['scope'] },
    ],
    planFingerprint: FINGERPRINT,
    confirmedAtUtc: '2026-08-06T06:00:00Z',
    ...overrides,
  };
}

describe('TICKET_1379: confirm -> start continuation', () => {
  it('projects only a real launch receipt as success, never raw JSON', () => {
    const visual = projectAgentToolVisualization({
      ok: true,
      state: 'running',
      receipt: { taskId: 'mining_1', acceptedPlanFingerprint: FINGERPRINT },
    }, 'confirm_and_start_factor_mining');
    expect(visual).toMatchObject({ ok: true, kind: 'info_panel' });
    if (visual.ok) expect(JSON.stringify(visual.payload)).toContain('mining_1');
    expect(projectAgentToolVisualization({ ok: true }, 'confirm_and_start_factor_mining'))
      .toMatchObject({ ok: false });
  });
  it('names the launch tool, not the confirm tool', () => {
    expect(FACTOR_MINING_CONFIRM_TOOL).toBe('confirm_factor_mining');
    expect(FACTOR_MINING_START_TOOL).toBe('start_factor_mining');
    const result = deriveFactorMiningLaunch(plan());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.toolName).toBe(FACTOR_MINING_START_TOOL);
  });

  it('forwards a bare confirm result as the plan verbatim', () => {
    const confirmed = plan();
    const result = deriveFactorMiningLaunch(confirmed);
    expect(result.ok).toBe(true);
    // Verbatim forwarding is the contract: the fingerprint the user accepted
    // is the fingerprint that executes. No merging, no re-derivation.
    if (result.ok) expect(result.args.plan).toEqual(confirmed);
  });

  it('unwraps a confirm result that nests the plan under `plan`', () => {
    const inner = plan();
    const result = deriveFactorMiningLaunch({ plan: inner, ok: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.plan).toEqual(inner);
  });

  it('preserves parameter values exactly rather than rebuilding them', () => {
    const confirmed = plan({
      parameters: [
        { id: 'preset', value: 'g10-28', provenance: 'persisted', editable: true, impact: ['scope'] },
        { id: 'timeframes', value: ['5m', '15m'], provenance: 'default', editable: true, impact: ['cost'] },
      ],
    });
    const result = deriveFactorMiningLaunch(confirmed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.plan.parameters).toEqual(confirmed.parameters);
  });

  describe('refuses rather than launching an unconfirmed plan', () => {
    it('rejects a missing fingerprint', () => {
      const { planFingerprint: _omitted, ...rest } = plan();
      const result = deriveFactorMiningLaunch(rest);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('planFingerprint');
    });

    it('rejects a malformed fingerprint', () => {
      const result = deriveFactorMiningLaunch(plan({ planFingerprint: 'not-a-sha256' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('planFingerprint');
    });

    it('rejects a plan with no parameters array', () => {
      const result = deriveFactorMiningLaunch(plan({ parameters: undefined }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('parameters');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'confirmed'],
      ['an array', [plan()]],
    ])('rejects %s', (_label, input) => {
      const result = deriveFactorMiningLaunch(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBeTruthy();
    });

    it('states a reason on every refusal so the surface can report it', () => {
      // TICKET_858: a refusal that cannot be narrated is a silent failure.
      for (const bad of [null, {}, plan({ planFingerprint: 'x' })]) {
        const result = deriveFactorMiningLaunch(bad);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
