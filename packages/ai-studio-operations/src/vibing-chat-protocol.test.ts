/**
 * Vibing Chat Protocol Unit Tests
 *
 * TICKET_1315 Block F (F1): action-trigger mapping (section 4.2),
 * available_actions gating, content-vs-strategy_code extraction (section 4.6),
 * and payload building.
 */

import { describe, it, expect } from 'vitest';
import {
  extractStrategyCode,
  actionToMessage,
  isActionAvailable,
  buildVibingChatPayload,
  VIBING_CHAT_ACTIONS,
  type VibingChatResult,
  type VibingChatAction,
} from './vibing-chat-protocol';

// =============================================================================
// F1: Action-trigger mapping (section 4.2)
// =============================================================================

describe('actionToMessage', () => {
  it('wraps generate_code in angle brackets', () => {
    expect(actionToMessage('generate_code')).toBe('<generate_code>');
  });

  it('wraps save_strategy in angle brackets', () => {
    expect(actionToMessage('save_strategy')).toBe('<save_strategy>');
  });

  it('wraps run_backtest in angle brackets', () => {
    expect(actionToMessage('run_backtest')).toBe('<run_backtest>');
  });
});

describe('VIBING_CHAT_ACTIONS constants', () => {
  it('maps symbolic names to their string actions', () => {
    expect(VIBING_CHAT_ACTIONS.GENERATE_CODE).toBe('generate_code');
    expect(VIBING_CHAT_ACTIONS.SAVE_STRATEGY).toBe('save_strategy');
    expect(VIBING_CHAT_ACTIONS.RUN_BACKTEST).toBe('run_backtest');
  });
});

// =============================================================================
// F1: available_actions gating
// =============================================================================

describe('isActionAvailable', () => {
  it('returns true when action is in available_actions', () => {
    expect(isActionAvailable(['generate_code', 'chat'], 'generate_code')).toBe(true);
  });

  it('returns false when action is not in available_actions', () => {
    expect(isActionAvailable(['chat'], 'generate_code')).toBe(false);
  });

  it('returns false for undefined available_actions', () => {
    expect(isActionAvailable(undefined, 'generate_code')).toBe(false);
  });

  it('returns false for empty available_actions', () => {
    expect(isActionAvailable([], 'save_strategy')).toBe(false);
  });

  it('handles has_existing_code branch via save_strategy gating', () => {
    expect(isActionAvailable(['save_strategy', 'regenerate'], 'save_strategy')).toBe(true);
    expect(isActionAvailable(['regenerate'], 'save_strategy')).toBe(false);
  });
});

// =============================================================================
// F1: content-vs-strategy_code extraction (section 4.6)
// =============================================================================

describe('extractStrategyCode', () => {
  it('extracts from content when type is strategy_code (primary path)', () => {
    const result: VibingChatResult = {
      type: 'strategy_code',
      content: 'class RSIMeanReversion {};',
    };
    expect(extractStrategyCode(result)).toBe('class RSIMeanReversion {};');
  });

  it('does not extract from content when type is not strategy_code', () => {
    const result: VibingChatResult = {
      type: 'text',
      content: 'I analyzed your strategy...',
      strategy_code: 'class Fallback {};',
    };
    expect(extractStrategyCode(result)).toBe('class Fallback {};');
  });

  it('falls back to strategy_code field', () => {
    const result: VibingChatResult = {
      strategy_code: 'class SnakeCase {};',
    };
    expect(extractStrategyCode(result)).toBe('class SnakeCase {};');
  });

  it('falls back to strategyCode field', () => {
    const result: VibingChatResult = {
      strategyCode: 'class CamelCase {};',
    };
    expect(extractStrategyCode(result)).toBe('class CamelCase {};');
  });

  it('returns null when no code is present', () => {
    const result: VibingChatResult = {
      type: 'text',
      content: 'No strategy code here',
    };
    expect(extractStrategyCode(result)).toBeNull();
  });

  it('prefers content (type=strategy_code) over strategy_code field', () => {
    const result: VibingChatResult = {
      type: 'strategy_code',
      content: 'class Primary {};',
      strategy_code: 'class Fallback {};',
    };
    expect(extractStrategyCode(result)).toBe('class Primary {};');
  });

  it('returns null when type is strategy_code but content is empty', () => {
    const result: VibingChatResult = {
      type: 'strategy_code',
      content: '',
    };
    expect(extractStrategyCode(result)).toBeNull();
  });
});

// =============================================================================
// F1: buildVibingChatPayload
// =============================================================================

describe('buildVibingChatPayload', () => {
  const baseParams = {
    sessionId: 'sess-1',
    message: 'build me a RSI strategy',
    strategyName: 'RSIStrat',
    llmProvider: 'openai',
    llmModel: 'gpt-4',
  };

  it('produces a payload with all required fields', () => {
    const payload = buildVibingChatPayload(baseParams);
    expect(payload.session_id).toBe('sess-1');
    expect(payload.message).toBe('build me a RSI strategy');
    expect(payload.strategy_name).toBe('RSIStrat');
    expect(payload.model).toBe('openai');
    expect(payload.llm_model).toBe('gpt-4');
    expect(payload.output_format).toBe('v3');
    expect(payload.storage_mode).toBe('local');
    expect(payload.locale).toBe('en_US');
    expect(payload.task_id).toEqual(expect.any(String));
  });

  it('allows explicit taskId override', () => {
    const payload = buildVibingChatPayload({ ...baseParams, taskId: 'custom-task-1' });
    expect(payload.task_id).toBe('custom-task-1');
  });

  it('includes current_strategy_rules when provided', () => {
    const rules = { entry_conditions: [{ type: 'indicator', condition: 'RSI < 30' }] };
    const payload = buildVibingChatPayload({ ...baseParams, currentStrategyRules: rules });
    expect(payload.current_strategy_rules).toEqual(rules);
  });

  it('omits optional fields when not provided', () => {
    const payload = buildVibingChatPayload(baseParams);
    expect(payload).not.toHaveProperty('message_id');
    expect(payload).not.toHaveProperty('strategy_id');
    expect(payload).not.toHaveProperty('language');
    expect(payload).not.toHaveProperty('current_strategy_rules');
  });

  it('includes message_id, strategy_id, language when provided', () => {
    const payload = buildVibingChatPayload({
      ...baseParams,
      messageId: 'msg-1',
      strategyId: 'strat-1',
      language: 'cpp',
    });
    expect(payload.message_id).toBe('msg-1');
    expect(payload.strategy_id).toBe('strat-1');
    expect(payload.language).toBe('cpp');
  });
});
