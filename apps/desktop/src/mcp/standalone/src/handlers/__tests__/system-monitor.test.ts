/**
 * TICKET_1276 P2 Batch D -- system-monitor is the SINGLE sanctioned Class-R
 * fallback (TICKET_1281). Unlike every other Class-R site, when Electron is
 * absent it does NOT return `electronNotRunning`; it returns live telemetry from
 * the in-process local collector -- a REAL second owning layer, not a degraded
 * bridge answer. This test locks that exception in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDiscoverServiceApi, mockGetSystemMonitor, mockCollectLocalSnapshot } = vi.hoisted(() => ({
  mockDiscoverServiceApi: vi.fn(),
  mockGetSystemMonitor: vi.fn(),
  mockCollectLocalSnapshot: vi.fn(),
}));

vi.mock('../../bridge/discovery', () => ({ discoverServiceApi: mockDiscoverServiceApi }));
vi.mock('../../bridge/api-client', () => ({ getSystemMonitor: mockGetSystemMonitor }));
vi.mock('../../local-system-monitor', () => ({ collectLocalSnapshot: mockCollectLocalSnapshot }));

import { handleGetSystemMonitor } from '../system-monitor';

const LOCAL_SNAPSHOT = { source: 'local-collector', cpu: { total: 12 }, memory: { usedGb: 4 } };

beforeEach(() => { vi.resetAllMocks(); });

describe('handleGetSystemMonitor (sanctioned Class-R local fallback)', () => {
  it('returns local telemetry (NOT an error) when Electron is absent', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);
    mockCollectLocalSnapshot.mockReturnValue(LOCAL_SNAPSHOT);

    const result = await handleGetSystemMonitor();

    // The sanctioned exception: no electronNotRunning error, real local data.
    expect(result.isError).toBeUndefined();
    expect(mockCollectLocalSnapshot).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(LOCAL_SNAPSHOT);
    expect(result.content[0].text).not.toContain('not running');
  });

  it('falls back to local telemetry when the bridge is unreachable', async () => {
    mockDiscoverServiceApi.mockReturnValue({ baseUrl: 'http://x', token: 't' });
    mockGetSystemMonitor.mockResolvedValue({ success: false, unreachable: true, error: 'ECONNREFUSED' });
    mockCollectLocalSnapshot.mockReturnValue(LOCAL_SNAPSHOT);

    const result = await handleGetSystemMonitor();

    expect(result.isError).toBeUndefined();
    expect(mockCollectLocalSnapshot).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual(LOCAL_SNAPSHOT);
  });

  it('returns bridge telemetry when Electron is running', async () => {
    const bridgeData = { source: 'electron-bridge', cpu: { total: 55 } };
    mockDiscoverServiceApi.mockReturnValue({ baseUrl: 'http://x', token: 't' });
    mockGetSystemMonitor.mockResolvedValue({ success: true, data: bridgeData });

    const result = await handleGetSystemMonitor();

    expect(result.isError).toBeUndefined();
    expect(mockCollectLocalSnapshot).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toEqual(bridgeData);
  });

  it('surfaces a real bridge error (not local fallback) when the bridge returns a hard error', async () => {
    mockDiscoverServiceApi.mockReturnValue({ baseUrl: 'http://x', token: 't' });
    mockGetSystemMonitor.mockResolvedValue({ success: false, error: 'boom' });

    const result = await handleGetSystemMonitor();

    expect(result.isError).toBe(true);
    expect(mockCollectLocalSnapshot).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text).error).toBe('boom');
  });
});
