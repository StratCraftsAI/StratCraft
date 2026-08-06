import { describe, it, expect, vi } from 'vitest';
import { safeForEach } from '../utils/safe-emit';

describe('safeForEach', () => {
  it('calls every listener even when one throws', () => {
    const calls: number[] = [];
    const listeners = [
      () => calls.push(1),
      () => { throw new Error('boom'); },
      () => calls.push(3),
    ];

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeForEach(listeners, '[TEST]');
    spy.mockRestore();

    expect(calls).toEqual([1, 3]);
  });

  it('logs the tag and the error on failure', () => {
    const err = new Error('test-error');
    const listeners = [() => { throw err; }];

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeForEach(listeners, '[E:TEST:TAG]');

    expect(spy).toHaveBeenCalledWith('[E:TEST:TAG]', err);
    spy.mockRestore();
  });

  it('forwards arguments to each listener', () => {
    const received: unknown[][] = [];
    const listeners = [
      (a: string, b: number) => received.push([a, b]),
      (a: string, b: number) => received.push([a, b]),
    ];

    safeForEach(listeners, '[TEST]', 'hello', 42);
    expect(received).toEqual([['hello', 42], ['hello', 42]]);
  });

  it('works with a Set (the common container)', () => {
    const calls: number[] = [];
    const listeners = new Set([
      () => calls.push(1),
      () => calls.push(2),
    ]);

    safeForEach(listeners, '[TEST]');
    expect(calls).toEqual([1, 2]);
  });

  it('does nothing on an empty iterable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeForEach([] as Array<() => void>, '[TEST]');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
