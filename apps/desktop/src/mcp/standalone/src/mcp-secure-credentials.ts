/**
 * MCP-side credential store + LLM provider resolution (TICKET_1276 P1).
 *
 * De-bridges the LLM surface: the standalone server now reads/writes the SAME
 * credential rows (@StratCraft/secure-store over the shared StratCraft.db) and
 * the SAME plugin-config selection/validation file that Electron uses, and
 * builds the `list_llm_providers` / `check_llm_credential` payloads from the
 * SAME @StratCraft/llm-providers resolver. Electron liveness is no longer
 * observable in the payload -- the process just reads the store.
 *
 * The SQLite handle is INJECTED (initSecureCredentials) exactly like the
 * conversation store: better-sqlite3 is ABI-specific per process, so the server
 * opens the DB with its own build and passes the handle in.
 */
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { readJsonConfigFile, updateJsonConfigFile } from '@StratCraft/config-file';
import { resolveDbPath, resolveDevDataDir } from './db';
import {
  SecureStore,
  createKeyringAdapter,
  type KeyringAdapter,
  type SecureStoreLogger,
  type MasterKeyProvider,
  type UnreadableCredential,
  type ResetUnreadableResult,
  type LifecycleMutationResponse,
  type SecureStoreLifecycleStatus,
} from '@StratCraft/secure-store';
import {
  createByokModelFetcher,
  buildLlmProvidersPayload,
  buildLlmCredentialPayload,
  buildGuideToolbarGroups,
  discoverByokModels,
  type ProviderResolutionDeps,
  type LlmProvidersPayload,
  type LlmCredentialPayload,
} from '@StratCraft/llm-providers';
import {
  LLM_CONFIG_KEYS,
  LLM_CREDENTIAL_KEYS,
  LLM_PROVIDER_RECORDS,
  LLM_PROVIDER_OPENAI_COMPATIBLE,
  LLM_PROVIDER_LINO,
  LLM_PROVIDER_PRO_CATALOG,
  SECURE_STORE_ERROR_CODES,
  getProviderRecord,
  validateLlmCredentialValue,
  type GuideLlmSettingsConfig,
  type CredentialHealth,
  type SecureStoreErrorCode,
  type ProCatalogModel,
} from '@StratCraft/types';
import {
  AGENT_PERMISSION_AUTHORITY_NAMESPACE,
  type GuideToolbarConfig,
} from '@StratCraft/types';
// TICKET_1327 F1: one owner for data-provider configured-ness, shared with
// Electron and the plugin UI.
import {
  resolveConfiguredDataProviders,
  type ProviderConfiguredEntry,
} from '@StratCraft/types';
import { SHARED_DEFAULT_LOCALE, SUPPORTED_LOCALE_RECORDS, normalizeSupportedLocale } from '@StratCraft/types';

// TICKET_809_2: global credentials (LLM keys, OAuth) live under the synthetic
// 'host' pluginId -- the same owner Electron writes.
const HOST_PLUGIN_ID = 'host';
const STRATEGY_PLUGIN_ID = 'com.stratcraft.strategy-builder-nexus';

/**
 * SecureStore reports a missing record as this `errorCode` rather than as a
 * distinct success shape. It denotes ABSENCE, not a storage fault, and callers
 * must not treat it as a read failure (TICKET_1314).
 */
const SECURE_STORE_RECORD_ABSENT = 404;

/**
 * Auth signal shared with Electron. Electron's authService reports
 * `isAuthenticated = !!cachedUser && !!cachedTokens`, and it persists exactly
 * these two rows (deleting both on logout), so the persisted-row conjunction
 * is the parity predicate for a process without the live auth runtime.
 */
const OAUTH_TOKENS_KEY = 'oauth_tokens';
const OAUTH_USER_KEY = 'oauth_user';
const BROWSER_SESSION_PREFIX = 'browser_oauth_session:';

// TICKET_1305: the SAME electron-store keys EntitlementSyncService writes to the
// shared config.json (apps/desktop/src/main/services/entitlement-sync-service.ts).
// Kept in lockstep with that writer -- this reader must not drift from them.
const ENTITLED_PLUGINS_CACHE_KEY = 'entitlement_entitled_plugins_cache';
const ENTITLED_PLUGINS_CACHE_TS_KEY = 'entitlement_entitled_plugins_cache_ts';
const ENTITLED_PLUGINS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (TICKET_892_4)

export interface BrowserOAuthSessionRecord {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  absoluteExpiresAt: number;
  user: {
    id: string;
    email: string;
    name: string;
    avatar?: string;
    plan: 'FREE' | 'PRO' | 'GOLD';
  };
}

const mcpLog: SecureStoreLogger = {
  info: (m: string) => console.error(m),
  warn: (m: string) => console.error(m),
  error: (m: string) => console.error(m),
  debug: () => { /* MCP stderr is user-facing; skip debug noise */ },
};

function resolveUserDataDir(): string {
  // Override for tests / non-default installs (avoids touching the real config).
  if (process.env.STRATCRAFT_MCP_USERDATA_DIR) {
    return process.env.STRATCRAFT_MCP_USERDATA_DIR;
  }
  const platform = os.platform();
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', '@StratCraft', 'desktop');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '@StratCraft', 'desktop');
  }
  return path.join(os.homedir(), '.config', '@StratCraft', 'desktop');
}

// Resolved lazily per access so a test can point STRATCRAFT_MCP_USERDATA_DIR at
// a temp dir before the first read/write.
function pluginConfigPathOf(): string {
  return path.join(resolveUserDataDir(), 'plugins', STRATEGY_PLUGIN_ID, 'config.json');
}
function byokCacheDirOf(): string {
  return path.join(resolveUserDataDir(), 'byok-model-cache');
}

function applicationConfigPathOf(): string {
  return path.join(resolveUserDataDir(), 'config.json');
}

/**
 * TICKET_1305: read the server-authoritative entitled-plugins cache Electron
 * writes to the shared `config.json` (EntitlementSyncService, keys
 * `entitlement_entitled_plugins_cache` + `_ts`). Returns a
 * pluginId -> tier map for use as `UserTierContext.pluginTierOverrides`,
 * respecting the same 7-day offline-grace TTL (TICKET_892_4). Same file, same
 * directory, no Electron bridge -- identical to the BYOK/locale read pattern.
 *
 * Falls back to an empty map (== free-tier baseline) when the file is missing,
 * the cache is absent, malformed, or expired (AC8).
 */
export function readEntitledPluginsCache(): Record<string, string> {
  const config = readJsonConfigFile(applicationConfigPathOf());
  const ts = config[ENTITLED_PLUGINS_CACHE_TS_KEY];
  if (typeof ts === 'number' && Date.now() - ts > ENTITLED_PLUGINS_CACHE_TTL_MS) {
    return {};
  }
  const plugins = config[ENTITLED_PLUGINS_CACHE_KEY];
  if (!Array.isArray(plugins)) return {};
  const overrides: Record<string, string> = {};
  for (const entry of plugins) {
    if (
      entry && typeof entry === 'object' && !Array.isArray(entry)
      && typeof (entry as Record<string, unknown>).plugin_id === 'string'
      && typeof (entry as Record<string, unknown>).tier === 'string'
    ) {
      const record = entry as { plugin_id: string; tier: string };
      overrides[record.plugin_id] = record.tier;
    }
  }
  return overrides;
}

export function readLocalePreference(): GuideToolbarConfig['locale'] {
  const config = readJsonConfigFile(applicationConfigPathOf());
  const user = config.user;
  const persisted = user && typeof user === 'object' && !Array.isArray(user)
    ? (user as Record<string, unknown>).locale
    : undefined;
  const current = typeof persisted === 'string' && normalizeSupportedLocale(persisted) === persisted
    ? persisted
    : SHARED_DEFAULT_LOCALE;
  return {
    current,
    supported: SUPPORTED_LOCALE_RECORDS.map(locale => ({ code: locale.code, nativeLabel: locale.nativeLabel })),
  };
}

export async function writeLocalePreference(value: string): Promise<string> {
  const canonical = normalizeSupportedLocale(value);
  if (!canonical || canonical !== value.replace('-', '_')) {
    throw new Error(`Unsupported locale '${value}'`);
  }
  const config = readJsonConfigFile(applicationConfigPathOf());
  const existingUser = config.user && typeof config.user === 'object' && !Array.isArray(config.user)
    ? config.user as Record<string, unknown>
    : {};
  await updateJsonConfigFile(applicationConfigPathOf(), { user: { ...existingUser, locale: canonical } });
  return canonical;
}

// ── Injected singleton store ────────────────────────────────────────────────

let store: SecureStore | null = null;

/**
 * Dev-install detection for the TICKET_587 insecure-T0-fallback policy --
 * parity with Electron's `!app.isPackaged`. Dev means the resolved database
 * actually lives in the source-tree dev data dir (`apps/desktop/data`);
 * `STRATCRAFT_DEV=1` is the explicit override for test harnesses. A custom
 * `StratCraft_DB_PATH` / `--db-path` pointing anywhere else is a production
 * override and MUST NOT weaken the T0 keyring requirement.
 */
function isDevInstall(): boolean {
  if (process.env.STRATCRAFT_DEV) return true;
  try {
    return path.resolve(path.dirname(resolveDbPath())) === path.resolve(resolveDevDataDir());
  } catch {
    return false;
  }
}

/**
 * Build the SecureStore over the injected RW SQLite handle.
 *
 * `masterKey` is an injection seam (parity with the Electron
 * SecureCredentialService) so tests can supply a deterministic provider and
 * never touch the real OS keyring; production omits it and gets the keyring.
 */
export function initSecureCredentials(
  db: Database.Database,
  masterKey?: MasterKeyProvider,
  keyring?: KeyringAdapter,
): void {
  const allowInsecureT0Fallback = isDevInstall();
  store = new SecureStore({
    db: db as unknown as ConstructorParameters<typeof SecureStore>[0]['db'],
    ...(keyring ? { keyring } : masterKey ? { masterKey } : { keyring: createKeyringAdapter() }),
    allowInsecureT0Fallback,
    log: mcpLog,
    processKind: 'mcp',
    buildId: process.env.npm_package_version ?? 'standalone',
  });
}

function getStore(): SecureStore {
  if (!store) {
    throw new Error('SecureStore not initialized -- call initSecureCredentials(db) first');
  }
  return store;
}

/**
 * TICKET_1314 / TICKET_1303_1_10: a keyring READ FAILURE is a hard error and is
 * never read as "no credentials enrolled". ABSENCE is not a read failure: on a
 * fresh install no authority record exists yet, and the store reports that as
 * `errorCode: 404` rather than as a distinct success shape.
 *
 * Collapsing the two is what makes first enrollment unreachable -- every
 * control-session bootstrap throws before any credential can be registered, so
 * the very state the ceremony exists to leave becomes terminal. Absence maps to
 * `null` (the caller's empty-store path); every other failure still throws.
 */
export async function readAgentPermissionAuthorityRecord(
  key: string,
): Promise<string | null> {
  const result = await getStore().getSecret(AGENT_PERMISSION_AUTHORITY_NAMESPACE, key);
  if (!result.success) {
    if (result.errorCode === SECURE_STORE_RECORD_ABSENT) return null;
    throw new Error(result.errorMessage ?? 'Agent permission authority secure-store read failed');
  }
  return result.value ?? null;
}

export async function writeAgentPermissionAuthorityRecord(
  key: string,
  value: string,
): Promise<void> {
  const result = await getStore().setSecret(
    AGENT_PERMISSION_AUTHORITY_NAMESPACE,
    key,
    value,
  );
  if (!result.success) {
    throw new Error(result.errorMessage ?? 'Agent permission authority secure-store write failed');
  }
}

export async function compareAndSwapAgentPermissionAuthorityRecord(
  key: string,
  expectedValue: string | null,
  value: string,
): Promise<boolean> {
  const result = await getStore().compareAndSwapSecret(
    AGENT_PERMISSION_AUTHORITY_NAMESPACE,
    key,
    expectedValue,
    value,
  );
  if (result.success) return true;
  if (result.errorCode === SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT) return false;
  throw new Error(result.errorMessage ?? 'Agent permission authority secure-store CAS failed');
}

export async function deleteAgentPermissionAuthorityRecord(key: string): Promise<void> {
  const result = await getStore().deleteSecret(AGENT_PERMISSION_AUTHORITY_NAMESPACE, key);
  if (!result.success) {
    throw new Error(result.errorMessage ?? 'Agent permission authority secure-store delete failed');
  }
}

/** Byte-identical typed health operation shared with Electron. */
export function readCredentialHealth(
  pluginId: string,
  key: string,
): Promise<CredentialHealth> {
  return getStore().credentialHealth(pluginId, key);
}

/**
 * TICKET_1327 F1/F3/F4 -- Class-S data-provider configured-ness.
 *
 * The WebUI's half of the convergence. It answers "are this provider's
 * credentials stored?" from the SAME shared owner and the SAME credential rows
 * the Electron surface reads -- not from a live reachability probe, which was
 * the divergence (TICKET_1327 sec.2/sec.3).
 *
 * Class-S per TICKET_1276: this reads persisted credential rows over the shared
 * SQLite handle, with no live provider pool and no probe, so it answers
 * identically whether or not Electron is running (AC4). Reachability stays
 * Class-R and is NOT synthesized here.
 *
 * Read failures propagate as `unknown`, never as `not-configured`: the shared
 * resolver's `CredentialPresenceReader` contract distinguishes "the store said
 * no" from "the store could not be read", and a `SecureStore` throw is the
 * latter (AC6).
 */
export async function readConfiguredDataProviders(): Promise<ProviderConfiguredEntry[]> {
  const store = getStore();
  return resolveConfiguredDataProviders(async (pluginId, key) => {
    // `hasCredentialSync` is row-presence only -- the same predicate the
    // Electron `credential.has` IPC resolves. A throw (locked/corrupt store)
    // becomes `unknown` upstream rather than a false "no credentials".
    return { success: true, exists: store.hasCredentialSync(pluginId, key) };
  });
}

/**
 * TICKET_1314_3: every credential the current master key cannot read.
 *
 * Delegates to the same shared SecureStore operation the Electron surface
 * uses -- no surface reimplements the cohort scan.
 */
export function listUnreadableCredentials(): UnreadableCredential[] {
  return getStore().listUnreadableCredentialsSync();
}

/**
 * TICKET_1314_3: archive and clear the unreadable cohort.
 *
 * DESTRUCTIVE to live credentials -- the caller MUST have obtained explicit
 * user confirmation first. Ciphertext is preserved in
 * `credential_recovery_archive` and is never deleted. This is the only route
 * out of a store whose OS keyring master key was lost.
 */
export function resetUnreadableCredentials(): ResetUnreadableResult {
  const result = getStore().resetUnreadableCredentialsSync();
  if (result.success) {
    mcpLog.warn(
      `[secure-credentials] unreadable cohort reset: archived ${result.archived ?? 0} credential(s)`,
    );
  }
  return result;
}

export function readSecureStoreLifecycleStatus(): SecureStoreLifecycleStatus {
  return getStore().lifecycleStatusSync();
}

export function migrateLegacyCredentialStore(): LifecycleMutationResponse {
  return getStore().migrateLegacyToGcm2Sync();
}

export function rotateCredentialMasterKey(): LifecycleMutationResponse {
  return getStore().rotateMasterKeySync();
}

export function exportCredentialRecoveryBundle(
  passphrase: string,
): LifecycleMutationResponse & { bundleBase64?: string } {
  const result = getStore().exportRecoveryBundleSync(passphrase);
  const { bundle, ...response } = result;
  return {
    ...response,
    bundleBase64: bundle?.toString('base64'),
  };
}

export function importCredentialRecoveryBundle(
  bundleBase64: string,
  passphrase: string,
): LifecycleMutationResponse {
  return getStore().importRecoveryBundleSync(Buffer.from(bundleBase64, 'base64'), passphrase);
}

export async function writeBrowserOAuthSession(
  sessionHash: string,
  record: BrowserOAuthSessionRecord,
): Promise<void> {
  const result = await getStore().setSecret(
    HOST_PLUGIN_ID,
    `${BROWSER_SESSION_PREFIX}${sessionHash}`,
    JSON.stringify(record),
  );
  if (!result.success) throw new Error(result.errorMessage ?? 'Failed to persist browser OAuth session');
}

export async function readBrowserOAuthSession(
  sessionHash: string,
): Promise<BrowserOAuthSessionRecord | null> {
  const key = `${BROWSER_SESSION_PREFIX}${sessionHash}`;
  const result = await getStore().getSecret(HOST_PLUGIN_ID, key);
  if (!result.success || !result.value) return null;
  try {
    const record = JSON.parse(result.value) as BrowserOAuthSessionRecord;
    if (
      typeof record.accessToken !== 'string'
      || typeof record.refreshToken !== 'string'
      || typeof record.accessTokenExpiresAt !== 'number'
      || typeof record.absoluteExpiresAt !== 'number'
      || !record.user
    ) throw new Error('Invalid browser OAuth session record');
    if (record.absoluteExpiresAt <= Date.now()) {
      await getStore().deleteSecret(HOST_PLUGIN_ID, key);
      return null;
    }
    return record;
  } catch (reason) {
    await getStore().deleteSecret(HOST_PLUGIN_ID, key);
    throw reason;
  }
}

export async function deleteBrowserOAuthSession(sessionHash: string): Promise<void> {
  await getStore().deleteSecret(HOST_PLUGIN_ID, `${BROWSER_SESSION_PREFIX}${sessionHash}`);
}

// ── Plugin-config selection + validation (the same file Electron writes) ─────
//
// TICKET_1276: reads/writes go through @StratCraft/config-file -- the same
// cross-process advisory lock + atomic-rename path Electron's
// plugin-settings-file.ts uses -- so an MCP write can neither tear a read nor
// lose a concurrent Electron read-modify-write cycle.

function readPluginConfig(): Record<string, unknown> {
  return readJsonConfigFile(pluginConfigPathOf());
}

/** Read the canonical LLM selection (null when none persisted). */
export function readLlmSelection(): { provider: string; model: string; catalogProvider?: string } | null {
  const config = readPluginConfig();
  const provider = config[LLM_CONFIG_KEYS.SELECTED_PROVIDER];
  const model = config[LLM_CONFIG_KEYS.SELECTED_MODEL];
  if (typeof provider !== 'string' || provider === '') return null;
  const catalogProvider = config[LLM_CONFIG_KEYS.SELECTED_PRO_PROVIDER];
  return {
    provider,
    model: typeof model === 'string' ? model : '',
    catalogProvider: typeof catalogProvider === 'string' && catalogProvider !== ''
      ? catalogProvider
      : undefined,
  };
}

/** Persist the canonical LLM selection into the shared plugin-config file. */
export async function writeLlmSelection(provider: string, model: string, catalogProvider?: string): Promise<void> {
  await updateJsonConfigFile(pluginConfigPathOf(), {
    [LLM_CONFIG_KEYS.SELECTED_PROVIDER]: provider,
    [LLM_CONFIG_KEYS.SELECTED_MODEL]: model,
    [LLM_CONFIG_KEYS.SELECTED_PRO_PROVIDER]: catalogProvider ?? '',
  });
}

function getValidationStatus(providerId: string): boolean {
  const config = readPluginConfig();
  const key = `${LLM_CONFIG_KEYS.VALIDATION_STATUS_PREFIX}${providerId.toLowerCase()}`;
  return config[key] === true;
}

// ── Shared provider-resolution deps ──────────────────────────────────────────

let byokFetcher: ReturnType<typeof createByokModelFetcher> | null = null;

function getByokFetcher() {
  if (!byokFetcher) {
    byokFetcher = createByokModelFetcher({
      getSecretValue: async (secretKey: string) => {
        const res = await getStore().getSecret(HOST_PLUGIN_ID, secretKey);
        return res.success && res.value !== undefined ? res.value : null;
      },
      cacheDir: byokCacheDirOf(),
      log: mcpLog,
    });
  }
  return byokFetcher;
}

/**
 * TICKET_1276 P1: the SAME dependency wiring Electron's LLMKeyResolver uses,
 * but with MCP-side IO: credential store, plugin-config validation, OAuth-row
 * auth signal, shared BYOK fetcher. `getProCatalogModels` returns [] -- the Pro
 * catalog is an authenticated backend fetch owned by the app runtime, not the
 * storage layer; its absence only omits Plan-tier models, never BYOK keys.
 */
export function buildMcpProviderResolutionDeps(
  curationModels: ProCatalogModel[] = [],
): ProviderResolutionDeps {
  const s = getStore();
  return {
    // TICKET_1313 Phase 4: decryptability, not row existence -- an undecryptable
    // row must resolve to `needs_credential`, not a turn-admission failure.
    hasSecret: (secretKey: string) => s.isCredentialUsable(HOST_PLUGIN_ID, secretKey),
    getSecretHealth: (secretKey: string) => s.credentialHealth(HOST_PLUGIN_ID, secretKey),
    isAuthenticated: async () =>
      (await s.credentialHealth(HOST_PLUGIN_ID, OAUTH_TOKENS_KEY)).state === 'usable'
      && (await s.credentialHealth(HOST_PLUGIN_ID, OAUTH_USER_KEY)).state === 'usable',
    getValidationStatus: async (providerId: string) => getValidationStatus(providerId),
    fetchByokModels: (providerId: string) => getByokFetcher().fetchModels(providerId),
    getProCatalogModels: async () => curationModels,
    log: mcpLog,
  };
}

// ── Payload builders consumed by the settings-conversations handlers ─────────

export function buildProvidersPayload(): Promise<LlmProvidersPayload> {
  return buildLlmProvidersPayload(buildMcpProviderResolutionDeps());
}

export function buildCredentialPayload(): Promise<LlmCredentialPayload> {
  return buildLlmCredentialPayload(
    buildMcpProviderResolutionDeps(),
    async () => readLlmSelection(),
  );
}

export async function buildGuideLlmConfig(
  planProviders: GuideToolbarConfig['llm']['groups'][number]['providers'] = [],
  curationModels: ProCatalogModel[] = [],
): Promise<Omit<GuideToolbarConfig['llm'], 'selectionFingerprint'>> {
  const groups = await buildGuideToolbarGroups(
    buildMcpProviderResolutionDeps(curationModels),
    planProviders,
  );
  const configuredLinoModels = readProviderEnabledModels(LLM_PROVIDER_LINO);
  if (configuredLinoModels !== null) {
    const lino = groups
      .flatMap(group => group.providers)
      .find(provider => provider.id === LLM_PROVIDER_LINO);
    if (lino) {
      const enabled = new Set(configuredLinoModels);
      lino.models = lino.models.filter(model => enabled.has(model.id));
      if (lino.models.length === 0) {
        lino.availability = 'needs_credential';
        lino.unavailableReason = 'Select at least one discovered model in Settings';
        lino.recommendedModelId = undefined;
      } else if (!lino.models.some(model => model.id === lino.recommendedModelId)) {
        lino.recommendedModelId = lino.models[0].id;
      }
    }
  }
  const persisted = readLlmSelection();
  const providers = groups.flatMap(group => group.providers);
  const provider = persisted
    ? providers.find(row =>
      row.id === (persisted.catalogProvider ?? persisted.provider)
      && (row.runtimeProviderId ?? row.id) === persisted.provider)
      // Desktop parity for selections written before selectedProProvider
      // existed: locate the catalog owner by its model once, then include that
      // owner in the returned canonical snapshot. New writes always persist it.
      ?? (!persisted.catalogProvider
        ? providers.find(row =>
          row.runtimeProviderId === persisted.provider
          && row.models.some(model => model.id === persisted.model))
        : undefined)
    : undefined;
  const selected = provider?.availability === 'selectable'
    && provider.models.some(model => model.id === persisted?.model)
    ? {
      providerId: persisted!.provider,
      modelId: persisted!.model,
      ...(provider.runtimeProviderId ? { catalogProviderId: provider.id } : {}),
    }
    : null;
  const invalidatedSelection = persisted !== null && selected === null
    ? {
      providerId: persisted.provider,
      modelId: persisted.model,
      ...(persisted.catalogProvider
        ? { catalogProviderId: persisted.catalogProvider }
        : {}),
    }
    : undefined;
  return {
    groups,
    selected,
    ...(invalidatedSelection ? { invalidatedSelection } : {}),
    selectionInvalidated: invalidatedSelection !== undefined,
  };
}

function readProviderEnabledModels(providerId: string): string[] | null {
  if (providerId !== LLM_PROVIDER_LINO) return null;
  const value = readPluginConfig()[LLM_CONFIG_KEYS.LINO_USER_MODELS];
  return Array.isArray(value)
    ? value.filter((modelId): modelId is string => typeof modelId === 'string')
    : null;
}

async function hasRequiredStoredCredentials(providerId: string): Promise<boolean> {
  const record = getProviderRecord(providerId);
  if (!record) return false;
  if (!record.credential.required) return true;
  // TICKET_1313 Phase 4: decryptability, not row existence. This drives the
  // `configured` / `validated` badges in the Guide settings panel; row
  // existence would render "CONFIGURED" for a key that cannot be decrypted,
  // contradicting the disabled dropdown option for the same provider.
  if (!(await getStore().isCredentialUsable(HOST_PLUGIN_ID, record.secretKey))) return false;
  for (const field of record.credential.extraFields ?? []) {
    if (field.required && !(await getStore().isCredentialUsable(HOST_PLUGIN_ID, field.key))) {
      return false;
    }
  }
  return true;
}

export async function buildGuideLlmSettingsConfig(
  planProviders: GuideToolbarConfig['llm']['groups'][number]['providers'] = [],
  curationModels: ProCatalogModel[] = [],
): Promise<GuideLlmSettingsConfig> {
  const groups = await buildGuideToolbarGroups(
    buildMcpProviderResolutionDeps(curationModels),
    planProviders,
  );
  const rows = groups
    .filter(group => group.kind !== 'plan')
    .flatMap(group => group.providers.map(provider => ({ kind: group.kind, provider })));

  return {
    planProviders,
    providers: await Promise.all(LLM_PROVIDER_RECORDS.map(async record => {
      const row = rows.find(candidate => candidate.provider.id === record.id);
      const configured = await hasRequiredStoredCredentials(record.id);
      const validated = configured && (getValidationStatus(record.id) || !record.credential.required);
      const discoveredModels = row?.provider.models ?? [];
      const configuredModels = readProviderEnabledModels(record.id);
      return {
        id: record.id,
        name: record.name,
        kind: record.credential.required ? 'byok' as const : 'local' as const,
        configured,
        availability: row?.provider.availability ?? 'needs_credential',
        unavailableReason: row?.provider.unavailableReason,
        credentialHealth: row?.provider.credentialHealth,
        credential: record.credential,
        validationStatus: validated
          ? 'valid' as const
          : configured ? 'invalid' as const : 'unknown' as const,
        validationMessage: configured && !validated
          ? 'Credential validation is required'
          : undefined,
        discoveredModels,
        enabledModelIds: configuredModels ?? discoveredModels.map(model => model.id),
        recommendedModelId: row?.provider.recommendedModelId,
        modelSelectionSupported: record.id === LLM_PROVIDER_LINO,
      };
    })),
  };
}

export async function validateAndWriteLlmSelection(
  providerId: string,
  modelId: string,
  catalogProviderId?: string,
  planProviders: GuideToolbarConfig['llm']['groups'][number]['providers'] = [],
  curationModels: ProCatalogModel[] = [],
): Promise<{ providerId: string; modelId: string; catalogProviderId?: string }> {
  if (providerId === LLM_PROVIDER_PRO_CATALOG && !catalogProviderId) {
    throw new Error('catalog_provider is required when selecting a Plan model');
  }
  const llm = await buildGuideLlmConfig(planProviders, curationModels);
  const visibleProviderId = catalogProviderId ?? providerId;
  const provider = llm.groups.flatMap(group => group.providers).find(row =>
    row.id === visibleProviderId && (row.runtimeProviderId ?? row.id) === providerId);
  if (!provider) throw new Error(`Unknown LLM provider '${providerId}'`);
  if (provider.availability !== 'selectable') {
    throw new Error(provider.unavailableReason ?? `LLM provider '${providerId}' is unavailable`);
  }
  if (!provider.models.some(model => model.id === modelId)) {
    throw new Error(`Model '${modelId}' is not available for provider '${providerId}'`);
  }
  await writeLlmSelection(providerId, modelId, catalogProviderId);
  return { providerId, modelId, ...(catalogProviderId ? { catalogProviderId } : {}) };
}

/**
 * TICKET_1276_1: read a provider's stored BYOK secret directly from the shared
 * store (API key for cloud providers, base URL for OLLAMA). This is the
 * agent-loop key path -- the same rows Electron and the settings handlers use;
 * no Electron bridge. Returns null when the provider is unknown or no secret
 * is stored; store-level read failures are logged (TICKET_858) and surface as
 * null so callers emit their actionable no-key error.
 */
export async function getLlmSecret(provider: string): Promise<string | null> {
  const record = getProviderRecord(provider);
  if (!record || !record.secretKey) {
    mcpLog.warn(`[TICKET_1276_1] No credential key mapping for LLM provider '${provider}'`);
    return null;
  }
  const res = await getStore().getSecret(HOST_PLUGIN_ID, record.secretKey);
  if (!res.success) {
    mcpLog.warn(`[TICKET_1276_1] Failed to read LLM secret for '${provider}': ${res.errorMessage ?? 'unknown error'}`);
    return null;
  }
  return res.value ?? null;
}

/**
 * TICKET_1266: read the OPENAI_COMPATIBLE user-supplied base URL from the same
 * shared host store the fetcher, validator, and Electron write. Returns null
 * when not configured or on a store read failure (logged, TICKET_858) so the
 * caller surfaces its actionable "endpoint not configured" error.
 */
export async function getLlmBaseUrl(): Promise<string | null> {
  const res = await getStore().getSecret(HOST_PLUGIN_ID, LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL);
  if (!res.success) {
    // 404 == not configured yet (a normal absence, not a failure). Only a
    // genuine read error (decrypt/keyring/IO) is worth logging (TICKET_858).
    if (res.errorCode !== 404) {
      mcpLog.warn(`[TICKET_1266] Failed to read OPENAI_COMPATIBLE base URL: ${res.errorMessage ?? 'unknown error'}`);
    }
    return null;
  }
  return res.value ?? null;
}

/**
 * TICKET_1266: store the OPENAI_COMPATIBLE user-supplied base URL in the shared
 * host store (the same row the fetcher/validator/Electron read), invalidating
 * the provider's model cache so discovery re-runs against the new endpoint.
 */
export async function setLlmBaseUrl(baseUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await getStore().setSecret(HOST_PLUGIN_ID, LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL, baseUrl);
  if (!res.success) {
    return { ok: false, error: res.errorMessage ?? 'Failed to store base URL' };
  }
  getByokFetcher().invalidate(LLM_PROVIDER_OPENAI_COMPATIBLE);
  return { ok: true };
}

/** Store a BYOK credential, invalidating the provider's model cache. */
export async function setLlmCredential(provider: string, apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const record = getProviderRecord(provider);
  if (!record || !record.secretKey) {
    return { ok: false, error: `No credential key mapping for provider '${provider}'` };
  }
  const res = await getStore().setSecret(HOST_PLUGIN_ID, record.secretKey, apiKey);
  if (!res.success) {
    return { ok: false, error: res.errorMessage ?? 'Failed to store credential' };
  }
  getByokFetcher().invalidate(record.id);
  return { ok: true };
}

function validationConfigKey(providerId: string): string {
  return `${LLM_CONFIG_KEYS.VALIDATION_STATUS_PREFIX}${providerId.toLowerCase()}`;
}

async function writeValidationStatus(providerId: string, validated: boolean): Promise<void> {
  await updateJsonConfigFile(pluginConfigPathOf(), {
    [validationConfigKey(providerId)]: validated,
  });
}

function validateSubmittedField(
  value: string,
  required: boolean,
  pattern: string | undefined,
  label: string,
): void {
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (trimmed && pattern && !new RegExp(pattern).test(trimmed)) {
    throw new Error(`${label} does not match the required format`);
  }
}

type StoredCredentialSnapshot = Map<string, string | null>;

/**
 * TICKET_1314_2: the ONE typed SecureStore failure adapter for this operation.
 *
 * Every credential boundary (snapshot read, write, delete, restore) funnels its
 * `{ success: false }` result through `secureStoreFailure()`, so the
 * authoritative `SecureStoreErrorCode` survives to the MCP `errorResult` and
 * reaches the UI as an actionable message instead of the generic
 * `credential_operation_failed` (TICKET_858: no silent failures).
 *
 * The code is validated against the shared `SECURE_STORE_ERROR_CODES` contract
 * -- an unrecognized or numeric code is dropped rather than forwarded as an
 * arbitrary string the frontend has no translation for.
 */
export class SecureStoreOperationError extends Error {
  constructor(
    readonly secureStoreErrorCode: SecureStoreErrorCode | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'SecureStoreOperationError';
  }
}

const SECURE_STORE_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(
  Object.values(SECURE_STORE_ERROR_CODES),
);

function asSecureStoreErrorCode(code: unknown): SecureStoreErrorCode | undefined {
  return typeof code === 'string' && SECURE_STORE_ERROR_CODE_VALUES.has(code)
    ? (code as SecureStoreErrorCode)
    : undefined;
}

function secureStoreFailure(
  result: { errorCode?: SecureStoreErrorCode | number; errorMessage?: string },
  fallbackMessage: string,
): SecureStoreOperationError {
  return new SecureStoreOperationError(
    asSecureStoreErrorCode(result.errorCode),
    result.errorMessage ?? fallbackMessage,
  );
}

async function readCredentialSnapshot(keys: readonly string[]): Promise<StoredCredentialSnapshot> {
  const snapshot: StoredCredentialSnapshot = new Map();
  for (const key of keys) {
    const result = await getStore().getSecret(HOST_PLUGIN_ID, key);
    if (!result.success && result.errorCode !== 404) {
      throw secureStoreFailure(result, `Failed to read credential field '${key}'`);
    }
    snapshot.set(key, result.success ? result.value ?? null : null);
  }
  return snapshot;
}

async function restoreCredentialSnapshot(snapshot: StoredCredentialSnapshot): Promise<void> {
  for (const [key, value] of snapshot) {
    const result = value === null
      ? await getStore().deleteSecret(HOST_PLUGIN_ID, key)
      : await getStore().setSecret(HOST_PLUGIN_ID, key, value);
    if (!result.success) {
      throw secureStoreFailure(result, `Failed to restore credential field '${key}'`);
    }
  }
}

/**
 * TICKET_1314_2 (B2): roll back without letting the rollback outcome replace the
 * primary failure. A restore error is logged and dropped -- the caller rethrows
 * the original typed reason, which is the one the user must act on.
 */
async function rollbackCredentialSnapshot(
  snapshot: StoredCredentialSnapshot,
  primaryReason: unknown,
): Promise<void> {
  try {
    await restoreCredentialSnapshot(snapshot);
  } catch (restoreReason) {
    mcpLog.error(
      `[TICKET_1314_2] Credential rollback failed; preserving the primary failure. ` +
      `primaryErrorCode=${credentialFailureCode(primaryReason) ?? 'none'} ` +
      `rollbackErrorCode=${credentialFailureCode(restoreReason) ?? 'none'} ` +
      `rollbackMessage=${restoreReason instanceof Error ? restoreReason.message : String(restoreReason)}`,
    );
  }
}

/** The typed SecureStore code carried by a failure, when it carries one. */
export function credentialFailureCode(reason: unknown): SecureStoreErrorCode | undefined {
  return reason instanceof SecureStoreOperationError ? reason.secureStoreErrorCode : undefined;
}

export async function validateAndStoreLlmCredential(
  providerId: string,
  value: string,
  extraCredentials: Record<string, string> = {},
): Promise<Array<{ id: string; name: string }>> {
  const record = getProviderRecord(providerId);
  if (!record) throw new Error(`Unknown LLM provider '${providerId}'`);
  const primaryValidation = validateLlmCredentialValue(providerId, value);
  if (primaryValidation === 'empty') throw new Error('Credential value is required');
  if (primaryValidation === 'patternMismatch') {
    throw new Error(`Value does not match the required format for provider '${providerId}'`);
  }

  const allowedExtraKeys = new Set((record.credential.extraFields ?? []).map(field => field.key));
  for (const key of Object.keys(extraCredentials)) {
    if (!allowedExtraKeys.has(key)) {
      throw new Error(`Unknown credential field '${key}' for provider '${providerId}'`);
    }
  }
  for (const field of record.credential.extraFields ?? []) {
    validateSubmittedField(
      extraCredentials[field.key] ?? '',
      field.required,
      field.pattern,
      `Credential field '${field.key}'`,
    );
  }

  const normalizedExtras = Object.fromEntries(
    Object.entries(extraCredentials).map(([key, fieldValue]) => [key, fieldValue.trim()]),
  );
  const models = await discoverByokModels(providerId, {
    primary: value,
    extra: normalizedExtras,
  });

  const keys = [record.secretKey, ...(record.credential.extraFields ?? []).map(field => field.key)];
  const snapshot = await readCredentialSnapshot(keys);
  try {
    const submitted = new Map<string, string>([
      [record.secretKey, value.trim()],
      ...Object.entries(normalizedExtras),
    ]);
    for (const key of keys) {
      const fieldValue = submitted.get(key) ?? '';
      const result = fieldValue
        ? await getStore().setSecret(HOST_PLUGIN_ID, key, fieldValue)
        : await getStore().deleteSecret(HOST_PLUGIN_ID, key);
      if (!result.success) {
        throw secureStoreFailure(result, `Failed to store credential field '${key}'`);
      }
    }
    await writeValidationStatus(providerId, true);
  } catch (reason) {
    await rollbackCredentialSnapshot(snapshot, reason);
    throw reason;
  }

  getByokFetcher().invalidate(providerId);
  await getByokFetcher().storeModels(providerId, models);
  return models;
}

/**
 * Provider-validated explicit replacement for an unreadable LLM credential.
 * Network discovery completes before the first store mutation. Each unreadable
 * envelope is archived by SecureStore before its verified replacement commits.
 */
export async function validateAndReplaceUnreadableLlmCredential(
  providerId: string,
  value: string,
  extraCredentials: Record<string, string> = {},
): Promise<Array<{ id: string; name: string }>> {
  const record = getProviderRecord(providerId);
  if (!record) throw new Error(`Unknown LLM provider '${providerId}'`);
  const primaryValidation = validateLlmCredentialValue(providerId, value);
  if (primaryValidation === 'empty') throw new Error('Credential value is required');
  if (primaryValidation === 'patternMismatch') {
    throw new Error(`Value does not match the required format for provider '${providerId}'`);
  }
  const allowedExtraKeys = new Set((record.credential.extraFields ?? []).map(field => field.key));
  for (const key of Object.keys(extraCredentials)) {
    if (!allowedExtraKeys.has(key)) {
      throw new Error(`Unknown credential field '${key}' for provider '${providerId}'`);
    }
  }
  for (const field of record.credential.extraFields ?? []) {
    validateSubmittedField(
      extraCredentials[field.key] ?? '',
      field.required,
      field.pattern,
      `Credential field '${field.key}'`,
    );
  }
  const normalizedExtras = Object.fromEntries(
    Object.entries(extraCredentials).map(([key, fieldValue]) => [key, fieldValue.trim()]),
  );
  const primary = value.trim();
  const models = await discoverByokModels(providerId, { primary, extra: normalizedExtras });
  const submitted = new Map<string, string>([
    [record.secretKey, primary],
    ...Object.entries(normalizedExtras),
  ]);
  const keys = [record.secretKey, ...(record.credential.extraFields ?? []).map(field => field.key)];
  for (const key of keys) {
    const fieldValue = submitted.get(key) ?? '';
    const health = getStore().credentialHealthSync(HOST_PLUGIN_ID, key);
    const result = fieldValue
      ? health.state === 'usable' || health.state === 'missing'
        ? getStore().setSecretSync(HOST_PLUGIN_ID, key, fieldValue)
        : getStore().replaceUnreadableSecretSync(HOST_PLUGIN_ID, key, fieldValue, health)
      : getStore().deleteSecretSync(HOST_PLUGIN_ID, key);
    if (!result.success) {
      throw secureStoreFailure(result, `Failed to replace credential field '${key}'`);
    }
  }
  await writeValidationStatus(providerId, true);
  getByokFetcher().invalidate(providerId);
  await getByokFetcher().storeModels(providerId, models);
  return models;
}

export async function deleteLlmCredential(providerId: string): Promise<void> {
  const record = getProviderRecord(providerId);
  if (!record) throw new Error(`Unknown LLM provider '${providerId}'`);
  if (!record.credential.required) {
    throw new Error(`Provider '${providerId}' has no required credential to delete`);
  }
  const keys = [record.secretKey, ...(record.credential.extraFields ?? []).map(field => field.key)];
  const snapshot = await readCredentialSnapshot(keys);
  try {
    for (const key of keys) {
      const result = await getStore().deleteSecret(HOST_PLUGIN_ID, key);
      if (!result.success) {
        throw secureStoreFailure(result, `Failed to delete credential field '${key}'`);
      }
    }
    await writeValidationStatus(providerId, false);
  } catch (reason) {
    await rollbackCredentialSnapshot(snapshot, reason);
    throw reason;
  }
  getByokFetcher().invalidate(providerId);
}

export async function refreshLlmProviderModels(
  providerId: string,
): Promise<Array<{ id: string; name: string }>> {
  const record = getProviderRecord(providerId);
  if (!record) throw new Error(`Unknown LLM provider '${providerId}'`);
  const primary = await getStore().getSecret(HOST_PLUGIN_ID, record.secretKey);
  if (record.credential.required && (!primary.success || !primary.value)) {
    throw new Error(`Provider '${providerId}' is not configured`);
  }
  const extra: Record<string, string> = {};
  for (const field of record.credential.extraFields ?? []) {
    const result = await getStore().getSecret(HOST_PLUGIN_ID, field.key);
    if (field.required && (!result.success || !result.value)) {
      throw new Error(`Credential field '${field.key}' is not configured`);
    }
    if (result.success && result.value) extra[field.key] = result.value;
  }
  const models = await discoverByokModels(providerId, {
    primary: primary.success ? primary.value ?? '' : '',
    extra,
  });
  getByokFetcher().invalidate(providerId);
  await getByokFetcher().storeModels(providerId, models);
  await writeValidationStatus(providerId, true);
  return models;
}

export async function writeLlmProviderModels(providerId: string, modelIds: string[]): Promise<void> {
  if (providerId !== LLM_PROVIDER_LINO) {
    throw new Error(`Custom model selection is not supported for provider '${providerId}'`);
  }
  // Re-discover under the currently stored credential so a stale cache cannot
  // authorize a model that disappeared between Settings load and save.
  const discovered = await refreshLlmProviderModels(providerId);
  const discoveredIds = new Set(discovered.map(model => model.id));
  const unique = [...new Set(modelIds)];
  const unknown = unique.find(modelId => !discoveredIds.has(modelId));
  if (unknown) {
    throw new Error(`Model '${unknown}' is not available for provider '${providerId}'`);
  }
  await updateJsonConfigFile(pluginConfigPathOf(), {
    [LLM_CONFIG_KEYS.LINO_USER_MODELS]: unique,
  });
}

/** Test-only reset of the injected singleton state. */
export function resetSecureCredentialsForTest(): void {
  store = null;
  byokFetcher = null;
}
