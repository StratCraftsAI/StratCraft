/**
 * Host-side auth / OAuth contributions
 *
 * TICKET_809_1 Phase 6 (TICKET_809_6). OAuth tokens are managed by
 * `auth-service` in the main process; the user does not edit them
 * directly. The contribution is rendered as a read-only audit entry
 * in SecretsPanel so System Settings shows "yes, you are logged in"
 * (or "not logged in") consistently with every other credential
 * surface.
 *
 * Per TICKET_809_1 section 8 / 12.2: OAuth tokens were migrated to
 * `pluginId = 'host'` in TICKET_809_2. This module reflects that
 * post-migration state.
 */

import { LogIn } from 'lucide-react';

import { HOST_PLUGIN_ID } from '../../shared/types/credential-contribution';
import type {
  ProviderCredentialContribution,
} from '../../shared/types/credential-contribution';
import { credentialRegistry } from './credential-registry';

const OAUTH_CONTRIBUTION: ProviderCredentialContribution = {
  providerId: 'oauth-session',
  domain: 'auth',
  nameKey: 'secretsPanel.providers.oauthSession.name',
  icon: LogIn,
  pluginId: HOST_PLUGIN_ID,
  fields: [
    {
      key: 'oauth_tokens',
      labelKey: 'secretsPanel.providers.oauthSession.tokens',
      inputType: 'password',
      required: false,
    },
    {
      key: 'oauth_user',
      labelKey: 'secretsPanel.providers.oauthSession.user',
      inputType: 'text',
      required: false,
    },
  ],
  readOnly: true,
};

/** Pure inspection helper -- returns the OAuth contribution(s). */
export function getAuthContributions(): ProviderCredentialContribution[] {
  return [OAUTH_CONTRIBUTION];
}

/**
 * Register OAuth contribution with the shared `credentialRegistry`.
 * Idempotent.
 */
export function registerAuthContributions(): void {
  for (const contribution of getAuthContributions()) {
    if (credentialRegistry.has(contribution.providerId)) continue;
    credentialRegistry.register(contribution);
  }
}
