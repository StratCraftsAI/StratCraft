/**
 * Constants exports
 *
 * TICKET_179: Unified Constants Management
 */

export * from './channels';
export * from './colors';
export * from './intervals';
export * from './plugin-ids';
export * from './plugin-activation';
export * from './security';
export * from './timing';
export * from './trading';
export * from './network';
export * from './factor-engines';
export * from './window';
export * from './data-providers';
export * from './database';
export * from './rendering';
export * from './llm-providers';
export * from './z-index';
export * from './validation';
export * from './formatting';
export * from './hardware';
export * from './entitlement';
export * from './distribution';

// API Configuration (TICKET_082)
// TICKET_434: API_BASE_URL is defined at build time via webpack DefinePlugin.
// For self-hosted deployments, set StratCraft_API_URL environment variable before build.
// TICKET_1023_4: Fallback domain constants from @StratCraft/types (Tier 0).
import { DESKTOP_API_BASE_URL, AUTH_SERVER_BASE_URL } from '@StratCraft/types';
// TICKET_1023_8: Import canonical timeout constants from timing.ts.
import { API_REQUEST_DEFAULT_TIMEOUT_MS, PER_ARM_EXECUTOR_TIMEOUT_MS } from './timing';
declare const __API_BASE_URL__: string | undefined;
const API_BASE = (typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : null)
  || DESKTOP_API_BASE_URL;
export const API_CONFIG = {
  BASE_URL: API_BASE,
  WS_URL: API_BASE.replace(/^http/, 'ws') + '/ws',
  SSE_URL: API_BASE + '/sse',
  TIMEOUT: API_REQUEST_DEFAULT_TIMEOUT_MS,
} as const;

// Auth Server Configuration
// TICKET_492: Build-time injection via DefinePlugin (set StratCraft_AUTH_URL env var)
declare const __AUTH_BASE_URL__: string | undefined;
const AUTH_BASE = (typeof __AUTH_BASE_URL__ !== 'undefined' ? __AUTH_BASE_URL__ : null)
  || AUTH_SERVER_BASE_URL;
export const AUTH_CONFIG = {
  BASE_URL: AUTH_BASE,
  UPGRADE_URL: AUTH_BASE + '/user-upgrade/',
} as const;

// Application configuration
export const APP_CONFIG = {
  NAME: 'StratCraft',
  VERSION: '0.1.0',
  DEFAULT_THEME: 'dark' as const,
} as const;

// Chart configuration
// TICKET_1023_1: Values reference CHART_COLORS from colors.ts
import { CHART_COLORS as _CC } from './colors';
export const CHART_CONFIG = {
  PROFIT_COLOR: _CC.PROFIT,
  LOSS_COLOR: _CC.LOSS,
  GRID_COLOR: _CC.GRID,
  TEXT_COLOR: _CC.TEXT,
} as const;

// Long-running Task Configuration (TICKET_082)
export const TASK_CONFIG = {
  DEFAULT_POLL_INTERVAL: 500,
  DEFAULT_TIMEOUT: PER_ARM_EXECUTOR_TIMEOUT_MS,
  MARKET_REGIME_TIMEOUT: PER_ARM_EXECUTOR_TIMEOUT_MS,
} as const;

// Credit Configuration (TICKET_519)
export const CREDIT_CONFIG = {
  LOW_THRESHOLD_PERCENT: 20,
  CRITICAL_THRESHOLD_PERCENT: 5,
} as const;

// API Endpoints (TICKET_082, DESKTOP_CLIENT_INTEGRATION_GUIDE v1.2)
// Route constants moved to @StratCraft/types (api-routes.ts, TICKET_1030_14).
export const API_ENDPOINTS = {
  HEALTH: '/health',
} as const;
