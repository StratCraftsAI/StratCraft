import { describe, expect, it } from 'vitest';

import {
  getGenerationErrorMessage,
  parseGenerationPollResponse,
  parseGenerationStartResponse,
} from '../generation-response-contract';

describe('generation response contract', () => {
  it('validates start and poll response envelopes at the HTTP boundary', () => {
    expect(parseGenerationStartResponse({
      success: true,
      data: {
        task_id: 'task-1341',
        result: { status: 'completed', strategy_code: 'class Strategy {}' },
      },
    })).toMatchObject({
      success: true,
      data: { task_id: 'task-1341' },
    });

    expect(parseGenerationPollResponse({
      data: { status: 'failed', error: { message: 'backend rejected input' } },
    })).toMatchObject({
      data: { status: 'failed', error: { message: 'backend rejected input' } },
    });
  });

  it.each([
    ['start task id', () => parseGenerationStartResponse({ task_id: 1341 })],
    ['nested start data', () => parseGenerationStartResponse({ data: 'invalid' })],
    ['poll error payload', () => parseGenerationPollResponse({ error: 1341 })],
  ])('rejects a malformed %s', (_label, parse) => {
    expect(parse).toThrow();
  });

  it('normalizes only validated backend error messages', () => {
    expect(getGenerationErrorMessage('plain failure')).toBe('plain failure');
    expect(getGenerationErrorMessage({ message: 'structured failure', code: 'REJECTED' }))
      .toBe('structured failure');
    expect(getGenerationErrorMessage({ code: 'MISSING_MESSAGE' })).toBeUndefined();
    expect(getGenerationErrorMessage(1341)).toBeUndefined();
  });
});
