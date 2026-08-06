import { describe, expect, it } from 'vitest';
import {
  GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION,
  type GovernanceAttributionV1,
  type GovernanceSubmissionState,
  projectGovernanceAttribution,
} from '../agent-attribution';

function attribution(
  submissionState: GovernanceSubmissionState,
  localResult: GovernanceAttributionV1['localResult'] = 'accepted',
): GovernanceAttributionV1 {
  return {
    schemaVersion: GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION,
    eventId: 'event-1',
    taskId: 'task-1',
    admissionFingerprint: 'a'.repeat(64),
    policyHashes: [],
    evidenceHashes: [],
    operation: 'local_admission',
    ...(localResult ? { localResult } : {}),
    submissionState,
    occurredAt: '2026-08-03T00:00:00.000Z',
    recordedAt: '2026-08-03T00:00:00.000Z',
  };
}

describe('TICKET_1354 governance attribution projection', () => {
  it('distinguishes_absent_attribution_from_present_not_submitted', () => {
    expect(projectGovernanceAttribution(undefined)).toEqual({
      attributionState: 'absent',
      attributionMessageKey: 'agentGovernance.attributionAbsent',
    });
    expect(projectGovernanceAttribution(attribution('not_submitted'))).toMatchObject({
      attributionState: 'present',
      localAdmission: {
        result: 'accepted',
        messageKey: 'agentGovernance.localAccepted',
      },
      remoteSubmission: {
        state: 'not_submitted',
        messageKey: 'agentGovernance.remoteNotSubmitted',
      },
    });
  });

  it('keeps_rejected_local_admission_explicit_without_remote_submission', () => {
    expect(projectGovernanceAttribution(attribution('not_submitted', 'rejected')))
      .toMatchObject({
        localAdmission: {
          result: 'rejected',
          messageKey: 'agentGovernance.localRejected',
        },
        remoteSubmission: { state: 'not_submitted' },
      });
  });

  it.each([
    ['queued_offline', 'agentGovernance.remoteQueuedOffline'],
    ['submitted', 'agentGovernance.remoteSubmitted'],
    ['claim_recorded', 'agentGovernance.remoteClaimRecorded'],
    ['client_verified', 'agentGovernance.remoteClientVerified'],
    ['server_verified', 'agentGovernance.remoteServerVerified'],
    ['rejected', 'agentGovernance.remoteRejected'],
    ['revoked', 'agentGovernance.remoteRevoked'],
    ['failed', 'agentGovernance.remoteFailed'],
  ] as const)('projects_remote_state_%s', (state, messageKey) => {
    const projected = projectGovernanceAttribution(attribution(state));
    expect(projected.attributionState).toBe('present');
    if (projected.attributionState !== 'present') throw new Error('Expected present attribution.');
    expect(projected.remoteSubmission)
      .toEqual({ state, messageKey });
  });

  it('preserves_missing_local_result_and_credit_without_inference', () => {
    const projected = projectGovernanceAttribution({
      ...attribution('submitted'),
      localResult: undefined,
      creditValue: '2.5',
      creditUnit: 'credit',
    });
    expect(projected.attributionState).toBe('present');
    if (projected.attributionState !== 'present') throw new Error('Expected present attribution.');
    expect(projected.localAdmission).toEqual({
      result: 'unavailable',
      messageKey: 'agentGovernance.localResultUnavailable',
    });
    expect(projected.credit).toEqual({ value: '2.5', unit: 'credit' });
  });
});
