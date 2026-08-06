/**
 * useAssistantShortcut Unit Tests (TICKET_593_1)
 *
 * Tests the Ctrl+L keyboard shortcut hook for the assistant panel.
 * Uses a mock document since tests run in Node environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

let mockAssistantEnabled = true;
const mockTogglePanel = vi.fn();

let effectCallback: (() => (() => void) | void) | null = null;

vi.mock('react', () => ({
  useEffect: (cb: () => (() => void) | void) => {
    effectCallback = cb;
  },
}));

vi.mock('@/stores', () => ({
  useAssistantStore: (selector: any) => {
    const state = {
      assistantEnabled: mockAssistantEnabled,
      togglePanel: mockTogglePanel,
    };
    return selector(state);
  },
}));

// =============================================================================
// Mock document
// =============================================================================

const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

// Provide document if not available (Node environment)
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
  };
}

// =============================================================================
// Import after mocks
// =============================================================================

import { useAssistantShortcut } from '../useAssistantShortcut';

// =============================================================================
// Tests
// =============================================================================

describe('useAssistantShortcut (TICKET_593_1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssistantEnabled = true;
    effectCallback = null;

    // Reset mock document functions
    if (typeof document !== 'undefined') {
      document.addEventListener = mockAddEventListener;
      document.removeEventListener = mockRemoveEventListener;
    }
  });

  it('should register keydown listener when assistant is enabled', () => {
    useAssistantShortcut();
    expect(effectCallback).toBeDefined();

    effectCallback!();
    expect(mockAddEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should not register listener when assistant is disabled', () => {
    mockAssistantEnabled = false;
    useAssistantShortcut();

    const cleanup = effectCallback!();
    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(cleanup).toBeUndefined();
  });

  it('should call togglePanel on Ctrl+L', () => {
    useAssistantShortcut();
    effectCallback!();

    const handler = mockAddEventListener.mock.calls[0][1] as (e: any) => void;
    const event = { key: 'l', ctrlKey: true, preventDefault: vi.fn() };

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockTogglePanel).toHaveBeenCalled();
  });

  it('should not call togglePanel on plain L key', () => {
    useAssistantShortcut();
    effectCallback!();

    const handler = mockAddEventListener.mock.calls[0][1] as (e: any) => void;
    const event = { key: 'l', ctrlKey: false, preventDefault: vi.fn() };

    handler(event);

    expect(mockTogglePanel).not.toHaveBeenCalled();
  });

  it('should not call togglePanel on Ctrl+other key', () => {
    useAssistantShortcut();
    effectCallback!();

    const handler = mockAddEventListener.mock.calls[0][1] as (e: any) => void;
    const event = { key: 'k', ctrlKey: true, preventDefault: vi.fn() };

    handler(event);

    expect(mockTogglePanel).not.toHaveBeenCalled();
  });

  it('should remove listener on cleanup', () => {
    useAssistantShortcut();
    const cleanup = effectCallback!();

    expect(typeof cleanup).toBe('function');
    (cleanup as Function)();

    expect(mockRemoveEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
