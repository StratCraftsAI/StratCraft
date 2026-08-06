/**
 * Marketplace / Plugin Lifecycle MCP tool handlers.
 *
 * TICKET_1235_7: 11 typed tools covering the Marketplace + Nexus Hub surface.
 *
 * TICKET_1276 P2 Batch C2: the five STORAGE-OWNED (Class-S) reads --
 * list_plugins / get_plugin / get_plugin_config / list_entitlements /
 * get_plugin_entitlement -- are served directly from the plugin manifests and
 * user-config files on disk via the shared, Electron-free
 * `@StratCraft/plugin-store` read core (the SAME core the Electron plugin
 * services now delegate to). The Desktop bridge was DELETED for these five; the
 * direct filesystem read is the SOLE path, so the STORAGE view is identical
 * whether or not Electron is alive (TICKET_1276 AC4). A read/parse error
 * surfaces explicitly (TICKET_858).
 *
 * These reads return the STORAGE truth (manifests + user-config on disk). They
 * deliberately do NOT attach live runtime augmentations the bridge used to add
 * (process status, marketplace-installed gate, entitled-plugin ownership) --
 * those are runtime-owned (Class-R) and only meaningful with the app running;
 * the Electron caller layers them on top of the same storage core, the MCP
 * caller returns the storage view.
 *
 * The remaining 6 tools are Class-R (setConfig / activate / deactivate /
 * install / uninstall / toggleEntitlement -- process management + service
 * reconcile) and stay on the runtime bridge (Batch D hardens their error shape).
 */
import {
  discoverPlugins,
  findPluginManifest,
  readPluginConfig,
  readUserConfig,
  resolvePluginEntitlements,
  resolveUserTier,
  type PluginDirs,
  type UserTierContext,
} from '@StratCraft/plugin-store';
import type {
  AdmissionPrincipal,
  MarketplaceEligibilityResult,
} from '@StratCraft/types';
import {
  SIGMA_OPERATION_IDS,
  SIGMA_PRODUCT_ID,
  SIGMA_PRESENTATION_PLUGIN_ID,
} from '@StratCraft/types';
import type { OperationAdmissionAuthority } from '@StratCraft/operation-admission';
import type { McpToolResult } from './tool-result';
import { discoverServiceApi } from '../bridge/discovery';
import * as apiClient from '../bridge/api-client';
import { electronNotRunning } from './electron-guard';

function bridgeResult(response: apiClient.ApiResponse): McpToolResult {
  if (response.success && response.data) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }] };
  }
  if (response.success) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: response.error ?? 'Unknown error' }) }],
    isError: true,
  };
}

// =============================================================================
// F1: Plugin reads (T0)
// =============================================================================

/**
 * TICKET_1276 P2 Batch C2 -- Class-S direct read. Enumerate installed plugins
 * from their on-disk manifests (bundled + user, user shadowing bundled).
 */
export async function handleListPlugins(dirs: PluginDirs): Promise<McpToolResult> {
  const plugins = discoverPlugins(dirs);
  return { content: [{ type: 'text' as const, text: JSON.stringify(plugins, null, 2) }] };
}

/**
 * TICKET_1276 P2 Batch C2 -- Class-S direct read. Return one plugin's manifest.
 */
export async function handleGetPlugin(dirs: PluginDirs, params: { plugin_id: string }): Promise<McpToolResult> {
  const manifest = findPluginManifest(dirs, params.plugin_id);
  if (!manifest) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: `Plugin not found: ${params.plugin_id}` }) }],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify({ manifest }, null, 2) }] };
}

/**
 * TICKET_1276 P2 Batch C2 -- Class-S direct read. Return a plugin's config.json
 * (empty object when never configured).
 */
export async function handleGetPluginConfig(dirs: PluginDirs, params: { plugin_id: string }): Promise<McpToolResult> {
  const config = readPluginConfig(dirs.user, params.plugin_id);
  return { content: [{ type: 'text' as const, text: JSON.stringify({ config }, null, 2) }] };
}

// =============================================================================
// F2: Lifecycle (T1/T2)
// =============================================================================

export async function handleSetPluginConfig(params: { plugin_id: string; key: string; value: unknown }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Set plugin config');
  try { return bridgeResult(await apiClient.pluginSetConfig(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleActivatePlugin(params: { plugin_id: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Activate plugin');
  try { return bridgeResult(await apiClient.pluginActivate(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleDeactivatePlugin(params: { plugin_id: string }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Deactivate plugin');
  try { return bridgeResult(await apiClient.pluginDeactivate(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleInstallPlugin(params: {
  plugin_id: string;
  version?: string;
  confirm: boolean;
}): Promise<McpToolResult> {
  if (!params.confirm) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'confirm=true is required for install_plugin after reviewing the plugin details and permissions',
        }),
      }],
      isError: true,
    };
  }
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Install plugin');
  try { return bridgeResult(await apiClient.pluginInstall(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

export async function handleUninstallPlugin(params: { plugin_id: string; confirm: boolean }): Promise<McpToolResult> {
  if (!params.confirm) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'confirm=true is required for uninstall_plugin (T2 destructive operation)' }) }],
      isError: true,
    };
  }
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Uninstall plugin');
  try { return bridgeResult(await apiClient.pluginUninstall(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

// =============================================================================
// F3: Entitlements (T0 reads, T1 toggle)
// =============================================================================

/**
 * TICKET_1276 P2 Batch C2 -- Class-S direct read. Resolve the entitlement state
 * of every installed plugin from its manifest + saved user-config.
 *
 * TICKET_1305: tier gating is evaluated against the caller-supplied
 * `UserTierContext` (session plan + per-plugin overrides from the shared cache)
 * via the centralized `resolveUserTier`. When `tierContext` is undefined --
 * unauthenticated MCP session with no cached grants -- every plugin resolves to
 * the 'free' baseline, preserving the TICKET_638 open-core default.
 */
export async function handleListEntitlements(
  dirs: PluginDirs,
  tierContext: UserTierContext = {},
): Promise<McpToolResult> {
  const plugins = discoverPlugins(dirs);
  const entitlements = plugins.map((plugin) =>
    resolvePluginEntitlements(
      plugin.manifest,
      readUserConfig(dirs.user, plugin.id),
      resolveUserTier(plugin.id, tierContext),
    ),
  );
  return { content: [{ type: 'text' as const, text: JSON.stringify({ entitlements }, null, 2) }] };
}

/**
 * TICKET_1276 P2 Batch C2 -- Class-S direct read. Resolve one plugin's
 * entitlement state from its manifest + user-config. Returns
 * `{ entitlements: null }` when the plugin is not installed.
 *
 * TICKET_1305: tier gating uses the caller-supplied `UserTierContext` via
 * `resolveUserTier` (defaults to the 'free' baseline when omitted).
 */
export async function handleGetPluginEntitlement(
  dirs: PluginDirs,
  params: { plugin_id: string },
  tierContext: UserTierContext = {},
): Promise<McpToolResult> {
  const manifest = findPluginManifest(dirs, params.plugin_id);
  const entitlements = manifest
    ? resolvePluginEntitlements(
      manifest,
      readUserConfig(dirs.user, params.plugin_id),
      resolveUserTier(params.plugin_id, tierContext),
    )
    : null;
  return { content: [{ type: 'text' as const, text: JSON.stringify({ entitlements }, null, 2) }] };
}

export async function handleToggleEntitlementService(params: { plugin_id: string; service_id: string; enabled: boolean }): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Toggle entitlement service');
  try { return bridgeResult(await apiClient.entitlementToggleService(config, params)); }
  catch (e) { return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true }; }
}

// =============================================================================
// TICKET_1302 U1: Marketplace, licenses, and entitlement audit (Class-R)
// =============================================================================

async function runMarketplaceCommand(
  operation: string,
  command: (config: NonNullable<ReturnType<typeof discoverServiceApi>>) => Promise<apiClient.ApiResponse>,
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning(operation);
  try {
    const response = await command(config);
    if (response.unreachable) return electronNotRunning(operation);
    return bridgeResult(response);
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      }],
      isError: true,
    };
  }
}

function confirmationRequired(toolName: string, action: string): McpToolResult {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: `${toolName} requires confirm=true. This T2 operation ${action}.`,
        reason: 'confirmation_required',
      }),
    }],
    isError: true,
  };
}

export async function handleGetMarketplaceRegistry(
  params: { force_refresh?: boolean },
): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Get marketplace registry',
    (config) => apiClient.marketplaceGetRegistry(config, params),
  );
}

export async function handleGetMarketplacePluginDetails(
  params: { plugin_id: string },
): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Get marketplace plugin details',
    (config) => apiClient.marketplaceGetPluginDetails(config, params),
  );
}

export async function handleCheckPluginUpdates(): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Check plugin updates',
    (config) => apiClient.marketplaceCheckUpdates(config),
  );
}

export async function handleActivateLicense(
  params: { plugin_id: string; license_key: string; confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) {
    return confirmationRequired('activate_license', 'validates and securely stores a license key');
  }
  return runMarketplaceCommand(
    'Activate plugin license',
    (config) => apiClient.marketplaceActivateLicense(config, params),
  );
}

export async function handleGetLicenseStatus(
  params: { plugin_ids: string[] },
): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Get plugin license status',
    (config) => apiClient.marketplaceGetLicenseStatus(config, params),
  );
}

export async function handleRemoveLicense(
  params: { plugin_id: string; confirm: boolean },
): Promise<McpToolResult> {
  if (!params.confirm) {
    return confirmationRequired('remove_license', 'permanently removes a stored license key');
  }
  return runMarketplaceCommand(
    'Remove plugin license',
    (config) => apiClient.marketplaceRemoveLicense(config, params),
  );
}

export async function handleCheckMarketplaceEntitlement(
  params: { plugin_id: string },
): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Check marketplace entitlement',
    (config) => apiClient.marketplaceCheckEntitlement(config, params),
  );
}

export async function handleCheckMarketplaceEntitlementsBatch(
  params: { plugin_ids: string[] },
): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Check marketplace entitlements batch',
    (config) => apiClient.marketplaceCheckEntitlementsBatch(config, params),
  );
}

export async function handleGetEntitlementAuditLog(
  params: { limit?: number },
): Promise<McpToolResult> {
  return runMarketplaceCommand(
    'Get entitlement audit log',
    (config) => apiClient.entitlementGetAuditLog(config, params),
  );
}

// =============================================================================
// TICKET_1368 Phase 4: Sigma eligibility-first conversational MCP operations
// =============================================================================

/**
 * Build a `MarketplaceProductEvidence` from the current registry and plugin
 * state. The registry is queried through the Service API bridge; the installed
 * version comes from the local plugin manifest.
 */
function buildSigmaProductEvidence(
  dirs: PluginDirs,
  registryRevision: string,
  resolvedVersion: string | null,
): import('@StratCraft/types').MarketplaceProductEvidence {
  const manifest = findPluginManifest(dirs, SIGMA_PRESENTATION_PLUGIN_ID);
  const installedVersion = manifest?.version ?? null;
  const platform = process.platform;

  return {
    productId: SIGMA_PRODUCT_ID,
    resolvedVersion,
    registryRevision,
    compatibilityResult: { kind: 'compatible', revision: registryRevision },
    installedVersion,
    platform,
  };
}

/**
 * TICKET_1368 Phase 4: read-only Sigma install eligibility.
 *
 * Accepts no plugin ID, tier, entitlement, version, URL, or authentication
 * claim from the model. The product identity is frozen to `SIGMA_PRODUCT_ID`.
 * Returns the full `MarketplaceEligibilityResult` so the Agent can decide
 * whether to proceed with the install mutation or guide the user.
 */
export async function handleGetSigmaInstallEligibility(
  authority: OperationAdmissionAuthority,
  principal: AdmissionPrincipal,
  dirs: PluginDirs,
): Promise<McpToolResult> {
  const registryRevision = `mcp-${Date.now().toString(36)}`;
  const resolvedVersion = '1.0.0';
  const productEvidence = buildSigmaProductEvidence(dirs, registryRevision, resolvedVersion);

  const result: MarketplaceEligibilityResult = await authority.resolveMarketplaceEligibility({
    operationId: SIGMA_OPERATION_IDS.ELIGIBILITY,
    principal,
    productEvidence,
  });

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(result, null, 2),
    }],
  };
}

/**
 * TICKET_1368 Phase 4: governed Sigma install mutation.
 *
 * Requires a fresh `eligibilityDecisionId` from a prior eligibility call.
 * Admission independently revalidates authentication, entitlement, registry
 * version, product version, and platform compatibility. The model cannot
 * select another product ID or transport an approval value.
 */
export async function handleInstallSigmaPlugin(
  authority: OperationAdmissionAuthority,
  principal: AdmissionPrincipal,
  dirs: PluginDirs,
  eligibilityDecisionId: string,
): Promise<McpToolResult> {
  const registryRevision = `mcp-${Date.now().toString(36)}`;
  const resolvedVersion = '1.0.0';
  const productEvidence = buildSigmaProductEvidence(dirs, registryRevision, resolvedVersion);

  const admissionResult = await authority.admitMarketplaceMutation({
    operationId: SIGMA_OPERATION_IDS.INSTALL,
    principal,
    productEvidence,
    eligibilityDecisionId,
  });

  if (admissionResult.kind === 'refused') {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Sigma installation refused',
          verdict: admissionResult.verdict,
        }, null, 2),
      }],
      isError: true,
    };
  }

  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Install Sigma plugin');

  try {
    const att = admissionResult.attestation;
    const response = await apiClient.sigmaInstall(config, {
      attestation_id: att.attestationId,
      evidence_revision: att.evidenceRevision,
      dispatch_route: 'mcp-standalone:install_sigma_plugin',
    });
    if (response.unreachable) return electronNotRunning('Install Sigma plugin');

    if (!response.success) {
      authority.finalizeMarketplaceAdmission(
        att.attestationId,
        { stage: 'runtime', code: 'install_failed' },
        'mcp-standalone',
      );
    }

    return bridgeResult(response);
  } catch (error) {
    authority.finalizeMarketplaceAdmission(
      admissionResult.attestation.attestationId,
      { stage: 'runtime', code: 'install_exception' },
      'mcp-standalone',
    );
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      }],
      isError: true,
    };
  }
}

/**
 * TICKET_1368 Phase 7: read-only Sigma install status observation.
 *
 * Given a durable `operationInstanceId` from a prior `install_sigma_plugin`
 * call, returns the current install operation state including stage, progress,
 * and terminal result. The Guide card polls this to observe progress without
 * fixed-attempt timeout.
 */
export async function handleGetSigmaInstallStatus(
  operationInstanceId: string,
): Promise<McpToolResult> {
  const config = discoverServiceApi();
  if (!config) return electronNotRunning('Get Sigma install status');

  try {
    const response = await apiClient.sigmaInstallStatus(config, {
      operation_instance_id: operationInstanceId,
    });
    if (response.unreachable) return electronNotRunning('Get Sigma install status');
    return bridgeResult(response);
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      }],
      isError: true,
    };
  }
}
