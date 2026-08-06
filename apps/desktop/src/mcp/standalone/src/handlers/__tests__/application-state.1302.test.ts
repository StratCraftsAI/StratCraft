import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  getConsentStatus: vi.fn(),
  getDistributionInfo: vi.fn(),
  mapCreditStatus: vi.fn(),
  resolveDesktopPackageJson: vi.fn(),
  setConsentState: vi.fn(),
  resolveUserDataDir: vi.fn(),
  discoverElectronService: vi.fn(),
  getAppRateLimitStatus: vi.fn(),
  getAppServerStatus: vi.fn(),
  electronNotRunning: vi.fn((operation: string) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ electronRequired: true, operation }) }],
    isError: true,
    errorCategory: 'process' as const,
  })),
}));

vi.mock('@StratCraft/app-state-core', () => ({
  getAppInfo: mocks.getAppInfo,
  getConsentStatus: mocks.getConsentStatus,
  getDistributionInfo: mocks.getDistributionInfo,
  mapCreditStatus: mocks.mapCreditStatus,
  resolveDesktopPackageJson: mocks.resolveDesktopPackageJson,
  setConsentState: mocks.setConsentState,
}));

vi.mock('../../db', () => ({
  resolveUserDataDir: mocks.resolveUserDataDir,
}));

vi.mock('../../bridge/electron-service', () => ({
  discoverElectronService: mocks.discoverElectronService,
}));

vi.mock('../../bridge/api-client', () => ({
  getAppRateLimitStatus: mocks.getAppRateLimitStatus,
  getAppServerStatus: mocks.getAppServerStatus,
}));

vi.mock('../electron-guard', () => ({
  electronNotRunning: mocks.electronNotRunning,
}));

import {
  handleGetAppInfo,
  handleGetConsentStatus,
  handleGetCreditStatus,
  handleGetDistributionInfo,
  handleGetRateLimitStatus,
  handleGetServerStatus,
  handleSetConsent,
} from '../application-state';

function payload(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

describe('TICKET_1302 U7 application-state handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubGlobal('fetch', vi.fn());
    mocks.resolveDesktopPackageJson.mockReturnValue('/desktop/package.json');
    mocks.resolveUserDataDir.mockReturnValue('/user-data');
    mocks.getAppInfo.mockReturnValue({
      version: '1.2.3',
      path: '/user-data',
      researchMode: false,
    });
    mocks.getDistributionInfo.mockReturnValue({
      distribution: 'full',
      isPublicRelease: false,
    });
    mocks.getConsentStatus.mockReturnValue({
      consent: {
        crashes: true,
        analytics: false,
        timestamp: '',
        appVersion: '',
      },
      isFirstLaunch: true,
    });
    mocks.setConsentState.mockResolvedValue({
      crashes: false,
      analytics: true,
      timestamp: 'now',
      appVersion: '1.2.3',
    });
  });

  describe('get_credit_status', () => {
    it('calls the authoritative account endpoint and maps the response', async () => {
      vi.stubEnv('DESKTOP_API_URL', 'https://api.example');
      const raw = { has_credit: true, remaining: 8 };
      const mapped = { hasCredit: true, remaining: 8 };
      mocks.mapCreditStatus.mockReturnValue(mapped);
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(raw), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

      const result = await handleGetCreditStatus('secret-bearer');

      expect(payload(result)).toEqual(mapped);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example/api/v1/user/credit-status',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(AbortSignal),
          headers: expect.objectContaining({
            Authorization: 'Bearer secret-bearer',
            'X-Client-Type': 'desktop',
          }),
        }),
      );
      expect(mocks.mapCreditStatus).toHaveBeenCalledWith(raw);
    });

    it('surfaces backend JSON auth errors without exposing the bearer', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(
        JSON.stringify({ error: 'Session expired' }),
        { status: 401 },
      ));
      const result = await handleGetCreditStatus('secret-bearer');
      expect(payload(result)).toEqual({ error: 'Session expired' });
      expect(result.errorCategory).toBe('authentication');
      expect(result.content[0].text).not.toContain('secret-bearer');
    });

    it('uses the HTTP status for non-JSON failures', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('<html>bad gateway</html>', {
        status: 502,
      }));
      const result = await handleGetCreditStatus('bearer');
      expect(payload(result)).toEqual({
        error: 'Credit status request failed with HTTP 502',
      });
      expect(result.errorCategory).toBe('network');
    });

    it('rejects malformed successful backend responses', async () => {
      mocks.mapCreditStatus.mockImplementation(() => {
        throw new Error('Credit status response is malformed');
      });
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
        has_credit: 'yes',
        remaining: 8,
      }), { status: 200 }));
      const result = await handleGetCreditStatus('bearer');
      expect(payload(result)).toEqual({
        error: 'Credit status response is malformed',
      });
      expect(result.errorCategory).toBe('schema');
    });

    it('surfaces network exceptions', async () => {
      vi.mocked(fetch).mockRejectedValue('offline');
      const result = await handleGetCreditStatus('bearer');
      expect(payload(result)).toEqual({ error: 'offline' });
      expect(result.errorCategory).toBe('network');
    });
  });

  describe('Class-R runtime reads', () => {
    it('returns the canonical Electron-down error before issuing a command', async () => {
      mocks.discoverElectronService.mockReturnValue(null);
      expect(payload(await handleGetRateLimitStatus())).toEqual({
        electronRequired: true,
        operation: 'get_rate_limit_status',
      });
      expect(mocks.getAppRateLimitStatus).not.toHaveBeenCalled();
    });

    it('returns runtime data for both live status tools', async () => {
      const config = { baseUrl: 'http://127.0.0.1:1', token: 'token' };
      mocks.discoverElectronService.mockReturnValue(config);
      mocks.getAppRateLimitStatus.mockResolvedValue({
        success: true,
        data: { limited: false },
      });
      mocks.getAppServerStatus.mockResolvedValue({
        success: true,
        data: { api: true, engine: true },
      });
      expect(payload(await handleGetRateLimitStatus())).toEqual({ limited: false });
      expect(payload(await handleGetServerStatus())).toEqual({ api: true, engine: true });
    });

    it('converts an unreachable runtime to the canonical Electron-down error', async () => {
      mocks.discoverElectronService.mockReturnValue({});
      mocks.getAppRateLimitStatus.mockResolvedValue({
        success: false,
        unreachable: true,
        error: 'ECONNREFUSED',
      });
      expect(payload(await handleGetRateLimitStatus())).toEqual({
        electronRequired: true,
        operation: 'get_rate_limit_status',
      });
    });

    it('surfaces runtime failures and exceptions', async () => {
      mocks.discoverElectronService.mockReturnValue({});
      mocks.getAppRateLimitStatus.mockResolvedValue({
        success: false,
        error: 'rate state failed',
      });
      let result = await handleGetRateLimitStatus();
      expect(payload(result)).toEqual({ error: 'rate state failed' });
      expect(result.errorCategory).toBe('process');

      mocks.getAppRateLimitStatus.mockRejectedValue(new Error('transport failed'));
      result = await handleGetRateLimitStatus();
      expect(payload(result)).toEqual({ error: 'transport failed' });
    });
  });

  describe('Class-S application state', () => {
    it('reads distribution, consent, and app info directly', () => {
      expect(payload(handleGetDistributionInfo())).toEqual({
        distribution: 'full',
        isPublicRelease: false,
      });
      expect(payload(handleGetConsentStatus())).toEqual(
        mocks.getConsentStatus.mock.results[0].value,
      );
      expect(payload(handleGetAppInfo())).toEqual({
        version: '1.2.3',
        path: '/user-data',
        researchMode: false,
      });
      expect(mocks.getConsentStatus).toHaveBeenCalledWith('/user-data/consent.json');
    });

    it('persists consent with the authoritative app version', async () => {
      const result = await handleSetConsent({ crashes: false, analytics: true });
      expect(payload(result)).toEqual({
        crashes: false,
        analytics: true,
        timestamp: 'now',
        appVersion: '1.2.3',
      });
      expect(mocks.setConsentState).toHaveBeenCalledWith({
        consentFilePath: '/user-data/consent.json',
        crashes: false,
        analytics: true,
        appVersion: '1.2.3',
      });
    });

    it.each([
      ['distribution', () => {
        mocks.getDistributionInfo.mockImplementation(() => { throw new Error('distribution read'); });
        return handleGetDistributionInfo();
      }],
      ['consent', () => {
        mocks.getConsentStatus.mockImplementation(() => { throw 'consent read'; });
        return handleGetConsentStatus();
      }],
      ['app info', () => {
        mocks.getAppInfo.mockImplementation(() => { throw new Error('app read'); });
        return handleGetAppInfo();
      }],
    ])('surfaces %s storage failures', (_name, run) => {
      const result = run();
      expect(result.isError).toBe(true);
      expect(result.errorCategory).toBe('storage');
    });

    it('surfaces consent write failures', async () => {
      mocks.setConsentState.mockRejectedValue(new Error('consent write'));
      const result = await handleSetConsent({ crashes: true, analytics: false });
      expect(payload(result)).toEqual({ error: 'consent write' });
      expect(result.errorCategory).toBe('storage');
    });
  });
});
