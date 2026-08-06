/**
 * TICKET_634_3: useThemeStore Tests
 *
 * Tests for theme state management (node environment with DOM stubs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub document.documentElement for applyTheme()
const classList = { remove: vi.fn(), add: vi.fn() };
vi.stubGlobal('document', {
  documentElement: { classList },
});

// Stub window.matchMedia for system theme detection
vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
  matches: true, // Simulate dark mode
  addEventListener: vi.fn(),
}));

import { useThemeStore } from '../useThemeStore';

describe('useThemeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' });
  });

  it('should start with dark theme', () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.resolvedTheme).toBe('dark');
  });

  it('should set theme to light', () => {
    useThemeStore.getState().setTheme('light');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('light');
    expect(state.resolvedTheme).toBe('light');
    expect(classList.add).toHaveBeenCalledWith('light');
  });

  it('should set theme to dark', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().setTheme('dark');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.resolvedTheme).toBe('dark');
    expect(classList.add).toHaveBeenCalledWith('dark');
  });

  it('should resolve system theme based on matchMedia', () => {
    useThemeStore.getState().setTheme('system');
    const state = useThemeStore.getState();
    expect(state.theme).toBe('system');
    // matchMedia returns matches: true (dark mode)
    expect(state.resolvedTheme).toBe('dark');
  });

  it('should call applyTheme on theme change', () => {
    useThemeStore.getState().setTheme('light');
    expect(classList.remove).toHaveBeenCalledWith('light', 'dark');
    expect(classList.add).toHaveBeenCalledWith('light');
  });
});
