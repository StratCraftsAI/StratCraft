import { expect, test } from '@playwright/test';
import { projectGovernanceAttribution } from '@StratCraft/types';

test('guide_and_electron_consume_one_governance_projection', () => {
  const attribution = {
    schemaVersion: '1.0.0' as const,
    eventId: 'event-1', taskId: 'task-1', admissionFingerprint: 'a'.repeat(64),
    policyHashes: [], evidenceHashes: [], operation: 'local_admission' as const,
    localResult: 'accepted' as const, submissionState: 'queued_offline' as const,
    occurredAt: '2026-08-03T00:00:00.000Z', recordedAt: '2026-08-03T00:00:00.000Z',
  };
  const guideProjection = projectGovernanceAttribution(attribution);
  const electronProjection = projectGovernanceAttribution(attribution);
  expect(electronProjection).toEqual(guideProjection);
  expect(guideProjection.localAdmission?.result).toBe('accepted');
  expect(guideProjection.remoteSubmission?.state).toBe('queued_offline');
});
