import { describe, it, expect } from 'vitest';
import {
  AGENT_VISUAL_TOOL_NAMES,
  projectAgentToolVisualization,
  projectAgentToolVisualizationText,
} from '../agent-tool-visualization';

describe('TICKET_1375: AI Studio tool visualization projection', () => {
  const SESSION_RESULT = {
    session_id: 'sess_abc123',
    message: 'I extracted the Larry Williams strategy.',
    strategy_rules: {
      entry_conditions: [
        { type: 'LONG', condition: 'Williams %R(14) < -80' },
        { type: 'SHORT', condition: 'Williams %R(14) > -20' },
      ],
      exit_conditions: [
        { type: 'SIGNAL_EXIT', condition: '%R crosses above -20' },
      ],
      indicators: [{ name: 'Williams %R', period: 14 }],
      status: 'COMPLETE',
    },
    available_actions: ['generate_code'],
    metadata: {},
  };

  it('registers AI Studio session tools as visual', () => {
    expect(AGENT_VISUAL_TOOL_NAMES).toContain('start_ai_studio_session');
    expect(AGENT_VISUAL_TOOL_NAMES).toContain('continue_ai_studio_session');
    expect(AGENT_VISUAL_TOOL_NAMES).not.toContain('run_ai_studio_action');
  });

  it('projects start_ai_studio_session with available_actions as ai_studio_action', () => {
    const result = projectAgentToolVisualization(SESSION_RESULT, 'start_ai_studio_session');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('ai_studio_action');
    expect(result.payload.type).toBe('ai_studio_action');
    expect(result.payload.session_id).toBe('sess_abc123');
    expect(result.payload.available_actions).toEqual(['generate_code']);
    expect(result.payload.strategy_rules).toBeDefined();
  });

  it('projects continue_ai_studio_session with available_actions', () => {
    const result = projectAgentToolVisualization(SESSION_RESULT, 'continue_ai_studio_session');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('ai_studio_action');
  });

  it('does not project legacy save_strategy chatter after generation', () => {
    const actionResult = {
      session_id: 'sess_abc123',
      action: 'generate_code',
      strategy_code: 'class MyStrategy { ... }',
      class_name: 'MyStrategy',
      available_actions: ['save_strategy'],
    };
    const result = projectAgentToolVisualization(actionResult, 'run_ai_studio_action');
    expect(result.ok).toBe(false);
  });

  it('does NOT project when available_actions is empty', () => {
    const noActions = { ...SESSION_RESULT, available_actions: [] };
    const result = projectAgentToolVisualization(noActions, 'start_ai_studio_session');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('does not offer generate_code');
  });

  it('does NOT project when available_actions is absent', () => {
    const { available_actions: _, ...noField } = SESSION_RESULT;
    const result = projectAgentToolVisualization(noField, 'start_ai_studio_session');
    expect(result.ok).toBe(false);
  });

  it('does NOT project a session result that offers only legacy save_strategy', () => {
    const result = projectAgentToolVisualization(
      { ...SESSION_RESULT, available_actions: ['save_strategy'] },
      'continue_ai_studio_session',
    );
    expect(result.ok).toBe(false);
  });

  it('projects from JSON text via projectAgentToolVisualizationText', () => {
    const text = JSON.stringify(SESSION_RESULT);
    const result = projectAgentToolVisualizationText(text, 'start_ai_studio_session');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('ai_studio_action');
  });

  it('does NOT interfere with existing visual tool projection (bare review)', () => {
    const reviewResult = { parameters: [], validationErrors: [], planFingerprint: 'abc' };
    const result = projectAgentToolVisualization(reviewResult, 'review_factor_mining');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('workload_prelaunch_review');
  });

  it('does NOT project non-AI-Studio tools as ai_studio_action', () => {
    const result = projectAgentToolVisualization(SESSION_RESULT, 'get_guided_action');
    expect(result.ok).toBe(false);
  });
});
