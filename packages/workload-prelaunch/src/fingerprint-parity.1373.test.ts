/**
 * TICKET_1373 R2: cross-runtime fingerprint parity.
 *
 * The Guide white screen was caused by this package's fingerprint owner
 * depending on `node:crypto`, which Vite externalizes for the browser. The
 * owner now uses a runtime-portable SHA-256. These fixtures exist so that
 * change -- and any future change to the hash owner -- cannot silently move a
 * fingerprint value: an already-confirmed plan whose digest shifted would be
 * rejected as stale, and confirmation, edit re-resolution, and stale-plan
 * detection would disagree across surfaces.
 *
 * `node:crypto` is imported HERE, in a Node-only test, purely as the
 * independent oracle. It must never re-enter `index.ts`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkloadParameterSpecification } from './index';
import {
  assertConfirmedPlanIntegrity,
  assertCurrentConfirmedPlan,
  confirmPrelaunchReview,
  resolvePrelaunchReview,
  workloadPlanDigest,
  WorkloadPrelaunchError,
} from './index';

const specification: WorkloadParameterSpecification = {
  id: 'test.workload',
  version: '1.0.0',
  parameters: [
    { id: 'engine', label: 'Engine', required: true, editable: false, impact: ['cost'], defaultValue: 'gpquant', defaultSource: 'test:v1' },
    { id: 'symbols', label: 'Symbols', required: true, editable: true, impact: ['scope'] },
    { id: 'threads', label: 'Threads', required: true, editable: true, impact: ['cost'], supportedChoices: [1, 2, 4] },
    { id: 'output', label: 'Output', required: true, editable: true, impact: ['output'] },
  ],
};

/** A plan exercising nested JSON, arrays, null, booleans, and every provenance. */
const canonicalPlanInput = {
  explicit: {
    symbols: ['EURUSD', 'USDJPY'],
    output: { path: 'x', nested: { deep: [1, null, true] } },
  },
  persisted: { threads: 4 },
  derivedContextVersion: 'ctx-1',
} as const;

/**
 * Pinned lowercase SHA-256 of the canonical plan above. Produced by the
 * pre-TICKET_1373 `createHash('sha256')` owner and unchanged by the portable
 * owner. A diff here means the canonical payload or the hash changed.
 */
const PINNED_PLAN_FINGERPRINT =
  'c9b61b4ef4861fbe3161a5bd994753c39ec93814478dac3f987bcd6bafd88628';

describe('TICKET_1373 R2: cross-runtime fingerprint parity', () => {
  it('agrees byte-for-byte with node:crypto across payload shapes', () => {
    const payloads = [
      '',
      'a',
      '{"a":1}',
      '{"derivedContextVersion":"ctx-1","parameters":[],"specificationId":"s"}',
      // Multi-byte UTF-8 must hash over its encoded bytes, not UTF-16 units.
      'accented-e-and-cjk: é中文',
      // Surrogate pair: the classic boundary a naive charCodeAt loop breaks on.
      'astral: \u{1F600}',
      // Beyond a single 64-byte SHA-256 block, exercising multi-block padding.
      'x'.repeat(100_000),
    ];
    for (const payload of payloads) {
      expect(workloadPlanDigest(payload))
        .toBe(createHash('sha256').update(payload, 'utf8').digest('hex'));
    }
  });

  it('emits a lowercase 64-character digest', () => {
    expect(workloadPlanDigest('probe')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the canonical plan fingerprint pinned', () => {
    const review = resolvePrelaunchReview(specification, canonicalPlanInput);
    expect(review.planFingerprint).toBe(PINNED_PLAN_FINGERPRINT);
  });

  it('is insensitive to key ordering but sensitive to every identity field', () => {
    const reordered = resolvePrelaunchReview(specification, {
      explicit: {
        output: { nested: { deep: [1, null, true] }, path: 'x' },
        symbols: ['EURUSD', 'USDJPY'],
      },
      persisted: { threads: 4 },
      derivedContextVersion: 'ctx-1',
    });
    expect(reordered.planFingerprint).toBe(PINNED_PLAN_FINGERPRINT);

    // Derived-context version participates in plan identity.
    const otherContext = resolvePrelaunchReview(specification, {
      ...canonicalPlanInput,
      derivedContextVersion: 'ctx-2',
    });
    expect(otherContext.planFingerprint).not.toBe(PINNED_PLAN_FINGERPRINT);

    // Specification identity and version participate in plan identity.
    const otherVersion = resolvePrelaunchReview(
      { ...specification, version: '2.0.0' },
      canonicalPlanInput,
    );
    expect(otherVersion.planFingerprint).not.toBe(PINNED_PLAN_FINGERPRINT);
    const otherId = resolvePrelaunchReview(
      { ...specification, id: 'other.workload' },
      canonicalPlanInput,
    );
    expect(otherId.planFingerprint).not.toBe(PINNED_PLAN_FINGERPRINT);

    // Provenance participates: same value, resolved from a different source.
    const otherProvenance = resolvePrelaunchReview(specification, {
      explicit: { symbols: ['EURUSD', 'USDJPY'], output: { path: 'x', nested: { deep: [1, null, true] } }, threads: 4 },
      derivedContextVersion: 'ctx-1',
    });
    expect(otherProvenance.planFingerprint).not.toBe(PINNED_PLAN_FINGERPRINT);
  });

  it('backs confirmation, stale detection, and integrity with the same owner', () => {
    const review = resolvePrelaunchReview(specification, canonicalPlanInput);
    const confirmed = confirmPrelaunchReview(specification, review, {
      planFingerprint: PINNED_PLAN_FINGERPRINT,
      specificationVersion: '1.0.0',
      confirmedAtUtc: '2026-08-06T00:00:00Z',
    });
    expect(confirmed.planFingerprint).toBe(PINNED_PLAN_FINGERPRINT);

    // Stale detection and integrity both accept the portable digest.
    expect(() => assertCurrentConfirmedPlan(specification, confirmed, review)).not.toThrow();
    expect(() => assertConfirmedPlanIntegrity(specification, confirmed, 'ctx-1')).not.toThrow();

    // Integrity recomputes rather than trusting the carried value.
    const tampered = { ...confirmed, planFingerprint: workloadPlanDigest('forged') };
    expect(() => assertConfirmedPlanIntegrity(specification, tampered, 'ctx-1'))
      .toThrow(WorkloadPrelaunchError);
  });
});
