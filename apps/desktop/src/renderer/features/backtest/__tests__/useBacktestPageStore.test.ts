/**
 * TICKET_1208 P3: useBacktestPageStore Tests
 *
 * Validates cockpit selection preservation across view switches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useBacktestPageStore } from '../useBacktestPageStore';

describe('useBacktestPageStore', () => {
  beforeEach(() => {
    useBacktestPageStore.setState({
      viewState: 'hub',
      selectedCockpit: null,
    });
  });

  it('should start at hub with no cockpit selected', () => {
    const state = useBacktestPageStore.getState();
    expect(state.viewState).toBe('hub');
    expect(state.selectedCockpit).toBeNull();
  });

  it('should set viewState', () => {
    useBacktestPageStore.getState().setViewState('indicators');
    expect(useBacktestPageStore.getState().viewState).toBe('indicators');
  });

  it('should set selectedCockpit', () => {
    useBacktestPageStore.getState().setSelectedCockpit('kronos');
    expect(useBacktestPageStore.getState().selectedCockpit).toBe('kronos');
  });

  it('should resetToHub clearing viewState and selectedCockpit', () => {
    useBacktestPageStore.getState().setViewState('trader');
    useBacktestPageStore.getState().setSelectedCockpit('trader');

    useBacktestPageStore.getState().resetToHub();

    const state = useBacktestPageStore.getState();
    expect(state.viewState).toBe('hub');
    expect(state.selectedCockpit).toBeNull();
  });

  it('should preserve state across multiple set calls (simulates unmount/remount)', () => {
    useBacktestPageStore.getState().setViewState('aiStudio');
    useBacktestPageStore.getState().setSelectedCockpit('aiStudio');

    const afterRemount = useBacktestPageStore.getState();
    expect(afterRemount.viewState).toBe('aiStudio');
    expect(afterRemount.selectedCockpit).toBe('aiStudio');
  });

  it('should allow setting viewState to catalog', () => {
    useBacktestPageStore.getState().setViewState('catalog');
    useBacktestPageStore.getState().setSelectedCockpit('catalog');
    expect(useBacktestPageStore.getState().viewState).toBe('catalog');
    expect(useBacktestPageStore.getState().selectedCockpit).toBe('catalog');
  });
});
