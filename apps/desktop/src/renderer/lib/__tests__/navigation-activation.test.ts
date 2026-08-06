/**
 * Navigation-Activation Wiring Tests (TICKET_1231)
 *
 * Covers wireNavigationActivation(): initial-view firing (persisted view /
 * boot race), forwarding on view change with the host VIEW_REGISTRY plugin
 * mapping, same-view dedup, and unsubscribe.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PluginManager } from '../plugin-manager';

// -----------------------------------------------------------------------------
// Mocks: minimal zustand-like store + minimal view registry
// -----------------------------------------------------------------------------

type Listener = (state: { activeView: string }) => void;

const storeState = { activeView: 'nexus' };
const listeners = new Set<Listener>();

function setActiveView(view: string): void {
  storeState.activeView = view;
  for (const listener of [...listeners]) listener(storeState);
}

vi.mock('@/stores', () => ({
  useAppStore: {
    getState: () => storeState,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
}));

vi.mock('@/config/view-registry', () => ({
  VIEW_REGISTRY: {
    nexus: { viewId: 'nexus' },
    signalGenerator: { viewId: 'signalGenerator', pluginId: 'com.stratcraft.signal-generator-nexus' },
    backtest: { viewId: 'backtest', pluginId: 'com.stratcraft.back-test-nexus' },
  },
}));

import { wireNavigationActivation } from '../navigation-activation';

function makeManager() {
  const handleViewNavigation = vi.fn(async (): Promise<void> => undefined);
  return { manager: { handleViewNavigation } as unknown as PluginManager, handleViewNavigation };
}

beforeEach(() => {
  storeState.activeView = 'nexus';
  listeners.clear();
});

describe('wireNavigationActivation', () => {
  it('fires once for the view active at wire time (persisted view / boot race)', () => {
    storeState.activeView = 'signalGenerator';
    const { manager, handleViewNavigation } = makeManager();

    wireNavigationActivation(manager);

    expect(handleViewNavigation).toHaveBeenCalledTimes(1);
    expect(handleViewNavigation).toHaveBeenCalledWith('signalGenerator', 'com.stratcraft.signal-generator-nexus');
  });

  it('forwards every view change with the host plugin mapping', () => {
    const { manager, handleViewNavigation } = makeManager();
    wireNavigationActivation(manager);
    handleViewNavigation.mockClear();

    setActiveView('backtest');
    expect(handleViewNavigation).toHaveBeenCalledWith('backtest', 'com.stratcraft.back-test-nexus');

    setActiveView('signalGenerator');
    expect(handleViewNavigation).toHaveBeenCalledWith('signalGenerator', 'com.stratcraft.signal-generator-nexus');
  });

  it('passes undefined mapping for views without a plugin (host pages)', () => {
    storeState.activeView = 'signalGenerator';
    const { manager, handleViewNavigation } = makeManager();
    wireNavigationActivation(manager);
    handleViewNavigation.mockClear();

    setActiveView('nexus');
    expect(handleViewNavigation).toHaveBeenCalledWith('nexus', undefined);
  });

  it('does not re-fire when the store updates without a view change', () => {
    const { manager, handleViewNavigation } = makeManager();
    wireNavigationActivation(manager);
    handleViewNavigation.mockClear();

    setActiveView('nexus'); // unchanged
    expect(handleViewNavigation).not.toHaveBeenCalled();
  });

  it('stops forwarding after unsubscribe', () => {
    const { manager, handleViewNavigation } = makeManager();
    const unsubscribe = wireNavigationActivation(manager);
    handleViewNavigation.mockClear();

    unsubscribe();
    setActiveView('backtest');
    expect(handleViewNavigation).not.toHaveBeenCalled();
  });

  it('handles views absent from the registry defensively', () => {
    const { manager, handleViewNavigation } = makeManager();
    wireNavigationActivation(manager);
    handleViewNavigation.mockClear();

    setActiveView('data'); // legacy store value with no registry entry
    expect(handleViewNavigation).toHaveBeenCalledWith('data', undefined);
  });
});
