/**
 * Credential Sensitivity Tier Classification
 *
 * TICKET_1276 P0: relocated from apps/desktop/src/shared/constants so the
 * MCP standalone server enforces the same storage-policy tiers as Electron
 * (the desktop path re-exports from here).
 *
 * TICKET_580_2: Credential Store Security Strategy
 *
 * Classifies credential keys into tiers that determine storage policy:
 * - T0_CRITICAL: OS keychain mandatory, refuse without safeStorage
 * - T1_HIGH: OS keychain preferred, warn on fallback
 * - T2_LOW: Fallback acceptable
 * - T3_METADATA: No encryption required
 */

import { LLM_CREDENTIAL_KEYS, DATA_CREDENTIAL_KEYS, LLM_CONFIG_KEYS } from './credential-keys'; // TICKET_1023_6 / TICKET_1276 P0 relocation

// =============================================================================
// Tier Enum
// =============================================================================

export enum CredentialTier {
  T0_CRITICAL = 0,
  T1_HIGH = 1,
  T2_LOW = 2,
  T3_METADATA = 3,
}

// =============================================================================
// Tier Registry
// =============================================================================

/**
 * Known credential key patterns mapped to sensitivity tiers.
 * Keys are matched by exact key or prefix pattern (ending with '*').
 */
const TIER_REGISTRY: Array<{ pattern: string; tier: CredentialTier }> = [
  // T0 - Critical: API keys, passwords, tokens with financial exposure
  { pattern: 'oauth_tokens', tier: CredentialTier.T0_CRITICAL },
  { pattern: 'browser_oauth_session', tier: CredentialTier.T0_CRITICAL },
  { pattern: LLM_CREDENTIAL_KEYS.CLAUDE_API_KEY, tier: CredentialTier.T0_CRITICAL },
  { pattern: LLM_CREDENTIAL_KEYS.OPENAI_API_KEY, tier: CredentialTier.T0_CRITICAL },
  { pattern: LLM_CREDENTIAL_KEYS.DEEPSEEK_API_KEY, tier: CredentialTier.T0_CRITICAL },
  { pattern: LLM_CREDENTIAL_KEYS.GEMINI_API_KEY, tier: CredentialTier.T0_CRITICAL },
  { pattern: LLM_CREDENTIAL_KEYS.GROK_API_KEY, tier: CredentialTier.T0_CRITICAL },
  { pattern: LLM_CREDENTIAL_KEYS.QWEN_API_KEY, tier: CredentialTier.T0_CRITICAL },
  { pattern: 'CLICKHOUSE_PASSWORD', tier: CredentialTier.T0_CRITICAL },
  { pattern: DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID, tier: CredentialTier.T0_CRITICAL },
  { pattern: DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY, tier: CredentialTier.T0_CRITICAL },

  // T1 - High: PII, server URLs
  { pattern: 'oauth_user', tier: CredentialTier.T1_HIGH },
  { pattern: 'CLICKHOUSE_URL', tier: CredentialTier.T1_HIGH },
  { pattern: 'CLICKHOUSE_USERNAME', tier: CredentialTier.T1_HIGH },

  // T2 - Low: License keys, local service URLs
  { pattern: 'license_key', tier: CredentialTier.T2_LOW },
  { pattern: LLM_CREDENTIAL_KEYS.OLLAMA_BASE_URL, tier: CredentialTier.T2_LOW },

  // T3 - Metadata: Cache, validation flags, timestamps
  { pattern: 'CLICKHOUSE_EXPIRES_AT', tier: CredentialTier.T3_METADATA },
];

// =============================================================================
// Tier Inference
// =============================================================================

/**
 * Infer the sensitivity tier for a credential key.
 *
 * Matching rules (in order):
 * 1. Exact key match from TIER_REGISTRY
 * 2. Wildcard prefix patterns ending with '*' (future extension)
 * 3. LLM API key pattern: `llm.*.apiKey` -> T0_CRITICAL
 * 4. LLM validation flag pattern: `llm.validated.*` -> T3_METADATA
 * 5. Default: T1_HIGH (conservative for unknown keys)
 */
export function inferCredentialTier(_pluginId: string, key: string): CredentialTier {
  // 1. Exact match
  for (const entry of TIER_REGISTRY) {
    if (entry.pattern === key) {
      return entry.tier;
    }
  }

  // 2. LLM API key pattern: llm.<provider>.apiKey
  if (/^llm\.[^.]+\.apiKey$/.test(key)) {
    return CredentialTier.T0_CRITICAL;
  }

  // 3. LLM validation flag pattern: llm.validated.*
  if (key.startsWith(LLM_CONFIG_KEYS.VALIDATION_STATUS_PREFIX)) {
    return CredentialTier.T3_METADATA;
  }

  // 4. Default: T1_HIGH (conservative)
  return CredentialTier.T1_HIGH;
}

// =============================================================================
// Memory Clearing Utilities
// =============================================================================

/**
 * Zero-fill a buffer to minimize sensitive data exposure in memory.
 * Accepts Uint8Array (platform-agnostic) — Node Buffer extends it,
 * so callers can pass Buffer directly without a cast.
 */
export function clearSensitiveBuffer(buf: Uint8Array): void {
  buf.fill(0);
}

/**
 * Returns null to signal that the caller should discard the string reference.
 * JS strings are immutable so we cannot zero-fill them, but discarding
 * the reference minimizes the exposure window before GC collects.
 */
export function clearSensitiveString(_value: string): null {
  return null;
}

// =============================================================================
// Plugin Classification
// =============================================================================

/** Core plugin ID prefixes that ship with the application */
const CORE_PLUGIN_PREFIXES = [
  'com.stratcraft.',
  'system.',
];

/**
 * Determine whether a plugin ID belongs to a marketplace (third-party) plugin.
 * Core plugins use `com.stratcraft.*` or `system.*` prefixes.
 */
export function isMarketplacePlugin(pluginId: string): boolean {
  return !CORE_PLUGIN_PREFIXES.some(prefix => pluginId.startsWith(prefix));
}

// =============================================================================
// Audit Entry Type
// =============================================================================

export interface CredentialAuditEntry {
  timestamp: number;
  operation: 'get' | 'set' | 'delete';
  pluginId: string;
  key: string;
  tier: CredentialTier;
}
