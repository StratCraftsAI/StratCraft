/**
 * IPC Channel Name Constants
 */

// Window Control
export const WINDOW_CHANNELS = {
  MINIMIZE: 'window:minimize',
  MAXIMIZE: 'window:maximize',
  CLOSE: 'window:close',
  IS_MAXIMIZED: 'window:isMaximized',
} as const;

// Application Info
export const APP_CHANNELS = {
  VERSION: 'app:version',
  PATH: 'app:path',
  // TICKET_958_5 follow-up: surfaces the STRATCRAFT_RESEARCH_MODE env var
  // to the renderer so the picker hook can decide whether to inject
  // research-only providers (databento, ...) into the catalog. The
  // runtime is the single source of truth (provider-manager.ts:360); the
  // renderer mirrors it instead of reading process.env directly (Tier-0
  // catalog stays env-free per architecture).
  RESEARCH_MODE: 'app:research-mode',
} as const;

// Commercial research-worker public capability boundary (TICKET_1304_5C).
// Execution remains a Main-process supervisor API consumed by the installable
// Public Main-process worker supervision channel. It is not exposed directly
// by preload; signed packages reach worker execution through their registered
// commercial operation and the generic extension bridge.
export const RESEARCH_WORKER_CHANNELS = {
  DISCOVER: 'research-worker:discover',
} as const;

// TICKET_1304_15: transport-neutral commercial operation adapter. These
// channels expose only the frozen shared request/result and capability
// contracts; business decisions remain in the signed package operation owner.
export const EXTENSION_BRIDGE_CHANNELS = {
  CAPABILITY: 'extension-bridge:capability',
  INVOKE: 'extension-bridge:invoke',
  EVENT: 'extension-bridge:event',
} as const;

// Strategy
export const STRATEGY_CHANNELS = {
  LIST: 'strategy:list',
  GET: 'strategy:get',
  SAVE: 'strategy:save',
  DELETE: 'strategy:delete',
} as const;

// File Operations
export const FILE_CHANNELS = {
  OPEN_DIALOG: 'file:openDialog',
  SAVE_DIALOG: 'file:saveDialog',
  READ: 'file:read',
  WRITE: 'file:write',
} as const;

// Database
export const DB_CHANNELS = {
  QUERY: 'db:query',
  EXECUTE: 'db:execute',
} as const;

// Market Data
export const MARKET_CHANNELS = {
  GET_DATA: 'market:getData',
} as const;

// Credential Management (TICKET_032 Phase 3)
export const CREDENTIAL_CHANNELS = {
  GET: 'credential:get',
  SET: 'credential:set',
  DELETE: 'credential:delete',
  HAS: 'credential:has',
  LIST: 'credential:list',
  VALIDATE_USER: 'credential:validateUser',
  SET_MASTER_PASSWORD: 'credential:setMasterPassword',
  EXECUTE_WITH: 'credential:executeWith',
  GET_AUDIT_LOG: 'credential:getAuditLog',
  LIFECYCLE_STATUS: 'credential:lifecycleStatus',
  RESET_UNREADABLE: 'credential:resetUnreadable',
  REPLACE_UNREADABLE: 'credential:replaceUnreadable',
  MIGRATE_LEGACY: 'credential:migrateLegacy',
  ROTATE_MASTER_KEY: 'credential:rotateMasterKey',
  EXPORT_RECOVERY_BUNDLE: 'credential:exportRecoveryBundle',
  EXPORT_BACKUP_RECOVERY_BUNDLE: 'credential:exportBackupRecoveryBundle',
  IMPORT_RECOVERY_BUNDLE: 'credential:importRecoveryBundle',
  // TICKET_192: API Key Validation
  VALIDATE_API_KEY: 'credential:validateApiKey',
} as const;

// TICKET_054: Authorization, Authentication, and Module Auth channels REMOVED
// - Client-side user level verification is insecure
// - All features unlocked in open-source version

// UI Service (Simplified)
export const UI_CHANNELS = {
  SHOW_PLUGIN_SETTINGS: 'ui:showPluginSettings',
} as const;

// Strategy Generation - LLM (TICKET_045)
export const STRATEGY_GENERATION_CHANNELS = {
  GENERATE: 'strategy:generate',
  CANCEL: 'strategy:cancel',
  PROGRESS: 'strategy:progress',
  COMPLETE: 'strategy:complete',
  ERROR: 'strategy:error',
} as const;

// Data Source Integration (TICKET_045)
export const DATA_CHANNELS = {
  ENSURE: 'data:ensure',
  CHECK_COVERAGE: 'data:checkCoverage',
  SEARCH_SYMBOLS: 'data:searchSymbols',
  CHECK_CONNECTION: 'data:checkConnection',
  PROGRESS: 'data:progress',
  CANCEL_DOWNLOAD: 'data:cancelDownload',
} as const;

// Authentication (TICKET_066_1, TICKET_165)
export const AUTH_CHANNELS = {
  // OAuth flow
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
  CALLBACK: 'auth:callback',
  REFRESH: 'auth:refresh',
  // State
  GET_STATE: 'auth:getState',
  GET_USER: 'auth:getUser',
  // Token access (TICKET_165: Silent Token Refresh)
  GET_ACCESS_TOKEN: 'auth:getAccessToken',
  // Events (main -> renderer)
  STATE_CHANGED: 'auth:stateChanged',
  ERROR: 'auth:error',
} as const;

// Plugin Marketplace (TICKET_051)
export const MARKETPLACE_CHANNELS = {
  // Registry
  GET_REGISTRY: 'marketplace:getRegistry',
  GET_PLUGIN_DETAILS: 'marketplace:getPluginDetails',
  GET_STATS: 'marketplace:getStats',
  // Installation
  INSTALL: 'marketplace:install',
  UNINSTALL: 'marketplace:uninstall',
  // Updates
  CHECK_UPDATES: 'marketplace:checkUpdates',
  UPDATE_PLUGIN: 'marketplace:updatePlugin',
  // Events (main -> renderer)
  INSTALL_PROGRESS: 'marketplace:installProgress',
  INSTALL_COMPLETE: 'marketplace:installComplete',
  INSTALL_ERROR: 'marketplace:installError',
  // TICKET_447_1: License Management
  VALIDATE_LICENSE: 'marketplace:validateLicense',
  ACTIVATE_LICENSE: 'marketplace:activateLicense',
  GET_LICENSE_STATUS: 'marketplace:getLicenseStatus',
  REMOVE_LICENSE: 'marketplace:removeLicense',
  OPEN_PURCHASE_URL: 'marketplace:openPurchaseUrl',
  LICENSE_STATUS_CHANGED: 'marketplace:licenseStatusChanged',
  // TICKET_551: Entitlement Management (First-Party Paid Plugins)
  CHECK_ENTITLEMENT: 'marketplace:checkEntitlement',
  CHECK_ENTITLEMENTS_BATCH: 'marketplace:checkEntitlementsBatch',
  ENTITLEMENT_CHANGED: 'marketplace:entitlementChanged',
  // TICKET_805_2: Promo telemetry state (persistent once-only gates)
  PROMO_TELEMETRY_MARK_FIRST_RUN: 'marketplace:promoTelemetry:markFirstRunIfFirst',
  PROMO_TELEMETRY_SET_INSTALL_WITH_PROMO: 'marketplace:promoTelemetry:setInstallWithPromoAt',
  PROMO_TELEMETRY_GET_INSTALL_WITH_PROMO: 'marketplace:promoTelemetry:getInstallWithPromoAt',
  PROMO_TELEMETRY_CLEAR_INSTALL_WITH_PROMO: 'marketplace:promoTelemetry:clearInstallWithPromoAt',
  // TICKET_805_2: Plugin activation broadcast (main -> renderer)
  PLUGIN_ACTIVATED: 'marketplace:pluginActivated',
} as const;

// Inline Auth (TICKET_564: In-App Registration)
export const INLINE_AUTH_CHANNELS = {
  SEND_CODE: 'inlineAuth:sendCode',
  VERIFY_CODE: 'inlineAuth:verifyCode',
  LOGIN_PASSWORD: 'inlineAuth:loginPassword',
} as const;

// Diagnostics (TICKET_573: Production Log & Diagnostics)
export const DIAGNOSTIC_CHANNELS = {
  OPEN_LOG_FOLDER: 'diagnostics:openLogFolder',
} as const;

// Consent (TICKET_573 Phase 4A: Sentry Crash Reporting)
export const CONSENT_CHANNELS = {
  GET_STATUS: 'consent:getStatus',
  SET_CONSENT: 'consent:setConsent',
} as const;

// Onboarding (TICKET_593: In-App Onboarding System)
export const ONBOARDING_CHANNELS = {
  GET_STATE: 'onboarding:getState',
  SET_ENABLED: 'onboarding:setEnabled',
  SET_ASSISTANT_MODE: 'onboarding:setAssistantMode',
  MARK_COMPLETED: 'onboarding:markCompleted',
  RESET: 'onboarding:reset',
} as const;

// Security Events (TICKET_580_4: safeStorage Fallback Security)
export const SECURITY_CHANNELS = {
  KEYCHAIN_UNAVAILABLE: 'security:keychain-unavailable',
  T0_REJECTED: 'security:t0-rejected',
  T1_WARNING: 'security:t1-warning',
} as const;

// Recycle Bin (TICKET_580_6: Soft-Delete)
export const RECYCLE_BIN_CHANNELS = {
  LIST_DELETED: 'v3:recycle-bin:list-deleted',
  RESTORE: 'v3:recycle-bin:restore',
  PURGE: 'v3:recycle-bin:purge',
} as const;

// Kronos Price Prediction (TICKET_226)
export const KRONOS_PRICE_CHANNELS = {
  HEALTH: 'kronos-price:health',
  PREDICT: 'kronos-price:predict',
} as const;

/**
 * Service API runtime role (TICKET_1334 P4 / D4 / AC5_1).
 *
 * `GET_ROLE` is the pull, `ROLE_CHANGED` the push -- the TICKET_206 pair: sync
 * await for the direct query, event subscription for the async state change. Both
 * carry the identical `ServiceApiRuntimeRoleState` payload so the renderer store
 * can apply either through one reducer.
 *
 * Registered UNCONDITIONALLY (a core handler, not Pro-gated): the runtime role
 * exists in every distribution, and a surface that could not ask who serves it
 * would be back to the silent cognitive gap D4 exists to close.
 */
export const SERVICE_API_CHANNELS = {
  GET_ROLE: 'service-api:get-role',
  // Event (main -> renderer)
  ROLE_CHANGED: 'service-api:role-changed',
} as const;

/**
 * TICKET_1335: research environment lifecycle.
 *
 * INSTALL and REPAIR take no arguments by design. Main owns the confirmation
 * dialog and constructs the approval from what it observed, so renderer input
 * never carries a confirmation boolean, approval token, or approval object
 * (D6). All five are invoke/await; the two mutations return a job ID
 * immediately rather than holding the channel open for a long download.
 */
export const RESEARCH_ENVIRONMENT_CHANNELS = {
  GET_STATUS: 'research-environment:get-status',
  GET_JOB: 'research-environment:get-job',
  VERIFY: 'research-environment:verify',
  INSTALL: 'research-environment:install',
  REPAIR: 'research-environment:repair',
  UNINSTALL: 'research-environment:uninstall',
  REMOVE_GPQUANT: 'research-environment:remove-gpquant',
} as const;

/**
 * TICKET_1364 D3: HistData forex acquisition IPC channels.
 *
 * Three operations: review (produces a normalized plan), confirm (seals the
 * plan with a fingerprint), and execute (runs the confirmed plan). All are
 * sync-await invoke channels. Execute returns immediately with a job-like
 * acknowledgement; the renderer follows progress via events.
 */
export const HISTDATA_ACQUISITION_CHANNELS = {
  REVIEW: 'histdata-acquisition:review',
  CONFIRM: 'histdata-acquisition:confirm',
  EXECUTE: 'histdata-acquisition:execute',
} as const;
