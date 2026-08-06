/**
 * CredentialRegistry
 *
 * TICKET_809_1 Phase 2 (TICKET_809_4): Renderer-side registry that
 * aggregates ProviderCredentialContribution declarations from the host
 * itself and from activated plugins. SecretsPanel (Phase 3) queries this
 * registry; System Settings re-renders on the change event.
 *
 * Storage / IPC contract is unchanged. This module is a pure in-memory
 * registry; it does not touch credential-manager or the AES-256-GCM
 * store. All persistence still flows through window.electronAPI.credential.*.
 *
 * Per TICKET_809_1 section 12.2: tier-lowering is rejected at registration
 * (raising the default tier is allowed; lowering it is a security regression
 * and would let a contribution bypass the credential-tiers.ts policy).
 */

import { inferCredentialTier } from '../../shared/constants/credential-tiers';
import { safeForEach } from '../../shared/utils/safe-emit';
import {
  isProviderDomain,
  type ProviderCredentialContribution,
  type ProviderDomain,
} from '../../shared/types/credential-contribution';

// =============================================================================
// Events
// =============================================================================

/**
 * Change-event payload delivered to subscribers on register/unregister/clear.
 */
export interface CredentialRegistryChangeDetail {
  /** Kind of change that triggered the event. */
  change: 'register' | 'unregister' | 'clear';
  /** Provider id affected (absent for `'clear'`). */
  providerId?: string;
  /** Total count of contributions after the change. */
  total: number;
}

/** Subscriber callback signature. */
export type CredentialRegistryListener = (detail: CredentialRegistryChangeDetail) => void;

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when a contribution violates a registry invariant. Validation
 * runs at register time; SecretsPanel never sees malformed contributions.
 */
export class CredentialContributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialContributionError';
  }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a contribution at registration time. Throws
 * CredentialContributionError on the first violation found.
 *
 * Rules:
 * 1. providerId is non-empty.
 * 2. pluginId is non-empty.
 * 3. domain is a member of PROVIDER_DOMAINS.
 * 4. fields is non-empty.
 * 5. Field keys within a single contribution are unique.
 * 6. Tier overrides must not LOWER the default tier (raising is allowed).
 *    Lower tier numbers indicate higher sensitivity (T0_CRITICAL = 0).
 *    So an override is valid iff `override <= inferred`.
 */
function validateContribution(c: ProviderCredentialContribution): void {
  if (!c.providerId || typeof c.providerId !== 'string') {
    throw new CredentialContributionError('providerId must be a non-empty string');
  }
  if (!c.pluginId || typeof c.pluginId !== 'string') {
    throw new CredentialContributionError(
      `[${c.providerId}] pluginId must be a non-empty string`,
    );
  }
  if (!isProviderDomain(c.domain)) {
    throw new CredentialContributionError(
      `[${c.providerId}] domain must be one of PROVIDER_DOMAINS; got ${String(c.domain)}`,
    );
  }
  if (!Array.isArray(c.fields) || c.fields.length === 0) {
    throw new CredentialContributionError(
      `[${c.providerId}] fields must be a non-empty array`,
    );
  }

  const seenKeys = new Set<string>();
  for (const field of c.fields) {
    if (!field.key || typeof field.key !== 'string') {
      throw new CredentialContributionError(
        `[${c.providerId}] field.key must be a non-empty string`,
      );
    }
    if (seenKeys.has(field.key)) {
      throw new CredentialContributionError(
        `[${c.providerId}] duplicate field key: ${field.key}`,
      );
    }
    seenKeys.add(field.key);

    if (field.tier !== undefined) {
      const inferred = inferCredentialTier(c.pluginId, field.key);
      // Lower number = higher sensitivity. Override must not LOWER sensitivity
      // (i.e., must not produce a HIGHER tier number than the default).
      if (field.tier > inferred) {
        throw new CredentialContributionError(
          `[${c.providerId}] field ${field.key} tier override ${field.tier}`
            + ` lowers sensitivity below inferred default ${inferred}; this is rejected.`
            + ` Tier overrides may only raise sensitivity (smaller tier number).`,
        );
      }
    }
  }
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Renderer-side credential contribution registry.
 *
 * Single instance is exported as `credentialRegistry`. Class is exported
 * separately for tests that need an isolated instance.
 */
export class CredentialRegistry {
  private readonly contributions = new Map<string, ProviderCredentialContribution>();
  private readonly listeners = new Set<CredentialRegistryListener>();

  /**
   * Subscribe to registry change events. Returns an unsubscribe function.
   * Listener errors are caught and logged (one bad subscriber must not
   * break the others or block the registry mutation).
   */
  subscribe(listener: CredentialRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Register a contribution. Throws CredentialContributionError if the
   * contribution is invalid or if providerId is already registered.
   * Conflicts are surfaced (not silently overwritten) because two
   * contributions claiming the same providerId is a bug: which icon,
   * which verify, which postConfigureHook would win?
   *
   * Plugin re-activation should call unregister() first.
   */
  register(contribution: ProviderCredentialContribution): void {
    validateContribution(contribution);

    if (this.contributions.has(contribution.providerId)) {
      throw new CredentialContributionError(
        `Provider already registered: ${contribution.providerId}.`
          + ' Call unregister() first to replace.',
      );
    }

    this.contributions.set(contribution.providerId, contribution);
    this.emitChange({
      change: 'register',
      providerId: contribution.providerId,
      total: this.contributions.size,
    });
  }

  /**
   * Unregister by providerId. No-op (returns false) if absent.
   * Returns true if a contribution was removed.
   */
  unregister(providerId: string): boolean {
    const removed = this.contributions.delete(providerId);
    if (removed) {
      this.emitChange({
        change: 'unregister',
        providerId,
        total: this.contributions.size,
      });
    }
    return removed;
  }

  /**
   * Remove all contributions. Used by tests and by host teardown paths.
   * Emits a single change event with `change: 'clear'`.
   */
  clear(): void {
    if (this.contributions.size === 0) return;
    this.contributions.clear();
    this.emitChange({ change: 'clear', total: 0 });
  }

  /**
   * Get all contributions in registration order.
   * Returns a shallow copy; mutating it does not affect the registry.
   */
  getAll(): ProviderCredentialContribution[] {
    return Array.from(this.contributions.values());
  }

  /** Filter by domain. */
  getByDomain(domain: ProviderDomain): ProviderCredentialContribution[] {
    return this.getAll().filter(c => c.domain === domain);
  }

  /** Lookup by providerId. */
  getById(providerId: string): ProviderCredentialContribution | undefined {
    return this.contributions.get(providerId);
  }

  /** Whether a provider is currently registered. */
  has(providerId: string): boolean {
    return this.contributions.has(providerId);
  }

  /** Current count of registered contributions. */
  size(): number {
    return this.contributions.size;
  }

  /**
   * Notify all subscribers. Caught listener errors are logged via console
   * so a misbehaving subscriber cannot break the others or roll back the
   * registry mutation that triggered the event.
   */
  private emitChange(detail: CredentialRegistryChangeDetail): void {
    safeForEach(this.listeners, '[E:CREDENTIAL:SUBSCRIBER_THREW] [CredentialRegistry] subscriber threw:', detail);
  }
}

// =============================================================================
// Singleton
// =============================================================================

/**
 * Shared registry instance. Host startup (Phase 4) and plugin loader
 * (Phase 5) both feed contributions here; SecretsPanel reads from here.
 */
export const credentialRegistry = new CredentialRegistry();
