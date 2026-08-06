/**
 * SecretsPanel types
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5).
 */

import type {
  ProviderDomain,
  SecretsPanelMode,
} from '../../../../shared/types/credential-contribution';

/**
 * Filter that restricts which registry contributions render in this
 * SecretsPanel instance. Both arrays are AND-combined when both are set
 * (a contribution must satisfy every filter that is supplied).
 *
 * When the filter is omitted, every contribution from the registry is
 * shown. System Settings page mode uses the empty filter; in-context
 * shortcuts (e.g. BYOKSetupDialog) supply `providerIds: [requested]`.
 */
export interface SecretsPanelFilter {
  /** Restrict to these domains. */
  domains?: ProviderDomain[];
  /** Restrict to these provider IDs. */
  providerIds?: ProviderCredentialContributionId[];
}

/** Stable string alias for a provider id. Documentation aid; not enforced. */
export type ProviderCredentialContributionId = string;

/**
 * Props for the shared `SecretsPanel` component.
 *
 * Per TICKET_809_1 section 12.3:
 * - `mode: 'page'`  rendered only by System Settings -> Config -> Credentials.
 *                   Shows audit log + security status banner.
 * - `mode: 'modal'` rendered by in-context shortcuts (BYOKSetupDialog).
 *                   Suppresses audit log / security banner; consumer is
 *                   responsible for the modal chrome (overlay, portal).
 */
export interface SecretsPanelProps {
  /** Rendering mode. Required (no default). */
  mode: SecretsPanelMode;

  /** Optional filter narrowing which providers render. */
  filter?: SecretsPanelFilter;

  /**
   * Optional i18n key for the panel heading. Page mode falls back to
   * `settings.secretsPanel.title`; modal mode omits the heading when this
   * is undefined.
   */
  headingKey?: string;

  /**
   * Show audit log section beneath the provider list. Defaults to true
   * in `mode: 'page'`, false in `mode: 'modal'`.
   */
  showAuditLog?: boolean;

  /**
   * Show master password / OS keychain security status banner above the
   * provider list. Defaults to true in `mode: 'page'`, false in
   * `mode: 'modal'`.
   */
  showSecurityStatus?: boolean;

  /**
   * Callback fired after a credential is successfully saved (and
   * verified, if a verifier is declared). Used by modal-mode shortcuts
   * to auto-dismiss after the user completes setup of the requested
   * provider.
   */
  onProviderConfigured?: (providerId: ProviderCredentialContributionId) => void;
}
