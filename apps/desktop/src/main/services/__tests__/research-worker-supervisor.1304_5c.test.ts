import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Writable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type {
  ResearchWorkerExecuteRequest,
  ResearchWorkerHostDiscovery,
  ResearchWorkerPackageManifest,
  ResearchWorkerDiscoveryDescriptor,
} from '@StratCraft/types';
import {
  buildResearchWorkerLaunch,
  getResearchWorkerSupervisor,
  ResearchWorkerSupervisor,
  type ResearchWorkerExecutionContext,
  type ResearchWorkerSupervisorDependencies,
} from '../research-worker-supervisor';
import {
  ResearchWorkerPackageError,
} from '../research-worker-package';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
}));

const roots: string[] = [];
const manifestHash = 'a'.repeat(64);
const sent: unknown[] = [];
const readyDiscovery: ResearchWorkerHostDiscovery = {
  state: 'ready',
  packageVersion: '1.0.0',
  protocolVersion: '1.0.0',
  capabilities: [{
    capabilityId: 'research.discovery',
    contractVersion: '1.0.0',
  }],
  packageManifestSha256: manifestHash,
};

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString('utf8').trim().split('\n')) {
        if (line) sent.push(JSON.parse(line));
      }
      callback();
    },
  });
  readonly stdio = [this.stdin, this.stdout, this.stderr];
  readonly pid = 42;
  readonly connected = false;
  readonly killed = false;
  readonly exitCode = null;
  readonly signalCode = null;
  readonly spawnargs: string[] = [];
  readonly spawnfile = '/worker';
  kill = vi.fn(() => true);
}

const descriptor: ResearchWorkerDiscoveryDescriptor = {
  schemaVersion: 1,
  packageId: 'com.stratcraft.quant-lab',
  workerId: 'stratcraft-research-worker',
  packageVersion: '1.0.0',
  protocol: { minimum: '1.0.0', current: '1.0.0' },
  controlTransport: 'stdio-jsonl',
  executableRelativePath: 'worker',
  capabilities: [{
    capabilityId: 'research.discovery',
    contractVersion: '1.0.0',
  }],
};

const manifest: ResearchWorkerPackageManifest = {
  schemaVersion: 1,
  packageId: 'com.stratcraft.quant-lab',
  packageVersion: '1.0.0',
  discoveryDescriptorRelativePath: 'discovery.json',
  hostModule: {
    relativePath: 'host/register.cjs',
    sha256: 'd'.repeat(64),
    contractVersion: '1.0.0',
    operationContractVersion: '1.0.0',
    registerExport: 'registerCommercialHostCapabilities',
    supportedHostRoles: ['electron', 'service-api'],
  },
  protocol: { minimum: '1.0.0', current: '1.0.0' },
  executables: [{
    platform: 'linux-x64',
    relativePath: 'worker',
    sha256: 'b'.repeat(64),
  }],
  signedFiles: [
    { relativePath: 'worker', sha256: 'b'.repeat(64) },
    { relativePath: 'discovery.json', sha256: 'c'.repeat(64) },
    { relativePath: 'host/register.cjs', sha256: 'd'.repeat(64) },
  ],
  signature: {
    algorithm: 'Ed25519',
    publisherId: 'com.stratcraft',
    keyId: 'release-1',
    signatureRelativePath: 'manifest.sig',
  },
  lifecycle: {
    atomicInstall: true,
    healthCheckCommand: ['worker', '--health'],
    rollbackSupported: true,
    uninstallRemoves: ['worker'],
  },
  upgradesFrom: [],
};

function request(): ResearchWorkerExecuteRequest {
  return {
    messageType: 'execute',
    protocolVersion: '1.0.0',
    correlationId: 'renderer-correlation',
    sequence: 0,
    sentAt: '2026-07-26T00:00:00.000Z',
    requestId: 'request-1',
    decisionId: 'decision-1',
    capabilityId: 'research.fusion',
    operationContractVersion: '1.0.0',
    dataReferences: [],
    resourcePlan: {
      schemaVersion: 1,
      decisionId: 'decision-1',
      effectiveCapacity: {
        hostAvailableCpuCores: 4,
        effectiveCpuCores: 2,
        hostAvailableMemoryBytes: 10_000,
        effectiveMemoryBytes: 8_000,
        reservedCpuCores: 2,
        reservedMemoryBytes: 2_000,
        cpuLimitSource: 'cgroup-v2',
        memoryLimitSource: 'cgroup-v2',
      },
      workload: {
        processCount: 1,
        threadsPerProcess: 2,
        totalThreadBudget: 2,
        measuredPeakBytesPerProcess: 4_000,
        memorySafetyMarginBytes: 1_000,
        admittedPeakMemoryBytes: 5_000,
        bindingConstraint: 'cpu',
      },
      backpressure: {
        enabled: true,
        pauseAboveMemoryBytes: 7_000,
        resumeBelowMemoryBytes: 6_000,
      },
      enforcement: {
        decisionId: 'decision-1',
        kind: 'cgroup-v2',
        cpuLimitCores: 2,
        memoryLimitBytes: 8_000,
      },
    },
    requestPayload: {},
  };
}

async function setup() {
  sent.length = 0;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qnx-worker-supervisor-'));
  roots.push(root);
  const child = new FakeChild();
  let spawnOptions: unknown;
  const dependencies: Partial<ResearchWorkerSupervisorDependencies> = {
    packageVerifier: {
      discover: vi.fn(async () => readyDiscovery),
      verifyActivePackage: vi.fn(async () => ({
        packageRoot: root,
        executablePath: path.join(root, 'worker'),
        libraryPaths: [],
        hostModulePath: path.join(root, 'host', 'register.cjs'),
        manifestSha256: manifestHash,
        manifest,
        discovery: descriptor,
      })),
    },
    spawnWorker: vi.fn((_path, _args, options) => {
      spawnOptions = options;
      return child as unknown as ChildProcessWithoutNullStreams;
    }),
    newId: () => 'host-correlation',
    now: () => '2026-07-26T00:00:00.000Z',
    negotiationTimeoutMs: 1_000,
    cancellationGraceMs: 10,
  };
  return {
    root,
    child,
    supervisor: new ResearchWorkerSupervisor(dependencies),
    getSpawnOptions: () => spawnOptions as {
      env: NodeJS.ProcessEnv;
    },
  };
}

function emit(child: FakeChild, message: unknown): void {
  child.stdout.write(`${JSON.stringify(message)}\n`);
}

const base = (messageType: string, sequence: number) => ({
  messageType,
  protocolVersion: '1.0.0',
  correlationId: 'host-correlation',
  sequence,
  sentAt: '2026-07-26T00:00:00.000Z',
});

const scoped = (messageType: string, sequence: number) => ({
  ...base(messageType, sequence),
  requestId: 'request-1',
  decisionId: 'decision-1',
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function launchExecution(
  overrides: {
    request?: ResearchWorkerExecuteRequest;
    publishArtifact?: ResearchWorkerExecutionContext['publishArtifact'];
  } = {},
) {
  const state = await setup();
  const defaultPublisher: ResearchWorkerExecutionContext['publishArtifact'] =
    vi.fn(async (artifact, _exchangeRoot) => ({
      ...artifact,
      publicationState: 'published' as const,
    }));
  const terminal = state.supervisor.execute(overrides.request ?? request(), {
    exchangeRoot: state.root,
    publishArtifact: overrides.publishArtifact ?? defaultPublisher,
  });
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
  return { ...state, terminal };
}

async function negotiateExecution(
  overrides: Parameters<typeof launchExecution>[0] = {},
) {
  const state = await launchExecution(overrides);
  emit(state.child, {
    ...base('worker-hello', 0),
    selectedProtocolVersion: '1.0.0',
    workerVersion: '1.0.0',
    packageManifestSha256: manifestHash,
    capabilities: descriptor.capabilities,
  });
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(1));
  return state;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe('TICKET_1304_5C research worker supervisor', () => {
  it('negotiates, preserves the resource decision, publishes Artifact, and returns result', async () => {
    const { root, child, supervisor, getSpawnOptions } = await setup();
    const artifactBytes = Buffer.from('result');
    await fs.writeFile(path.join(root, 'result.json'), artifactBytes);
    const artifact = {
      artifactId: 'artifact-1',
      artifactKind: 'result' as const,
      relativePath: 'result.json',
      schemaId: 'research-result',
      schemaVersion: '1.0.0',
      byteCount: artifactBytes.byteLength,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'),
      publicationTransactionId: 'tx-1',
      publicationState: 'staged' as const,
    };
    const published = { ...artifact, publicationState: 'published' as const };
    const onProgress = vi.fn();
    const onArtifactPublished = vi.fn();
    const terminal = supervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(async () => published),
      onProgress,
      onArtifactPublished,
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0]).toMatchObject({
      messageType: 'host-hello',
      correlationId: 'host-correlation',
      expectedPackageManifestSha256: manifestHash,
    });
    expect(getSpawnOptions().env).toMatchObject({
      STRATCRAFT_RESEARCH_DECISION_ID: 'decision-1',
      STRATCRAFT_RESEARCH_CPU_LIMIT_CORES: '2',
      STRATCRAFT_RESEARCH_MEMORY_LIMIT_BYTES: '8000',
      STRATCRAFT_RESEARCH_PROCESS_COUNT: '1',
      STRATCRAFT_RESEARCH_THREADS_PER_PROCESS: '2',
    });
    emit(child, {
      ...base('worker-hello', 0),
      selectedProtocolVersion: '1.0.0',
      workerVersion: '1.0.0',
      packageManifestSha256: manifestHash,
      capabilities: descriptor.capabilities,
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(1));
    expect(sent[1]).toMatchObject({
      messageType: 'execute',
      correlationId: 'host-correlation',
      sequence: 1,
      decisionId: 'decision-1',
    });
    emit(child, scoped('accepted', 1));
    emit(child, {
      ...scoped('progress', 2),
      phase: 'kernel-execution',
      completedUnits: 1,
      totalUnits: 2,
      statusText: 'Running',
    });
    emit(child, { ...scoped('artifact', 3), artifact });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(2));
    expect(sent[2]).toMatchObject({
      messageType: 'artifact-published',
      sequence: 2,
      artifact: published,
    });
    emit(child, {
      ...scoped('result', 4),
      status: 'succeeded',
      artifacts: [published],
      resultPayload: { ok: true },
    });
    await expect(terminal).resolves.toMatchObject({
      messageType: 'result',
      artifacts: [published],
    });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onArtifactPublished).toHaveBeenCalledWith(published);
    expect(supervisor.getActiveRequestIds()).toEqual([]);
  });

  it('returns WORKER_NOT_INSTALLED without spawning a fallback implementation', async () => {
    const { root, supervisor } = await setup();
    const verifier = {
      discover: vi.fn(async () => ({ state: 'absent' as const })),
      verifyActivePackage: vi.fn(async () => null),
    };
    const spawnWorker = vi.fn();
    const isolated = new ResearchWorkerSupervisor({
      packageVerifier: verifier,
      spawnWorker,
    });
    await expect(isolated.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).resolves.toMatchObject({
      messageType: 'error',
      code: 'WORKER_NOT_INSTALLED',
      phase: 'discovery',
    });
    await expect(isolated.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).resolves.toMatchObject({
      code: 'WORKER_NOT_INSTALLED',
    });
    expect(spawnWorker).not.toHaveBeenCalled();
    expect(supervisor.getActiveRequestIds()).toEqual([]);
  });

  it('sends correlated cancellation and kills only its owned child after grace expiry', async () => {
    const { root, child, supervisor } = await setup();
    const terminal = supervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    emit(child, {
      ...base('worker-hello', 0),
      selectedProtocolVersion: '1.0.0',
      workerVersion: '1.0.0',
      packageManifestSha256: manifestHash,
      capabilities: descriptor.capabilities,
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(1));
    await expect(supervisor.cancel('request-1')).resolves.toBe(true);
    expect(sent.at(-1)).toMatchObject({
      messageType: 'cancel',
      requestId: 'request-1',
      decisionId: 'decision-1',
      reason: 'user-request',
    });
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledOnce());
    child.emit('close', 1, 'SIGTERM');
    await expect(terminal).resolves.toMatchObject({
      code: 'WORKER_CRASHED',
    });
  });

  it('turns malformed, non-monotonic worker output into an actionable protocol error', async () => {
    const { root, child, supervisor } = await setup();
    const terminal = supervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    });
    emit(child, {
      ...base('worker-hello', 1),
      selectedProtocolVersion: '1.0.0',
      workerVersion: '1.0.0',
      packageManifestSha256: manifestHash,
      capabilities: descriptor.capabilities,
    });
    await expect(terminal).resolves.toMatchObject({
      messageType: 'error',
      code: 'WORKER_REQUEST_INVALID',
      phase: 'negotiation',
    });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('rejects duplicate active request IDs and invalid exchange roots', async () => {
    const { root, child, supervisor } = await setup();
    const first = supervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    });
    await expect(supervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).rejects.toThrow('already active');
    await expect(supervisor.execute({ ...request(), requestId: 'request-2' }, {
      exchangeRoot: path.join(root, 'missing'),
      publishArtifact: vi.fn(),
    })).rejects.toThrow();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    await supervisor.cancel('request-1');
    child.emit('close', 1, 'SIGTERM');
    await expect(first).resolves.toMatchObject({ code: 'WORKER_CRASHED' });
  });

  it('maps package verification failures, delegates discovery, and rejects work after shutdown', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qnx-worker-errors-'));
    roots.push(root);
    const discover = vi.fn(async () => ({ state: 'absent' as const }));
    const packageErrorSupervisor = new ResearchWorkerSupervisor({
      packageVerifier: {
        discover,
        verifyActivePackage: vi.fn(async () => {
          throw new ResearchWorkerPackageError(
            'WORKER_PROTOCOL_INCOMPATIBLE',
            'version drift',
            'upgrade worker',
          );
        }),
      },
      spawnWorker: vi.fn(),
    });
    await expect(packageErrorSupervisor.discover()).resolves.toEqual({ state: 'absent' });
    await expect(packageErrorSupervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).resolves.toMatchObject({
      code: 'WORKER_PROTOCOL_INCOMPATIBLE',
      phase: 'negotiation',
      remediation: 'upgrade worker',
    });
    await expect(packageErrorSupervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).resolves.toMatchObject({
      code: 'WORKER_PROTOCOL_INCOMPATIBLE',
    });

    const signatureErrorSupervisor = new ResearchWorkerSupervisor({
      packageVerifier: {
        discover,
        verifyActivePackage: vi.fn(async () => {
          throw new ResearchWorkerPackageError(
            'WORKER_SIGNATURE_INVALID',
            'signature drift',
            'reinstall worker',
          );
        }),
      },
      spawnWorker: vi.fn(),
    });
    await expect(signatureErrorSupervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).resolves.toMatchObject({
      code: 'WORKER_SIGNATURE_INVALID',
      phase: 'verification',
    });

    const generic = new ResearchWorkerSupervisor({
      packageVerifier: {
        discover,
        verifyActivePackage: vi.fn(async () => {
          throw new Error('disk failed');
        }),
      },
      spawnWorker: vi.fn(),
    });
    await expect(generic.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).rejects.toThrow('disk failed');
    await generic.shutdown();
    await expect(generic.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).rejects.toThrow('shutting down');
  });

  it('validates non-empty data references against path, size, and hash before launch', async () => {
    const state = await setup();
    const bytes = Buffer.from('bounded-window');
    await fs.writeFile(path.join(state.root, 'input.parquet'), bytes);
    const withReference = {
      ...request(),
      dataReferences: [{
        referenceId: 'input-1',
        relativePath: 'input.parquet',
        format: 'parquet' as const,
        schemaId: 'ohlcv',
        schemaVersion: '1.0.0',
        requestedWindow: {
          startUtc: '2026-01-01T00:00:00.000Z',
          endUtc: '2026-01-02T00:00:00.000Z',
        },
        materializedWindow: {
          startUtc: '2026-01-01T00:00:00.000Z',
          endUtc: '2026-01-02T00:00:00.000Z',
        },
        windowPushdownDecisionId: 'pushdown-1',
        rowCount: 1,
        byteCount: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }],
    };
    const terminal = state.supervisor.execute(withReference, {
      exchangeRoot: state.root,
      publishArtifact: vi.fn(),
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    state.child.emit('close', 1, null);
    await expect(terminal).resolves.toMatchObject({ code: 'WORKER_CRASHED' });

    await expect(new ResearchWorkerSupervisor({
      packageVerifier: {
        discover: vi.fn(),
        verifyActivePackage: vi.fn(),
      },
      spawnWorker: vi.fn(),
    }).execute({
      ...withReference,
      requestId: 'bad-hash',
      dataReferences: [{
        ...withReference.dataReferences[0],
        sha256: 'f'.repeat(64),
      }],
    }, {
      exchangeRoot: state.root,
      publishArtifact: vi.fn(),
    })).rejects.toThrow('hash does not match');

    await expect(new ResearchWorkerSupervisor({
      packageVerifier: {
        discover: vi.fn(),
        verifyActivePackage: vi.fn(),
      },
      spawnWorker: vi.fn(),
    }).execute({
      ...withReference,
      requestId: 'bad-size',
      dataReferences: [{
        ...withReference.dataReferences[0],
        byteCount: bytes.byteLength + 1,
      }],
    }, {
      exchangeRoot: state.root,
      publishArtifact: vi.fn(),
    })).rejects.toThrow('does not match storage');

    const emptyState = await setup();
    const emptyTerminal = emptyState.supervisor.execute({
      ...withReference,
      requestId: 'empty-reference',
      dataReferences: [{
        ...withReference.dataReferences[0],
        relativePath: 'not-materialized.parquet',
        rowCount: 0,
        byteCount: 0,
        materializedWindow: null,
        sha256: createHash('sha256').update('').digest('hex'),
      }],
    }, {
      exchangeRoot: emptyState.root,
      publishArtifact: vi.fn(),
    });
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    emptyState.child.emit('close', 1, null);
    await expect(emptyTerminal).resolves.toMatchObject({ code: 'WORKER_CRASHED' });

    const fileRoot = path.join(state.root, 'not-directory');
    await fs.writeFile(fileRoot, 'x');
    await expect(new ResearchWorkerSupervisor({
      packageVerifier: {
        discover: vi.fn(),
        verifyActivePackage: vi.fn(),
      },
      spawnWorker: vi.fn(),
    }).execute({ ...request(), requestId: 'file-root' }, {
      exchangeRoot: fileRoot,
      publishArtifact: vi.fn(),
    })).rejects.toThrow('must be a directory');
  });

  it('handles negotiation timeout, launch error, stderr bounding, and accepted crash phase', async () => {
    vi.useFakeTimers();
    const timeout = await launchExecution();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(timeout.terminal).resolves.toMatchObject({
      code: 'WORKER_PROTOCOL_INCOMPATIBLE',
    });
    vi.useRealTimers();

    const launchError = await launchExecution();
    launchError.child.emit('error', new Error('spawn denied'));
    await expect(launchError.terminal).resolves.toMatchObject({
      code: 'WORKER_CRASHED',
      message: expect.stringContaining('spawn denied'),
    });

    const crashed = await negotiateExecution();
    crashed.child.stderr.write(Buffer.alloc(70_000, 0x78));
    crashed.child.stderr.write('ignored');
    emit(crashed.child, scoped('accepted', 1));
    await flush();
    crashed.child.emit('close', 2, 'SIGABRT');
    await expect(crashed.terminal).resolves.toMatchObject({
      code: 'WORKER_CRASHED',
      phase: 'kernel-execution',
    });
  });

  it.each([
    { label: 'empty line', write: (child: FakeChild) => child.stdout.write('\n') },
    { label: 'invalid JSON', write: (child: FakeChild) => child.stdout.write('{\n') },
    {
      label: 'oversized unterminated line',
      write: (child: FakeChild) =>
        child.stdout.write(Buffer.alloc(1_048_577, 0x78)),
    },
    {
      label: 'oversized terminated line',
      write: (child: FakeChild) =>
        child.stdout.write(Buffer.concat([Buffer.alloc(1_048_577, 0x78), Buffer.from('\n')])),
    },
  ])('rejects $label without parsing a fallback result', async ({ write }) => {
    const state = await launchExecution();
    write(state.child);
    await expect(state.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
      phase: 'negotiation',
    });
  });

  it('rejects verified-hello drift and response identity drift', async () => {
    for (const helloOverride of [
      { messageType: 'accepted' },
      { packageManifestSha256: 'b'.repeat(64) },
      { workerVersion: '1.0.1' },
      { capabilities: [{ capabilityId: 'research.fusion', contractVersion: '1.0.0' }] },
    ]) {
      const state = await launchExecution();
      emit(state.child, {
        ...base('worker-hello', 0),
        selectedProtocolVersion: '1.0.0',
        workerVersion: '1.0.0',
        packageManifestSha256: manifestHash,
        capabilities: descriptor.capabilities,
        ...helloOverride,
      });
      await expect(state.terminal).resolves.toMatchObject({
        code: 'WORKER_REQUEST_INVALID',
      });
    }

    for (const drift of [
      { requestId: 'other' },
      { decisionId: 'other' },
    ]) {
      const state = await negotiateExecution();
      emit(state.child, { ...scoped('accepted', 1), ...drift });
      await expect(state.terminal).resolves.toMatchObject({
        code: 'WORKER_REQUEST_INVALID',
      });
    }
  });

  it('enforces accepted/progress/terminal state transitions', async () => {
    const earlyProgress = await negotiateExecution();
    emit(earlyProgress.child, {
      ...scoped('progress', 1),
      phase: 'training',
      completedUnits: 0,
      totalUnits: 1,
      statusText: 'early',
    });
    await expect(earlyProgress.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const duplicateAccepted = await negotiateExecution();
    emit(duplicateAccepted.child, scoped('accepted', 1));
    emit(duplicateAccepted.child, scoped('accepted', 2));
    await expect(duplicateAccepted.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const earlyResult = await negotiateExecution();
    emit(earlyResult.child, {
      ...scoped('result', 1),
      status: 'succeeded',
      artifacts: [],
      resultPayload: {},
    });
    await expect(earlyResult.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const cancelled = await negotiateExecution();
    emit(cancelled.child, {
      ...scoped('cancelled', 1),
      phase: 'queued',
      artifactsPublished: false,
    });
    await expect(cancelled.terminal).resolves.toMatchObject({
      messageType: 'cancelled',
    });

    const workerError = await negotiateExecution();
    emit(workerError.child, {
      ...scoped('error', 1),
      code: 'WORKER_INTERNAL_ERROR',
      phase: 'kernel-execution',
      message: 'failed',
      retryable: false,
      remediation: 'inspect diagnostics',
    });
    await expect(workerError.terminal).resolves.toMatchObject({
      messageType: 'error',
      code: 'WORKER_INTERNAL_ERROR',
    });
  });

  it('rejects Artifact publication and terminal-result drift at every host boundary', async () => {
    const artifactBytes = Buffer.from('artifact');
    const artifactHash = createHash('sha256').update(artifactBytes).digest('hex');
    const staged = {
      artifactId: 'artifact-1',
      artifactKind: 'result' as const,
      relativePath: 'artifact.bin',
      schemaId: 'result',
      schemaVersion: '1.0.0',
      byteCount: artifactBytes.byteLength,
      sha256: artifactHash,
      publicationTransactionId: 'tx-1',
      publicationState: 'staged' as const,
    };

    const early = await negotiateExecution();
    emit(early.child, { ...scoped('artifact', 1), artifact: staged });
    await expect(early.terminal).resolves.toMatchObject({ code: 'WORKER_REQUEST_INVALID' });

    const cases = [
      {
        name: 'path escape',
        publish: { ...staged, relativePath: '../escape', publicationState: 'published' as const },
      },
      {
        name: 'not published',
        publish: staged,
      },
      {
        name: 'byte drift',
        publish: { ...staged, byteCount: 1, publicationState: 'published' as const },
      },
      {
        name: 'hash drift',
        publish: { ...staged, sha256: 'f'.repeat(64), publicationState: 'published' as const },
      },
      {
        name: 'identity drift',
        publish: { ...staged, artifactId: 'other', publicationState: 'published' as const },
      },
    ];
    for (const entry of cases) {
      const state = await negotiateExecution({
        publishArtifact: vi.fn(async () => entry.publish),
      });
      await fs.writeFile(path.join(state.root, 'artifact.bin'), artifactBytes);
      emit(state.child, scoped('accepted', 1));
      emit(state.child, { ...scoped('artifact', 2), artifact: staged });
      await expect(state.terminal, entry.name).resolves.toMatchObject({
        code: 'WORKER_REQUEST_INVALID',
      });
    }

    const storageHashDrift = await negotiateExecution({
      publishArtifact: vi.fn(async () => ({
        ...staged,
        sha256: 'f'.repeat(64),
        publicationState: 'published' as const,
      })),
    });
    await fs.writeFile(path.join(storageHashDrift.root, 'artifact.bin'), artifactBytes);
    emit(storageHashDrift.child, scoped('accepted', 1));
    emit(storageHashDrift.child, {
      ...scoped('artifact', 2),
      artifact: {
        ...staged,
        sha256: 'f'.repeat(64),
      },
    });
    await expect(storageHashDrift.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const rejectedPublication = await negotiateExecution({
      publishArtifact: vi.fn(async () => Promise.reject('publisher rejected')),
    });
    emit(rejectedPublication.child, scoped('accepted', 1));
    emit(rejectedPublication.child, { ...scoped('artifact', 2), artifact: staged });
    await expect(rejectedPublication.terminal).resolves.toMatchObject({
      code: 'WORKER_STORAGE_FAILED',
      message: expect.stringContaining('publisher rejected'),
    });

    const cancelledBeforePublication = await negotiateExecution();
    emit(cancelledBeforePublication.child, scoped('accepted', 1));
    await cancelledBeforePublication.supervisor.cancel('request-1', 'user-request');
    emit(cancelledBeforePublication.child, { ...scoped('artifact', 2), artifact: staged });
    await expect(cancelledBeforePublication.terminal).resolves.toMatchObject({
      code: 'WORKER_CANCELLED',
      phase: 'publication',
    });

    let rejectPublication!: (error: Error) => void;
    const cancelledDuringPublication = await negotiateExecution({
      publishArtifact: vi.fn(() => new Promise((_resolve, reject) => {
        rejectPublication = reject;
      })),
    });
    emit(cancelledDuringPublication.child, scoped('accepted', 1));
    emit(cancelledDuringPublication.child, { ...scoped('artifact', 2), artifact: staged });
    await flush();
    await cancelledDuringPublication.supervisor.cancel('request-1', 'user-request');
    rejectPublication(new Error('publication aborted'));
    await expect(cancelledDuringPublication.terminal).resolves.toMatchObject({
      code: 'WORKER_CANCELLED',
      message: 'publication aborted',
    });

    let resolvePublication!: (
      artifact: Awaited<ReturnType<ResearchWorkerExecutionContext['publishArtifact']>>,
    ) => void;
    const completedAfterCancellation = await negotiateExecution({
      publishArtifact: vi.fn(() => new Promise((resolve) => {
        resolvePublication = resolve;
      })),
    });
    emit(completedAfterCancellation.child, scoped('accepted', 1));
    emit(completedAfterCancellation.child, { ...scoped('artifact', 2), artifact: staged });
    await flush();
    await completedAfterCancellation.supervisor.cancel('request-1', 'user-request');
    resolvePublication({ ...staged, publicationState: 'published' });
    await expect(completedAfterCancellation.terminal).resolves.toMatchObject({
      code: 'WORKER_CANCELLED',
      message: expect.stringContaining('completed after cancellation'),
    });

    const duplicate = await negotiateExecution({
      publishArtifact: vi.fn(async () => ({
        ...staged,
        publicationState: 'published' as const,
      })),
    });
    await fs.writeFile(path.join(duplicate.root, 'artifact.bin'), artifactBytes);
    emit(duplicate.child, scoped('accepted', 1));
    emit(duplicate.child, { ...scoped('artifact', 2), artifact: staged });
    await flush();
    emit(duplicate.child, { ...scoped('artifact', 3), artifact: staged });
    await expect(duplicate.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const resultDrift = await negotiateExecution();
    emit(resultDrift.child, scoped('accepted', 1));
    emit(resultDrift.child, {
      ...scoped('result', 2),
      status: 'succeeded',
      artifacts: [{ ...staged, publicationState: 'published' }],
      resultPayload: {},
    });
    await expect(resultDrift.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const queuedClose = await negotiateExecution({
      publishArtifact: vi.fn(async () => ({
        ...staged,
        publicationState: 'published' as const,
      })),
    });
    await fs.writeFile(path.join(queuedClose.root, 'artifact.bin'), artifactBytes);
    queuedClose.child.stdout.write([
      JSON.stringify(scoped('accepted', 1)),
      JSON.stringify({ ...scoped('artifact', 2), artifact: staged }),
      JSON.stringify({
        ...scoped('result', 3),
        status: 'succeeded',
        artifacts: [{ ...staged, publicationState: 'published' }],
        resultPayload: {},
      }),
      '',
    ].join('\n'));
    queuedClose.child.emit('close', 0, null);
    await expect(queuedClose.terminal).resolves.toMatchObject({
      messageType: 'result',
    });
  });

  it('rejects systemd-scope launch on a non-Linux host', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      expect(() => buildResearchWorkerLaunch({
        packageRoot: '/package',
        executablePath: '/package/worker',
        libraryPaths: [],
        manifestSha256: manifestHash,
      }, {
        ...request(),
        resourcePlan: {
          ...request().resourcePlan,
          enforcement: {
            ...request().resourcePlan.enforcement,
            kind: 'systemd-scope',
          },
        },
      }, '/exchange')).toThrow(/requires Linux/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('rejects unexpected post-negotiation host messages and oversized host execute messages', async () => {
    const unexpected = await negotiateExecution();
    emit(unexpected.child, {
      ...base('host-hello', 1),
      hostProtocol: { minimum: '1.0.0', current: '1.0.0' },
      hostVersion: '0.1.0',
      expectedPackageId: 'com.stratcraft.quant-lab',
      expectedPackageManifestSha256: manifestHash,
    });
    await expect(unexpected.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });

    const oversizedRequest = {
      ...request(),
      requestId: 'oversized-host-request',
      requestPayload: { payload: 'x'.repeat(1_048_576) },
    };
    const oversized = await launchExecution({ request: oversizedRequest });
    emit(oversized.child, {
      ...base('worker-hello', 0),
      selectedProtocolVersion: '1.0.0',
      workerVersion: '1.0.0',
      packageManifestSha256: manifestHash,
      capabilities: descriptor.capabilities,
    });
    await expect(oversized.terminal).resolves.toMatchObject({
      code: 'WORKER_REQUEST_INVALID',
    });
  });

  it('waits for terminal cancellation and owned-child close during shutdown', async () => {
    const state = await negotiateExecution();
    const shutdown = state.supervisor.shutdown();
    await vi.waitFor(() =>
      expect(sent.some((message) =>
        (message as { messageType?: string }).messageType === 'cancel')).toBe(true));
    emit(state.child, {
      ...scoped('cancelled', 1),
      phase: 'queued',
      artifactsPublished: false,
    });
    await flush();
    state.child.emit('close', 0, null);
    await expect(shutdown).resolves.toBeUndefined();
    await expect(state.terminal).resolves.toMatchObject({ messageType: 'cancelled' });
  });

  it('keeps terminal and cancellation race guards idempotent', async () => {
    vi.useFakeTimers();
    const state = await launchExecution();
    const internals = state.supervisor as unknown as {
      active: Map<string, {
        terminal: boolean;
      }>;
      send(execution: object, message: object): void;
      failExecution(execution: object, message: object): void;
      finishExecution(execution: object, message: object): void;
      processLine(execution: object, workerPackage: object, line: Buffer): Promise<void>;
    };
    const execution = internals.active.get('request-1');
    expect(execution).toBeDefined();
    if (execution === undefined) throw new Error('Expected active execution.');

    execution.terminal = true;
    await expect(state.supervisor.cancel('request-1')).resolves.toBe(false);
    state.child.stdout.write('{}\n');
    internals.send(execution, {});
    internals.failExecution(execution, {});
    internals.finishExecution(execution, {});
    await internals.processLine(execution, {}, Buffer.alloc(0));

    execution.terminal = false;
    await expect(state.supervisor.cancel('request-1')).resolves.toBe(true);
    execution.terminal = true;
    await vi.advanceTimersByTimeAsync(11);
    expect(state.child.kill).not.toHaveBeenCalled();
    execution.terminal = false;
    state.child.emit('close', 1, null);
    await expect(state.terminal).resolves.toMatchObject({ code: 'WORKER_CRASHED' });
  });

  it('short-circuits the shutdown close wait when cancellation becomes terminal', async () => {
    const state = await launchExecution();
    const internals = state.supervisor as unknown as {
      active: Map<string, { terminal: boolean }>;
      cancel(requestId: string, reason: string): Promise<boolean>;
    };
    const execution = internals.active.get('request-1');
    expect(execution).toBeDefined();
    if (execution === undefined) throw new Error('Expected active execution.');
    internals.cancel = vi.fn(async () => {
      execution.terminal = true;
      return true;
    });
    await expect(state.supervisor.shutdown()).resolves.toBeUndefined();
  });

  it('advertises the configured desktop version during negotiation', async () => {
    const previousVersion = process.env.npm_package_version;
    process.env.npm_package_version = '9.8.7';
    try {
      const state = await launchExecution();
      expect(sent[0]).toMatchObject({
        messageType: 'host-hello',
        hostVersion: '9.8.7',
      });
      state.child.emit('close', 1, null);
      await expect(state.terminal).resolves.toMatchObject({ code: 'WORKER_CRASHED' });

      delete process.env.npm_package_version;
      const fallbackState = await launchExecution();
      expect(sent[0]).toMatchObject({
        messageType: 'host-hello',
        hostVersion: '0.1.0',
      });
      fallbackState.child.emit('close', 1, null);
      await expect(fallbackState.terminal).resolves.toMatchObject({
        code: 'WORKER_CRASHED',
      });
    } finally {
      if (previousVersion === undefined) {
        delete process.env.npm_package_version;
      } else {
        process.env.npm_package_version = previousVersion;
      }
    }
  });

  it('uses the production spawn, clock, ID, and singleton defaults with a real stdio worker', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qnx-real-worker-'));
    roots.push(root);
    const scriptPath = path.join(root, 'worker.mjs');
    await fs.writeFile(scriptPath, `#!/usr/bin/env node
import readline from 'node:readline';
let sequence = 0;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  const base = {
    protocolVersion: '1.0.0',
    correlationId: message.correlationId,
    sequence: sequence++,
    sentAt: new Date().toISOString(),
  };
  if (message.messageType === 'host-hello') {
    process.stdout.write(JSON.stringify({
      ...base,
      messageType: 'worker-hello',
      selectedProtocolVersion: '1.0.0',
      workerVersion: '1.0.0',
      packageManifestSha256: '${manifestHash}',
      capabilities: [{ capabilityId: 'research.discovery', contractVersion: '1.0.0' }],
    }) + '\\n');
  } else if (message.messageType === 'execute') {
    process.stdout.write(JSON.stringify({
      ...base,
      messageType: 'accepted',
      requestId: message.requestId,
      decisionId: message.decisionId,
    }) + '\\n');
    process.stdout.write(JSON.stringify({
      ...base,
      sequence: sequence++,
      messageType: 'result',
      requestId: message.requestId,
      decisionId: message.decisionId,
      status: 'succeeded',
      artifacts: [],
      resultPayload: { realProcess: true },
    }) + '\\n');
  }
});
`);
    await fs.chmod(scriptPath, 0o755);
    const supervisor = new ResearchWorkerSupervisor({
      packageVerifier: {
        discover: vi.fn(async () => readyDiscovery),
        verifyActivePackage: vi.fn(async () => ({
          packageRoot: root,
          executablePath: scriptPath,
          libraryPaths: [],
          hostModulePath: path.join(root, 'host', 'register.cjs'),
          manifestSha256: manifestHash,
          manifest,
          discovery: descriptor,
        })),
      },
    });
    await expect(supervisor.execute(request(), {
      exchangeRoot: root,
      publishArtifact: vi.fn(),
    })).resolves.toMatchObject({
      messageType: 'result',
      resultPayload: { realProcess: true },
    });
    Object.defineProperty(process, 'resourcesPath', {
      value: '/tmp',
      configurable: true,
    });
    expect(getResearchWorkerSupervisor()).toBe(getResearchWorkerSupervisor());
  });
});
