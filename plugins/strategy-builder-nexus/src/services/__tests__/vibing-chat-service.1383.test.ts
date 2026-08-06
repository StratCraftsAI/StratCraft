import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeWithPolling } = vi.hoisted(() => ({
  executeWithPolling: vi.fn(),
}));

vi.mock('i18next', () => ({
  default: {
    t: (key: string, options?: { ns?: string }) => `${options?.ns}:${key}`,
  },
}));

vi.mock('../api-client', () => ({
  pluginApiClient: { executeWithPolling },
  createStandardPollHandler: vi.fn(() => vi.fn()),
}));

import { executeVibingChat } from '../vibing-chat-service';
import { decodeVibingChatTaskFailure } from '@StratCraft/ai-studio-operations/vibing-chat-protocol';

describe('TICKET_1383 Vibing Chat failed-task parity', () => {
  beforeEach(() => {
    executeWithPolling.mockReset();
  });

  it('installs the shared failed-task decoder on the Electron polling adapter', async () => {
    executeWithPolling.mockImplementationOnce(async (options) => {
      expect(options.decodeTaskFailure).toBe(decodeVibingChatTaskFailure);
      return {
        success: true,
        task_id: 'task-ok',
        session_id: 'session-1',
        status: 'completed',
      };
    });

    await expect(executeVibingChat({
      session_id: 'session-1',
      message: '<generate_code>',
    })).resolves.toMatchObject({ success: true, status: 'completed' });
  });

  it('maps a current backend code through the shared presentation identity', async () => {
    const failure = Object.assign(new Error('Raw provider failure'), {
      code: 'LLM_SERVICE_ERROR',
    });
    executeWithPolling.mockRejectedValueOnce(failure);

    await expect(executeVibingChat({
      session_id: 'session-1',
      message: '<generate_code>',
    })).rejects.toMatchObject({
      message: 'strategy-builder:errorCodes.LLM_ERROR',
      code: 'LLM_SERVICE_ERROR',
      cause: failure,
    });
  });

  it('does not relabel an unknown backend failure', async () => {
    const failure = Object.assign(new Error('Unknown provider failure'), {
      code: 'UNKNOWN_PROVIDER_CODE',
    });
    executeWithPolling.mockRejectedValueOnce(failure);

    await expect(executeVibingChat({
      session_id: 'session-1',
      message: '<generate_code>',
    })).rejects.toBe(failure);
  });
});
