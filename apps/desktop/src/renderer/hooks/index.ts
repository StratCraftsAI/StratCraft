/**
 * Hooks exports
 *
 * TICKET_054: Removed usePluginAuth (client-side auth is insecure)
 */

// V1 Python API hooks (DEPRECATED - use V3 useExecutor hooks instead)
/** @deprecated TICKET_133: V1 Python API hooks, use V3 useExecutor hooks */
export {
  useStrategies,
  useStrategy,
  useSaveStrategy,
  useDeleteStrategy,
  useRunBacktest,
  useBacktestResult,
  useHealthCheck,
} from './useApi';

export { useWebSocket } from './useWebSocket';
/** @deprecated TICKET_133: V1 SSE hooks, use useExecutor for V3 */
export { useSSE, useBacktestProgress } from './useSSE';

// TICKET_066: Service Entitlements
export {
  usePluginEntitlements,
  useAllEntitlements,
  useToggleService,
  useIsServiceEnabled,
  useEntitlementChanges,
  useServicesByCategory,
} from './useEntitlement';
export type {
  ServiceEntitlementState,
  PluginEntitlementState,
} from './useEntitlement';

// TICKET_066_1: Authentication
export {
  useAuth,
  useAuthUser,
  useIsAuthenticated,
  useAuthPlan,
  useAuthState,
  useHasPlan,
  useUserTier,
} from './useAuth';
export type { AuthUser, AuthState, AuthPlan } from './useAuth';

// TICKET_429: Auth Gate for Backend Operations
export { useAuthGate } from './useAuthGate';

// TICKET_096: Message Utils
export { useMessage } from './useMessage';

// TICKET_117_2: File Sharing Hub
export { useHubFile, useHubFiles } from './use-hub-file';

// TICKET_133: V3 Executor Architecture
export {
  useExecutor,
  useExecutorResult,
  useStrategiesV3,
  useSaveStrategyV3,
  useLoadStrategyV3,
  useGenerateStrategy,
} from './useExecutor';
export type {
  ExecutorConfig,
  ExecutorMetrics,
  ExecutorTrade,
  EquityPoint,
  ExecutorResult,
  ExecutorProgress,
  ExecutorStatus,
  ExecutorState,
  StrategyInfo,
} from './useExecutor';

// TICKET_176: Checkpoint Resume
export {
  useCheckpoint,
  useCheckpointList,
  useBacktestResume,
} from './useCheckpoint';
export type {
  CheckpointInfo,
  IntermediateResults,
  DataValidationStatus,
  CheckpointSummary,
  UseCheckpointResult,
  UseCheckpointListResult,
  ResumeState,
  ResumeProgress,
  UseBacktestResumeResult,
  DisplayResults,
} from './useCheckpoint';

// TICKET_300: Centralized Breadcrumb Management
export { useBreadcrumbs } from './useBreadcrumbs';
export type { BreadcrumbSegment } from './useBreadcrumbs';

// TICKET_519: Credit Status
export { useCreditStatus } from './useCreditStatus';

// TICKET_631 / TICKET_635: Distribution Detection
export { useDistribution, useIsPublicRelease } from './useDistribution';

// TICKET_892_4: Server-authoritative plugin ownership
export { usePluginOwnership, useEntitledPlugins } from './usePluginOwnership';
