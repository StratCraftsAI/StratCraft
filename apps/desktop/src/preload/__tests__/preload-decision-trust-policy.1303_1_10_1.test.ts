import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  exposed: undefined as unknown,
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: state.invoke,
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: unknown) => {
      state.exposed = api;
    }),
  },
}));

describe('preload decision trust policy bridge', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    state.exposed = undefined;
    state.invoke.mockResolvedValue({ status: 'cancelled' });
    await import('../index');
  });

  it('exposes only an argument-free Main-process navigation intent', async () => {
    const api = state.exposed as {
      decisionTrustPolicy: {
        openSettings(): Promise<unknown>;
      };
    };
    await expect(api.decisionTrustPolicy.openSettings()).resolves.toEqual({
      status: 'cancelled',
    });
    expect(state.invoke).toHaveBeenCalledWith('trust-policy:open-settings');
  });
});
