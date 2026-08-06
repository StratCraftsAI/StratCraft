/**
 * TICKET_1284 -- system-monitor handler fallback test.
 *
 * Verifies handleGetSystemMonitor returns local stats (not an error) when
 * the Electron bridge is unavailable (discoverServiceApi returns null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bridge/discovery', () => ({ discoverServiceApi: vi.fn() }));
vi.mock('../bridge/api-client', () => ({ getSystemMonitor: vi.fn() }));

import { handleGetSystemMonitor } from '../handlers/system-monitor';
import { discoverServiceApi } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';

const mockDiscover = discoverServiceApi as ReturnType<typeof vi.fn>;
const mockGetSysMonitor = apiClient.getSystemMonitor as ReturnType<typeof vi.fn>;

describe('handleGetSystemMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns local snapshot (not error) when Electron is not running', async () => {
    mockDiscover.mockReturnValue(null);
    const result = await handleGetSystemMonitor();
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('system');
    expect(parsed).toHaveProperty('gpu');
    expect(parsed).toHaveProperty('workloads');
    expect(parsed).toHaveProperty('sampledAt');
    expect(parsed.workloads).toHaveLength(3);
  });

  it('uses Electron bridge when available', async () => {
    mockDiscover.mockReturnValue({ host: 'localhost', port: 12345 });
    const mockData = { system: { cpuPercent: 42 }, gpu: { present: false }, workloads: [], sampledAt: 100 };
    mockGetSysMonitor.mockResolvedValue({ success: true, data: mockData });
    const result = await handleGetSystemMonitor();
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.system.cpuPercent).toBe(42);
  });

  it('falls back to local when bridge is unreachable', async () => {
    mockDiscover.mockReturnValue({ host: 'localhost', port: 12345 });
    mockGetSysMonitor.mockResolvedValue({ success: false, unreachable: true });
    const result = await handleGetSystemMonitor();
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toHaveProperty('system');
    expect(parsed).toHaveProperty('workloads');
  });
});
