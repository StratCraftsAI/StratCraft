/**
 * SecretsPanel helpers (pure, testable)
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5).
 */

import i18n from 'i18next';
import type { ProviderCredentialContribution } from '../../../../shared/types/credential-contribution';
import type { SecretsPanelFilter, SecretsPanelProps } from './types';

/**
 * Apply a SecretsPanel filter to a list of contributions.
 * Empty / undefined filter -> return all.
 * Both filter axes are AND-combined.
 */
export function applyFilter(
  all: ProviderCredentialContribution[],
  filter: SecretsPanelFilter | undefined,
): ProviderCredentialContribution[] {
  if (!filter) return [...all];

  const { domains, providerIds } = filter;
  const domainSet = domains && domains.length > 0 ? new Set(domains) : null;
  const idSet = providerIds && providerIds.length > 0 ? new Set(providerIds) : null;

  return all.filter(c => {
    if (domainSet && !domainSet.has(c.domain)) return false;
    if (idSet && !idSet.has(c.providerId)) return false;
    return true;
  });
}

/**
 * Resolve the effective `showAuditLog` flag given the mode and any
 * caller override. Modal mode defaults to false; page mode defaults to
 * true. Explicit overrides win.
 */
export function resolveShowAuditLog(props: Pick<SecretsPanelProps, 'mode' | 'showAuditLog'>): boolean {
  if (props.showAuditLog !== undefined) return props.showAuditLog;
  return props.mode === 'page';
}

/**
 * Resolve the effective `showSecurityStatus` flag. Modal mode defaults
 * to false; page mode defaults to true. Explicit overrides win.
 */
export function resolveShowSecurityStatus(
  props: Pick<SecretsPanelProps, 'mode' | 'showSecurityStatus'>,
): boolean {
  if (props.showSecurityStatus !== undefined) return props.showSecurityStatus;
  return props.mode === 'page';
}

/**
 * A provider is "fully configured" when every required field is non-empty.
 * `values` is the in-memory edit buffer keyed by `field.key`.
 */
export function isProviderFullyConfigured(
  contribution: ProviderCredentialContribution,
  values: Record<string, string | undefined>,
): boolean {
  for (const field of contribution.fields) {
    if (!field.required) continue;
    const v = values[field.key];
    if (!v || v.trim() === '') return false;
  }
  return true;
}

/**
 * Validate every supplied field value against any declared pattern.
 * Returns a map of `{ [field.key]: errorMessage }` for invalid fields.
 * Empty map -> all fields valid (or empty; pattern only checks
 * non-empty values to avoid double-reporting "required" errors).
 */
export function validateFieldPatterns(
  contribution: ProviderCredentialContribution,
  values: Record<string, string | undefined>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of contribution.fields) {
    if (!field.pattern) continue;
    const v = values[field.key];
    if (!v) continue;
    try {
      const re = new RegExp(field.pattern);
      if (!re.test(v)) {
        const fallback = `Value does not match expected pattern (${field.pattern})`;
        errors[field.key] = i18n.isInitialized
          ? i18n.t('settings:secretsPanel.patternMismatch', { pattern: field.pattern, defaultValue: fallback })
          : fallback;
      }
    } catch {
      // Malformed pattern is a developer error, not a user error; skip silently.
    }
  }
  return errors;
}

/**
 * Compute which field values changed relative to the persisted snapshot.
 * Used to avoid round-tripping unchanged secrets through the credential IPC
 * (re-encrypting an unchanged value is harmless but wasteful and pollutes
 * the audit log).
 *
 * Returns the subset of `next` that differs from `persisted`. Keys absent
 * from `next` or whose value equals the persisted value are dropped.
 */
export function diffChangedFields(
  persisted: Record<string, string | undefined>,
  next: Record<string, string | undefined>,
): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const key of Object.keys(next)) {
    const nextVal = next[key];
    if (nextVal === undefined) continue;
    if (persisted[key] === nextVal) continue;
    changed[key] = nextVal;
  }
  return changed;
}

/**
 * Compute which field values were CLEARED relative to the persisted
 * snapshot (persisted had a value, next is empty or absent). Used to
 * trigger credential.delete IPC calls for the keys the user wiped.
 */
export function diffClearedFields(
  contribution: ProviderCredentialContribution,
  persisted: Record<string, string | undefined>,
  next: Record<string, string | undefined>,
): string[] {
  const cleared: string[] = [];
  for (const field of contribution.fields) {
    const before = persisted[field.key];
    const after = next[field.key];
    if (before && (!after || after.trim() === '')) {
      cleared.push(field.key);
    }
  }
  return cleared;
}
