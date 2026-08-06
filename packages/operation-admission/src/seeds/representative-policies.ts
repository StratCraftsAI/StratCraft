/**
 * TICKET_1345 Phase 3: Representative operation policies.
 *
 * This is the initial subset (~30 operations) that validates the policy
 * registry, admission pipeline, and cross-surface parity before full
 * migration (Phase 6). Each entry maps one exposed operation to its
 * authoritative entitlement policy.
 *
 * Tier mapping from `electron-capability-manifest.json` authTiers:
 *   T0 = public (free, no auth required)
 *   T1 = plugin-tier (requires the plugin's marketplace tier)
 *   T2 = plugin-tier + human-origin mutation authority
 *
 * The `pluginId` for most operations is 'com.stratcraft.base' (the Base
 * plugin, which all installations have). Quant Lab operations use
 * 'com.stratcraft.quant-lab'.
 */

import type {
  OperationAdmissionPolicy,
  OperationAdmissionPolicyReadOnly,
  OperationAdmissionPolicyMutation,
} from '@StratCraft/types';

// ---------------------------------------------------------------------------
// Helper constructors
// ---------------------------------------------------------------------------

function publicReadOnly(
  operationId: string,
  capabilityId: string,
  runtimeRequirements: readonly string[] = [],
): OperationAdmissionPolicyReadOnly {
  return {
    operationId,
    capabilityId,
    authentication: 'optional',
    entitlement: { kind: 'public' },
    mutationAuthority: 'none',
    runtimeRequirements,
    policyRevision: 1,
  };
}

function tierReadOnly(
  operationId: string,
  capabilityId: string,
  pluginId: string,
  runtimeRequirements: readonly string[] = [],
): OperationAdmissionPolicyReadOnly {
  return {
    operationId,
    capabilityId,
    authentication: 'required',
    entitlement: { kind: 'plugin-tier', pluginId, requirementSource: 'current-registry' },
    mutationAuthority: 'none',
    runtimeRequirements,
    policyRevision: 1,
  };
}

function tierMutation(
  operationId: string,
  capabilityId: string,
  pluginId: string,
  delegationPolicy: 'direct-only' | 'session-trust-eligible',
  runtimeRequirements: readonly string[] = [],
): OperationAdmissionPolicyMutation {
  return {
    operationId,
    capabilityId,
    authentication: 'required',
    entitlement: { kind: 'plugin-tier', pluginId, requirementSource: 'current-registry' },
    mutationAuthority: 'human-origin-required',
    delegationPolicy,
    runtimeRequirements,
    policyRevision: 1,
  };
}

// ---------------------------------------------------------------------------
// Representative MCP tool policies
// ---------------------------------------------------------------------------

import {
  SIGMA_PRESENTATION_PLUGIN_ID,
  SIGMA_OPERATION_IDS,
} from '@StratCraft/types';

const BASE_PLUGIN = 'com.stratcraft.base';
const QUANT_LAB_PLUGIN = 'com.stratcraft.quant-lab';

export const MCP_TOOL_POLICIES: readonly OperationAdmissionPolicy[] = [
  // T0 / public reads
  publicReadOnly('mcp:get_research_environment_status', 're1', ['research-runtime-service']),
  publicReadOnly('mcp:get_research_environment_job', 're1', ['research-runtime-service']),
  publicReadOnly('mcp:verify_research_environment', 're1', ['research-runtime-service']),
  publicReadOnly('mcp:list_strategies', 's2'),
  publicReadOnly('mcp:get_strategy', 's2'),
  publicReadOnly('mcp:list_backtest_results', 'b13'),
  publicReadOnly('mcp:get_backtest_result', 'b13'),
  publicReadOnly('mcp:list_entitlements', 'm9'),
  publicReadOnly('mcp:get_plugin_entitlement', 'm9'),
  publicReadOnly('mcp:check_marketplace_entitlement', 'm4', ['marketplace-service']),

  // T1 / tier-gated reads and operations
  tierReadOnly('mcp:run_backtest', 'b1', BASE_PLUGIN, ['executor-service']),
  tierReadOnly('mcp:cancel_backtest', 'b3', BASE_PLUGIN, ['executor-service']),
  tierReadOnly('mcp:generate_strategy', 's1', BASE_PLUGIN, ['strategy-generation-service']),
  tierReadOnly('mcp:generate_entry_signal', 's1', BASE_PLUGIN, ['strategy-generation-service']),
  tierReadOnly('mcp:generate_exit_strategy', 's1', BASE_PLUGIN, ['strategy-generation-service']),

  // T2 / mutation with human-origin approval
  tierMutation('mcp:purge_strategy', 's3', BASE_PLUGIN, 'direct-only'),
  tierMutation('mcp:delete_backtest_result', 'b11', BASE_PLUGIN, 'direct-only'),
  tierMutation('mcp:install_research_environment', 're1', BASE_PLUGIN, 'direct-only', ['research-runtime-service']),
  tierMutation('mcp:repair_research_environment', 're1', BASE_PLUGIN, 'direct-only', ['research-runtime-service']),
  tierMutation('mcp:uninstall_research_environment', 're1', BASE_PLUGIN, 'direct-only', ['research-runtime-service']),
  tierMutation('mcp:remove_research_environment_capability', 're1', BASE_PLUGIN, 'direct-only', ['research-runtime-service']),
];

// ---------------------------------------------------------------------------
// Representative IPC channel policies
// ---------------------------------------------------------------------------

export const IPC_CHANNEL_POLICIES: readonly OperationAdmissionPolicy[] = [
  // T0 / public
  publicReadOnly('ipc:research-environment:get-status', 're1'),
  publicReadOnly('ipc:research-environment:get-job', 're1'),
  publicReadOnly('ipc:backtest-chain:list', 'b13'),
  publicReadOnly('ipc:entitlement:getAllEntitlements', 'm9'),
  publicReadOnly('ipc:entitlement:checkPluginAdmission', 'm9'),

  // T1 / tier-gated
  tierReadOnly('ipc:v3:run-backtest', 'b1', BASE_PLUGIN),
  tierReadOnly('ipc:v3:generate-strategy', 's1', BASE_PLUGIN),
  tierReadOnly('ipc:v3:cancel-backtest', 'b3', BASE_PLUGIN),
];

// ---------------------------------------------------------------------------
// Representative Service API route policies
// ---------------------------------------------------------------------------

export const SERVICE_API_POLICIES: readonly OperationAdmissionPolicy[] = [
  publicReadOnly('api:research-environment-status', 're1'),
  publicReadOnly('api:strategy-list', 's2'),
  publicReadOnly('api:backtest-list', 'b13'),

  tierReadOnly('api:strategy-generate', 's1', BASE_PLUGIN),
  tierReadOnly('api:backtest-run', 'b1', BASE_PLUGIN),
];

// ---------------------------------------------------------------------------
// TICKET_1368: Sigma marketplace operation policies
// ---------------------------------------------------------------------------

export const SIGMA_MARKETPLACE_POLICIES: readonly OperationAdmissionPolicy[] = [
  tierReadOnly(
    SIGMA_OPERATION_IDS.ELIGIBILITY,
    'm4',
    SIGMA_PRESENTATION_PLUGIN_ID,
    ['marketplace-service'],
  ),
  tierMutation(
    SIGMA_OPERATION_IDS.INSTALL,
    'm4',
    SIGMA_PRESENTATION_PLUGIN_ID,
    'direct-only',
    ['marketplace-service'],
  ),
  tierMutation(
    SIGMA_OPERATION_IDS.UPDATE,
    'm4',
    SIGMA_PRESENTATION_PLUGIN_ID,
    'direct-only',
    ['marketplace-service'],
  ),
];

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export const REPRESENTATIVE_POLICIES: readonly OperationAdmissionPolicy[] = [
  ...MCP_TOOL_POLICIES,
  ...IPC_CHANNEL_POLICIES,
  ...SERVICE_API_POLICIES,
  ...SIGMA_MARKETPLACE_POLICIES,
];
