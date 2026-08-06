import type { CredentialHealth } from '@StratCraft/types'

type CredentialFailureState = Exclude<
  CredentialHealth,
  { state: 'usable' | 'missing' }
>['state']

export const CREDENTIAL_HEALTH_I18N_KEYS = {
  keyring_locked: 'llm.credentialHealth.keyring_locked',
  keyring_unavailable: 'llm.credentialHealth.keyring_unavailable',
  keyring_permission_denied: 'llm.credentialHealth.keyring_permission_denied',
  master_key_missing: 'llm.credentialHealth.master_key_missing',
  master_key_malformed: 'llm.credentialHealth.master_key_malformed',
  key_identity_mismatch: 'llm.credentialHealth.key_identity_mismatch',
  credential_auth_failed: 'llm.credentialHealth.credential_auth_failed',
  credential_corrupt: 'llm.credentialHealth.credential_corrupt',
  migration_required: 'llm.credentialHealth.migration_required',
  recovery_required: 'llm.credentialHealth.recovery_required',
  writer_upgrade_required: 'llm.credentialHealth.writer_upgrade_required',
} as const satisfies Record<CredentialFailureState, string>

export function credentialHealthI18nKey(state: string | undefined): string {
  if (!state) return 'llm.credentialHealth.generic'
  return CREDENTIAL_HEALTH_I18N_KEYS[state as CredentialFailureState]
    ?? 'llm.credentialHealth.generic'
}
