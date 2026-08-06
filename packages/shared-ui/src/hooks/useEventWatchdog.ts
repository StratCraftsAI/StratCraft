import { useEffect, useRef } from 'react';

export interface UseEventWatchdogParams {
  active: boolean;
  timeoutMs: number;
  resetSignals?: unknown[];
  onTimeout: () => void;
}

export interface WatchdogTimer {
  beginSession: (timeoutMs: number, onTimeout: () => void) => void;
  resetWithin: (timeoutMs: number, onTimeout: () => void) => void;
  endSession: () => void;
  hasFired: () => boolean;
}

export function createWatchdog(): WatchdogTimer {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let firedThisSession = false;

  const clearTimer = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const arm = (timeoutMs: number, onTimeout: () => void): void => {
    clearTimer();
    if (firedThisSession) return;
    timerId = setTimeout(() => {
      timerId = null;
      firedThisSession = true;
      onTimeout();
    }, timeoutMs);
  };

  return {
    beginSession: (timeoutMs, onTimeout) => {
      clearTimer();
      firedThisSession = false;
      arm(timeoutMs, onTimeout);
    },
    resetWithin: arm,
    endSession: clearTimer,
    hasFired: () => firedThisSession,
  };
}

export function useEventWatchdog(params: UseEventWatchdogParams): void {
  const { active, timeoutMs, resetSignals, onTimeout } = params;

  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const watchdogRef = useRef<WatchdogTimer | null>(null);
  if (watchdogRef.current === null) watchdogRef.current = createWatchdog();

  const wasActiveRef = useRef(false);

  useEffect(() => {
    const wd = watchdogRef.current!;
    const cb = (): void => onTimeoutRef.current();
    if (!active) {
      if (wasActiveRef.current) wd.endSession();
      wasActiveRef.current = false;
      return;
    }
    if (!wasActiveRef.current) {
      wd.beginSession(timeoutMs, cb);
      wasActiveRef.current = true;
    } else {
      wd.resetWithin(timeoutMs, cb);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, timeoutMs, ...(resetSignals ?? [])]);

  useEffect(() => () => watchdogRef.current?.endSession(), []);
}
