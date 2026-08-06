/**
 * TICKET_1208 P1: useStrategyStudioStore Tests
 *
 * Validates navigation depth preservation across view switches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStrategyStudioStore } from '../useStrategyStudioStore';

describe('useStrategyStudioStore', () => {
  beforeEach(() => {
    useStrategyStudioStore.setState({
      currentLevel: 'hub',
      selectedNode: null,
      featureName: null,
    });
  });

  it('should start at hub with no selection', () => {
    const state = useStrategyStudioStore.getState();
    expect(state.currentLevel).toBe('hub');
    expect(state.selectedNode).toBeNull();
    expect(state.featureName).toBeNull();
  });

  it('should set currentLevel', () => {
    useStrategyStudioStore.getState().setCurrentLevel('generator');
    expect(useStrategyStudioStore.getState().currentLevel).toBe('generator');
  });

  it('should set selectedNode', () => {
    const node = { id: 'prov-1', label: 'My Provider', type: 'provider' as const };
    useStrategyStudioStore.getState().setSelectedNode(node);

    const saved = useStrategyStudioStore.getState().selectedNode;
    expect(saved).toEqual(node);
  });

  it('should set featureName', () => {
    useStrategyStudioStore.getState().setFeatureName('sma_cross');
    expect(useStrategyStudioStore.getState().featureName).toBe('sma_cross');
  });

  it('should resetToHub clearing all navigation state', () => {
    useStrategyStudioStore.getState().setCurrentLevel('generator');
    useStrategyStudioStore.getState().setSelectedNode({ id: 'x', label: 'X', type: 'provider' });
    useStrategyStudioStore.getState().setFeatureName('feature_a');

    useStrategyStudioStore.getState().resetToHub();

    const state = useStrategyStudioStore.getState();
    expect(state.currentLevel).toBe('hub');
    expect(state.selectedNode).toBeNull();
    expect(state.featureName).toBeNull();
  });

  it('should preserve state across multiple set calls (simulates unmount/remount)', () => {
    useStrategyStudioStore.getState().setCurrentLevel('audit');
    useStrategyStudioStore.getState().setFeatureName('regime_detector');

    const afterRemount = useStrategyStudioStore.getState();
    expect(afterRemount.currentLevel).toBe('audit');
    expect(afterRemount.featureName).toBe('regime_detector');
  });
});
