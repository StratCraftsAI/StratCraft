/**
 * Provider Credential Contribution Schema
 *
 * TICKET_809_1 Phase 1 (TICKET_809_3): Contributor model for credential-bearing
 * providers. Every secret-bearing thing in the app (LLM keys, data-provider
 * keys, exchange keys, OAuth tokens) is the same shape: an id, display name,
 * icon, a list of credential fields with sensitivity tiers, an optional
 * verifier, and an optional post-configure hook.
 *
 * Renderer-only types. Host code and plugin code both import from here.
 * Storage / IPC contract is unchanged (`window.electronAPI.credential.*`);
 * this module only defines the declarative contribution shape that
 * `CredentialRegistry` (Phase 2) and `SecretsPanel` (Phase 3) consume.
 *
 * Per TICKET_809_1 section 12.4 section 7.4: this lives in the host shared module
 * (not Tier 0 data-plugin) because credentials are a host concern.
 * data-plugin's `data-providers.ts` will import from here in Phase 5.
 *
 * Per TICKET_809_1 section 12.2: `pluginId` directly holds the owner. Global
 * credentials (LLM, OAuth) use `'host'`; plugin-private secrets use the
 * plugin's own id. The two-field `(pluginId, ownership)` model from section 7.1
 * was rejected.
 */

import type { ComponentType } from 'react';

import type { CredentialTier } from '../constants/credential-tiers';

// =============================================================================
// Constants
// =============================================================================

/**
 * Synthetic pluginId for host-owned (global) credentials. Mirrors
 * `HOST_PLUGIN_ID` in `apps/desktop/src/main/services/secure-credential-service.ts`.
 * Duplicated here because the renderer cannot import from main-process
 * modules. Phase 7 (TICKET_809_7) adds a lint rule that flags any
 * `'host'` string literal in renderer credential operations and steers
 * callers to this constant.
 */
export const HOST_PLUGIN_ID = 'host';

/**
 * Domain buckets used to group providers in System Settings.
 *
 * - `llm`      LLM API keys (OpenAI, Claude, DeepSeek, ...)
 * - `data`     Market-data providers (Alpaca, Polygon, AlphaVantage, ClickHouse)
 * - `exchange` Live-trading exchange API keys (CCXT, IBKR, ...)
 * - `auth`     OAuth tokens and identity material (read-only audit view)
 * - `other`    Escape hatch for unforeseen provider types
 */
export type ProviderDomain = 'llm' | 'data' | 'exchange' | 'auth' | 'other';

/** Frozen list for iteration / validation. Order is the canonical display order. */
export const PROVIDER_DOMAINS: readonly ProviderDomain[] = Object.freeze([
  'llm',
  'data',
  'exchange',
  'auth',
  'other',
] as const);

// =============================================================================
// Credential Key Field
// =============================================================================

/**
 * UI input type for a credential key field.
 *
 * - `password` Masked input with show/hide toggle (default for T0/T1 keys).
 * - `text`     Plain text (usernames, key IDs).
 * - `url`      URL input with basic protocol validation hint.
 */
export type CredentialKeyInputType = 'password' | 'text' | 'url';

/** A single credential key the provider needs. */
export interface CredentialKeyField {
  /**
   * Storage key under the provider's pluginId. Identical to the value
   * passed to `window.electronAPI.credential.set(pluginId, key, value)`.
   * Examples: `'llm.openai.apiKey'`, `'alpaca.apiKeyId'`,
   * `'CLICKHOUSE_PASSWORD'`.
   */
  key: string;

  /** i18n key for the human-facing label. Not a raw string. */
  labelKey: string;

  /** Optional i18n key for placeholder text shown in the input. */
  placeholderKey?: string;

  /** UI input type. Drives masking and validation hints. */
  inputType: CredentialKeyInputType;

  /** Whether the field must be populated for the provider to be "configured." */
  required: boolean;

  /**
   * Sensitivity tier override. Defaults to `inferCredentialTier(pluginId, key)`
   * from `credential-tiers.ts` when omitted. Only set this to **raise**
   * the default tier; lowering is rejected by `CredentialRegistry.register`
   * (Phase 2) at runtime.
   */
  tier?: CredentialTier;

  /**
   * Optional regex pattern (serialized) for client-side format validation
   * before the value is sent to the verifier. Mirrors the existing
   * `BYOKProviderUIConfig.apiKeyPattern` convention. Consumers compile via
   * `new RegExp(pattern)`.
   */
  pattern?: string;
}

// =============================================================================
// Verifier
// =============================================================================

/**
 * Result returned by a `CredentialVerifier`.
 */
export type CredentialVerifyResult =
  | { ok: true; details?: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Function that verifies credentials by hitting the provider's API.
 * Receives a map of `{ [field.key]: rawValue }` for every field declared
 * on the contribution.
 *
 * Implementations MUST NOT persist the values themselves -- persistence
 * is owned by `SecretsPanel` after `ok: true`. The verifier's only job
 * is to answer "would these credentials work."
 *
 * Implementations SHOULD handle their own network timeouts and never
 * throw (return `{ ok: false, error }` instead). `SecretsPanel` does
 * have a top-level catch as defense-in-depth.
 */
export type CredentialVerifier = (
  values: Record<string, string>,
) => Promise<CredentialVerifyResult>;

// =============================================================================
// Post-configure hook
// =============================================================================

/**
 * Optional follow-on side effect after a successful verify + save.
 *
 * Typical uses:
 * - LLM providers fetch their model catalog and prime the
 *   `LLMProviderSelector` dropdown.
 * - Data providers warm a symbol-coverage cache.
 * - Exchanges fetch supported trading pairs.
 *
 * The hook runs after the credential is written to the AES-256-GCM
 * store, so implementations may read it back via the standard IPC
 * surface; they do not need (and SHOULD NOT take) the raw values
 * passed to the verifier.
 */
export type PostConfigureHook = () => Promise<void>;

// =============================================================================
// Provider Contribution
// =============================================================================

/**
 * Icon component supplied by the contributor. Accepts at minimum
 * `className` for size/color. Both lucide-react icons and custom SVG
 * components satisfy this shape.
 */
export type ProviderIconComponent = ComponentType<{ className?: string }>;

/**
 * A complete provider declaration. One contribution = one row in
 * `SecretsPanel` and one entry in System Settings -> Config.
 */
export interface ProviderCredentialContribution {
  /**
   * Stable, unique id. Examples: `'alpaca'`, `'openai'`, `'claude'`,
   * `'oauth-session'`. Used by `CredentialRegistry` for dedup and by
   * `SecretsPanel` filters (`filter.providerIds`).
   */
  providerId: string;

  /** Domain bucket for grouping in System Settings. */
  domain: ProviderDomain;

  /** i18n key for the display name. */
  nameKey: string;

  /** Icon component (lucide-react or custom). */
  icon: ProviderIconComponent;

  /**
   * Owning pluginId. Passed verbatim to
   * `window.electronAPI.credential.set(pluginId, key, value)`.
   *
   * Per TICKET_809_1 section 12.2:
   * - Global credentials (LLM, OAuth) use `HOST_PLUGIN_ID` (`'host'`).
   * - Plugin-private secrets use the plugin's own manifest id.
   *
   * The migration in TICKET_809_2 (Phase 0) already moved existing
   * LLM/OAuth records to `'host'` on disk; this field reflects the
   * post-migration state.
   */
  pluginId: string;

  /** Credential keys this provider needs. Order is the UI render order. */
  fields: CredentialKeyField[];

  /**
   * Optional verifier. When present, `SecretsPanel` renders a "Test"
   * button next to the provider card. When absent, the provider is
   * treated as un-verifiable (configuration is accepted on save).
   */
  verify?: CredentialVerifier;

  /**
   * Optional post-configure side effect. Runs after a successful
   * save (and verify, if a verifier is declared). Errors are logged
   * but do not roll back the save -- the user explicitly chose to
   * persist a credential that passed verification.
   */
  postConfigureHook?: PostConfigureHook;

  /**
   * Optional URL to the provider's "where do I get this key" docs.
   * Rendered as a link in the provider card.
   */
  signupUrl?: string;

  /**
   * Optional read-only flag. When `true`, `SecretsPanel` renders the
   * card without edit/delete affordances -- the credential is managed
   * elsewhere (e.g., OAuth tokens managed by `auth-service`).
   * Defaults to `false`.
   */
  readOnly?: boolean;

  /**
   * TICKET_811: opt-in marker that this credential belongs to a BYOK
   * domain whose default provider is user-selectable. The Settings
   * ProviderCard renders a "Default for <domain>" radio that writes
   * `dataProviderDefaults[domain] = providerId`. Today the only
   * supported domain is `us_equity`. Adding a new BYOK family is a
   * matter of (a) setting this field on the new contribution and
   * (b) extending `SUPPORTED_DEFAULT_DOMAINS` in
   * `data-provider-defaults-service.ts`.
   *
   * Contributions that omit this field do not render the radio --
   * which is the right behavior for LLM keys, OAuth session, and
   * non-BYOK data providers (ClickHouse tunnel).
   */
  byokDefaultDomain?: 'us_equity';
}

/**
 * Module-level function a plugin exports to contribute providers.
 * Collected by the plugin loader on activation. The host also calls
 * this shape internally for host-owned contributions.
 */
export type ContributeProviders = () => ProviderCredentialContribution[];

// =============================================================================
// SecretsPanel mode (Phase 3 contract, exported here for type sharing)
// =============================================================================

/**
 * Rendering mode for `SecretsPanel`.
 *
 * - `'page'`  Full System Settings rendering: audit log + security status
 *             banner + master password controls all visible.
 * - `'modal'` In-context shortcut: only the provider-card list. No audit
 *             log, no master password, no security banner. The
 *             `BYOKSetupDialog` rewrite (Phase 4) renders in this mode.
 *
 * Per TICKET_809_1 section 12.3: this two-mode split is a structural constraint,
 * not a guideline. There is no API on `SecretsPanel` that lets a plugin
 * render `'page'` mode embedded inside its own settings; plugins can
 * only render `'modal'`.
 */
export type SecretsPanelMode = 'page' | 'modal';

// =============================================================================
// Type Guards
// =============================================================================

/** Type guard: a value is a member of `PROVIDER_DOMAINS`. */
export function isProviderDomain(value: unknown): value is ProviderDomain {
  return typeof value === 'string' && (PROVIDER_DOMAINS as readonly string[]).includes(value);
}
