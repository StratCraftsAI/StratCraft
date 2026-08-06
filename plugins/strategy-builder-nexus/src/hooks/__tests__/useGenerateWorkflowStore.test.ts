/**
 * Tests for useGenerateWorkflowStore
 *
 * TICKET_1208 P6 Layer A: Verifies workflow state preservation across
 * component unmount/remount, keyed isolation between pageIds, and reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGenerateWorkflowStore } from '../useGenerateWorkflowStore';

describe('useGenerateWorkflowStore', () => {
  beforeEach(() => {
    useGenerateWorkflowStore.setState({ pages: {} });
  });

  it('returns default state for new pageId', () => {
    const store = useGenerateWorkflowStore.getState();
    const page = store.getPage('test-page', 'Default Strategy');

    expect(page.strategyName).toBe('Default Strategy');
    expect(page.generateResult).toBeNull();
    expect(page.isSaved).toBe(false);
    expect(page.savedAlgorithmId).toBeNull();
  });

  it('preserves state across getPage calls (simulates unmount/remount)', () => {
    const store = useGenerateWorkflowStore.getState();

    store.getPage('test-page', 'Default');
    store.setStrategyName('test-page', 'My Custom Strategy');
    store.setGenerateResult('test-page', { code: 'class Foo {};', language: 'cpp' });
    store.setIsSaved('test-page', true);
    store.setSavedAlgorithmId('test-page', 42);

    const preserved = store.getPage('test-page', 'Default');
    expect(preserved.strategyName).toBe('My Custom Strategy');
    expect(preserved.generateResult).toEqual({ code: 'class Foo {};', language: 'cpp' });
    expect(preserved.isSaved).toBe(true);
    expect(preserved.savedAlgorithmId).toBe(42);
  });

  it('isolates state between different pageIds', () => {
    const store = useGenerateWorkflowStore.getState();

    store.getPage('page-a', 'Strategy A');
    store.getPage('page-b', 'Strategy B');

    store.setStrategyName('page-a', 'Modified A');
    store.setGenerateResult('page-b', { code: 'code_b', language: 'cpp' });

    const pageA = useGenerateWorkflowStore.getState().pages['page-a'];
    const pageB = useGenerateWorkflowStore.getState().pages['page-b'];

    expect(pageA.strategyName).toBe('Modified A');
    expect(pageA.generateResult).toBeNull();

    expect(pageB.strategyName).toBe('Strategy B');
    expect(pageB.generateResult).toEqual({ code: 'code_b', language: 'cpp' });
  });

  it('resetPage removes the page entry', () => {
    const store = useGenerateWorkflowStore.getState();

    store.getPage('test-page', 'Default');
    store.setStrategyName('test-page', 'Modified');

    store.resetPage('test-page');

    expect(useGenerateWorkflowStore.getState().pages['test-page']).toBeUndefined();
  });

  it('setGenerateResult is no-op for uninitialized page', () => {
    const store = useGenerateWorkflowStore.getState();

    store.setGenerateResult('nonexistent', { code: 'test' });

    expect(useGenerateWorkflowStore.getState().pages['nonexistent']).toBeUndefined();
  });

  it('preserves error result', () => {
    const store = useGenerateWorkflowStore.getState();

    store.getPage('test-page', 'Default');
    store.setGenerateResult('test-page', { error: 'API timeout' });

    const page = useGenerateWorkflowStore.getState().pages['test-page'];
    expect(page.generateResult).toEqual({ error: 'API timeout' });
  });
});
