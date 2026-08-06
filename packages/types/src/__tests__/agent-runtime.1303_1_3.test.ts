import { describe, expect, it } from 'vitest';
import {
  AGENT_USAGE_CONTRACT_VERSION,
  NORMALIZED_AGENT_EVENT_CONTRACT_VERSION,
  NORMALIZED_AGENT_EVENT_TYPES,
  type NormalizedAgentEventPayloadMap,
} from '../agent-runtime';

describe('TICKET_1303_1_3 normalized Agent event contract', () => {
  it('exports the complete versioned closed discriminator set', () => {
    // TICKET_1352: 2.0 removes raw terminal display strings.
    expect(NORMALIZED_AGENT_EVENT_CONTRACT_VERSION).toBe('2.1.0');
    expect(AGENT_USAGE_CONTRACT_VERSION).toBe('1.0.0');
    expect(NORMALIZED_AGENT_EVENT_TYPES).toEqual([
      'turn_started',
      'text_delta',
      'thought_delta',
      'plan_updated',
      'tool_started',
      'tool_progress',
      'tool_completed',
      'tool_visualization',
      'permission_requested',
      'permission_resolved',
      'governance_reported',
      'file_change_proposed',
      'file_change_applied',
      'usage_reported',
      'candidate_artifact_ready',
      'artifact_admission_started',
      'artifact_admission_stage',
      'artifact_accepted',
      'artifact_rejected',
      'turn_failed',
      'turn_cancelled',
      'turn_completed',
    ]);
  });

  it('keeps permission scope bound to the expected payload hash', () => {
    const payload: NormalizedAgentEventPayloadMap['permission_requested'] = {
        scope: {
          mcpSessionId: 'session-1',
          taskId: 'task-1',
          turnId: 'turn-1',
          workspaceId: 'workspace-1',
          requestId: 'request-1',
          capability: 'delete_signal',
          expectedPayloadHash: 'a'.repeat(64),
        },
        operation: 'delete_signal',
        requestPayload: { id: 1 },
        riskTier: 'high',
        expiresAt: '2026-07-26T00:05:00.000Z',
      };
    expect(payload.scope).toMatchObject({
      mcpSessionId: 'session-1',
      taskId: 'task-1',
      turnId: 'turn-1',
      workspaceId: 'workspace-1',
      requestId: 'request-1',
      capability: 'delete_signal',
      expectedPayloadHash: 'a'.repeat(64),
    });
  });
});
