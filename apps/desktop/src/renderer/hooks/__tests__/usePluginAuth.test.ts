/**
 * usePluginAuth Unit Tests
 *
 * TICKET_571: Tests for the unified plugin auth hook.
 * Tests the hook's IPC subscription logic via direct module testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

const mockGetState = vi.fn();
const mockOnStateChanged = vi.fn();
const mockUnsubscribe = vi.fn();

// Mock React hooks to test effect logic
let effectCallback: (() => (() => void) | void) | null = null;
let stateValue = false;
let stateSetter: (val: boolean) => void;

vi.mock('react', () => ({
  useState: (initial: boolean) => {
    stateValue = initial;
    stateSetter = (val: boolean) => { stateValue = val; };
    return [stateValue, stateSetter];
  },
  useEffect: (cb: () => (() => void) | void) => {
    effectCallback = cb;
  },
}));

function setupElectronAPI(hasAuth = true) {
  (globalThis as any).window = {
    electronAPI: hasAuth
      ? {
          auth: {
            getState: mockGetState,
            onStateChanged: mockOnStateChanged,
          },
        }
      : {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('usePluginAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateValue = false;
    effectCallback = null;
    mockOnStateChanged.mockReturnValue(mockUnsubscribe);
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.resetModules();
  });

  it('should return isAuthenticated=false initially', async () => {
    setupElectronAPI();
    const { usePluginAuth } = await import('../usePluginAuth');
    const result = usePluginAuth();
    expect(result.isAuthenticated).toBe(false);
  });

  it('should call getState and onStateChanged when auth API is available', async () => {
    mockGetState.mockResolvedValue({ success: true, data: { isAuthenticated: true } });
    setupElectronAPI();

    const { usePluginAuth } = await import('../usePluginAuth');
    usePluginAuth();

    // Run the effect
    expect(effectCallback).not.toBeNull();
    effectCallback!();

    expect(mockGetState).toHaveBeenCalledOnce();
    expect(mockOnStateChanged).toHaveBeenCalledOnce();

    // Wait for getState promise
    await vi.waitFor(() => {
      expect(stateValue).toBe(true);
    });
  });

  it('should update state when auth changes via subscription', async () => {
    mockGetState.mockResolvedValue({ success: true, data: { isAuthenticated: false } });
    let changeCallback: ((data: { isAuthenticated: boolean }) => void) | null = null;
    mockOnStateChanged.mockImplementation((cb: (data: { isAuthenticated: boolean }) => void) => {
      changeCallback = cb;
      return mockUnsubscribe;
    });
    setupElectronAPI();

    const { usePluginAuth } = await import('../usePluginAuth');
    usePluginAuth();
    effectCallback!();

    await vi.waitFor(() => {
      expect(changeCallback).not.toBeNull();
    });

    // Simulate auth state change
    changeCallback!({ isAuthenticated: true });
    expect(stateValue).toBe(true);
  });

  it('should return cleanup function that unsubscribes', async () => {
    mockGetState.mockResolvedValue({ success: true, data: { isAuthenticated: false } });
    setupElectronAPI();

    const { usePluginAuth } = await import('../usePluginAuth');
    usePluginAuth();

    const cleanup = effectCallback!();
    expect(typeof cleanup).toBe('function');

    (cleanup as () => void)();
    expect(mockUnsubscribe).toHaveBeenCalledOnce();
  });

  it('should not call auth API when not available', async () => {
    setupElectronAPI(false);

    const { usePluginAuth } = await import('../usePluginAuth');
    usePluginAuth();

    // Effect should return early
    const cleanup = effectCallback!();
    expect(mockGetState).not.toHaveBeenCalled();
    expect(mockOnStateChanged).not.toHaveBeenCalled();
    expect(cleanup).toBeUndefined();
  });

  it('should handle getState failure gracefully', async () => {
    mockGetState.mockResolvedValue({ success: false, error: 'Network error' });
    setupElectronAPI();

    const { usePluginAuth } = await import('../usePluginAuth');
    usePluginAuth();
    effectCallback!();

    await vi.waitFor(() => {
      expect(mockGetState).toHaveBeenCalledOnce();
    });

    // State should remain false (not updated)
    expect(stateValue).toBe(false);
  });

  it('should handle getState with null data gracefully', async () => {
    mockGetState.mockResolvedValue({ success: true, data: null });
    setupElectronAPI();

    const { usePluginAuth } = await import('../usePluginAuth');
    usePluginAuth();
    effectCallback!();

    await vi.waitFor(() => {
      expect(mockGetState).toHaveBeenCalledOnce();
    });

    expect(stateValue).toBe(false);
  });
});
