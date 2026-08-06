/**
 * Configuration exports
 *
 * @see TICKET_069 - Centralized View Registry
 */

// Primary export: Centralized View Registry
export * from './view-registry';

// Backward compatibility: Re-export from view-registry
// (plugin-hub-auth.ts will be removed after migration)
export { getPluginHubAuthConfig } from './view-registry';
