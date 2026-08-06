/**
 * TICKET_1334 P4 (D4 / AC5_1) -- preload exposure of the runtime-role pair.
 *
 * Lives in its own file rather than being appended to
 * `preload-api-functions.test.ts` because that suite carries pre-existing
 * unrelated failures; adding to it would mix this ticket's result into a red
 * file (TICKET_853).
 *
 * What must hold: the pull and the push are BOTH exposed through the
 * contextBridge on the declared channels, no Node API leaks across the boundary,
 * and the subscription returns a working unsubscribe. That last one is not a
 * formality -- a subscription without a paired `removeListener` accumulates a
 * listener on every renderer reload until the role push fans out to dead
 * handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SERVICE_API_CHANNELS } from '../../shared/constants/channels';

const mockInvoke = vi.fn().mockResolvedValue(undefined);
const mockSend = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();

let exposedApi: Record<string, any> | undefined;

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mockInvoke,
    send: mockSend,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, any>) => {
      exposedApi = api;
    },
  },
}));

async function loadPreload(): Promise<Record<string, any>> {
  await import('../index');
  if (!exposedApi) throw new Error('contextBridge.exposeInMainWorld was not called');
  return exposedApi;
}

beforeEach(() => {
  vi.resetModules();
  exposedApi = undefined;
  mockInvoke.mockReset().mockResolvedValue(undefined);
  mockSend.mockReset();
  mockOn.mockReset();
  mockRemoveListener.mockReset();
});

describe('preload serviceApi namespace (TICKET_1334 P4)', () => {
  it('exposes both halves of the TICKET_206 pair', async () => {
    const api = await loadPreload();
    expect(typeof api.serviceApi.getRole).toBe('function');
    expect(typeof api.serviceApi.onRoleChanged).toBe('function');
  });

  it('getRole invokes the declared pull channel with no arguments', async () => {
    const api = await loadPreload();
    await api.serviceApi.getRole();
    expect(mockInvoke).toHaveBeenCalledWith(SERVICE_API_CHANNELS.GET_ROLE);
  });

  it('getRole resolves the main-process state to the caller unchanged', async () => {
    const state = {
      status: 'external',
      holder: { host: 'headless', pid: 2832541, claimedAtMs: 1 },
    };
    mockInvoke.mockResolvedValueOnce(state);
    const api = await loadPreload();
    await expect(api.serviceApi.getRole()).resolves.toEqual(state);
  });

  it('onRoleChanged subscribes to the declared push channel', async () => {
    const api = await loadPreload();
    api.serviceApi.onRoleChanged(() => {});
    expect(mockOn).toHaveBeenCalledWith(
      SERVICE_API_CHANNELS.ROLE_CHANGED,
      expect.any(Function),
    );
  });

  it('onRoleChanged forwards the payload, stripping the IPC event', async () => {
    // The renderer must never receive the Electron event object -- exposing it
    // would leak `sender` and its Node-side surface across the contextBridge.
    const api = await loadPreload();
    const received: unknown[] = [];
    api.serviceApi.onRoleChanged((s: unknown) => received.push(s));
    const handler = mockOn.mock.calls[0][1];
    const state = { status: 'none' };
    handler({ sender: 'should-not-reach-the-renderer' }, state);
    expect(received).toEqual([state]);
  });

  it('returns an unsubscribe that removes the SAME handler it registered', async () => {
    // Removing a different reference is a silent no-op, so the listener would
    // survive every unmount and accumulate.
    const api = await loadPreload();
    const unsub = api.serviceApi.onRoleChanged(() => {});
    const registered = mockOn.mock.calls[0][1];
    expect(typeof unsub).toBe('function');
    unsub();
    expect(mockRemoveListener).toHaveBeenCalledWith(
      SERVICE_API_CHANNELS.ROLE_CHANGED,
      registered,
    );
  });

  it('exposes nothing beyond the two documented members', async () => {
    const api = await loadPreload();
    expect(Object.keys(api.serviceApi).sort()).toEqual(['getRole', 'onRoleChanged']);
  });
});
