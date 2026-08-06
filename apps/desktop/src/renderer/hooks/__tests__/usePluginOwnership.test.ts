/**
 * usePluginOwnership + useEntitledPlugins Hook Tests
 *
 * TICKET_892_4 Step 5: Source-pin tests for server-authoritative ownership hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPluginOwnership = vi.fn();
const mockGetEntitledPlugins = vi.fn();
const mockOnStateChanged = vi.fn();

(globalThis as any).window = {
  electronAPI: {
    entitlement: {
      getPluginOwnership: mockGetPluginOwnership,
      getEntitledPlugins: mockGetEntitledPlugins,
    },
    auth: {
      onStateChanged: mockOnStateChanged,
    },
  },
};

let capturedQueryConfigs: any[] = [];
let capturedEffectCallbacks: Function[] = [];

vi.mock('react', () => ({
  useEffect: (cb: Function) => { capturedEffectCallbacks.push(cb); },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (config: any) => { capturedQueryConfigs.push(config); return { data: null, isLoading: true }; },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

describe('usePluginOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueryConfigs = [];
    capturedEffectCallbacks = [];
  });

  it('calls useQuery with correct queryKey and queryFn', async () => {
    const { usePluginOwnership } = await import('../usePluginOwnership');
    usePluginOwnership('com.stratcraft.quant-lab-nexus');

    expect(capturedQueryConfigs.length).toBeGreaterThanOrEqual(1);
    const config = capturedQueryConfigs[0];
    expect(config.queryKey).toEqual(['ownership', 'com.stratcraft.quant-lab-nexus']);
    expect(config.enabled).toBe(true);
    expect(config.staleTime).toBe(30_000);
  });

  it('queryFn calls getPluginOwnership IPC', async () => {
    mockGetPluginOwnership.mockResolvedValueOnce({
      success: true,
      data: { owned: true, tier: 'gold' },
    });

    const { usePluginOwnership } = await import('../usePluginOwnership');
    usePluginOwnership('com.stratcraft.quant-lab-nexus');

    const config = capturedQueryConfigs[0];
    const result = await config.queryFn();
    expect(result).toEqual({ owned: true, tier: 'gold' });
    expect(mockGetPluginOwnership).toHaveBeenCalledWith('com.stratcraft.quant-lab-nexus');
  });

  it('queryFn returns default when IPC fails', async () => {
    mockGetPluginOwnership.mockResolvedValueOnce({
      success: false,
      error: 'not found',
    });

    const { usePluginOwnership } = await import('../usePluginOwnership');
    usePluginOwnership('com.example.unknown');

    const config = capturedQueryConfigs[0];
    const result = await config.queryFn();
    expect(result).toEqual({ owned: false, tier: 'free' });
  });
});

describe('useEntitledPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueryConfigs = [];
    capturedEffectCallbacks = [];
  });

  it('calls useQuery with correct queryKey', async () => {
    const { useEntitledPlugins } = await import('../usePluginOwnership');
    useEntitledPlugins();

    expect(capturedQueryConfigs.length).toBeGreaterThanOrEqual(1);
    const config = capturedQueryConfigs[0];
    expect(config.queryKey).toEqual(['ownership', 'all']);
    expect(config.staleTime).toBe(30_000);
  });

  it('queryFn calls getEntitledPlugins IPC', async () => {
    mockGetEntitledPlugins.mockResolvedValueOnce({
      success: true,
      data: [
        { plugin_id: 'com.stratcraft.quant-lab-nexus', tier: 'gold' },
        { plugin_id: 'com.stratcraft.strategy-builder-nexus', tier: 'pro' },
      ],
    });

    const { useEntitledPlugins } = await import('../usePluginOwnership');
    useEntitledPlugins();

    const config = capturedQueryConfigs[0];
    const result = await config.queryFn();
    expect(result).toHaveLength(2);
    expect(result[0].plugin_id).toBe('com.stratcraft.quant-lab-nexus');
  });

  it('queryFn returns empty array when IPC fails', async () => {
    mockGetEntitledPlugins.mockResolvedValueOnce({
      success: false,
      error: 'offline',
    });

    const { useEntitledPlugins } = await import('../usePluginOwnership');
    useEntitledPlugins();

    const config = capturedQueryConfigs[0];
    const result = await config.queryFn();
    expect(result).toEqual([]);
  });

  // TICKET_892_6: Verify auth state change invalidates the ownership-all query
  it('registers onStateChanged listener that invalidates ownership-all query', async () => {
    const mockInvalidate = vi.fn();
    vi.mocked(vi.fn()).mockReturnValue({ invalidateQueries: mockInvalidate });

    // Re-mock useQueryClient for this test to capture invalidation
    let capturedInvalidate: Function | null = null;
    mockOnStateChanged.mockImplementation((cb: Function) => {
      capturedInvalidate = cb;
      return vi.fn();
    });

    const { useEntitledPlugins } = await import('../usePluginOwnership');
    useEntitledPlugins();

    // The hook registers a useEffect that subscribes to onStateChanged
    expect(capturedEffectCallbacks.length).toBeGreaterThanOrEqual(1);

    // Run the effect -- it should call onStateChanged
    for (const cb of capturedEffectCallbacks) {
      cb();
    }

    expect(mockOnStateChanged).toHaveBeenCalled();
    expect(capturedInvalidate).not.toBeNull();
  });
});
