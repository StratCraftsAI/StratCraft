/**
 * @StratCraft/research-environment -- TICKET_1335 L3.
 *
 * The durable owner of research-environment job truth: one job store, one
 * long-held advisory claim, one crash reconciler. Electron main, the Service
 * API, and the standalone MCP server all consume this package rather than
 * keeping a private in-memory registry, which is what allowed two installers to
 * run concurrently against a single `.pixi` directory (TICKET_1335 D4).
 *
 * The schema this package reads and writes is created by migration 140 in
 * `@StratCraft/db-migrations`; it is not re-declared here.
 */

export {
  ResearchEnvironmentJobRepository,
  ResearchEnvironmentJobError,
  RESEARCH_ENV_JOB_ERROR_CODES,
  type ResearchEnvironmentJobErrorCode,
  type ResearchEnvironmentJobRepositoryDeps,
  type PersistedResearchEnvironmentJob,
  type ResearchEnvironmentDb,
  type ResearchEnvironmentStatement,
} from './job-repository';

export {
  ResearchEnvironmentHeartbeat,
  type HeartbeatSchedulerDeps,
} from './heartbeat';

export {
  RESEARCH_ENV_HEARTBEAT_INTERVAL_MS,
  RESEARCH_ENV_HEARTBEAT_STALE_AFTER_MS,
  RESEARCH_ENV_PERSISTED_LOG_LINES,
  PIXI_INSTALL_ARGS,
  PIXI_INSTALL_TIMEOUT_MS,
  PIXI_LOCK_FILE_NAME,
  PIXI_MANIFEST_FILE_NAME,
  PIXI_REPAIR_ARGS,
  RESEARCH_ENV_VERIFY_TIMEOUT_MS,
} from './constants';

// -----------------------------------------------------------------------------
// L4: the shared lifecycle owner
// -----------------------------------------------------------------------------

/**
 * `ResearchEnvironmentService` is the single owner every surface adapts over
 * (TICKET_1335 D2). Electron IPC, the Service API, and MCP must call it rather
 * than spawning pixi, resolving an interpreter, or deciding readiness
 * themselves -- doing any of those in a surface is the root cause the ticket
 * closes.
 */
export {
  ResearchEnvironmentService,
  ResearchEnvironmentServiceError,
  RESEARCH_ENV_SERVICE_ERROR_CODES,
  type LocalMutationApproval,
  type ResearchEnvironmentServiceDeps,
  type ResearchEnvironmentServiceErrorCode,
} from './research-environment-service';

export {
  isSupportedPlatform,
  readEnvironmentIdentity,
  readLockedVersions,
  parseLockedVersions,
  normalizeDistributionName,
  resolveEnvironmentPaths,
  resolveProjectionEnvironmentPaths,
  resolveRepositoryRoot,
  resolvePixiExecutable,
  hashFile,
  CAPABILITY_DISTRIBUTION_NAMES,
  SUPPORTED_PLATFORM_TARGETS,
  ResearchEnvironmentPathError,
  RESEARCH_ENV_PATH_ERROR_CODES,
  type EnvironmentHost,
  type EnvironmentIdentity,
  type EnvironmentPathsDeps,
  type ResearchEnvironmentPathErrorCode,
  type ResearchEnvironmentPaths,
} from './environment-paths';

export {
  buildInstallArgs,
  buildRepairArgs,
  buildVersionArgs,
  looksLikeLockDrift,
  looksLikeNetworkFailure,
  runPixiInstall,
  runPixiRepair,
  runPixiUninstall,
  runPixiVersion,
  runReadinessProbe,
  type PixiCommandRequest,
  type ProcessResult,
  type ProcessRunner,
  type ProcessSpawnRequest,
} from './process-runner';

export {
  RESEARCH_ENV_PROBE_PROGRESS_PREFIX,
  parsePixiProgressLine,
  parseProbeProgressLine,
  type ResearchEnvironmentWorkloadUpdate,
} from './workload-progress';

export {
  parseProbeOutput,
  projectProbeResults,
  stageForProbeCause,
  uniformCapabilities,
  ResearchEnvironmentProbeError,
  RESEARCH_ENV_PROBE_ERROR_CODES,
  type CapabilityProjection,
  type ParsedProbeOutput,
  type ResearchEnvironmentProbeErrorCode,
} from './probe-result';

export {
  PROBE_PROGRAM,
  PROBE_RESULT_BEGIN,
  PROBE_RESULT_END,
} from './probe-program';

/**
 * Real Node bindings, exported from a separate module so importing the service
 * does not bind `node:child_process`.
 */
export {
  createNodeEnvironmentHost,
  createNodeProcessRunner,
} from './node-host';
