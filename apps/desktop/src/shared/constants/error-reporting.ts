// TICKET_881: Self-hosted GlitchTip (Sentry-compatible) -- single DSN source of truth
// TICKET_1023_4: Canonical ingest host in @StratCraft/types; re-exported here for app-level barrel.
// TICKET_1304_6R_I10: The DSN is an operational ingest credential, not a user
// setting, so it is injected at build time and has NO hardcoded fallback. When
// it is absent -- source builds, forks, self-hosted deployments -- the value is
// null and error reporting stays disabled rather than pointing at our project.
// Mirrors the __API_BASE_URL__ / __AUTH_BASE_URL__ pattern in ./index.ts, except
// those keep a default (TICKET_435 BYOK) and this deliberately does not.
export { GLITCHTIP_INGEST_HOST } from '@StratCraft/types';

declare const __GLITCHTIP_DSN__: string | undefined;

/**
 * Resolved GlitchTip DSN, or null when no DSN was injected at build time.
 * Callers MUST treat null as "error reporting disabled" -- see
 * resolveErrorReportingDsn().
 */
export const GLITCHTIP_DSN: string | null =
  (typeof __GLITCHTIP_DSN__ !== 'undefined' ? __GLITCHTIP_DSN__ : null) || null;

/**
 * Resolved DSN when error reporting is configured, otherwise null.
 *
 * Callers should branch on this rather than on GLITCHTIP_DSN directly: a
 * local const narrows to `string` inside the truthy branch, which a boolean
 * helper cannot do for a module-level binding.
 */
export function resolveErrorReportingDsn(): string | null {
  return GLITCHTIP_DSN;
}
