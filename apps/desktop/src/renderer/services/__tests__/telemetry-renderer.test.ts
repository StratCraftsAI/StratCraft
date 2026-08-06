/**
 * Unit tests for the renderer telemetry helper (TICKET_196_6 Phase 6).
 *
 * Contract under test:
 *   - emitTelemetry is a NO-OP when analytics consent is denied.
 *   - emitTelemetry is a NO-OP before initTelemetry resolves.
 *   - emitTelemetry calls Sentry.addBreadcrumb when consent is granted.
 *   - initTelemetry refreshes the cached consent flag.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const addBreadcrumbMock = vi.fn();

vi.mock('@sentry/electron/renderer', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
}));

import {
  emitTelemetry,
  initTelemetry,
  __resetTelemetryForTest,
} from '../telemetry-renderer';

interface ConsentResult {
  success: boolean;
  consent?: { crashes: boolean; analytics: boolean; timestamp: string; appVersion: string };
}

function stubConsent(result: ConsentResult): void {
  (globalThis as unknown as { window: { electronAPI: { consent: { getStatus: () => Promise<ConsentResult> } } } }).window = {
    electronAPI: {
      consent: {
        getStatus: vi.fn().mockResolvedValue(result),
      },
    },
  };
}

describe('telemetry-renderer', () => {
  beforeEach(() => {
    addBreadcrumbMock.mockClear();
    __resetTelemetryForTest();
  });

  it('is a no-op before initTelemetry resolves', () => {
    emitTelemetry('scoreboard.viewed', { row_count: 3, mode: 'backtest' });
    expect(addBreadcrumbMock).not.toHaveBeenCalled();
  });

  it('is a no-op when analytics consent is denied', async () => {
    stubConsent({
      success: true,
      consent: { crashes: true, analytics: false, timestamp: 'now', appVersion: '0.1' },
    });

    await initTelemetry();
    emitTelemetry('scoreboard.viewed', { row_count: 3, mode: 'backtest' });

    expect(addBreadcrumbMock).not.toHaveBeenCalled();
  });

  it('is a no-op when consent IPC fails', async () => {
    (globalThis as unknown as { window: { electronAPI: { consent: { getStatus: () => Promise<ConsentResult> } } } }).window = {
      electronAPI: {
        consent: {
          getStatus: vi.fn().mockRejectedValue(new Error('ipc down')),
        },
      },
    };

    await initTelemetry();
    emitTelemetry('scoreboard.viewed', { row_count: 1, mode: 'backtest' });

    expect(addBreadcrumbMock).not.toHaveBeenCalled();
  });

  it('emits a Sentry breadcrumb when analytics consent is granted', async () => {
    stubConsent({
      success: true,
      consent: { crashes: true, analytics: true, timestamp: 'now', appVersion: '0.1' },
    });

    await initTelemetry();
    emitTelemetry('scoreboard.viewed', { row_count: 7, mode: 'backtest' });

    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
    expect(addBreadcrumbMock).toHaveBeenCalledWith({
      category: 'telemetry',
      type: 'info',
      level: 'info',
      message: 'scoreboard.viewed',
      data: { row_count: 7, mode: 'backtest' },
    });
  });

  it('initTelemetry refreshes cached consent on each call', async () => {
    // Granted first.
    stubConsent({
      success: true,
      consent: { crashes: true, analytics: true, timestamp: 'now', appVersion: '0.1' },
    });
    await initTelemetry();
    emitTelemetry('scoreboard.column_toggled', { column_name: 'sharpe_long', state: true });
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);

    // Then revoked: helper should go quiet.
    stubConsent({
      success: true,
      consent: { crashes: true, analytics: false, timestamp: 'later', appVersion: '0.1' },
    });
    await initTelemetry();
    emitTelemetry('scoreboard.column_toggled', { column_name: 'sharpe_long', state: false });
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
  });

  it('treats `analytics === undefined` as denied', async () => {
    stubConsent({ success: true });
    await initTelemetry();
    emitTelemetry('scoreboard.viewed', { row_count: 0, mode: 'backtest' });
    expect(addBreadcrumbMock).not.toHaveBeenCalled();
  });
});
