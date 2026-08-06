import { describe, expect, it } from 'vitest';
import type {
  AgentToolOutcomeV1,
  NormalizedAgentEventPayloadMap,
} from '../agent-runtime';

describe('TICKET_1352 Agent outcome contract', () => {
  it('canonical_outcome_separates_execution_state_terminal_reason_and_user_message', () => {
    const outcome: AgentToolOutcomeV1 = {
      code: 'permission_expired',
      executionState: 'not_executed',
      terminalReason: 'permission_expired',
      presentation: {
        messageKey: 'agentOutcome.permissionExpired',
        parameters: {},
        recoveryKey: 'agentOutcome.retryRequest',
        severity: 'warning',
      },
    };
    expect(outcome.executionState).toBe('not_executed');
    expect(outcome.terminalReason).toBe('permission_expired');
    expect(outcome.presentation.messageKey).toBe('agentOutcome.permissionExpired');
  });

  it('normalized_contract_carries_no_unvalidated_raw_display_text', () => {
    const payload: NormalizedAgentEventPayloadMap['tool_completed'] = {
      callId: 'call-1',
      toolName: 'install_research_environment',
      outcome: {
        code: 'permission_expired',
        executionState: 'not_executed',
        terminalReason: 'permission_expired',
        presentation: {
          messageKey: 'agentOutcome.permissionExpired',
          parameters: {},
          severity: 'warning',
        },
      },
    };
    expect(payload).not.toHaveProperty('result');
    expect(payload.outcome.presentation).not.toHaveProperty('message');
  });

  it('contract_makes_execution_and_terminal_state_contradictions_unrepresentable', () => {
    const presentation = {
      messageKey: 'agentOutcome.toolSucceeded',
      parameters: {},
      severity: 'info' as const,
    };

    const contradictorySuccess: AgentToolOutcomeV1 = {
      code: 'tool_succeeded',
      executionState: 'succeeded',
      // @ts-expect-error A successful execution cannot carry a terminal reason.
      terminalReason: 'tool_failed',
      presentation,
    };
    // @ts-expect-error Every non-success execution must carry its terminal reason.
    const incompleteFailure: AgentToolOutcomeV1 = {
      code: 'tool_execution_failed',
      executionState: 'executed_failed',
      presentation,
    };

    expect(contradictorySuccess.terminalReason).toBe('tool_failed');
    expect(incompleteFailure.executionState).toBe('executed_failed');
  });
});
