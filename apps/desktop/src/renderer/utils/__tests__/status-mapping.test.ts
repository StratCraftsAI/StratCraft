/**
 * TICKET_763 -- runtime tests for mapStatus.
 */

import { describe, expect, it } from 'vitest';
import { mapStatus } from '../status-mapping';

type SignalDiscoveryStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
type ExecutorStatus = 'idle' | 'running' | 'success' | 'error';

describe('mapStatus', () => {
  it('returns the branch value for each SignalDiscoveryStatus literal', () => {
    const branches: Record<SignalDiscoveryStatus, string> = {
      idle: 'idle',
      running: 'loading',
      completed: 'success',
      cancelled: 'idle',
      error: 'error',
    };

    expect(mapStatus<SignalDiscoveryStatus, string>('idle', branches)).toBe('idle');
    expect(mapStatus<SignalDiscoveryStatus, string>('running', branches)).toBe('loading');
    expect(mapStatus<SignalDiscoveryStatus, string>('completed', branches)).toBe('success');
    expect(mapStatus<SignalDiscoveryStatus, string>('cancelled', branches)).toBe('idle');
    expect(mapStatus<SignalDiscoveryStatus, string>('error', branches)).toBe('error');
  });

  it('works with a different status union (executor-shaped)', () => {
    const branches: Record<ExecutorStatus, number> = {
      idle: 0,
      running: 1,
      success: 2,
      error: 3,
    };

    expect(mapStatus<ExecutorStatus, number>('idle', branches)).toBe(0);
    expect(mapStatus<ExecutorStatus, number>('running', branches)).toBe(1);
    expect(mapStatus<ExecutorStatus, number>('success', branches)).toBe(2);
    expect(mapStatus<ExecutorStatus, number>('error', branches)).toBe(3);
  });

  it('returns the same reference identity for object branches (no copy)', () => {
    const idleBranch = { kind: 'idle' };
    const errorBranch = { kind: 'error' };
    const branches: Record<'idle' | 'error', { kind: string }> = {
      idle: idleBranch,
      error: errorBranch,
    };

    expect(mapStatus<'idle' | 'error', { kind: string }>('error', branches)).toBe(errorBranch);
    expect(mapStatus<'idle' | 'error', { kind: string }>('idle', branches)).toBe(idleBranch);
  });
});
