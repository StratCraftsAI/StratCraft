/**
 * TICKET_1380: the `start_factor_mining` input schema must accept exactly the
 * document `confirmPrelaunchReview` emits.
 *
 * The launch hop is the only one in the pre-launch chain that validates the
 * plan strictly -- `review_factor_mining`, `edit_workload_review` and
 * `confirm_factor_mining` all accept `z.array(z.unknown())` under
 * `.passthrough()`. That asymmetry hid a hand-written parameter schema that
 * omitted every presentation field of `ResolvedWorkloadParameter`. Because
 * `confirmWorkloadPlan` freezes `[...review.parameters]` verbatim, those fields
 * ride inside the confirmed plan, and the strict gate rejected every element
 * with "Unrecognized keys: label, control, validation ..." -- after the card had
 * rendered and the edit round-trip had succeeded.
 *
 * These tests drive the REAL factor-mining specification through resolve ->
 * confirm and validate the actual emitted plan, so any future presentation
 * field added to `ResolvedWorkloadParameter` fails here rather than at launch.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { confirmPrelaunchReview } from './index';
import {
  FACTOR_MINING_PARAMETER_SPECIFICATION,
  resolveFactorMiningReview,
  editFactorMiningReview,
} from './factor-mining';

/**
 * A verbatim copy of the `start_factor_mining` parameter schema. It is
 * duplicated here rather than imported because the MCP registry lives in the
 * Electron app and pulls in a server runtime; this package is the contract
 * owner, so the shape must hold on its own. `registration-shape` covers the
 * registry wiring.
 */
const CONFIRMED_PARAMETER_SCHEMA = z.object({
  id: z.string(), label: z.string(),
  control: z.enum(['select', 'multi-select', 'tags', 'date', 'datetime', 'number', 'text', 'readonly']),
  value: z.unknown(), provenance: z.enum(['explicit', 'persisted', 'default', 'derived']),
  defaultSource: z.string().optional(),
  defaultRole: z.literal('calculated-from-coverage').optional(),
  editable: z.boolean(),
  impact: z.array(z.enum(['scope', 'cost', 'duration', 'safety', 'output'])),
  supportedChoices: z.array(z.unknown()).optional(),
  validation: z.object({
    minimum: z.number().optional(), maximum: z.number().optional(), step: z.number().optional(),
  }).strict().optional(),
  nullable: z.boolean().optional(),
  visibleWhen: z.object({
    parameterId: z.string(), equals: z.array(z.unknown()),
  }).strict().optional(),
  dateBounds: z.object({
    minimumDate: z.string().optional(), maximumDate: z.string().optional(),
  }).strict().optional(),
}).strict();

const CONFIRMED_PLAN_SCHEMA = z.object({
  contractVersion: z.literal('1.0.0'),
  specificationId: z.literal('quantnexus.factor-mining'),
  specificationVersion: z.literal('1.0.0'),
  derivedContextVersion: z.string().min(1),
  parameters: z.array(CONFIRMED_PARAMETER_SCHEMA),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedAtUtc: z.string(),
}).strict();

const context = {
  version: 'cpu:4-memory:16000',
  concurrency: 2,
  blasThreads: 1,
  memoryBudgetMb: 12000,
  bindingConstraint: 'cpu' as const,
  coverage: {
    startUtc: '2025-01-01T00:00:00Z', endUtcExclusive: '2025-02-01T00:00:00Z',
    minimumDate: '2025-01-01', maximumDate: '2025-01-31', snapshotVersion: 'schema:snap:v1',
  },
};

const completeDraft = {
  engine: 'gpquant' as const,
  marketScopeSource: 'custom' as const,
  symbols: ['EURUSD'],
  timeframes: ['5m'],
  startDate: '2025-01-01',
  endDate: '2025-01-31',
};

function confirm(review: ReturnType<typeof resolveFactorMiningReview>) {
  return confirmPrelaunchReview(FACTOR_MINING_PARAMETER_SPECIFICATION, review, {
    planFingerprint: review.planFingerprint,
    specificationVersion: review.specificationVersion,
    confirmedAtUtc: '2026-08-06T00:00:00.000Z',
  });
}

describe('TICKET_1380: confirmed plan / start_factor_mining schema parity', () => {
  it('accepts the plan confirmed from a freshly resolved review', () => {
    const plan = confirm(resolveFactorMiningReview(completeDraft, context));
    const result = CONFIRMED_PLAN_SCHEMA.safeParse(plan);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('accepts the plan confirmed after an edit round-trip', () => {
    // The screenshot path: resolve -> edit_workload_review -> confirm -> start.
    const resolved = resolveFactorMiningReview(completeDraft, context);
    const edited = editFactorMiningReview(resolved, { marketScopeSource: 'preset' }, context);
    const result = CONFIRMED_PLAN_SCHEMA.safeParse(confirm(edited));
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('carries the presentation fields the old schema rejected', () => {
    const plan = confirm(resolveFactorMiningReview(completeDraft, context));
    const byId = new Map(plan.parameters.map(parameter => [parameter.id, parameter]));

    // Every parameter is labelled and has a control -- these alone produced two
    // "Unrecognized keys" issues per element under the pre-fix schema.
    for (const parameter of plan.parameters) {
      expect(parameter.label.length).toBeGreaterThan(0);
      expect(parameter.control).toBeTruthy();
    }
    // The remaining rejected keys, each present on at least one parameter.
    expect(byId.get('engine')?.supportedChoices).toBeDefined();
    expect(byId.get('gpquant.minIc')?.validation).toMatchObject({ minimum: 0, maximum: 1 });
    expect(byId.get('symbols')?.visibleWhen).toMatchObject({ parameterId: 'marketScopeSource' });
  });

  it('still rejects a parameter carrying a key outside the contract', () => {
    // The gate must stay strict: widening it to `.passthrough()` would let an
    // arbitrary unowned field reach the launch layer.
    const plan = confirm(resolveFactorMiningReview(completeDraft, context));
    const tampered = {
      ...plan,
      parameters: [{ ...plan.parameters[0], injectedByCaller: 'nope' }, ...plan.parameters.slice(1)],
    };
    const result = CONFIRMED_PLAN_SCHEMA.safeParse(tampered);
    expect(result.success).toBe(false);
  });
});
