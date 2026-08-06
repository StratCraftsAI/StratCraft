/**
 * ToolSweepBlockedListener pure handler tests -- TICKET_811.
 *
 * The apps/desktop vitest config runs in `node` env without a React
 * render harness, so the listener's imperative core was extracted to a
 * pure `handleToolSweepBlocked` function. This test pins the action
 * shape: error toast fired with the right content + action button, and
 * the action-button click dispatches the right two navigation steps.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleToolSweepBlocked,
  type ToolSweepBlockedDetail,
} from '../ToolSweepBlockedListener';

function buildDeps() {
  const error = vi.fn();
  const setActiveView = vi.fn();
  const dispatchEvent = vi.fn((_event: Event): boolean => true);
  return { error, setActiveView, dispatchEvent };
}

describe('handleToolSweepBlocked', () => {
  it('fires an error toast with the pre-rendered message + action label', () => {
    const deps = buildDeps();
    const detail: ToolSweepBlockedDetail = {
      message: 'Configure an API key for one of: Alpaca, Polygon. Open Settings to add a key.',
      actionLabel: 'Open Settings',
      candidates: ['alpaca', 'polygon'],
      universeId: 'sp500_top50',
    };
    handleToolSweepBlocked(detail, deps);
    expect(deps.error).toHaveBeenCalledTimes(1);
    const [content, options] = deps.error.mock.calls[0];
    expect(content).toBe(detail.message);
    expect(options.actions).toHaveLength(1);
    expect(options.actions[0].label).toBe(detail.actionLabel);
  });

  it('action button click navigates to Settings + dispatches section intent', () => {
    const deps = buildDeps();
    const detail: ToolSweepBlockedDetail = {
      message: 'msg',
      actionLabel: 'Open Settings',
    };
    handleToolSweepBlocked(detail, deps);
    // Invoke the captured action callback.
    const action = deps.error.mock.calls[0][1].actions[0];
    action.onClick();

    expect(deps.setActiveView).toHaveBeenCalledWith('settings');
    expect(deps.dispatchEvent).toHaveBeenCalledTimes(1);
    const ev = deps.dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(ev.type).toBe('nexus:settings-section');
    expect(ev.detail).toEqual({ section: 'data-providers' });
  });
});
