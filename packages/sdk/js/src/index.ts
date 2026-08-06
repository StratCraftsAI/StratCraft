/**
 * StratCraft JavaScript SDK
 *
 * Provides unified APIs for UI and plugin development.
 *
 * TICKET_054: Removed auth modules (authorization, authentication, auth)
 * - Client-side user level verification is insecure
 * - All features unlocked in open-source version
 */

// Credential Management (TICKET_032)
export * from './credential';

// UI Service
export * from './ui';

// Type Definitions
export * from './types';
