/**
 * Commercial research-worker process supervisor (TICKET_1304_5C).
 *
 * The supervisor consumes only the public worker contract. Commercial
 * control-plane adapters call this service; they do not spawn or import the
 * worker directly.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES,
  RESEARCH_WORKER_PROTOCOL_VERSION,
  parseResearchWorkerControlMessage,
  researchWorkerExecuteRequestSchema,
  type ResearchWorkerControlMessage,
  type ResearchWorkerExecuteRequest,
  type ResearchWorkerHostDiscovery,
} from '@StratCraft/types';
import {
  RESEARCH_WORKER_CANCELLATION_GRACE_MS,
  RESEARCH_WORKER_MAX_STDERR_BYTES,
  RESEARCH_WORKER_NEGOTIATION_TIMEOUT_MS,
  RESEARCH_WORKER_SYSTEMD_RUN_COMMAND,
  RESEARCH_WORKER_SYSTEMD_UNIT_PREFIX,
} from '../constants/research-worker';
import { createLogger } from '../utils/logger';
import {
  getResearchWorkerPackageVerifier,
  ResearchWorkerPackageError,
  type ResearchWorkerPackageVerifier,
  type VerifiedResearchWorkerPackage,
} from './research-worker-package';

const log = createLogger('RESEARCH-WORKER-SUPERVISOR');

type WorkerMessage = ResearchWorkerControlMessage;
type WorkerArtifactMessage = Extract<WorkerMessage, { messageType: 'artifact' }>;
type WorkerResultMessage = Extract<WorkerMessage, { messageType: 'result' }>;
type WorkerErrorMessage = Extract<WorkerMessage, { messageType: 'error' }>;
type WorkerProgressMessage = Extract<WorkerMessage, { messageType: 'progress' }>;
type WorkerCancelledMessage = Extract<WorkerMessage, { messageType: 'cancelled' }>;
type PublishedArtifact = WorkerResultMessage['artifacts'][number];

export interface ResearchWorkerExecutionContext {
  readonly exchangeRoot: string;
  readonly pythonExecutable?: string;
  readonly publishArtifact: (
    artifact: WorkerArtifactMessage['artifact'],
    exchangeRoot: string,
    cancellationSignal: AbortSignal,
  ) => Promise<PublishedArtifact>;
  readonly onProgress?: (message: WorkerProgressMessage) => void;
  readonly onArtifactPublished?: (artifact: PublishedArtifact) => void;
}

export type ResearchWorkerTerminalMessage =
  | WorkerResultMessage
  | WorkerErrorMessage
  | WorkerCancelledMessage;

interface SpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: ['pipe', 'pipe', 'pipe'];
  readonly windowsHide: true;
}

interface WorkerLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

export interface ResearchWorkerSupervisorDependencies {
  readonly packageVerifier: Pick<
    ResearchWorkerPackageVerifier,
    'discover' | 'verifyActivePackage'
  >;
  readonly spawnWorker: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcessWithoutNullStreams;
  readonly newId: () => string;
  readonly now: () => string;
  readonly negotiationTimeoutMs: number;
  readonly cancellationGraceMs: number;
}

interface ActiveExecution {
  readonly request: ResearchWorkerExecuteRequest;
  readonly child: ChildProcessWithoutNullStreams;
  readonly correlationId: string;
  readonly context: ResearchWorkerExecutionContext;
  readonly publishedArtifacts: Map<string, PublishedArtifact>;
  nextHostSequence: number;
  nextWorkerSequence: number;
  accepted: boolean;
  cancellationRequested: boolean;
  readonly cancellationController: AbortController;
  terminal: boolean;
  childClosed: boolean;
  killRequested: boolean;
  stderrBytes: number;
  stdoutBuffer: Buffer;
  processing: Promise<void>;
  negotiationTimer: ReturnType<typeof setTimeout> | null;
  cancellationTimer: ReturnType<typeof setTimeout> | null;
  resolve: (message: ResearchWorkerTerminalMessage) => void;
}

function actionableError(
  request: ResearchWorkerExecuteRequest,
  code: WorkerErrorMessage['code'],
  phase: WorkerErrorMessage['phase'],
  message: string,
  remediation: string,
  retryable = false,
): WorkerErrorMessage {
  return {
    messageType: 'error',
    protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
    correlationId: request.correlationId,
    sequence: Number.MAX_SAFE_INTEGER,
    sentAt: new Date().toISOString(),
    requestId: request.requestId,
    decisionId: request.decisionId,
    code,
    phase,
    message,
    retryable,
    remediation,
  };
}

function assertExchangePath(exchangeRoot: string, relativePath: string): string {
  const root = path.resolve(exchangeRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Artifact path escapes the request exchange root: ${relativePath}`);
  }
  return resolved;
}

async function verifyPublishedArtifact(
  artifact: PublishedArtifact,
  exchangeRoot: string,
): Promise<void> {
  if (artifact.publicationState !== 'published') {
    throw new Error(`Artifact '${artifact.artifactId}' was not atomically published.`);
  }
  const bytes = await fs.readFile(assertExchangePath(exchangeRoot, artifact.relativePath));
  if (bytes.byteLength !== artifact.byteCount) {
    throw new Error(`Artifact '${artifact.artifactId}' byte count does not match storage.`);
  }
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== artifact.sha256) {
    throw new Error(`Artifact '${artifact.artifactId}' hash does not match storage.`);
  }
}

export class ResearchWorkerSupervisor {
  private readonly dependencies: ResearchWorkerSupervisorDependencies;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly startingRequests = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private shuttingDown = false;

  constructor(dependencies: Partial<ResearchWorkerSupervisorDependencies> = {}) {
    this.dependencies = {
      packageVerifier:
        dependencies.packageVerifier ?? getResearchWorkerPackageVerifier(),
      spawnWorker: dependencies.spawnWorker ?? ((executablePath, args, options) =>
        spawn(executablePath, args, options) as ChildProcessWithoutNullStreams),
      newId: dependencies.newId ?? randomUUID,
      now: dependencies.now ?? (() => new Date().toISOString()),
      negotiationTimeoutMs:
        dependencies.negotiationTimeoutMs ?? RESEARCH_WORKER_NEGOTIATION_TIMEOUT_MS,
      cancellationGraceMs:
        dependencies.cancellationGraceMs ?? RESEARCH_WORKER_CANCELLATION_GRACE_MS,
    };
  }

  discover(): Promise<ResearchWorkerHostDiscovery> {
    return this.dependencies.packageVerifier.discover();
  }

  getActiveRequestIds(): readonly string[] {
    return [...this.active.keys()];
  }

  async cancelAll(
    reason: Extract<WorkerMessage, { messageType: 'cancel' }>['reason'],
  ): Promise<void> {
    await Promise.all(this.getActiveRequestIds().map((requestId) =>
      this.cancel(requestId, reason)));
  }

  waitForIdle(): Promise<void> {
    for (const [requestId, execution] of this.active) {
      if (execution.terminal) this.active.delete(requestId);
    }
    if (this.active.size === 0 && this.startingRequests.size === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  async execute(
    requestInput: unknown,
    context: ResearchWorkerExecutionContext,
  ): Promise<ResearchWorkerTerminalMessage> {
    if (this.shuttingDown) {
      throw new Error('Research worker supervisor is shutting down.');
    }
    const request = researchWorkerExecuteRequestSchema.parse(requestInput);
    if (this.active.has(request.requestId) || this.startingRequests.has(request.requestId)) {
      throw new Error(`Research worker request '${request.requestId}' is already active.`);
    }
    this.startingRequests.add(request.requestId);
    try {
      await this.validateExecutionInputs(request, context.exchangeRoot);

      let workerPackage: VerifiedResearchWorkerPackage | null;
      try {
        workerPackage = await this.dependencies.packageVerifier.verifyActivePackage();
      } catch (error) {
        if (error instanceof ResearchWorkerPackageError) {
          this.startingRequests.delete(request.requestId);
          this.resolveIdleWaiters();
          return actionableError(
            request,
            error.code,
            error.code === 'WORKER_PROTOCOL_INCOMPATIBLE' ? 'negotiation' : 'verification',
            error.message,
            error.remediation,
          );
        }
        throw error;
      }
      if (workerPackage === null) {
        this.startingRequests.delete(request.requestId);
        this.resolveIdleWaiters();
        return actionableError(
          request,
          'WORKER_NOT_INSTALLED',
          'discovery',
          'The Quant Lab research worker is not installed.',
          'Install Quant Lab from the StratCraft Marketplace and retry.',
        );
      }
      const terminal = this.launch(workerPackage, request, context);
      this.startingRequests.delete(request.requestId);
      this.resolveIdleWaiters();
      return terminal;
    } catch (error) {
      this.startingRequests.delete(request.requestId);
      this.resolveIdleWaiters();
      throw error;
    }
  }

  async cancel(
    requestId: string,
    reason: Extract<WorkerMessage, { messageType: 'cancel' }>['reason'] = 'user-request',
  ): Promise<boolean> {
    const execution = this.active.get(requestId);
    if (execution === undefined || execution.terminal) return false;
    execution.cancellationRequested = true;
    execution.cancellationController.abort();
    this.send(execution, {
      messageType: 'cancel',
      protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
      correlationId: execution.correlationId,
      sequence: execution.nextHostSequence++,
      sentAt: this.dependencies.now(),
      requestId: execution.request.requestId,
      decisionId: execution.request.decisionId,
      reason,
    });
    if (execution.cancellationTimer === null) {
      execution.cancellationTimer = setTimeout(() => {
        if (execution.terminal) return;
        log.error(
          'Worker did not acknowledge cancellation for request %s; terminating owned child',
          requestId,
        );
        execution.killRequested = true;
        execution.child.kill();
      }, this.dependencies.cancellationGraceMs);
    }
    return true;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.cancelAll('host-shutdown');
    await this.waitForIdle();
  }

  private async validateExecutionInputs(
    request: ResearchWorkerExecuteRequest,
    exchangeRoot: string,
  ): Promise<void> {
    const rootStat = await fs.stat(exchangeRoot);
    if (!rootStat.isDirectory()) {
      throw new Error('Research worker exchange root must be a directory.');
    }
    await Promise.all(request.dataReferences.map(async (reference) => {
      const filePath = assertExchangePath(exchangeRoot, reference.relativePath);
      if (reference.rowCount === 0) return;
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size !== reference.byteCount) {
        throw new Error(
          `Research worker data reference '${reference.referenceId}' does not match storage.`,
        );
      }
      const actualHash = createHash('sha256')
        .update(await fs.readFile(filePath))
        .digest('hex');
      if (actualHash !== reference.sha256) {
        throw new Error(
          `Research worker data reference '${reference.referenceId}' hash does not match storage.`,
        );
      }
    }));
  }

  private launch(
    workerPackage: VerifiedResearchWorkerPackage,
    request: ResearchWorkerExecuteRequest,
    context: ResearchWorkerExecutionContext,
  ): Promise<ResearchWorkerTerminalMessage> {
    const correlationId = this.dependencies.newId();
    const launch = buildResearchWorkerLaunch(
      workerPackage,
      request,
      context.exchangeRoot,
      context.pythonExecutable,
    );
    const child = this.dependencies.spawnWorker(
      launch.command,
      launch.args,
      launch.options,
    );

    return new Promise<ResearchWorkerTerminalMessage>((resolve) => {
      const execution: ActiveExecution = {
        request: { ...request, correlationId },
        child,
        correlationId,
        context,
        publishedArtifacts: new Map(),
        nextHostSequence: 1,
        nextWorkerSequence: 0,
        accepted: false,
        cancellationRequested: false,
        cancellationController: new AbortController(),
        terminal: false,
        childClosed: false,
        killRequested: false,
        stderrBytes: 0,
        stdoutBuffer: Buffer.alloc(0),
        processing: Promise.resolve(),
        negotiationTimer: null,
        cancellationTimer: null,
        resolve,
      };
      this.active.set(request.requestId, execution);
      this.attachProcessHandlers(execution, workerPackage);
      this.send(execution, {
        messageType: 'host-hello',
        protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
        correlationId,
        sequence: 0,
        sentAt: this.dependencies.now(),
        hostProtocol: {
          minimum: RESEARCH_WORKER_PROTOCOL_VERSION,
          current: RESEARCH_WORKER_PROTOCOL_VERSION,
        },
        hostVersion: process.env.npm_package_version ?? '0.1.0',
        expectedPackageId: 'com.stratcraft.quant-lab',
        expectedPackageManifestSha256: workerPackage.manifestSha256,
      });
      execution.negotiationTimer = setTimeout(() => {
        this.failExecution(
          execution,
          actionableError(
            execution.request,
            'WORKER_PROTOCOL_INCOMPATIBLE',
            'negotiation',
            'The research worker did not complete protocol negotiation.',
            'Reinstall a Quant Lab worker version compatible with this StratCraft version.',
          ),
        );
      }, this.dependencies.negotiationTimeoutMs);
    });
  }

  private attachProcessHandlers(
    execution: ActiveExecution,
    workerPackage: VerifiedResearchWorkerPackage,
  ): void {
    execution.child.stdout.on('data', (chunk: Buffer) => {
      if (execution.terminal) return;
      execution.stdoutBuffer = Buffer.concat([execution.stdoutBuffer, chunk]);
      this.drainStdout(execution, workerPackage);
    });
    execution.child.stderr.on('data', (chunk: Buffer) => {
      if (execution.stderrBytes >= RESEARCH_WORKER_MAX_STDERR_BYTES) return;
      const remaining = RESEARCH_WORKER_MAX_STDERR_BYTES - execution.stderrBytes;
      const bounded = chunk.subarray(0, remaining);
      execution.stderrBytes += bounded.byteLength;
      log.warn(
        '[request=%s] %s',
        execution.request.requestId,
        bounded.toString('utf8').trimEnd(),
      );
    });
    execution.child.on('error', (error) => {
      this.failExecution(
        execution,
        actionableError(
          execution.request,
          'WORKER_CRASHED',
          'negotiation',
          `The research worker could not be launched: ${error.message}`,
          'Verify the Quant Lab installation and retry.',
          true,
        ),
      );
    });
    execution.child.on('close', (code, signal) => {
      execution.childClosed = true;
      if (execution.terminal) return;
      void execution.processing.finally(() => {
        if (execution.terminal) return;
        this.failExecution(
          execution,
          actionableError(
            execution.request,
            'WORKER_CRASHED',
            execution.accepted ? 'kernel-execution' : 'negotiation',
            `The research worker exited before a terminal result (code=${code}, signal=${signal}).`,
            'Inspect the correlated desktop diagnostics, then retry the request.',
            true,
          ),
        );
      });
    });
  }

  private drainStdout(
    execution: ActiveExecution,
    workerPackage: VerifiedResearchWorkerPackage,
  ): void {
    while (true) {
      const newline = execution.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) {
        if (execution.stdoutBuffer.byteLength > RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES) {
          this.failInvalidProtocol(execution, 'Control message exceeds the 1 MiB limit.');
        }
        return;
      }
      const line = execution.stdoutBuffer.subarray(0, newline);
      execution.stdoutBuffer = execution.stdoutBuffer.subarray(newline + 1);
      if (line.byteLength === 0) {
        this.failInvalidProtocol(execution, 'Empty control messages are not allowed.');
        return;
      }
      if (line.byteLength > RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES) {
        this.failInvalidProtocol(execution, 'Control message exceeds the 1 MiB limit.');
        return;
      }
      execution.processing = execution.processing
        .then(() => this.processLine(execution, workerPackage, line))
        .catch((error) => {
          this.failInvalidProtocol(
            execution,
            error instanceof Error ? error.message : String(error),
          );
        });
    }
  }

  private async processLine(
    execution: ActiveExecution,
    workerPackage: VerifiedResearchWorkerPackage,
    line: Buffer,
  ): Promise<void> {
    if (execution.terminal) return;
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
    } catch {
      throw new Error('Worker emitted malformed UTF-8 JSON.');
    }
    const message = parseResearchWorkerControlMessage(input);
    if (
      message.correlationId !== execution.correlationId
      || message.sequence !== execution.nextWorkerSequence
    ) {
      throw new Error('Worker correlation ID or sequence is not monotonic.');
    }
    execution.nextWorkerSequence += 1;

    if (execution.nextWorkerSequence === 1) {
      if (
        message.messageType !== 'worker-hello'
        || message.packageManifestSha256 !== workerPackage.manifestSha256
        || message.workerVersion !== workerPackage.manifest.packageVersion
        || JSON.stringify(message.capabilities) !== JSON.stringify(workerPackage.discovery.capabilities)
      ) {
        throw new Error('Worker hello does not match the verified package descriptor.');
      }
      if (execution.negotiationTimer !== null) {
        clearTimeout(execution.negotiationTimer);
        execution.negotiationTimer = null;
      }
      this.send(execution, {
        ...execution.request,
        correlationId: execution.correlationId,
        sequence: execution.nextHostSequence++,
        sentAt: this.dependencies.now(),
      });
      return;
    }

    if ('requestId' in message && message.requestId !== execution.request.requestId) {
      throw new Error('Worker response requestId does not match the active request.');
    }
    if ('decisionId' in message && message.decisionId !== execution.request.decisionId) {
      throw new Error('Worker response decisionId does not match the resource plan.');
    }

    switch (message.messageType) {
      case 'accepted':
        if (execution.accepted) throw new Error('Worker accepted the same request twice.');
        execution.accepted = true;
        return;
      case 'progress':
        if (!execution.accepted) throw new Error('Worker progress arrived before acceptance.');
        execution.context.onProgress?.(message);
        return;
      case 'artifact': {
        if (!execution.accepted || message.artifact.publicationState !== 'staged') {
          throw new Error('Worker Artifact must be staged after request acceptance.');
        }
        if (execution.cancellationRequested) {
          this.failExecution(
            execution,
            actionableError(
              execution.request,
              'WORKER_CANCELLED',
              'publication',
              'Artifact publication was blocked because the request was cancelled.',
              'Start a new discovery request if the result is still required.',
            ),
          );
          return;
        }
        if (execution.publishedArtifacts.has(message.artifact.artifactId)) {
          throw new Error(`Worker emitted duplicate Artifact '${message.artifact.artifactId}'.`);
        }
        let published: PublishedArtifact;
        try {
          published = await execution.context.publishArtifact(
            message.artifact,
            execution.context.exchangeRoot,
            execution.cancellationController.signal,
          );
        } catch (error) {
          this.failExecution(
            execution,
            actionableError(
              execution.request,
              execution.cancellationRequested ? 'WORKER_CANCELLED' : 'WORKER_STORAGE_FAILED',
              'publication',
              error instanceof Error ? error.message : String(error),
              execution.cancellationRequested
                ? 'Start a new discovery request if the result is still required.'
                : 'Check Artifact storage capacity and permissions, then retry.',
              !execution.cancellationRequested,
            ),
          );
          return;
        }
        if (execution.cancellationRequested) {
          this.failExecution(
            execution,
            actionableError(
              execution.request,
              'WORKER_CANCELLED',
              'publication',
              'Artifact publication completed after cancellation was requested.',
              'Inspect the publication transaction and retry the discovery request.',
            ),
          );
          return;
        }
        if (
          published.artifactId !== message.artifact.artifactId
          || published.sha256 !== message.artifact.sha256
        ) {
          throw new Error('Host Artifact publication changed the Artifact identity or content hash.');
        }
        await verifyPublishedArtifact(published, execution.context.exchangeRoot);
        execution.publishedArtifacts.set(published.artifactId, published);
        execution.context.onArtifactPublished?.(published);
        this.send(execution, {
          messageType: 'artifact-published',
          protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
          correlationId: execution.correlationId,
          sequence: execution.nextHostSequence++,
          sentAt: this.dependencies.now(),
          requestId: execution.request.requestId,
          decisionId: execution.request.decisionId,
          artifact: published,
        });
        return;
      }
      case 'result':
        if (!execution.accepted) throw new Error('Worker result arrived before acceptance.');
        if (
          message.artifacts.length !== execution.publishedArtifacts.size
          || message.artifacts.some((artifact) =>
            JSON.stringify(execution.publishedArtifacts.get(artifact.artifactId))
              !== JSON.stringify(artifact))
        ) {
          throw new Error('Worker result does not match host-published Artifacts.');
        }
        this.finishExecution(execution, message);
        return;
      case 'cancelled':
        this.finishExecution(execution, message);
        return;
      case 'error':
        this.finishExecution(execution, message);
        return;
      default:
        throw new Error(`Unexpected worker message '${message.messageType}'.`);
    }
  }

  private send(execution: ActiveExecution, message: WorkerMessage): void {
    if (execution.terminal) return;
    const encoded = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
    if (encoded.byteLength - 1 > RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES) {
      throw new Error('Host control message exceeds the 1 MiB limit.');
    }
    execution.child.stdin.write(encoded);
  }

  private failInvalidProtocol(execution: ActiveExecution, detail: string): void {
    this.failExecution(
      execution,
      actionableError(
        execution.request,
        'WORKER_REQUEST_INVALID',
        execution.accepted ? 'kernel-execution' : 'negotiation',
        `The research worker violated the control protocol: ${detail}`,
        'Reinstall a compatible Quant Lab worker and retry.',
      ),
    );
  }

  private failExecution(
    execution: ActiveExecution,
    error: WorkerErrorMessage,
  ): void {
    if (execution.terminal) return;
    this.finishExecution(execution, error);
  }

  private finishExecution(
    execution: ActiveExecution,
    message: ResearchWorkerTerminalMessage,
  ): void {
    if (execution.terminal) return;
    execution.terminal = true;
    if (execution.negotiationTimer !== null) clearTimeout(execution.negotiationTimer);
    if (execution.cancellationTimer !== null) clearTimeout(execution.cancellationTimer);
    this.active.delete(execution.request.requestId);
    if (!execution.childClosed && !execution.killRequested) {
      execution.killRequested = true;
      execution.child.kill();
    }
    execution.resolve(message);
    this.resolveIdleWaiters();
  }

  private resolveIdleWaiters(): void {
    if (this.active.size !== 0 || this.startingRequests.size !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

/**
 * TICKET_1304_16 section 22: the loader-path variable for each release
 * platform. The worker links libraries it ships itself (libtorch), which do not
 * resolve from the default loader path, so a packaged worker cannot start at
 * all unless the host puts its library directories here -- measured in section
 * 20.1 against the real binary.
 *
 * Windows resolves bundled DLLs through `PATH`; macOS and Linux use their
 * respective loader variables. All four release platforms of TICKET_1304_17 are
 * covered.
 */
const RESEARCH_WORKER_LIBRARY_PATH_VARIABLE: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  linux: 'LD_LIBRARY_PATH',
  darwin: 'DYLD_LIBRARY_PATH',
  win32: 'PATH',
};

export function buildResearchWorkerLaunch(
  workerPackage: Pick<
    VerifiedResearchWorkerPackage,
    'packageRoot' | 'executablePath' | 'manifestSha256' | 'libraryPaths' | 'algorithmRootPath'
  >,
  request: ResearchWorkerExecuteRequest,
  exchangeRoot: string,
  pythonExecutable?: string,
  platform: NodeJS.Platform = process.platform,
): WorkerLaunch {
  // The worker's own library directories must PRECEDE any inherited value so a
  // stale system copy of a bundled library cannot win over the signed one.
  const libraryPathVariable = RESEARCH_WORKER_LIBRARY_PATH_VARIABLE[platform];
  const libraryPaths = workerPackage.libraryPaths ?? [];
  const libraryPathEntry = libraryPathVariable === undefined || libraryPaths.length === 0
    ? {}
    : {
      [libraryPathVariable]: [
        ...libraryPaths,
        ...(process.env[libraryPathVariable] === undefined
          ? []
          : [process.env[libraryPathVariable]]),
      ].join(path.delimiter),
    };

  const enforcedEnvironment = {
    ...libraryPathEntry,
    // Every Python entry command refuses to run without this
    // (`python_entry_commands.cpp:109`). It is exported only when the package
    // declares an algorithm root, so a C++-only package is unaffected.
    ...(workerPackage.algorithmRootPath === undefined
      ? {}
      : { STRATCRAFT_RESEARCH_ALGORITHM_ROOT: workerPackage.algorithmRootPath }),
    STRATCRAFT_RESEARCH_EXCHANGE_ROOT: exchangeRoot,
    STRATCRAFT_RESEARCH_DECISION_ID: request.decisionId,
    STRATCRAFT_RESEARCH_CPU_LIMIT_CORES:
      String(request.resourcePlan.enforcement.cpuLimitCores),
    STRATCRAFT_RESEARCH_MEMORY_LIMIT_BYTES:
      String(request.resourcePlan.enforcement.memoryLimitBytes),
    STRATCRAFT_RESEARCH_PROCESS_COUNT:
      String(request.resourcePlan.workload.processCount),
    STRATCRAFT_RESEARCH_THREADS_PER_PROCESS:
      String(request.resourcePlan.workload.threadsPerProcess),
    STRATCRAFT_RESEARCH_TOTAL_THREAD_BUDGET:
      String(request.resourcePlan.workload.totalThreadBudget),
    OMP_NUM_THREADS: String(request.resourcePlan.workload.threadsPerProcess),
    OPENBLAS_NUM_THREADS: String(request.resourcePlan.workload.threadsPerProcess),
    MKL_NUM_THREADS: String(request.resourcePlan.workload.threadsPerProcess),
    NUMEXPR_NUM_THREADS: String(request.resourcePlan.workload.threadsPerProcess),
    STRATCRAFT_RESEARCH_RESOURCE_PLAN: JSON.stringify(request.resourcePlan),
    STRATCRAFT_RESEARCH_PACKAGE_MANIFEST_SHA256: workerPackage.manifestSha256,
    ...(pythonExecutable
      ? { STRATCRAFT_RESEARCH_PYTHON_EXECUTABLE: pythonExecutable }
      : {}),
  };
  const options: SpawnOptions = {
    cwd: workerPackage.packageRoot,
    env: { ...process.env, ...enforcedEnvironment },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  };
  if (request.resourcePlan.enforcement.kind !== 'systemd-scope') {
    return { command: workerPackage.executablePath, args: [], options };
  }
  if (process.platform !== 'linux') {
    throw new Error('systemd-scope research-worker enforcement requires Linux.');
  }
  const unitName = `${RESEARCH_WORKER_SYSTEMD_UNIT_PREFIX}-${request.requestId}`
    .replace(/[^A-Za-z0-9_.-]/g, '-');
  const setEnvironment = Object.entries(enforcedEnvironment)
    .map(([name, value]) => `--setenv=${name}=${value}`);
  return {
    command: RESEARCH_WORKER_SYSTEMD_RUN_COMMAND,
    args: [
      '--user',
      '--scope',
      '--quiet',
      `--unit=${unitName}`,
      `--working-directory=${workerPackage.packageRoot}`,
      `--property=CPUQuota=${request.resourcePlan.enforcement.cpuLimitCores * 100}%`,
      `--property=MemoryMax=${request.resourcePlan.enforcement.memoryLimitBytes}`,
      ...setEnvironment,
      '--',
      workerPackage.executablePath,
    ],
    options,
  };
}

let supervisor: ResearchWorkerSupervisor | null = null;

export function getResearchWorkerSupervisor(): ResearchWorkerSupervisor {
  supervisor ??= new ResearchWorkerSupervisor();
  return supervisor;
}
