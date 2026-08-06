import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONSENT,
  getAppInfo,
  getConsentStatus,
  getDistributionInfo,
  mapCreditStatus,
  resolveDesktopPackageJson,
  setConsentState,
} from './index';

const temporaryDirectories: string[] = [];

function makeDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'app-state-core-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('distribution and app info', () => {
  it('reads public and full distribution values', () => {
    const directory = makeDirectory();
    const packagePath = path.join(directory, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({ distribution: 'public' }));
    expect(getDistributionInfo(packagePath)).toEqual({
      distribution: 'public',
      isPublicRelease: true,
    });
    fs.writeFileSync(packagePath, JSON.stringify({ distribution: 'full' }));
    expect(getDistributionInfo(packagePath)).toEqual({
      distribution: 'full',
      isPublicRelease: false,
    });
  });

  it('defaults invalid, absent, unreadable, and malformed distribution to full observably', () => {
    const directory = makeDirectory();
    const packagePath = path.join(directory, 'package.json');
    const warn = vi.fn();
    fs.writeFileSync(packagePath, JSON.stringify({}));
    expect(getDistributionInfo(packagePath, warn).distribution).toBe('full');
    expect(warn).not.toHaveBeenCalled();

    fs.writeFileSync(packagePath, JSON.stringify({ distribution: 'invalid' }));
    expect(getDistributionInfo(packagePath, warn).distribution).toBe('full');
    fs.writeFileSync(packagePath, '{');
    expect(getDistributionInfo(packagePath, warn).distribution).toBe('full');
    expect(getDistributionInfo(path.join(directory, 'missing.json'), warn).distribution).toBe('full');
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('stringifies non-Error distribution read failures', () => {
    const warn = vi.fn();
    expect(getDistributionInfo('/package.json', warn, () => {
      throw 'read failed';
    }).distribution).toBe('full');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('read failed'));
  });

  it('builds app info and rejects missing versions', () => {
    const directory = makeDirectory();
    const packagePath = path.join(directory, 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }));
    expect(getAppInfo({
      packageJsonPath: packagePath,
      userDataPath: '/data/user',
      researchMode: true,
    })).toEqual({
      version: '1.2.3',
      path: '/data/user',
      researchMode: true,
    });
    fs.writeFileSync(packagePath, JSON.stringify({ version: '' }));
    expect(() => getAppInfo({
      packageJsonPath: packagePath,
      userDataPath: '/data/user',
      researchMode: false,
    })).toThrow('no valid version');
    fs.writeFileSync(packagePath, '{');
    expect(() => getAppInfo({
      packageJsonPath: packagePath,
      userDataPath: '/data/user',
      researchMode: false,
    })).toThrow();
  });

  it('finds the desktop package and rejects an unrelated tree', () => {
    const directory = makeDirectory();
    const nested = path.join(directory, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@StratCraft/desktop' }),
    );
    expect(resolveDesktopPackageJson(nested)).toBe(path.join(directory, 'package.json'));

    const unrelated = makeDirectory();
    fs.writeFileSync(path.join(unrelated, 'package.json'), '{');
    expect(() => resolveDesktopPackageJson(unrelated)).toThrow('Unable to locate');
  });
});

describe('consent state', () => {
  it('returns the canonical first-launch default when the file is absent', () => {
    const filePath = path.join(makeDirectory(), 'consent.json');
    expect(getConsentStatus(filePath)).toEqual({
      consent: DEFAULT_CONSENT,
      isFirstLaunch: true,
    });
  });

  it('writes and reads the same consent record', async () => {
    const filePath = path.join(makeDirectory(), 'consent.json');
    const consent = await setConsentState({
      consentFilePath: filePath,
      crashes: false,
      analytics: true,
      appVersion: '2.0.0',
      now: () => new Date('2026-07-26T12:00:00.000Z'),
    });
    expect(consent).toEqual({
      crashes: false,
      analytics: true,
      timestamp: '2026-07-26T12:00:00.000Z',
      appVersion: '2.0.0',
    });
    expect(getConsentStatus(filePath)).toEqual({
      consent,
      isFirstLaunch: false,
    });
  });

  it('uses the current clock when no clock is injected', async () => {
    const filePath = path.join(makeDirectory(), 'consent.json');
    const before = Date.now();
    const consent = await setConsentState({
      consentFilePath: filePath,
      crashes: true,
      analytics: false,
      appVersion: '2.0.0',
    });
    expect(Date.parse(consent.timestamp)).toBeGreaterThanOrEqual(before);
  });

  it.each([
    [null, 'expected object'],
    [{ crashes: 'yes', analytics: false, timestamp: '', appVersion: '' }, 'crashes'],
    [{ crashes: true, analytics: 1, timestamp: '', appVersion: '' }, 'analytics'],
    [{ crashes: true, analytics: false, timestamp: 1, appVersion: '' }, 'timestamp'],
    [{ crashes: true, analytics: false, timestamp: '', appVersion: 1 }, 'appVersion'],
  ])('fails fast for malformed consent %#', (consent, message) => {
    const filePath = path.join(makeDirectory(), 'consent.json');
    fs.writeFileSync(filePath, JSON.stringify({ consent }));
    expect(() => getConsentStatus(filePath)).toThrow(message);
  });
});

describe('credit mapping', () => {
  it('maps complete and minimal backend responses without inventing values', () => {
    expect(mapCreditStatus({
      has_credit: true,
      remaining: 7,
      total_recharged: 10,
      total_consumed: 3,
      updated_at: 'updated',
      reset_date: 'reset',
    })).toEqual({
      hasCredit: true,
      remaining: 7,
      totalRecharged: 10,
      totalConsumed: 3,
      updatedAt: 'updated',
      resetDate: 'reset',
    });
    expect(mapCreditStatus({ has_credit: false, remaining: 0 })).toEqual({
      hasCredit: false,
      remaining: 0,
      totalRecharged: undefined,
      totalConsumed: undefined,
      updatedAt: undefined,
      resetDate: undefined,
    });
  });

  it.each([
    [{ has_credit: 'yes', remaining: 1 }],
    [{ has_credit: true, remaining: '1' }],
    [{ has_credit: true, remaining: Number.POSITIVE_INFINITY }],
  ])('rejects malformed backend response %#', (raw) => {
    expect(() => mapCreditStatus(
      raw as unknown as Parameters<typeof mapCreditStatus>[0],
    )).toThrow('Credit status response is malformed');
  });
});
