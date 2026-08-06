import * as fs from 'fs';
import * as path from 'path';
import {
  readJsonConfigFile,
  updateJsonConfigFile,
} from '@StratCraft/config-file';

export type DistributionType = 'public' | 'full';

export interface DistributionInfo {
  distribution: DistributionType;
  isPublicRelease: boolean;
}

export interface AppInfo {
  version: string;
  path: string;
  researchMode: boolean;
}

export interface ConsentState {
  crashes: boolean;
  analytics: boolean;
  timestamp: string;
  appVersion: string;
}

export interface ConsentStatus {
  consent: ConsentState;
  isFirstLaunch: boolean;
}

export interface CreditStatusRawResponse {
  has_credit: boolean;
  remaining: number;
  total_recharged?: number;
  total_consumed?: number;
  updated_at?: string;
  reset_date?: string;
}

export interface CreditStatus {
  hasCredit: boolean;
  remaining: number;
  totalRecharged?: number;
  totalConsumed?: number;
  updatedAt?: string;
  resetDate?: string;
}

export const DEFAULT_CONSENT: Readonly<ConsentState> = Object.freeze({
  crashes: true,
  analytics: false,
  timestamp: '',
  appVersion: '',
});

export function getDistributionInfo(
  packageJsonPath: string,
  onWarning?: (message: string) => void,
  readFile: (filePath: string, encoding: BufferEncoding) => string = fs.readFileSync,
): DistributionInfo {
  let distribution: DistributionType = 'full';
  try {
    const packageJson = JSON.parse(
      readFile(packageJsonPath, 'utf-8'),
    ) as Record<string, unknown>;
    const value = packageJson.distribution;
    if (value === 'public' || value === 'full') {
      distribution = value;
    } else if (value !== undefined && value !== null) {
      onWarning?.(
        `Invalid distribution value in ${packageJsonPath}: ${String(value)}; defaulting to full`,
      );
    }
  } catch (error) {
    onWarning?.(
      `Failed to read distribution from ${packageJsonPath}: ${
        error instanceof Error ? error.message : String(error)
      }; defaulting to full`,
    );
  }
  return {
    distribution,
    isPublicRelease: distribution === 'public',
  };
}

export function getAppInfo(params: {
  packageJsonPath: string;
  userDataPath: string;
  researchMode: boolean;
}): AppInfo {
  const packageJson = JSON.parse(
    fs.readFileSync(params.packageJsonPath, 'utf-8'),
  ) as Record<string, unknown>;
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`Application package has no valid version: ${params.packageJsonPath}`);
  }
  return {
    version: packageJson.version,
    path: params.userDataPath,
    researchMode: params.researchMode,
  };
}

export function resolveDesktopPackageJson(startDirectory: string): string {
  let directory = path.resolve(startDirectory);
  for (;;) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(candidate, 'utf-8'),
        ) as Record<string, unknown>;
        if (packageJson.name === '@StratCraft/desktop') {
          return candidate;
        }
      } catch {
        // This resolver only identifies the desktop package. The selected
        // package is parsed strictly by getAppInfo/getDistributionInfo.
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        `Unable to locate @StratCraft/desktop package.json from ${startDirectory}`,
      );
    }
    directory = parent;
  }
}

function requireBoolean(
  value: unknown,
  field: keyof Pick<ConsentState, 'crashes' | 'analytics'>,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid consent.${field}: expected boolean`);
  }
  return value;
}

function requireString(
  value: unknown,
  field: keyof Pick<ConsentState, 'timestamp' | 'appVersion'>,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid consent.${field}: expected string`);
  }
  return value;
}

function parseConsent(value: unknown): ConsentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid consent record: expected object');
  }
  const record = value as Record<string, unknown>;
  return {
    crashes: requireBoolean(record.crashes, 'crashes'),
    analytics: requireBoolean(record.analytics, 'analytics'),
    timestamp: requireString(record.timestamp, 'timestamp'),
    appVersion: requireString(record.appVersion, 'appVersion'),
  };
}

export function getConsentStatus(consentFilePath: string): ConsentStatus {
  const document = readJsonConfigFile(consentFilePath);
  const consent = document.consent === undefined
    ? { ...DEFAULT_CONSENT }
    : parseConsent(document.consent);
  return {
    consent,
    isFirstLaunch: consent.timestamp.length === 0,
  };
}

export async function setConsentState(params: {
  consentFilePath: string;
  crashes: boolean;
  analytics: boolean;
  appVersion: string;
  now?: () => Date;
}): Promise<ConsentState> {
  const consent: ConsentState = {
    crashes: params.crashes,
    analytics: params.analytics,
    timestamp: (params.now ?? (() => new Date()))().toISOString(),
    appVersion: params.appVersion,
  };
  await updateJsonConfigFile(params.consentFilePath, { consent });
  return consent;
}

export function mapCreditStatus(raw: CreditStatusRawResponse): CreditStatus {
  if (
    typeof raw.has_credit !== 'boolean'
    || typeof raw.remaining !== 'number'
    || !Number.isFinite(raw.remaining)
  ) {
    throw new Error('Credit status response is malformed');
  }

  return {
    hasCredit: raw.has_credit,
    remaining: raw.remaining,
    totalRecharged: raw.total_recharged,
    totalConsumed: raw.total_consumed,
    updatedAt: raw.updated_at,
    resetDate: raw.reset_date,
  };
}
