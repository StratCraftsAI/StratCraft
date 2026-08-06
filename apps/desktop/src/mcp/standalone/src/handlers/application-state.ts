/**
 * TICKET_1302 U7 application-state tools.
 *
 * Class-S reads/writes call the Electron-free @StratCraft/app-state-core
 * directly. Class-R reads use the authenticated loopback runtime channel.
 */

import * as path from 'path';
import {
  getAppInfo,
  getConsentStatus,
  getDistributionInfo,
  mapCreditStatus,
  resolveDesktopPackageJson,
  setConsentState,
  type CreditStatusRawResponse,
} from '@StratCraft/app-state-core';
import {
  API_USER_CREDIT_STATUS,
  DESKTOP_API_BASE_URL,
} from '@StratCraft/types';
import { resolveUserDataDir } from '../db';
import { discoverElectronService } from '../bridge/electron-service';
import * as apiClient from '../bridge/api-client';
import { MCP_REQUEST_TIMEOUT_MS } from '../constants';
import { electronNotRunning } from './electron-guard';
import type { McpToolResult } from './tool-result';

function textResult(value: unknown): McpToolResult {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function errorResult(
  error: unknown,
  category: McpToolResult['errorCategory'],
): McpToolResult {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    }],
    isError: true,
    errorCategory: category,
  };
}

function desktopPackageJsonPath(): string {
  return resolveDesktopPackageJson(__dirname);
}

function consentFilePath(): string {
  return path.join(resolveUserDataDir(), 'consent.json');
}

async function runtimeRead(
  operation: string,
  command: (
    config: NonNullable<ReturnType<typeof discoverElectronService>>,
  ) => Promise<apiClient.ApiResponse>,
): Promise<McpToolResult> {
  const config = discoverElectronService();
  if (!config) return electronNotRunning(operation);
  try {
    const response = await command(config);
    if (response.unreachable) return electronNotRunning(operation);
    if (!response.success) {
      return errorResult(response.error ?? `${operation} failed`, 'process');
    }
    return textResult(response.data);
  } catch (error) {
    return errorResult(error, 'process');
  }
}

export async function handleGetCreditStatus(
  serverBearer: string,
): Promise<McpToolResult> {
  try {
    const baseUrl = process.env.DESKTOP_API_URL || DESKTOP_API_BASE_URL;
    const response = await fetch(`${baseUrl}${API_USER_CREDIT_STATUS}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${serverBearer}`,
        'Content-Type': 'application/json',
        'X-Client-Type': 'desktop',
      },
      signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      let message = `Credit status request failed with HTTP ${response.status}`;
      try {
        const body = await response.json() as { error?: unknown; message?: unknown };
        const backendMessage = typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string' ? body.message : null;
        if (backendMessage) message = backendMessage;
      } catch {
        // The status code remains the actionable error when the backend body
        // is not JSON. No untrusted HTML body is reflected to the tool.
      }
      return errorResult(message, response.status === 401 ? 'authentication' : 'network');
    }
    try {
      const raw = await response.json() as CreditStatusRawResponse;
      return textResult(mapCreditStatus(raw));
    } catch (error) {
      return errorResult(error, 'schema');
    }
  } catch (error) {
    return errorResult(error, 'network');
  }
}

export async function handleGetRateLimitStatus(): Promise<McpToolResult> {
  return runtimeRead(
    'get_rate_limit_status',
    (config) => apiClient.getAppRateLimitStatus(config),
  );
}

export function handleGetDistributionInfo(): McpToolResult {
  try {
    return textResult(getDistributionInfo(desktopPackageJsonPath()));
  } catch (error) {
    return errorResult(error, 'storage');
  }
}

export function handleGetConsentStatus(): McpToolResult {
  try {
    return textResult(getConsentStatus(consentFilePath()));
  } catch (error) {
    return errorResult(error, 'storage');
  }
}

export async function handleSetConsent(params: {
  crashes: boolean;
  analytics: boolean;
}): Promise<McpToolResult> {
  try {
    const packageJsonPath = desktopPackageJsonPath();
    const appInfo = getAppInfo({
      packageJsonPath,
      userDataPath: resolveUserDataDir(),
      researchMode: process.env.STRATCRAFT_RESEARCH_MODE === '1',
    });
    const consent = await setConsentState({
      consentFilePath: consentFilePath(),
      crashes: params.crashes,
      analytics: params.analytics,
      appVersion: appInfo.version,
    });
    return textResult(consent);
  } catch (error) {
    return errorResult(error, 'storage');
  }
}

export function handleGetAppInfo(): McpToolResult {
  try {
    return textResult(getAppInfo({
      packageJsonPath: desktopPackageJsonPath(),
      userDataPath: resolveUserDataDir(),
      researchMode: process.env.STRATCRAFT_RESEARCH_MODE === '1',
    }));
  } catch (error) {
    return errorResult(error, 'storage');
  }
}

export async function handleGetServerStatus(): Promise<McpToolResult> {
  return runtimeRead(
    'get_server_status',
    (config) => apiClient.getAppServerStatus(config),
  );
}
