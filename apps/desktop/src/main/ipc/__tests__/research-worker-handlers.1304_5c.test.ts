import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, logError } = vi.hoisted(() => ({
  handlers: new Map<string, () => Promise<unknown>>(),
  logError: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: () => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    error: logError,
  }),
}));

vi.mock('../../services/research-worker-supervisor', () => ({
  getResearchWorkerSupervisor: vi.fn(),
}));

import { RESEARCH_WORKER_CHANNELS } from '../../../shared/constants/channels';
import { registerResearchWorkerHandlers } from '../research-worker-handlers';

describe('TICKET_1304_5C research worker discovery IPC', () => {
  beforeEach(() => {
    handlers.clear();
    logError.mockClear();
  });

  it('returns the supervisor public discovery projection unchanged', async () => {
    const discovery = {
      state: 'ready' as const,
      packageVersion: '1.0.0',
      protocolVersion: '1.0.0',
      capabilities: [{
        capabilityId: 'research.discovery' as const,
        contractVersion: '1.0.0',
      }],
      packageManifestSha256: 'a'.repeat(64),
    };
    registerResearchWorkerHandlers({
      discover: vi.fn(async () => discovery),
    });
    await expect(handlers.get(RESEARCH_WORKER_CHANNELS.DISCOVER)?.()).resolves.toEqual(
      discovery,
    );
  });

  it('converts unexpected discovery failures into actionable renderer errors', async () => {
    registerResearchWorkerHandlers({
      discover: vi.fn(async () => {
        throw new Error('trust store unavailable');
      }),
    });
    await expect(handlers.get(RESEARCH_WORKER_CHANNELS.DISCOVER)?.()).resolves.toEqual({
      state: 'error',
      code: 'WORKER_REQUEST_INVALID',
      message: 'trust store unavailable',
      remediation: 'Repair StratCraft or reinstall Quant Lab, then retry discovery.',
    });
    expect(logError).toHaveBeenCalledOnce();
  });
});
