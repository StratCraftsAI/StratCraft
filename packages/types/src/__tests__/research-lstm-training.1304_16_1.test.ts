import { describe, expect, it } from 'vitest';
import {
  RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION,
  RESEARCH_WORKER_PROTOCOL_VERSION,
  researchLstmTrainingOperationRequestSchema,
  researchLstmTrainingOperationResultSchema,
  researchWorkerControlMessageSchema,
} from '../research-worker-protocol';

const hash = (character: string): string => character.repeat(64);

function payload() {
  return {
    operation: 'train' as const,
    contractVersion: RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION,
    trainingSessionId: 'training-1',
    modelId: 'model-1',
    modelVersionId: 'version-1',
    resourcePlanDecisionId: 'decision-1',
    data: {
      inputReferenceId: 'lstm-data',
      timestampColumn: 'timestamp',
      targetEndTimestampColumn: 'target_end',
      symbolColumn: 'symbol',
      signalIdColumn: 'signal_id',
      targetColumn: 'forward_return',
    },
    featureSchema: [
      { name: 'score', dataType: 'float32' as const, role: 'score' as const },
      { name: 'ic', dataType: 'float32' as const, role: 'metadata' as const },
    ],
    signalIds: ['signal-a', 'signal-b'],
    split: {
      train: {
        startUtc: '2026-01-01T00:00:00Z',
        endUtc: '2026-01-31T23:59:59Z',
      },
      validation: {
        startUtc: '2026-02-02T00:00:00Z',
        endUtc: '2026-02-14T23:59:59Z',
      },
      test: {
        startUtc: '2026-02-16T00:00:00Z',
        endUtc: '2026-02-28T23:59:59Z',
      },
      embargoBars: 1,
    },
    architecture: {
      kind: 'shared-encoder-lstm-v1' as const,
      lookbackBars: 60,
      hiddenSize: 32,
      numLayers: 1,
      dropout: 0.2,
      metadataFeatureCount: 1,
    },
    optimizer: {
      kind: 'adam' as const,
      learningRate: 0.001,
      beta1: 0.9,
      beta2: 0.999,
      epsilon: 1e-8,
      weightDecay: 0.001,
      gradientClipNorm: 1,
    },
    seed: 7,
    epochs: 30,
    batchSize: 512,
    earlyStop: { patience: 5, minimumImprovement: 0 },
    checkpoint: null,
  };
}

function request() {
  return {
    messageType: 'execute' as const,
    protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
    correlationId: 'correlation-1',
    sequence: 1,
    sentAt: '2026-08-01T00:00:00Z',
    requestId: 'request-1',
    decisionId: 'decision-1',
    capabilityId: 'research.lstm-training' as const,
    operationContractVersion: RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION,
    dataReferences: [{
      referenceId: 'lstm-data',
      relativePath: 'data/lstm.parquet',
      format: 'parquet' as const,
      schemaId: 'research.lstm-training.input',
      schemaVersion: '1.0.0',
      requestedWindow: {
        startUtc: '2026-01-01T00:00:00Z',
        endUtc: '2026-02-28T23:59:59Z',
      },
      materializedWindow: {
        startUtc: '2026-01-01T00:00:00Z',
        endUtc: '2026-02-28T00:00:00Z',
      },
      windowPushdownDecisionId: 'window-1',
      rowCount: 1_000,
      byteCount: 4_096,
      sha256: hash('a'),
    }],
    resourcePlan: {
      schemaVersion: 1 as const,
      decisionId: 'decision-1',
      effectiveCapacity: {
        hostAvailableCpuCores: 8,
        effectiveCpuCores: 4,
        hostAvailableMemoryBytes: 16_000,
        effectiveMemoryBytes: 8_000,
        reservedCpuCores: 4,
        reservedMemoryBytes: 8_000,
        cpuLimitSource: 'cgroup-v2' as const,
        memoryLimitSource: 'cgroup-v2' as const,
      },
      workload: {
        processCount: 1,
        threadsPerProcess: 4,
        totalThreadBudget: 4,
        measuredPeakBytesPerProcess: 4_000,
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
    },
    requestPayload: payload(),
  };
}

describe('TICKET_1304_16_1 native LSTM worker contract', () => {
  it('accepts the dedicated strict request', () => {
    expect(researchLstmTrainingOperationRequestSchema.parse(payload())).toEqual(payload());
    expect(researchWorkerControlMessageSchema.safeParse(request()).success).toBe(true);
    expect(request().capabilityId).toBe('research.lstm-training');
  });

  it('rejects unknown fields, invalid feature order, leaking splits, and decision drift', () => {
    expect(researchLstmTrainingOperationRequestSchema.safeParse({
      ...payload(),
      unknown: true,
    }).success).toBe(false);
    expect(researchLstmTrainingOperationRequestSchema.safeParse({
      ...payload(),
      featureSchema: [payload().featureSchema[0], payload().featureSchema[0]],
    }).success).toBe(false);
    expect(researchLstmTrainingOperationRequestSchema.safeParse({
      ...payload(),
      split: {
        ...payload().split,
        validation: {
          startUtc: '2026-01-30T00:00:00Z',
          endUtc: '2026-02-14T23:59:59Z',
        },
      },
    }).success).toBe(false);
    expect(researchWorkerControlMessageSchema.safeParse({
      ...request(),
      requestPayload: { ...payload(), resourcePlanDecisionId: 'decision-drift' },
    }).success).toBe(false);
  });

  it('requires one bounded input that contains every split window', () => {
    expect(researchWorkerControlMessageSchema.safeParse({
      ...request(),
      dataReferences: [],
    }).success).toBe(false);
    expect(researchWorkerControlMessageSchema.safeParse({
      ...request(),
      dataReferences: [{
        ...request().dataReferences[0],
        requestedWindow: {
          startUtc: '2026-01-02T00:00:00Z',
          endUtc: '2026-02-28T23:59:59Z',
        },
      }],
    }).success).toBe(false);
  });

  it('freezes checkpoint compatibility and terminal lineage fields', () => {
    const checkpoint = {
      artifactId: 'checkpoint-1',
      relativePath: 'checkpoints/checkpoint-1.pt',
      schemaVersion: '1.0.0',
      sha256: hash('b'),
      configurationFingerprint: hash('c'),
    };
    expect(researchLstmTrainingOperationRequestSchema.safeParse({
      ...payload(),
      checkpoint,
    }).success).toBe(true);
    expect(researchLstmTrainingOperationRequestSchema.safeParse({
      ...payload(),
      checkpoint: { ...checkpoint, unknown: true },
    }).success).toBe(false);

    const result = {
      operation: 'train' as const,
      contractVersion: RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION,
      terminalStatus: 'succeeded' as const,
      trainingSessionId: 'training-1',
      modelId: 'model-1',
      modelVersionId: 'version-1',
      resourcePlanDecisionId: 'decision-1',
      configurationFingerprint: hash('c'),
      completedGeometry: {
        epochsCompleted: 5,
        batchesCompleted: 10,
        trainSamples: 100,
        validationSamples: 20,
        testSamples: 20,
        processCount: 1,
        threadsPerProcess: 4,
      },
      metrics: {
        bestValidationSharpe: 1.2,
        holdoutSharpe: 1.1,
        holdoutMeanReturn: 0.01,
        holdoutVolatility: 0.02,
      },
      lineage: {
        inputReferenceId: 'lstm-data',
        inputSha256: hash('a'),
        checkpointArtifactId: null,
      },
      artifacts: [
        { artifactId: 'model-1', artifactKind: 'model' as const, schemaVersion: '1.0.0', sha256: hash('d') },
        { artifactId: 'checkpoint-1', artifactKind: 'checkpoint' as const, schemaVersion: '1.0.0', sha256: hash('e') },
      ],
    };
    expect(researchLstmTrainingOperationResultSchema.parse(result)).toEqual(result);
    expect(researchLstmTrainingOperationResultSchema.safeParse({
      ...result,
      unknown: true,
    }).success).toBe(false);
  });

  it('accepts every required progress and cancellation phase', () => {
    for (const phase of [
      'admission',
      'data-load',
      'matrix-construction',
      'training',
      'evaluation',
      'checkpoint',
      'publication',
    ]) {
      expect(researchWorkerControlMessageSchema.safeParse({
        messageType: 'progress',
        protocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
        correlationId: 'correlation-1',
        sequence: 1,
        sentAt: '2026-08-01T00:00:00Z',
        requestId: 'request-1',
        decisionId: 'decision-1',
        phase,
        completedUnits: 0,
        totalUnits: 1,
        statusText: phase,
      }).success).toBe(true);
    }
  });
});
