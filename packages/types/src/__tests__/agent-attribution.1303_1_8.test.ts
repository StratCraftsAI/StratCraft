import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AGENT_USAGE_CONTRACT_VERSION,
  GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION,
  GOVERNANCE_EVIDENCE_ENVELOPE_V1_JSON_SCHEMA,
  GOVERNANCE_EVIDENCE_ENVELOPE_VERSION,
  GOVERNANCE_EVIDENCE_SCHEMA_VERSION,
  INFERENCE_ATTRIBUTION_SCHEMA_VERSION,
  agentUsageV1Schema,
  canonicalAgentJson,
  governanceAttributionV1Schema,
  governanceEvidenceEnvelopeV1Schema,
} from '../index';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../../contracts/governance-evidence-envelope-v1.golden.json',
  import.meta.url,
)), 'utf8')) as {
  envelope: unknown;
  canonical: string;
  hash: string;
};

describe('TICKET_1303_1_8 shared attribution contracts', () => {
  it('pins_versions_schema_and_canonical_cross_repository_fixture', () => {
    expect(AGENT_USAGE_CONTRACT_VERSION).toBe('1.0.0');
    expect(INFERENCE_ATTRIBUTION_SCHEMA_VERSION).toBe('1.0.0');
    expect(GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION).toBe('1.0.0');
    expect(GOVERNANCE_EVIDENCE_ENVELOPE_VERSION).toBe('1');
    expect(GOVERNANCE_EVIDENCE_SCHEMA_VERSION).toBe('1.0.0');
    expect(GOVERNANCE_EVIDENCE_ENVELOPE_V1_JSON_SCHEMA)
      .toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema' });
    expect(governanceEvidenceEnvelopeV1Schema.parse(fixture.envelope))
      .toEqual(fixture.envelope);
    const canonical = canonicalAgentJson(fixture.envelope);
    expect(canonical).toBe(fixture.canonical);
    expect(`sha256:${createHash('sha256').update(canonical).digest('hex')}`)
      .toBe(fixture.hash);
  });

  it('enforces_unavailable_reported_cost_and_route_usage_invariants', () => {
    const base = {
      contractVersion: AGENT_USAGE_CONTRACT_VERSION,
      taskId: 'task-1',
      turnId: 'turn-1',
      admissionFingerprint: 'a'.repeat(64),
      runtimeId: 'stratcraft',
      entitlementSource: 'provider-api-key',
      payerClass: 'user',
      providerId: 'OPENAI',
      modelId: 'gpt-5',
    } as const;
    expect(agentUsageV1Schema.safeParse({
      ...base,
      source: 'unavailable',
      completeness: 'unavailable',
    }).success).toBe(true);
    expect(agentUsageV1Schema.safeParse({
      ...base,
      source: 'unavailable',
      completeness: 'unavailable',
      inputTokens: 0,
    }).success).toBe(false);
    expect(agentUsageV1Schema.safeParse({
      ...base,
      source: 'provider_reported',
      completeness: 'complete',
      inputTokens: 1,
    }).success).toBe(false);
    expect(agentUsageV1Schema.safeParse({
      ...base,
      providerEventId: 'provider-event-1',
      source: 'provider_reported',
      completeness: 'partial',
      providerCost: '1.25',
    }).success).toBe(false);
    expect(agentUsageV1Schema.safeParse({
      ...base,
      providerEventId: 'provider-event-1',
      source: 'provider_reported',
      completeness: 'partial',
      providerCost: '1.25',
      currency: 'USD',
      pricingReference: 'price-1',
    }).success).toBe(true);
  });

  it('preserves_receipt_assurance_revocation_and_credit_without_fake_success', () => {
    const base = {
      schemaVersion: GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION,
      eventId: 'event-1',
      taskId: 'task-1',
      admissionFingerprint: 'a'.repeat(64),
      policyHashes: [],
      evidenceHashes: [],
      operation: 'evidence_receipt_recorded',
      occurredAt: '2026-07-26T00:00:00.000Z',
      recordedAt: '2026-07-26T00:00:00.000Z',
    } as const;
    expect(governanceAttributionV1Schema.safeParse({
      ...base,
      submissionState: 'claim_recorded',
    }).success).toBe(false);
    expect(governanceAttributionV1Schema.safeParse({
      ...base,
      serverReceiptId: 'receipt-1',
      receiptSignature: 'signature',
      receiptKeyId: 'key-1',
      assuranceLevel: 'client_verified',
      submissionState: 'client_verified',
    }).success).toBe(true);
    expect(governanceAttributionV1Schema.safeParse({
      ...base,
      serverReceiptId: 'receipt-1',
      assuranceLevel: 'server_verified',
      submissionState: 'client_verified',
    }).success).toBe(false);
    expect(governanceAttributionV1Schema.safeParse({
      ...base,
      serverReceiptId: 'receipt-1',
      submissionState: 'revoked',
    }).success).toBe(false);
    expect(governanceAttributionV1Schema.safeParse({
      ...base,
      creditUnit: 'governance-credit',
      submissionState: 'submitted',
    }).success).toBe(false);
  });
});
