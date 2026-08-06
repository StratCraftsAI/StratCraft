/**
 * API URL / Domain Constants (Tier 0)
 *
 * TICKET_1023_4: Centralized API domain definitions so all tiers
 * (apps, plugins, MCP standalone) can import without tier violations.
 *
 * These are the raw domain constants. apps/desktop/src/shared/constants/index.ts
 * builds API_CONFIG / AUTH_CONFIG on top of these, adding build-time
 * DefinePlugin overrides for self-hosted deployments.
 *
 * @see TICKET_141 - API Routing Architecture
 * @see TICKET_082 - API Configuration
 */

// =============================================================================
// Domain Constants
// =============================================================================

/** Desktop API / Python tunnel base URL (TICKET_140, TICKET_141) */
export const DESKTOP_API_BASE_URL = 'https://desktop-api.silvonastream.com';

/** Auth (WordPress) server base URL (TICKET_492) */
export const AUTH_SERVER_BASE_URL = 'https://ai.silvonastream.com';

/** Public website base URL (stratcraft.ai) */
export const STRATCRAFT_WEBSITE_URL = 'https://stratcraft.ai';

// =============================================================================
// Derived URL Helpers
// =============================================================================

/** User upgrade page */
export const AUTH_UPGRADE_URL = `${AUTH_SERVER_BASE_URL}/user-upgrade/`;

/** Pricing page (auth server) */
export const AUTH_PRICING_URL = `${AUTH_SERVER_BASE_URL}/pricing`;

/** Pricing page (public website) */
export const WEBSITE_PRICING_URL = `${STRATCRAFT_WEBSITE_URL}/pricing`;

/**
 * GlitchTip error-reporting ingest host (TICKET_881).
 *
 * TICKET_1304_6R_I10: The host is a public endpoint and may ship in source.
 * The *DSN* is an operational ingest credential and MUST NOT. Unlike
 * DESKTOP_API_BASE_URL / AUTH_SERVER_BASE_URL above -- which are
 * user-overridable defaults deliberately retained under the open-core BYOK
 * model (TICKET_435) -- a DSN is not a user setting, so there is no hardcoded
 * fallback to retain. Builds inject it via StratCraft_GLITCHTIP_DSN; see
 * apps/desktop/src/shared/constants/error-reporting.ts.
 */
export const GLITCHTIP_INGEST_HOST = 'https://glitchtip.stratcraft.ai';
