/**
 * AIStrategyStudioPage watchdog integration test -- TICKET_755_1 Phase 7.
 *
 * Verifies the watchdog wiring inside AIStrategyStudioPage:
 *   - active while isLoading === true
 *   - resetSignals is empty (single-shot Vibing Chat call with no streaming
 *     progress events): the watchdog is a fixed-duration deadline
 *   - on timeout: activeRequestRef.current.abort() + null the ref +
 *     setIsLoading(false) + append a system Message via setMessages using the
 *     `pages.aiStrategyStudio.errorPrefix` translation
 *   - watchdog augments manual cancellation (Esc / handleNewChat /
 *     handleSelectConversation), does not replace it; manual cancel still
 *     works
 *   - fires once per active session, even if the LLM never resolves
 *
 * Strategy: this project has no `@testing-library/react`, so we exercise
 * the same `createWatchdog` core that the hook delegates to, scripted with
 * the exact effects the page's onTimeout closure applies. This proves the
 * integration contract without mounting React, matching the Phase 4 / 5 / 6
 * pattern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWatchdog } from '@StratCraft/shared-ui';
import { UI_WATCHDOG_GENERATION_MS } from '@shared/constants/timing';

interface StubMessage {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface StubPage {
  isLoading: boolean;
  messages: StubMessage[];
  activeRequestRef: { current: AbortController | null };
  setIsLoading: (v: boolean) => void;
  appendMessage: (m: StubMessage) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

function makeStubPage(): StubPage {
  const page: StubPage = {
    isLoading: false,
    messages: [],
    activeRequestRef: { current: null },
    setIsLoading: (v) => { page.isLoading = v; },
    appendMessage: (m) => { page.messages.push(m); },
    // Match the production locale shape `Error: {{message}}`
    t: (key, params) => {
      if (key === 'pages.aiStrategyStudio.errorPrefix' && params?.message != null) {
        return `Error: ${String(params.message)}`;
      }
      return key;
    },
  };
  return page;
}

// Mirror the page's onTimeout closure verbatim so we test the same message
// and effects the production code applies.
function makeOnTimeout(page: StubPage): () => void {
  return () => {
    const seconds = Math.round(UI_WATCHDOG_GENERATION_MS / 1000);
    const message = `AI Studio watchdog: no response for ${seconds}s. Backend may be unresponsive. Try again or check logs.`;
    page.activeRequestRef.current?.abort();
    page.activeRequestRef.current = null;
    page.setIsLoading(false);
    page.appendMessage({
      id: `local-${Date.now()}`,
      type: 'system',
      content: page.t('pages.aiStrategyStudio.errorPrefix', { message }),
      timestamp: new Date(),
    });
  };
}

describe('AIStrategyStudioPage watchdog integration (TICKET_755_1 Phase 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts and surfaces a system message after UI_WATCHDOG_GENERATION_MS of silence', () => {
    const page = makeStubPage();
    page.setIsLoading(true);
    page.activeRequestRef.current = new AbortController();
    const abortSpy = vi.spyOn(page.activeRequestRef.current, 'abort');

    const wd = createWatchdog();
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, makeOnTimeout(page));

    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS - 1);
    expect(page.isLoading).toBe(true);
    expect(page.messages).toHaveLength(0);
    expect(abortSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(page.isLoading).toBe(false);
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(page.activeRequestRef.current).toBeNull();
    expect(page.messages).toHaveLength(1);
    const surfaced = page.messages[0]!;
    expect(surfaced.type).toBe('system');
    expect(surfaced.content).toMatch(
      /^Error: AI Studio watchdog: no response for \d+s/
    );
  });

  it('does not fire after manual cancellation (Esc)', () => {
    const page = makeStubPage();
    page.setIsLoading(true);
    page.activeRequestRef.current = new AbortController();

    const wd = createWatchdog();
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, makeOnTimeout(page));

    // Simulate the user pressing Esc partway through: the keydown handler
    // (TICKET_559) aborts the controller and flips isLoading to false. The
    // hook's effect then sees active=false and calls endSession on the
    // watchdog.
    vi.advanceTimersByTime(Math.floor(UI_WATCHDOG_GENERATION_MS / 3));
    page.activeRequestRef.current.abort();
    page.activeRequestRef.current = null;
    page.setIsLoading(false);
    wd.endSession();

    // Advance well past the original deadline -- watchdog must not fire.
    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS * 2);
    expect(page.messages).toHaveLength(0);
  });

  it('does not fire after successful completion (finally block clears isLoading)', () => {
    const page = makeStubPage();
    page.setIsLoading(true);
    page.activeRequestRef.current = new AbortController();

    const wd = createWatchdog();
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, makeOnTimeout(page));

    // Simulate executeVibingChat resolving cleanly mid-session: the finally
    // block at line 766 sets isLoading=false; the hook's effect sees
    // active=false and calls endSession.
    vi.advanceTimersByTime(Math.floor(UI_WATCHDOG_GENERATION_MS / 2));
    page.appendMessage({
      id: 'assistant-1',
      type: 'assistant',
      content: 'Generated rules.',
      timestamp: new Date(),
    });
    page.setIsLoading(false);
    wd.endSession();

    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS * 2);
    // Only the assistant message remains; no watchdog system message
    // appended.
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]!.type).toBe('assistant');
  });

  it('fires once per active session even if Vibing Chat never resolves', () => {
    const page = makeStubPage();
    page.setIsLoading(true);
    page.activeRequestRef.current = new AbortController();

    const wd = createWatchdog();
    const onTimeout = makeOnTimeout(page);
    wd.beginSession(UI_WATCHDOG_GENERATION_MS, onTimeout);

    // Backend hung -- no response at all. Watchdog is the only rescue.
    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS);
    expect(page.isLoading).toBe(false);
    expect(page.messages).toHaveLength(1);

    // Even if a stale dep-change calls resetWithin afterward, the watchdog
    // must not re-fire within the same session.
    wd.resetWithin(UI_WATCHDOG_GENERATION_MS, onTimeout);
    vi.advanceTimersByTime(UI_WATCHDOG_GENERATION_MS * 5);
    expect(page.messages).toHaveLength(1);
  });

  it('uses UI_WATCHDOG_GENERATION_MS from shared constants', () => {
    expect(UI_WATCHDOG_GENERATION_MS).toBeGreaterThan(60_000);
    expect(Number.isFinite(UI_WATCHDOG_GENERATION_MS)).toBe(true);
  });
});
