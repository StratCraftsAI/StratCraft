import { describe, expect, it } from 'vitest';
import {
  RESEARCH_WORKER_CONTROL_MESSAGE_V1_JSON_SCHEMA,
  RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA,
  RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA,
  RESEARCH_WORKER_DISCOVERY_V1_JSON_SCHEMA,
  RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES,
  RESEARCH_WORKER_PACKAGE_V1_JSON_SCHEMA,
  RESEARCH_WORKER_PROTOCOL_VERSION,
  negotiateResearchWorkerProtocol,
  parseResearchWorkerControlMessage,
  researchWorkerControlMessageSchema,
  researchDiscoveryOperationRequestSchema,
  researchDiscoveryOperationResultSchema,
  researchWorkerDataReferenceSchema,
  researchWorkerDiscoveryDescriptorSchema,
  researchWorkerHostDiscoverySchema,
  researchWorkerPackageManifestSchema,
  researchWorkerProtocolRangeSchema,
  researchWorkerResourcePlanSchema,
  researchWorkerWindowSchema,
} from '../research-worker-protocol';

const hash = (character: string) => character.repeat(64);
const sentAt = '2026-07-26T12:00:00Z';

function resourcePlan() {
  return {
    schemaVersion: 1 as const,
    decisionId: 'decision-1',
    effectiveCapacity: {
      hostAvailableCpuCores: 8,
      effectiveCpuCores: 4,
      hostAvailableMemoryBytes: 16_000,
      effectiveMemoryBytes: 8_000,
      reservedCpuCores: 1,
      reservedMemoryBytes: 2_000,
      cpuLimitSource: 'cgroup-v2' as const,
      memoryLimitSource: 'cgroup-v2' as const,
    },
    workload: {
      processCount: 2,
      threadsPerProcess: 2,
      totalThreadBudget: 4,
      measuredPeakBytesPerProcess: 2_000,
      memorySafetyMarginBytes: 1_000,
      admittedPeakMemoryBytes: 5_000,
      bindingConstraint: 'cpu' as const,
    },
    backpressure: {
      enabled: true as const,
      pauseAboveMemoryBytes: 7_000,
      resumeBelowMemoryBytes: 6_000,
    },
    enforcement: {
      decisionId: 'decision-1',
      kind: 'cgroup-v2' as const,
      cpuLimitCores: 4,
      memoryLimitBytes: 8_000,
    },
  };
}

function dataReference() {
  return {
    referenceId: 'data-1',
    relativePath: 'data/input.parquet',
    format: 'parquet' as const,
    schemaId: 'qnx.ohlcv',
    schemaVersion: '1.0.0',
    requestedWindow: {
      startUtc: '2026-01-01T00:00:00Z',
      endUtc: '2026-02-01T00:00:00Z',
    },
    materializedWindow: {
      startUtc: '2026-01-02T00:00:00Z',
      endUtc: '2026-01-31T00:00:00Z',
    },
    windowPushdownDecisionId: 'window-1',
    rowCount: 1_000,
    byteCount: 4_096,
    sha256: hash('a'),
  };
}

function executeRequest() {
  return {
    messageType: 'execute' as const,
    protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
    correlationId: 'correlation-1',
    sequence: 1,
    sentAt,
    requestId: 'request-1',
    decisionId: 'decision-1',
    capabilityId: 'research.discovery' as const,
    operationContractVersion: '1.0.0',
    dataReferences: [dataReference()],
    resourcePlan: resourcePlan(),
    requestPayload: {
      operation: 'discover',
      workflowId: 'workflow-1',
      inputReferenceIds: ['data-1'],
      candidate: {
        candidateId: 'candidate-1',
        featureColumn: 'feature',
        targetColumn: 'target',
      },
      training: { kind: 'ridge', l2Regularization: 0.01 },
      evaluation: { minimumRows: 20 },
      artifact: { artifactId: 'artifact-1' },
    },
  };
}

function packageManifest() {
  return {
    schemaVersion: 1 as const,
    packageId: 'com.stratcraft.quant-lab' as const,
    packageVersion: '1.0.0',
    discoveryDescriptorRelativePath: 'worker/discovery.json',
    hostModule: {
      relativePath: 'host/register.cjs',
      sha256: hash('d'),
      contractVersion: '1.0.0' as const,
      operationContractVersion: '1.0.0' as const,
      registerExport: 'registerCommercialHostCapabilities' as const,
      supportedHostRoles: ['electron', 'service-api'] as const,
    },
    protocol: { minimum: '1.0.0', current: '1.0.0' },
    executables: [{
      platform: 'linux-x64' as const,
      relativePath: 'worker/bin/research-worker',
      sha256: hash('a'),
    }],
    signedFiles: [
      { relativePath: 'worker/discovery.json', sha256: hash('b') },
      { relativePath: 'worker/bin/research-worker', sha256: hash('a') },
      { relativePath: 'host/register.cjs', sha256: hash('d') },
    ],
    signature: {
      algorithm: 'Ed25519' as const,
      publisherId: 'com.stratcraft' as const,
      keyId: 'release-1',
      signatureRelativePath: 'SIGNATURE.ed25519',
    },
    lifecycle: {
      atomicInstall: true as const,
      healthCheckCommand: ['worker/bin/research-worker', '--health'],
      rollbackSupported: true as const,
      uninstallRemoves: ['worker'],
    },
    upgradesFrom: ['0.9.0'],
  };
}

describe('TICKET_1304_2 commercial research worker public contracts', () => {
  it('freezes strict research.discovery operation request and result schemas', () => {
    const requestPayload = executeRequest().requestPayload;
    expect(researchDiscoveryOperationRequestSchema.parse(requestPayload)).toEqual(requestPayload);
    expect(researchDiscoveryOperationRequestSchema.safeParse({
      ...requestPayload,
      unknown: true,
    }).success).toBe(false);
    expect(researchWorkerControlMessageSchema.safeParse({
      ...executeRequest(),
      operationContractVersion: '1.1.0',
    }).success).toBe(false);
    expect(researchWorkerControlMessageSchema.safeParse({
      ...executeRequest(),
      dataReferences: [dataReference(), { ...dataReference(), referenceId: 'data-2' }],
    }).success).toBe(false);

    const resultPayload = {
      operation: 'discover' as const,
      workflowId: 'workflow-1',
      resourceDecisionId: 'decision-1',
      inputLineage: [{
        referenceId: 'data-1',
        sha256: hash('a'),
        requestedWindow: dataReference().requestedWindow,
        windowPushdownDecisionId: 'window-1',
      }],
      candidateCount: 1,
      trainedCandidateCount: 1,
      evaluatedCandidateCount: 1,
      selectedCandidateId: 'candidate-1',
      metrics: {
        observations: 100,
        intercept: 0.1,
        slope: 0.2,
        correlation: 0.3,
        meanSquaredError: 0.4,
      },
      publishedArtifactIds: ['artifact-1'],
    };
    expect(researchDiscoveryOperationResultSchema.parse(resultPayload)).toEqual(resultPayload);
    expect(researchDiscoveryOperationResultSchema.safeParse({
      ...resultPayload,
      trainedCandidateCount: 2,
    }).success).toBe(false);
    expect(RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA).toMatchObject({ type: 'object' });
    expect(RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA).toMatchObject({ type: 'object' });
  });
  it('freezes a same-major ordered protocol range and rejects malformed ranges', () => {
    expect(researchWorkerProtocolRangeSchema.safeParse({
      minimum: '1.0.0',
      current: '1.2.0',
    }).success).toBe(true);
    for (const protocol of [
      { minimum: '2.0.0', current: '1.0.0' },
      { minimum: '1.2.0', current: '1.1.0' },
      { minimum: 'bad', current: '1.0.0' },
      { minimum: '99999999999999999999.0.0', current: '1.0.0' },
    ]) {
      expect(researchWorkerProtocolRangeSchema.safeParse(protocol).success).toBe(false);
    }
  });

  it('negotiates only the frozen host version without silent major downgrade', () => {
    expect(negotiateResearchWorkerProtocol({
      minimum: '1.0.0',
      current: '1.1.0',
    })).toEqual({
      compatible: true,
      selectedProtocolVersion: '1.0.0',
    });
    expect(negotiateResearchWorkerProtocol({
      minimum: 'invalid',
      current: '1.0.0',
    })).toMatchObject({
      compatible: false,
      errorCode: 'WORKER_PROTOCOL_INCOMPATIBLE',
    });
    expect(negotiateResearchWorkerProtocol({
      minimum: '2.0.0',
      current: '2.1.0',
    })).toMatchObject({
      compatible: false,
      reason: expect.stringContaining('2.0.0 through 2.1.0'),
    });
    expect(negotiateResearchWorkerProtocol({
      minimum: '1.1.0',
      current: '1.2.0',
    }).compatible).toBe(false);
    expect(negotiateResearchWorkerProtocol({
      minimum: '0.9.0',
      current: '0.9.9',
    }).compatible).toBe(false);
  });

  it('requires valid requested windows and strictly bounded storage output', () => {
    expect(researchWorkerWindowSchema.safeParse(dataReference().requestedWindow).success).toBe(true);
    expect(researchWorkerWindowSchema.safeParse({
      startUtc: '2026-02-01T00:00:00Z',
      endUtc: '2026-01-01T00:00:00Z',
    }).success).toBe(false);
    expect(researchWorkerDataReferenceSchema.safeParse(dataReference()).success).toBe(true);

    const empty = {
      ...dataReference(),
      rowCount: 0,
      byteCount: 0,
      materializedWindow: null,
    };
    expect(researchWorkerDataReferenceSchema.safeParse(empty).success).toBe(true);
    expect(researchWorkerDataReferenceSchema.safeParse({
      ...empty,
      byteCount: 1,
    }).success).toBe(false);
    expect(researchWorkerDataReferenceSchema.safeParse({
      ...empty,
      materializedWindow: dataReference().materializedWindow,
    }).success).toBe(false);
    expect(researchWorkerDataReferenceSchema.safeParse({
      ...dataReference(),
      byteCount: 0,
    }).success).toBe(false);
    expect(researchWorkerDataReferenceSchema.safeParse({
      ...dataReference(),
      materializedWindow: null,
    }).success).toBe(false);
    expect(researchWorkerDataReferenceSchema.safeParse({
      ...dataReference(),
      materializedWindow: {
        startUtc: '2025-12-31T00:00:00Z',
        endUtc: '2026-01-15T00:00:00Z',
      },
    }).success).toBe(false);
    expect(researchWorkerDataReferenceSchema.safeParse({
      ...dataReference(),
      materializedWindow: {
        startUtc: '2026-01-15T00:00:00Z',
        endUtc: '2026-02-02T00:00:00Z',
      },
    }).success).toBe(false);
  });

  it('rejects every drift between admission, runtime geometry, and enforcement', () => {
    expect(researchWorkerResourcePlanSchema.safeParse(resourcePlan()).success).toBe(true);
    const invalidPlans = [
      {
        ...resourcePlan(),
        effectiveCapacity: { ...resourcePlan().effectiveCapacity, effectiveCpuCores: 9 },
      },
      {
        ...resourcePlan(),
        effectiveCapacity: { ...resourcePlan().effectiveCapacity, effectiveMemoryBytes: 17_000 },
        enforcement: { ...resourcePlan().enforcement, memoryLimitBytes: 17_000 },
      },
      {
        ...resourcePlan(),
        workload: { ...resourcePlan().workload, totalThreadBudget: 3 },
      },
      {
        ...resourcePlan(),
        workload: { ...resourcePlan().workload, totalThreadBudget: 5 },
      },
      {
        ...resourcePlan(),
        workload: { ...resourcePlan().workload, admittedPeakMemoryBytes: 4_999 },
      },
      {
        ...resourcePlan(),
        effectiveCapacity: { ...resourcePlan().effectiveCapacity, effectiveMemoryBytes: 4_000 },
        enforcement: { ...resourcePlan().enforcement, memoryLimitBytes: 4_000 },
      },
      {
        ...resourcePlan(),
        backpressure: { ...resourcePlan().backpressure, resumeBelowMemoryBytes: 7_000 },
      },
      {
        ...resourcePlan(),
        backpressure: { ...resourcePlan().backpressure, pauseAboveMemoryBytes: 9_000 },
      },
      {
        ...resourcePlan(),
        enforcement: { ...resourcePlan().enforcement, decisionId: 'drifted' },
      },
      {
        ...resourcePlan(),
        enforcement: { ...resourcePlan().enforcement, cpuLimitCores: 3 },
      },
      {
        ...resourcePlan(),
        enforcement: { ...resourcePlan().enforcement, memoryLimitBytes: 7_999 },
      },
    ];
    for (const plan of invalidPlans) {
      expect(researchWorkerResourcePlanSchema.safeParse(plan).success).toBe(false);
    }

    const fractionalSingleProcess = {
      ...resourcePlan(),
      effectiveCapacity: {
        ...resourcePlan().effectiveCapacity,
        effectiveCpuCores: 0.5,
      },
      workload: {
        ...resourcePlan().workload,
        processCount: 1,
        threadsPerProcess: 1,
        totalThreadBudget: 1,
        admittedPeakMemoryBytes: 3_000,
        bindingConstraint: 'single-process-floor' as const,
      },
      enforcement: {
        ...resourcePlan().enforcement,
        cpuLimitCores: 0.5,
      },
    };
    expect(researchWorkerResourcePlanSchema.safeParse(fractionalSingleProcess).success).toBe(true);
  });

  it('exposes capabilities without implementation details and rejects duplicates', () => {
    const descriptor = {
      schemaVersion: 1,
      packageId: 'com.stratcraft.quant-lab',
      workerId: 'stratcraft-research-worker',
      packageVersion: '1.0.0',
      protocol: { minimum: '1.0.0', current: '1.0.0' },
      controlTransport: 'stdio-jsonl',
      executableRelativePath: 'worker/bin/research-worker',
      capabilities: [{
        capabilityId: 'research.discovery',
        contractVersion: '1.0.0',
      }],
    };
    expect(researchWorkerDiscoveryDescriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(researchWorkerDiscoveryDescriptorSchema.safeParse({
      ...descriptor,
      capabilities: [descriptor.capabilities[0], descriptor.capabilities[0]],
    }).success).toBe(false);
  });

  it('owns the exact host discovery projection shared by Main and preload', () => {
    expect(researchWorkerHostDiscoverySchema.parse({ state: 'absent' })).toEqual({
      state: 'absent',
    });
    expect(researchWorkerHostDiscoverySchema.safeParse({
      state: 'ready',
      packageVersion: '1.0.0',
      protocolVersion: '1.0.0',
      capabilities: [{
        capabilityId: 'research.discovery',
        contractVersion: '1.0.0',
      }],
      packageManifestSha256: hash('c'),
    }).success).toBe(true);
    expect(researchWorkerHostDiscoverySchema.safeParse({
      state: 'error',
      code: 'WORKER_SIGNATURE_INVALID',
      message: 'Signature invalid.',
      remediation: 'Reinstall the package.',
    }).success).toBe(true);
    expect(researchWorkerHostDiscoverySchema.safeParse({
      state: 'absent',
      packageVersion: 'leak',
    }).success).toBe(false);
  });

  it('requires signed atomic lifecycle manifests with explicit rollback and uninstall', () => {
    expect(researchWorkerPackageManifestSchema.safeParse(packageManifest()).success).toBe(true);
    const manifest = packageManifest();
    const invalidManifests = [
      {
        ...manifest,
        executables: [manifest.executables[0], manifest.executables[0]],
      },
      {
        ...manifest,
        signedFiles: [manifest.signedFiles[0], manifest.signedFiles[0]],
      },
      {
        ...manifest,
        lifecycle: { ...manifest.lifecycle, uninstallRemoves: ['worker', 'worker'] },
      },
      {
        ...manifest,
        upgradesFrom: ['0.9.0', '0.9.0'],
      },
      {
        ...manifest,
        signedFiles: [manifest.signedFiles[0]],
      },
      {
        ...manifest,
        hostModule: { ...manifest.hostModule, contractVersion: '2.0.0' },
      },
      {
        ...manifest,
        hostModule: { ...manifest.hostModule, operationContractVersion: '2.0.0' },
      },
      {
        ...manifest,
        hostModule: { ...manifest.hostModule, sha256: hash('e') },
      },
      {
        ...manifest,
        hostModule: {
          ...manifest.hostModule,
          supportedHostRoles: ['electron', 'electron'],
        },
      },
    ];
    for (const invalid of invalidManifests) {
      expect(researchWorkerPackageManifestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('validates every request, progress, cancellation, Artifact, result, and error envelope', () => {
    const base = {
      protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
      correlationId: 'correlation-1',
      sequence: 1,
      sentAt,
    };
    const request = executeRequest();
    const messages = [
      {
        messageType: 'host-hello',
        ...base,
        hostProtocol: { minimum: '1.0.0', current: '1.0.0' },
        hostVersion: '2.0.0',
        expectedPackageId: 'com.stratcraft.quant-lab',
        expectedPackageManifestSha256: hash('a'),
      },
      {
        messageType: 'worker-hello',
        ...base,
        selectedProtocolVersion: '1.0.0',
        workerVersion: '1.0.0',
        packageManifestSha256: hash('a'),
        capabilities: [{
          capabilityId: 'research.discovery',
          contractVersion: '1.0.0',
        }],
      },
      request,
      {
        messageType: 'accepted',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
      },
      {
        messageType: 'progress',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        phase: 'kernel-execution',
        completedUnits: 1,
        totalUnits: 2,
        statusText: 'Evaluating candidates.',
      },
      {
        messageType: 'cancel',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        reason: 'user-request',
      },
      {
        messageType: 'cancelled',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        phase: 'kernel-execution',
        artifactsPublished: false,
      },
      {
        messageType: 'artifact',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        artifact: {
          artifactId: 'artifact-1',
          artifactKind: 'result',
          relativePath: 'artifacts/result.json',
          schemaId: 'research-result',
          schemaVersion: '1.0.0',
          byteCount: 100,
          sha256: hash('d'),
          publicationTransactionId: 'transaction-1',
          publicationState: 'staged',
        },
      },
      {
        messageType: 'artifact-published',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        artifact: {
          artifactId: 'artifact-1',
          artifactKind: 'result',
          relativePath: 'artifacts/result.json',
          schemaId: 'research-result',
          schemaVersion: '1.0.0',
          byteCount: 100,
          sha256: hash('d'),
          publicationTransactionId: 'transaction-1',
          publicationState: 'published',
        },
      },
      {
        messageType: 'result',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        status: 'succeeded',
        artifacts: [{
          artifactId: 'artifact-1',
          artifactKind: 'result',
          relativePath: 'artifacts/result.json',
          schemaId: 'research-result',
          schemaVersion: '1.0.0',
          byteCount: 100,
          sha256: hash('d'),
          publicationTransactionId: 'transaction-1',
          publicationState: 'published',
        }],
        resultPayload: { verdict: 'accepted' },
      },
      {
        messageType: 'error',
        ...base,
        requestId: 'request-1',
        decisionId: 'decision-1',
        code: 'WORKER_STORAGE_FAILED',
        phase: 'persistence',
        message: 'Artifact publication failed.',
        retryable: true,
        remediation: 'Retry after checking storage capacity.',
        diagnosticsReference: 'diagnostics-1',
      },
      {
        messageType: 'error',
        ...base,
        code: 'WORKER_NOT_INSTALLED',
        phase: 'discovery',
        message: 'The commercial worker is not installed.',
        retryable: false,
        remediation: 'Install Quant Lab.',
      },
    ];
    for (const message of messages) {
      expect(researchWorkerControlMessageSchema.safeParse(message).success).toBe(true);
    }
    expect(parseResearchWorkerControlMessage(request)).toEqual(request);
  });

  it('rejects decision drift, duplicate inputs, invalid progress, staged results, and partial errors', () => {
    const request = executeRequest();
    expect(researchWorkerControlMessageSchema.safeParse({
      ...request,
      decisionId: 'drifted',
    }).success).toBe(false);
    expect(researchWorkerControlMessageSchema.safeParse({
      ...request,
      dataReferences: [dataReference(), dataReference()],
    }).success).toBe(false);

    const base = {
      protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
      correlationId: 'correlation-1',
      sequence: 1,
      sentAt,
      requestId: 'request-1',
      decisionId: 'decision-1',
    };
    expect(researchWorkerControlMessageSchema.safeParse({
      messageType: 'progress',
      ...base,
      phase: 'training',
      completedUnits: 3,
      totalUnits: 2,
      statusText: 'Invalid progress.',
    }).success).toBe(false);
    expect(researchWorkerControlMessageSchema.safeParse({
      messageType: 'result',
      ...base,
      status: 'succeeded',
      artifacts: [{
        artifactId: 'artifact-1',
        artifactKind: 'result',
        relativePath: 'artifacts/result.json',
        schemaId: 'research-result',
        schemaVersion: '1.0.0',
        byteCount: 100,
        sha256: hash('d'),
        publicationTransactionId: 'transaction-1',
        publicationState: 'staged',
      }],
      resultPayload: {},
    }).success).toBe(false);
    for (const partialIdentity of [
      { requestId: 'request-1' },
      { decisionId: 'decision-1' },
    ]) {
      expect(researchWorkerControlMessageSchema.safeParse({
        messageType: 'error',
        protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
        correlationId: 'correlation-1',
        sequence: 1,
        sentAt,
        ...partialIdentity,
        code: 'WORKER_INTERNAL_ERROR',
        phase: 'kernel-execution',
        message: 'Failure.',
        retryable: false,
        remediation: 'Inspect diagnostics.',
      }).success).toBe(false);
    }
  });

  it('bounds control messages and portable exchange paths', () => {
    expect(() => parseResearchWorkerControlMessage({
      ...executeRequest(),
      requestPayload: { value: 'x'.repeat(RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES) },
    })).toThrow(/limit/);

    for (const relativePath of [
      'data\\input.parquet',
      'data:input.parquet',
      '/data/input.parquet',
      'data/input.parquet/',
      'data//input.parquet',
      'data/./input.parquet',
      'data/../input.parquet',
      'data/\0/input.parquet',
    ]) {
      expect(researchWorkerDataReferenceSchema.safeParse({
        ...dataReference(),
        relativePath,
      }).success).toBe(false);
    }
  });

  it('publishes all five Draft 2020-12 cross-language schemas', () => {
    for (const schema of [
      RESEARCH_WORKER_CONTROL_MESSAGE_V1_JSON_SCHEMA,
      RESEARCH_WORKER_DISCOVERY_V1_JSON_SCHEMA,
      RESEARCH_WORKER_PACKAGE_V1_JSON_SCHEMA,
      RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA,
      RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA,
    ]) {
      expect(schema).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema' });
    }
  });
});
