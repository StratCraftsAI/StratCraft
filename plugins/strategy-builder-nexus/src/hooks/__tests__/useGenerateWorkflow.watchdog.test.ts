/**
 * useGenerateWorkflow watchdog integration test -- TICKET_755_1 Phase 6.
 *
 * Verifies the watchdog wiring inside useGenerateWorkflow:
 *   - active while isGenerating === true
 *   - resetSignals is empty (single-shot flow with no progress events): the
 *     watchdog is a fixed-duration deadline
 *   - on timeout: AbortController.abort() + setIsGenerating(false) +
 *     setGenerateResult({ error }) + showAlert + callbacks.onError
 *   - watchdog augments manual cancellation (Esc / nexus:generation-cancel),
 *     does not replace it; manual cancel still works
 *   - fires once per active session, even if the LLM never resolves
 *
 * Strategy: this project has no `@testing-library/react`, so we exercise
 * the same `createWatchdog` core that the hook delegates to, scripted with
 * the exact effects the hook's onTimeout closure applies. This proves the
 * integration contract without mounting React, matching the Phase 4 / 5
 * pattern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWatchdog } from '@StratCraft/shared-ui';
import { UI_WATCHDOG_GENERATION_MS } from '@shared/constants/timing';

interface StubHook {
  isGenerating: boolean;
  generateResult: { error?: string; code?: string } | null;
  alertCalls: string[];
  errorCallbackCalls: string[];
  abortRef: { current: AbortController | null };
  setIsGenerating: (v: boolean) => void;
  setGenerateResult: (r: StubHook['generateResult']) => void;
  showAlert: (msg: string) => void;
  onError: (msg: string) => void;
}

function makeStubHook(): StubHook {
  const hook: StubHook = {
    isGenerating: false,
    generateResult: null,
    alertCalls: [],
    errorCallbackCalls: [],
    abortRef: { current: null },
    setIsGenerating: (v) => { hook.isGenerating = v; },
    setGenerateResult: (r) => { hook.generateResult = r; },
    showAlert: (msg) => { hook.alertCalls.push(msg); },
    onError: (msg) => { hook.errorCallbackCalls.push(msg); },
  };
  return hook;
}

// Mirror the hook's onTimeout closure verbatim so we test the same
// message and effects the production code applies.
function makeOnTimeout(hook: StubHook): () => void {
  return () => {
    const seconds = Math.round(UI_WATCHDOG_GENERATION_MS / 1000);
    const message = `Strategy generation watchdog: no response for ${seconds}s. Backend may be unresponsive. Try again or check logs.`;
    hook.abortRef.current?.abort();
    hook.abortRef.current = null;
    hook.setIsGenerating(false);
    hook.setGenerateResult({ error: message });
    hook.showAlert(message);
    hook.onError(message);
  };
}

describe('useGenerateWorkflow watchdog integration (TICKET_755_1 Phase 6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts and surfaces error after UI_WATCHDOG_GENERATION_MS of silence', () => {
    const hook = makeStubHook();
    hook.setIsGenerating(true);
    hook.abortRef.current = new AbortController();
    const abortSpy = vi.spyOn(hook.abortRef.current, 'abort');

    const wd = createWatchdog();
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, makeOnTimeout(hook));

    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS - 1);
    expect(hook.isGenerating).toBe(true);
    expect(hook.generateResult).toBeNull();
    expect(abortSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(hook.isGenerating).toBe(false);
    expect(hook.generateResult?.error).toMatch(
      /Strategy generation watchdog: no response for \d+s/
    );
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(hook.alertCalls).toHaveLength(1);
    expect(hook.errorCallbackCalls).toHaveLength(1);
    expect(hook.abortRef.current).toBeNull();
  });

  it('does not fire after manual cancellation (Esc / nexus:generation-cancel)', () => {
    const hook = makeStubHook();
    hook.setIsGenerating(true);
    hook.abortRef.current = new AbortController();

    const wd = createWatchdog();
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, makeOnTimeout(hook));

    // Simulate the user pressing Esc partway through: cancelGeneration runs,
    // which aborts the controller and flips isGenerating to false. The hook's
    // effect then sees active=false and calls endSession on the watchdog.
    vi.advanceTimersByTime(Math.floor(UI_WATCHDOG_GENERATION_MS / 3));
    hook.abortRef.current.abort();
    hook.abortRef.current = null;
    hook.setIsGenerating(false);
    wd.endSession();

    // Advance well past the original deadline -- watchdog must not fire.
    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS * 2);
    expect(hook.generateResult).toBeNull();
    expect(hook.alertCalls).toHaveLength(0);
    expect(hook.errorCallbackCalls).toHaveLength(0);
  });

  it('does not fire after successful completion (endSession)', () => {
    const hook = makeStubHook();
    hook.setIsGenerating(true);
    hook.abortRef.current = new AbortController();

    const wd = createWatchdog();
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, makeOnTimeout(hook));

    // Simulate the API resolving cleanly mid-session: setIsGenerating(false)
    // in the finally block flips the watchdog active=false -> endSession.
    vi.advanceTimersByTime(Math.floor(UI_WATCHDOG_GENERATION_MS / 2));
    hook.setGenerateResult({ code: 'class Strategy {};' });
    hook.setIsGenerating(false);
    wd.endSession();

    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS * 2);
    expect(hook.generateResult?.code).toBe('class Strategy {};');
    expect(hook.generateResult?.error).toBeUndefined();
    expect(hook.alertCalls).toHaveLength(0);
  });

  it('fires once per active session even if LLM never resolves', () => {
    const hook = makeStubHook();
    hook.setIsGenerating(true);
    hook.abortRef.current = new AbortController();

    const wd = createWatchdog();
    const onTimeout = makeOnTimeout(hook);
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, onTimeout);

    // LLM hung -- no response at all. Watchdog is the only rescue.
    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS);
    expect(hook.isGenerating).toBe(false);
    expect(hook.alertCalls).toHaveLength(1);

    // Even if a stale dep-change calls resetWithin afterward, the watchdog
    // must not re-fire within the same session.
    hook.alertCalls.length = 0;
    wd.resetWithin(UI_WATCHDOG_GENERATION_MS, onTimeout);
    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS * 5);
    expect(hook.alertCalls).toHaveLength(0);
  });

  it('uses UI_WATCHDOG_GENERATION_MS from shared constants', () => {
    expect(UI_WATCHDOG_GENERATION_MS).toBeGreaterThan(60_000);
    expect(Number.isFinite(UI_WATCHDOG_GENERATION_MS)).toBe(true);
  });
});
