/**
 * @StratCraft/operation-admission -- Centralized operation entitlement admission.
 *
 * TICKET_1345: policy registry, admission authority, attestation lifecycle,
 * and surface-neutral types. Surface adapters (Electron, Guide MCP, Service API)
 * consume this package; they do not resolve tiers or compare levels themselves.
 */

export {
  OperationPolicyRegistry,
  FrozenPolicyRegistry,
} from './policy-registry';

export {
  OperationAdmissionAuthority,
  type EntitlementEvidenceRepository,
  type OperationAdmissionRequest,
  type OperationAdmissionResult,
  type AttestationActivationResult,
  type AttestationConsumptionResult,
  type DispatchBinding,
  type SanitizedOperationOutcome,
  type OperationLifecycleRecord,
  type MarketplaceAdmissionResult,
  type MarketplaceActivationResult,
  type MarketplaceConsumptionResult,
} from './admission-authority';

export {
  REPRESENTATIVE_POLICIES,
  MCP_TOOL_POLICIES,
  IPC_CHANNEL_POLICIES,
  SERVICE_API_POLICIES,
  SIGMA_MARKETPLACE_POLICIES,
} from './seeds/index';
