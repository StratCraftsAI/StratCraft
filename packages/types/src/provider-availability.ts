/**
 * TICKET_1327 F1/F2 -- the single owner of "which data providers can I use?"
 *
 * Before this module, that question had two answers depending on which surface
 * asked, and neither was a projection of the other:
 *
 *   - Electron (`useConfiguredDataProviders`) answered "are this provider's
 *     credentials stored?" -- from the credential store, persistent,
 *     all-keys-required, fail-closed.
 *   - Guide WebUI / MCP (`list_data_providers`) answered "what did the live
 *     reachability probe last report?" -- from an in-memory `statusCache` with
 *     a 5-minute TTL, which returns `'checking'` for everything on a cold
 *     cache and refuses outright when Electron is down.
 *
 * Worse, the credential map itself was MIRRORED: `provider-manager.ts:42`
 * carried a hand-maintained main-process copy of the plugin's
 * `BYOK_PROVIDER_CREDENTIALS`, with the source location named in a comment and
 * nothing enforcing agreement. Adding a provider or changing its required keys
 * in one place silently desynchronized availability across surfaces -- the
 * concrete TICKET_854 violation, and the reason "just point the WebUI at the
 * same endpoint" was insufficient: the endpoint's own inputs were duplicated.
 *
 * ## The split that makes this tractable (TICKET_1327 sec.3.2)
 *
 * `ProviderStatusEntry` conflated two independently-owned facts. This module
 * owns only the half that is genuinely storage-derived:
 *
 *   - **identity** (`id`, `name`) + **configured-ness** -- from the credential
 *     store plus the credential map. No live pool, no probe. **Class-S**: it
 *     answers identically whether or not Electron is running (TICKET_1276 AC4).
 *   - **reachability / latency** -- a live probe result. Genuinely **Class-R**;
 *     nothing can synthesize it while the pool is down, and this module does
 *     not try. It is reported as explicitly ABSENT, never as `false`
 *     (TICKET_858: a configured provider must not appear unconfigured merely
 *     because the probe is unreachable).
 *
 * ## Invariants preserved verbatim from `useConfiguredDataProviders`
 *
 *   1. **all-keys-required** -- a provider is `configured` iff EVERY one of its
 *      `requiredKeys` is present. One of two keys stored is NOT configured.
 *   2. **fail-closed on read error** -- an unreadable credential source yields
 *      `unknown`, which GATES as not-configured (a host crash mid-read must not
 *      silently bypass the BYOK gate, TICKET_811 sec.11 Q6) but never DISPLAYS
 *      as "no credentials" (F5/AC6).
 *
 * Lives in `@StratCraft/types` because that is the one package every tier
 * already depends on: the plugin UI may not import from `apps/desktop`
 * (PLUGIN_TICKET_009), and the MCP standalone server is a separate process.
 * A shared definition in a shared package is the only shape in which the
 * mirror can actually be deleted rather than merely documented (F2/AC2).
 */

import { DATA_CREDENTIAL_KEYS } from './credential-keys';
import {
  PROVIDER_ALPACA,
  PROVIDER_ALPHA_VANTAGE,
  PROVIDER_POLYGON,
  PROVIDER_TUSHARE,
} from './data-provider-id';

/** The plugin that owns BYOK data-provider credential storage. */
export const DATA_PROVIDER_CREDENTIAL_PLUGIN_ID = 'com.stratcraft.back-test-nexus';

/** Per-provider credential requirement. */
export interface ProviderCredentialDescriptor {
  /** Credential-store owner (`pluginId` in the credential API). */
  readonly pluginId: string;
  /** EVERY key here must be present for the provider to be `configured`. */
  readonly requiredKeys: readonly string[];
  /** Human-readable name for gate messaging. */
  readonly displayName: string;
}

/**
 * TICKET_1327 F2 -- THE credential map. One definition, no mirrors.
 *
 * This replaces BOTH former copies:
 *   - `plugins/quant-lab-nexus/.../tool-sweep/universes.ts` `BYOK_PROVIDER_CREDENTIALS`
 *     (renderer-side BYOK gate; 3 providers)
 *   - `apps/desktop/src/main/services/data-providers/provider-manager.ts`
 *     `DATA_PROVIDER_CREDENTIALS` (main-process mirror; 4 providers)
 *
 * NOTE -- the two copies had DIVERGED, which is precisely the failure the
 * ticket predicts. The main-process mirror carried `tushare`; the renderer gate
 * did not. This map is the UNION, because a divergence in a BYOK gate can only
 * be resolved toward "requires its credentials": treating a key-bearing
 * provider as always-available is the fail-OPEN direction, and the gate is
 * specified fail-closed. Consequence to be aware of: `tushare` is now BYOK-
 * gated in the Tool Sweep picker, where it previously passed unconditionally.
 *
 * Adding a provider here changes availability on EVERY surface at once. That
 * is the point (AC1/AC3).
 */
export const DATA_PROVIDER_CREDENTIALS: Readonly<Record<string, ProviderCredentialDescriptor>> = {
  [PROVIDER_ALPACA]: {
    pluginId: DATA_PROVIDER_CREDENTIAL_PLUGIN_ID,
    requiredKeys: [
      DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
      DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY,
    ],
    displayName: 'Alpaca',
  },
  [PROVIDER_ALPHA_VANTAGE]: {
    pluginId: DATA_PROVIDER_CREDENTIAL_PLUGIN_ID,
    requiredKeys: [DATA_CREDENTIAL_KEYS.ALPHA_VANTAGE_API_KEY],
    displayName: 'Alpha Vantage',
  },
  [PROVIDER_POLYGON]: {
    pluginId: DATA_PROVIDER_CREDENTIAL_PLUGIN_ID,
    requiredKeys: [DATA_CREDENTIAL_KEYS.POLYGON_API_KEY],
    displayName: 'Polygon.io',
  },
  [PROVIDER_TUSHARE]: {
    pluginId: DATA_PROVIDER_CREDENTIAL_PLUGIN_ID,
    requiredKeys: [DATA_CREDENTIAL_KEYS.TUSHARE_API_TOKEN],
    displayName: 'Tushare Pro',
  },
} as const;

/** True iff the provider needs stored credentials to be usable. */
export function isByokDataProvider(providerId: string): boolean {
  return Object.prototype.hasOwnProperty.call(DATA_PROVIDER_CREDENTIALS, providerId);
}

/**
 * Reverse lookup: which provider does this credential key belong to?
 * Used to target a status refresh on `credential:set` / `credential:delete`.
 * Replaces `resolveDataProviderFromCredential` in `provider-manager.ts`.
 */
export function resolveDataProviderFromCredential(
  pluginId: string,
  key: string,
): string | null {
  for (const [providerId, descriptor] of Object.entries(DATA_PROVIDER_CREDENTIALS)) {
    if (descriptor.pluginId === pluginId && descriptor.requiredKeys.includes(key)) {
      return providerId;
    }
  }
  return null;
}

/**
 * TICKET_1327 F5 -- three states, not two.
 *
 * `unknown` is NOT a synonym for `not-configured`. Collapsing them is
 * acceptable only as a GATING decision (fail-closed), never as a displayed
 * claim: telling a user "no credentials" when the truth is "we could not read
 * the credential store" is a TICKET_858 silent failure that sends them to
 * re-enter a key they already have.
 */
export type ProviderConfiguredState = 'configured' | 'not-configured' | 'unknown';

/** Class-S half: identity + configured-ness. Answerable with Electron down. */
export interface ProviderConfiguredEntry {
  readonly id: string;
  readonly displayName: string;
  /** False for always-on providers (yfinance et al) that need no credentials. */
  readonly requiresCredentials: boolean;
  readonly state: ProviderConfiguredState;
  /** Which required keys were found missing. Empty when `configured`;
   *  meaningless (and empty) when `unknown` -- nothing was readable. */
  readonly missingKeys: readonly string[];
  /** Present only when `state === 'unknown'`: why the source was unreadable.
   *  Surfaced so the UI can say what actually went wrong (TICKET_858). */
  readonly unreadableReason?: string;
}

/**
 * The minimum credential-read surface this module needs.
 *
 * Deliberately narrow so every caller can satisfy it: the Electron preload's
 * `credential.has`, the MCP server's `SecureStore.hasCredential`, and a test
 * fake all fit. This module never imports a credential implementation -- that
 * is what lets one definition serve three processes.
 *
 * A thrown error or a non-`success` result is a READ FAILURE (-> `unknown`),
 * which is NOT the same as `exists: false` (-> `not-configured`). Callers must
 * preserve that distinction; collapsing it is the fail-closed-in-the-wrong-
 * direction bug F3 warns about.
 */
export interface CredentialPresenceReader {
  (pluginId: string, key: string): Promise<{
    success: boolean;
    exists: boolean;
    errorMessage?: string;
  }>;
}

/**
 * TICKET_1327 F1 -- resolve configured-ness for ONE provider.
 *
 * Honours all-keys-required and the read-error/absent distinction. Reads keys
 * sequentially and stops at the first definitive `not-configured`, so a
 * partially-configured provider costs one read rather than N.
 */
export async function resolveProviderConfiguredState(
  providerId: string,
  read: CredentialPresenceReader,
): Promise<ProviderConfiguredEntry> {
  const descriptor = DATA_PROVIDER_CREDENTIALS[providerId];

  // Always-on provider: no credentials, therefore trivially usable. Reported
  // as `configured` with `requiresCredentials: false` so a caller can tell
  // "needs nothing" apart from "needs keys and has them".
  if (!descriptor) {
    return {
      id: providerId,
      displayName: providerId,
      requiresCredentials: false,
      state: 'configured',
      missingKeys: [],
    };
  }

  const missingKeys: string[] = [];
  for (const key of descriptor.requiredKeys) {
    let result: { success: boolean; exists: boolean; errorMessage?: string };
    try {
      result = await read(descriptor.pluginId, key);
    } catch (error) {
      // READ FAILURE -> unknown. Fail-closed for gating, but never displayed
      // as "no credentials" (F5/AC6).
      return {
        id: providerId,
        displayName: descriptor.displayName,
        requiresCredentials: true,
        state: 'unknown',
        missingKeys: [],
        unreadableReason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!result || result.success !== true) {
      return {
        id: providerId,
        displayName: descriptor.displayName,
        requiresCredentials: true,
        state: 'unknown',
        missingKeys: [],
        unreadableReason: result?.errorMessage ?? 'Credential store read did not succeed',
      };
    }
    // A successful read reporting absence IS definitive: not-configured.
    if (!result.exists) missingKeys.push(key);
  }

  return {
    id: providerId,
    displayName: descriptor.displayName,
    requiresCredentials: true,
    state: missingKeys.length === 0 ? 'configured' : 'not-configured',
    missingKeys,
  };
}

/**
 * TICKET_1327 F1 -- resolve configured-ness for every BYOK provider.
 *
 * The surface-agnostic core. Electron calls it through preload IPC, the MCP
 * server calls it against `SecureStore` over the shared SQLite handle; neither
 * recomputes availability (F4/AC1).
 */
export async function resolveConfiguredDataProviders(
  read: CredentialPresenceReader,
): Promise<ProviderConfiguredEntry[]> {
  return Promise.all(
    Object.keys(DATA_PROVIDER_CREDENTIALS).map(id => resolveProviderConfiguredState(id, read)),
  );
}

/**
 * The gating projection: which provider ids may be selected?
 *
 * This is where -- and ONLY where -- `unknown` collapses into
 * not-selectable. Preserves the fail-closed contract from TICKET_811
 * sec.11 Q6 while leaving the displayed state untouched (F5).
 */
export function toSelectableProviderIds(
  entries: readonly ProviderConfiguredEntry[],
): ReadonlySet<string> {
  return new Set(entries.filter(e => e.state === 'configured').map(e => e.id));
}

/**
 * TICKET_1327 F3 -- the split response shape.
 *
 * `configured` is always present (Class-S). `reachability` is present only
 * when a live pool answered; `reachabilityAbsentReason` explains its absence
 * so a consumer states "unknown" rather than inventing "unavailable" (AC4).
 */
export interface ProviderAvailabilityResponse {
  readonly configured: readonly ProviderConfiguredEntry[];
  /** Class-R half. `undefined` (not empty) when no live pool answered. */
  readonly reachability?: readonly ProviderReachabilityEntry[];
  /** Why `reachability` is absent. Set iff `reachability` is undefined. */
  readonly reachabilityAbsentReason?: string;
}

/** Class-R half: the live probe result. Never synthesized. */
export interface ProviderReachabilityEntry {
  readonly id: string;
  /** Probe verdict. `'checking'` means the probe has not completed -- it is
   *  explicitly NOT evidence that the provider is unconfigured (AC7). */
  readonly status: 'connected' | 'disconnected' | 'error' | 'checking';
  readonly latencyMs?: number;
  readonly error?: string;
}

/**
 * Build the Class-S-only response for a surface with no live provider pool
 * (Electron down, or the MCP server answering directly from storage).
 *
 * The reason string is REQUIRED: an absent Class-R half must always be
 * explained, never silently omitted (TICKET_858).
 */
export function buildAvailabilityWithoutReachability(
  configured: readonly ProviderConfiguredEntry[],
  reachabilityAbsentReason: string,
): ProviderAvailabilityResponse {
  return { configured, reachabilityAbsentReason };
}
