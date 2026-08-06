/**
 * Credential Sensitivity Tier Classification - desktop re-export shim
 *
 * TICKET_580_2: Credential Store Security Strategy.
 * TICKET_1276 P0: the tier enum, registry, and helpers moved to
 * `@StratCraft/types` (credential-tiers.ts) so the MCP standalone server
 * enforces the same storage-policy tiers as Electron. This file keeps every
 * existing desktop import site working.
 *
 * Const-binding re-export form required for electron-vite externalization
 * correctness -- see shared/constants/llm-providers.ts for the full note.
 */

import {
  CredentialTier as CredentialTier_src,
  inferCredentialTier as inferCredentialTier_src,
  clearSensitiveBuffer as clearSensitiveBuffer_src,
  clearSensitiveString as clearSensitiveString_src,
  isMarketplacePlugin as isMarketplacePlugin_src,
} from '@StratCraft/types';

export const CredentialTier = CredentialTier_src;
export type CredentialTier = CredentialTier_src;
export const inferCredentialTier = inferCredentialTier_src;
export const clearSensitiveBuffer = clearSensitiveBuffer_src;
export const clearSensitiveString = clearSensitiveString_src;
export const isMarketplacePlugin = isMarketplacePlugin_src;

export type { CredentialAuditEntry } from '@StratCraft/types';
