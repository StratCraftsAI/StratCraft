/**
 * AssistantPanel Component Unit Tests (TICKET_593_1)
 *
 * Tests rendering logic, open/close behavior, and content resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

let mockPanelOpen = false;
const mockSetPanelOpen = vi.fn();
const mockPushContent = vi.fn();
const mockPopContent = vi.fn();
let mockContentOverrideKey: string | null = null;
let mockActiveView = 'strategy';
let mockSubPagePath: any[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('lucide-react', () => ({
  X: ({ className }: { className: string }) => `<X class="${className}" />`,
  BookOpen: ({ className }: { className: string }) => `<BookOpen class="${className}" />`,
  ArrowLeft: ({ className }: { className: string }) => `<ArrowLeft class="${className}" />`,
}));

vi.mock('@/stores', () => ({
  useAssistantStore: (selector: any) => {
    const state = {
      panelOpen: mockPanelOpen,
      setPanelOpen: mockSetPanelOpen,
      contentOverrideKey: mockContentOverrideKey,
      pushContent: mockPushContent,
      popContent: mockPopContent,
    };
    return selector(state);
  },
  useAppStore: (selector: any) => {
    const state = {
      activeView: mockActiveView,
      subPagePath: mockSubPagePath,
    };
    return selector(state);
  },
}));

vi.mock('@/config/assistant-help-registry', () => ({
  resolveHelpContent: vi.fn().mockReturnValue(null),
  getContentByKey: vi.fn().mockReturnValue(null),
}));

vi.mock('@shared/constants/z-index', () => ({
  Z_INDEX_ASSISTANT_PANEL: 500,
}));

// Simple React mock
let lastRenderedElement: any = null;

vi.mock('react', () => {
  const createElement = (type: any, props: any, ...children: any[]) => {
    const el = { type, props: { ...props, children: children.length <= 1 ? children[0] : children } };
    lastRenderedElement = el;
    return el;
  };
  const useCallback = (fn: any) => fn;
  return {
    default: { createElement, useCallback },
    createElement,
    useCallback,
  };
});

// =============================================================================
// Tests
// =============================================================================

describe('AssistantPanel (TICKET_593_1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPanelOpen = false;
    mockContentOverrideKey = null;
    mockActiveView = 'strategy';
    mockSubPagePath = [];
    lastRenderedElement = null;
  });

  it('should render with zero width when panel is closed', async () => {
    mockPanelOpen = false;
    const { AssistantPanel } = await import('../AssistantPanel');
    const result = AssistantPanel({}) as any;

    // Panel should have width: 0 when closed
    expect(result).toBeDefined();
    expect(result.props.style.width).toBe(0);
    expect(result.props.style.minWidth).toBe(0);
  });

  it('should render with 320px width when panel is open', async () => {
    mockPanelOpen = true;
    // Need to re-import to get fresh module
    vi.resetModules();
    // Re-apply mocks for fresh import
    vi.doMock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
    vi.doMock('lucide-react', () => ({
      X: ({ className }: { className: string }) => `<X class="${className}" />`,
      BookOpen: ({ className }: { className: string }) => `<BookOpen class="${className}" />`,
      ArrowLeft: ({ className }: { className: string }) => `<ArrowLeft class="${className}" />`,
    }));
    vi.doMock('@/stores', () => ({
      useAssistantStore: (selector: any) => selector({ panelOpen: true, setPanelOpen: mockSetPanelOpen, contentOverrideKey: null, pushContent: mockPushContent, popContent: mockPopContent }),
      useAppStore: (selector: any) => selector({ activeView: 'strategy', subPagePath: [] }),
    }));
    vi.doMock('@/config/assistant-help-registry', () => ({ resolveHelpContent: vi.fn().mockReturnValue(null), getContentByKey: vi.fn().mockReturnValue(null) }));
    vi.doMock('@shared/constants/z-index', () => ({ Z_INDEX_ASSISTANT_PANEL: 500 }));
    vi.doMock('react', () => {
      const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children: children.length <= 1 ? children[0] : children } });
      const useCallback = (fn: any) => fn;
      return { default: { createElement, useCallback }, createElement, useCallback };
    });

    const { AssistantPanel } = await import('../AssistantPanel');
    const result = AssistantPanel({}) as any;

    expect(result).toBeDefined();
    expect(result.props.style.width).toBe(320);
    expect(result.props.style.minWidth).toBe(320);
  });

  it('should have correct z-index', async () => {
    const { AssistantPanel } = await import('../AssistantPanel');
    const result = AssistantPanel({}) as any;

    expect(result.props.style.zIndex).toBe(500);
  });

  it('should have correct data-testid', async () => {
    const { AssistantPanel } = await import('../AssistantPanel');
    const result = AssistantPanel({}) as any;

    expect(result.props['data-testid']).toBe('assistant-panel');
  });
});
