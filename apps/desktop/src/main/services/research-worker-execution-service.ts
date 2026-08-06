/**
 * Public research-worker execution service (TICKET_1304_5D step 4).
 *
 * Applies package-supplied execution policy through a host-owned entitlement
 * checker, builds the authoritative resource plan, materializes bounded data
 * references, and delegates to ResearchWorkerSupervisor.
 */

import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import {
  RESEARCH_WORKER_CAPABILITY_IDS,
  RESEARCH_WORKER_CONTRACT_SCHEMA_VERSION,
  RESEARCH_WORKER_PROTOCOL_VERSION,
  isResearchWorkerPythonEntryCommand,
  type ResearchWorkerResourcePlan,
  type ResearchWorkerExecuteRequest,
  type ResearchWorkerHostDiscovery,
  type ResearchWorkerExecutionPolicy,
} from '@StratCraft/types';
import { createLogger } from '../utils/logger';
import {
  RESEARCH_WORKER_PUBLISHED_DIRECTORY,
  RESEARCH_WORKER_STAGING_DIRECTORY,
} from '../constants/research-worker';
import {
  getResearchWorkerSupervisor,
  type ResearchWorkerExecutionContext,
  type ResearchWorkerSupervisor,
  type ResearchWorkerTerminalMessage,
} from './research-worker-supervisor';
import {
  getComputeEnvironment,
  type ComputeEnvironment,
  type ComputeEnvironmentState,
} from './compute-environment';
import { getResearchEnvironmentService } from './research-environment-service-host';

const log = createLogger('RESEARCH-WORKER-EXECUTION');

type CapabilityId = (typeof RESEARCH_WORKER_CAPABILITY_IDS)[number];

export interface ResearchExecutionRequest {
  readonly capabilityId: CapabilityId;
  readonly operationContractVersion: string;
  readonly requestPayload: Record<string, unknown>;
  readonly dataInputs?: readonly DataInput[];
}

export interface DataInput {
  readonly referenceId: string;
  /** Host-local path to data already materialized with the declared storage pushdown decision. */
  readonly sourcePath: string;
  readonly format: 'arrow-ipc' | 'parquet';
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly requestedWindow: { startUtc: string; endUtc: string };
  readonly materializedWindow: { startUtc: string; endUtc: string } | null;
  readonly windowPushdownDecisionId: string;
  readonly rowCount: number;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface AdapterProgressEvent {
  readonly requestId: string;
  readonly phase: string;
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly statusText: string;
}

export type ProgressCallback = (event: AdapterProgressEvent) => void;

export interface HostAdapterDependencies {
  readonly supervisor: ResearchWorkerSupervisor;
  readonly computeEnvironment: ComputeEnvironment;
  readonly checkEntitlement: (pluginId: string) => Promise<{ entitled: boolean }>;
  readonly newId: () => string;
  readonly exchangeBaseDir: () => string;
  readonly resolveResearchPythonExecutable: () => Promise<string | null>;
}

export interface ResearchWorkerExecutionServiceOptions {
  readonly policy: ResearchWorkerExecutionPolicy;
  readonly dependencies?: Partial<HostAdapterDependencies>;
  /** Retain verified publication paths until a managed host store consumes them. */
  readonly retainPublishedArtifactPaths?: boolean;
}

function defaultExchangeBaseDir(): string {
  return path.join(app.getPath('userData'), 'research-exchange');
}

export class ResearchWorkerExecutionService {
  private readonly deps: HostAdapterDependencies;
  private readonly policy: ResearchWorkerExecutionPolicy;
  private readonly retainPublishedArtifactPaths: boolean;
  private readonly activeRequests = new Map<string, { requestId: string; cancel: () => Promise<boolean> }>();
  private readonly publishedArtifactPaths = new Map<string, string>();

  constructor(options: ResearchWorkerExecutionServiceOptions) {
    const deps = options.dependencies;
    this.policy = options.policy;
    this.retainPublishedArtifactPaths = options.retainPublishedArtifactPaths === true;
    this.deps = {
      supervisor: deps?.supervisor ?? getResearchWorkerSupervisor(),
      computeEnvironment: deps?.computeEnvironment ?? getComputeEnvironment(),
      checkEntitlement: requiredEntitlementChecker(deps?.checkEntitlement),
      newId: deps?.newId ?? randomUUID,
      exchangeBaseDir: deps?.exchangeBaseDir ?? defaultExchangeBaseDir,
      resolveResearchPythonExecutable:
        deps?.resolveResearchPythonExecutable ?? resolveApprovedResearchPythonExecutable,
    };
  }

  async discover(): Promise<ResearchWorkerHostDiscovery> {
    return this.deps.supervisor.discover();
  }

  async execute(
    request: ResearchExecutionRequest,
    onProgress?: ProgressCallback,
  ): Promise<ResearchWorkerTerminalMessage> {
    const entitlement = await this.deps.checkEntitlement(this.policy.entitlementId);
    if (!entitlement.entitled) {
      throw new ResearchWorkerEntitlementError(
        this.policy.entitlementError.code,
        this.policy.entitlementError.message,
        this.policy.entitlementError.remediation,
      );
    }

    const requestId = this.deps.newId();
    const decisionId = this.deps.newId();
    const correlationId = this.deps.newId();

    const exchangeRoot = await this.createExchangeRoot(requestId);
    const dataReferences = await this.materializeDataInputs(
      request.dataInputs ?? [],
      exchangeRoot,
    );
    const resourcePlan = await this.buildResourcePlan(decisionId);
    const requestPayload = request.capabilityId === 'research.lstm-training'
      ? {
          ...request.requestPayload,
          resourcePlanDecisionId: decisionId,
        }
      : request.requestPayload;
    // TICKET_1304_16 stream B: the interpreter follows the OPERATION, not the
    // capability. Keying on `research.discovery` alone was correct while the
    // discovery adapter was the only Python spawn in the binary, but P2 put
    // three more entry points behind other capabilities -- notably
    // `research.scoring/score-one-signal`, which the scoreboard refresh runs.
    // Under the capability rule the worker is handed no interpreter for those
    // and `resolveApprovedInterpreter()` refuses every one of them, so a
    // routable command fails for a reason the caller cannot act on.
    const needsInterpreter =
      request.capabilityId === 'research.discovery'
      || isResearchWorkerPythonEntryCommand(
        request.capabilityId,
        (request.requestPayload as { operation?: unknown }).operation,
      );
    const pythonExecutable = needsInterpreter
      ? await this.deps.resolveResearchPythonExecutable()
      : null;

    const executeRequest: ResearchWorkerExecuteRequest = {
      messageType: 'execute',
      protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
      correlationId,
      sequence: 0,
      sentAt: new Date().toISOString(),
      requestId,
      decisionId,
      capabilityId: request.capabilityId,
      operationContractVersion: request.operationContractVersion,
      dataReferences,
      resourcePlan,
      requestPayload,
    };

    const context: ResearchWorkerExecutionContext = {
      exchangeRoot,
      ...(pythonExecutable ? { pythonExecutable } : {}),
      publishArtifact: (artifact, root, cancellationSignal) =>
        publishResearchArtifactAtomically(
          artifact,
          root,
          this.deps.newId(),
          cancellationSignal,
        ),
      onProgress: onProgress
        ? (msg) => {
            onProgress({
              requestId,
              phase: msg.phase,
              completedUnits: msg.completedUnits,
              totalUnits: msg.totalUnits,
              statusText: msg.statusText,
            });
          }
        : undefined,
    };

    const cancelFn = async () => this.deps.supervisor.cancel(requestId);
    this.activeRequests.set(requestId, { requestId, cancel: cancelFn });

    try {
      const terminal = await this.deps.supervisor.execute(executeRequest, context);
      if (this.retainPublishedArtifactPaths && terminal.messageType === 'result') {
        for (const artifact of terminal.artifacts) {
          if (
            artifact.publicationState === 'published'
            && typeof artifact.relativePath === 'string'
          ) {
            const root = path.resolve(exchangeRoot);
            const artifactPath = path.resolve(root, artifact.relativePath);
            if (artifactPath.startsWith(`${root}${path.sep}`)) {
              this.publishedArtifactPaths.set(
                `${artifact.artifactId}:${artifact.sha256}`,
                artifactPath,
              );
            }
          }
        }
      }
      return terminal;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Transfers one verified publication path to a host-owned persistence layer.
   * The token key includes the content hash so an artifact ID cannot be reused
   * to substitute different bytes between publication and persistence.
   */
  consumePublishedArtifactPath(artifactId: string, sha256: string): string | null {
    const key = `${artifactId}:${sha256}`;
    const artifactPath = this.publishedArtifactPaths.get(key) ?? null;
    if (artifactPath !== null) this.publishedArtifactPaths.delete(key);
    return artifactPath;
  }

  async cancel(requestId: string): Promise<boolean> {
    const active = this.activeRequests.get(requestId);
    if (!active) return false;
    return active.cancel();
  }

  async cancelAll(): Promise<void> {
    await Promise.all(
      [...this.activeRequests.values()].map((r) => r.cancel()),
    );
  }

  getActiveRequestIds(): readonly string[] {
    return [...this.activeRequests.keys()];
  }

  /**
   * TICKET_1304_16 P1: admits a run against the enforced CPU/memory plan and
   * returns the decision the package forwards to the worker. The package
   * contract has always required this (`requireContext`,
   * `executeLstmTraining`), but no host provided it -- only the test doubles
   * did, so every real LSTM request would have been rejected by
   * `requireContext` before reaching the worker.
   */
  async requestResourcePlan(): Promise<ResearchWorkerResourcePlan> {
    return this.buildResourcePlan(this.deps.newId());
  }

  private async buildResourcePlan(
    decisionId: string,
  ): Promise<ResearchWorkerResourcePlan> {
    const env = this.deps.computeEnvironment.quickProbe();
    return buildResourcePlanFromEnvironment(decisionId, env);
  }

  private async createExchangeRoot(requestId: string): Promise<string> {
    const exchangeRoot = path.join(
      this.deps.exchangeBaseDir(),
      requestId,
    );
    await fs.mkdir(exchangeRoot, { recursive: true });
    return exchangeRoot;
  }

  private async materializeDataInputs(
    inputs: readonly DataInput[],
    exchangeRoot: string,
  ): Promise<ResearchWorkerExecuteRequest['dataReferences']> {
    const dataDirectory = path.join(exchangeRoot, 'data');
    await fs.mkdir(dataDirectory, { recursive: true });
    return Promise.all(inputs.map(async (input) => {
      const extension = input.format === 'parquet' ? '.parquet' : '.arrow';
      const fileName = `${encodeURIComponent(input.referenceId)}${extension}`;
      const relativePath = `data/${fileName}`;
      const destination = path.join(dataDirectory, fileName);
      if (input.rowCount > 0) {
        const sourceBytes = await fs.readFile(input.sourcePath);
        if (
          sourceBytes.byteLength !== input.byteCount
          || createHash('sha256').update(sourceBytes).digest('hex') !== input.sha256
        ) {
          throw new Error(
            `Bounded data input '${input.referenceId}' does not match its storage decision.`,
          );
        }
        await fs.copyFile(input.sourcePath, destination);
      }
      return {
        referenceId: input.referenceId,
        relativePath,
        format: input.format,
        schemaId: input.schemaId,
        schemaVersion: input.schemaVersion,
        requestedWindow: input.requestedWindow,
        materializedWindow: input.materializedWindow,
        windowPushdownDecisionId: input.windowPushdownDecisionId,
        rowCount: input.rowCount,
        byteCount: input.byteCount,
        sha256: input.sha256,
      };
    }));
  }
}

async function resolveApprovedResearchPythonExecutable(): Promise<string | null> {
  const environment = getResearchEnvironmentService();
  if (environment === null) return null;
  const status = await environment.getStatus();
  return status.state === 'ready' ? (status.interpreterPath ?? null) : null;
}

export async function publishResearchArtifactAtomically(
  artifact: Parameters<ResearchWorkerExecutionContext['publishArtifact']>[0],
  exchangeRoot: string,
  publicationTransactionId: string,
  cancellationSignal: AbortSignal,
): Promise<Awaited<ReturnType<ResearchWorkerExecutionContext['publishArtifact']>>> {
  if (cancellationSignal.aborted) {
    throw new Error('Artifact publication cancelled before the storage transaction started.');
  }
  const root = path.resolve(exchangeRoot);
  const stagedPath = path.resolve(root, artifact.relativePath);
  const stagingRoot = path.join(root, RESEARCH_WORKER_STAGING_DIRECTORY);
  if (!stagedPath.startsWith(`${stagingRoot}${path.sep}`)) {
    throw new Error('Worker Artifact is not inside the request staging directory.');
  }
  const [realStagingRoot, realStagedPath, stagedStat] = await Promise.all([
    fs.realpath(stagingRoot),
    fs.realpath(stagedPath),
    fs.lstat(stagedPath),
  ]);
  if (
    !realStagedPath.startsWith(`${realStagingRoot}${path.sep}`)
    || !stagedStat.isFile()
    || stagedStat.isSymbolicLink()
  ) {
    throw new Error('Worker Artifact must be a regular file inside request staging.');
  }
  const bytes = await fs.readFile(stagedPath);
  if (bytes.byteLength !== artifact.byteCount) {
    throw new Error(`Artifact '${artifact.artifactId}' byte count does not match staging.`);
  }
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== artifact.sha256) {
    throw new Error(`Artifact '${artifact.artifactId}' hash does not match staging.`);
  }
  const extension = path.extname(artifact.relativePath) || '.json';
  const publishedDirectory = path.join(
    root,
    RESEARCH_WORKER_PUBLISHED_DIRECTORY,
    publicationTransactionId,
  );
  await fs.mkdir(path.dirname(publishedDirectory), { recursive: true });
  await fs.mkdir(publishedDirectory, { recursive: false });
  const publishedPath = path.join(publishedDirectory, `${artifact.artifactId}${extension}`);
  if (cancellationSignal.aborted) {
    await fs.rmdir(publishedDirectory);
    throw new Error('Artifact publication cancelled before the atomic storage transaction.');
  }
  await fs.rename(stagedPath, publishedPath);
  if (cancellationSignal.aborted) {
    await fs.rename(publishedPath, stagedPath);
    await fs.rmdir(publishedDirectory);
    throw new Error('Artifact publication cancelled during the atomic storage transaction.');
  }
  return {
    ...artifact,
    relativePath: path.relative(root, publishedPath).split(path.sep).join('/'),
    publicationState: 'published' as const,
    publicationTransactionId,
  };
}

export function buildResourcePlanFromEnvironment(
  decisionId: string,
  env: ComputeEnvironmentState,
): ResearchWorkerResourcePlan {
  const hostCpuCores = env.totalCores;
  const hostMemoryBytes = env.memTotalMB * 1_048_576;
  const availableMemoryBytes = env.memAvailableMB * 1_048_576;

  const effectiveCpuCores = Math.max(1, hostCpuCores - 2);
  const effectiveMemoryBytes = Math.min(
    availableMemoryBytes,
    Math.floor(hostMemoryBytes * 0.75),
  );

  const processCount = 1;
  const threadsPerProcess = Math.max(1, Math.floor(effectiveCpuCores));
  const totalThreadBudget = threadsPerProcess;
  const measuredPeakBytesPerProcess = Math.floor(effectiveMemoryBytes * 0.8);
  const memorySafetyMarginBytes = Math.floor(effectiveMemoryBytes * 0.1);
  const admittedPeakMemoryBytes =
    processCount * measuredPeakBytesPerProcess + memorySafetyMarginBytes;

  const pauseAboveMemoryBytes = Math.floor(effectiveMemoryBytes * 0.9);
  const resumeBelowMemoryBytes = Math.floor(effectiveMemoryBytes * 0.7);

  const enforcementKind = resolveEnforcementKind();

  return {
    schemaVersion: RESEARCH_WORKER_CONTRACT_SCHEMA_VERSION,
    decisionId,
    effectiveCapacity: {
      hostAvailableCpuCores: hostCpuCores,
      effectiveCpuCores,
      hostAvailableMemoryBytes: hostMemoryBytes,
      effectiveMemoryBytes,
      reservedCpuCores: hostCpuCores - effectiveCpuCores,
      reservedMemoryBytes: hostMemoryBytes - effectiveMemoryBytes,
      cpuLimitSource: enforcementKind === 'systemd-scope' ? 'cgroup-v2' : 'host',
      memoryLimitSource: enforcementKind === 'systemd-scope' ? 'cgroup-v2' : 'host',
    },
    workload: {
      processCount,
      threadsPerProcess,
      totalThreadBudget,
      measuredPeakBytesPerProcess,
      memorySafetyMarginBytes,
      admittedPeakMemoryBytes,
      bindingConstraint: effectiveMemoryBytes < measuredPeakBytesPerProcess * 2
        ? 'memory'
        : 'cpu',
    },
    backpressure: {
      enabled: true as const,
      pauseAboveMemoryBytes,
      resumeBelowMemoryBytes,
    },
    enforcement: {
      decisionId,
      kind: enforcementKind,
      cpuLimitCores: effectiveCpuCores,
      memoryLimitBytes: effectiveMemoryBytes,
    },
  };
}

function resolveEnforcementKind(): ResearchWorkerResourcePlan['enforcement']['kind'] {
  if (process.platform === 'linux') return 'systemd-scope';
  if (process.platform === 'win32') return 'job-object';
  return 'process-limits';
}

export class ResearchWorkerEntitlementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly remediation: string,
  ) {
    super(message);
    this.name = 'ResearchWorkerEntitlementError';
  }
}

function requiredEntitlementChecker(
  checker: HostAdapterDependencies['checkEntitlement'] | undefined,
): HostAdapterDependencies['checkEntitlement'] {
  if (!checker) {
    throw new Error(
      'Research-worker execution requires a host-owned entitlement checker.',
    );
  }
  return checker;
}
