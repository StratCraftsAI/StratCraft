import { z } from 'zod';
import {
  COMMERCIAL_HOST_ROLES,
  COMMERCIAL_OPERATION_CONTRACT_VERSION,
  commercialHostRoleSchema,
} from './commercial-operation';

export const RESEARCH_WORKER_PROTOCOL_VERSION = '1.0.0' as const;
export const RESEARCH_WORKER_PROTOCOL_MAJOR = 1 as const;
export const RESEARCH_WORKER_CONTRACT_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKER_DISCOVERY_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKER_PACKAGE_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION = '1.0.0' as const;
export const RESEARCH_DISCOVERY_OPERATION_CONTRACT_VERSION = '1.0.0' as const;
export const RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION = '1.0.0' as const;

export const RESEARCH_WORKER_CONTROL_TRANSPORT = 'stdio-jsonl' as const;
export const RESEARCH_WORKER_BULK_FORMATS = ['arrow-ipc', 'parquet'] as const;
export const RESEARCH_WORKER_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
] as const;
export const RESEARCH_WORKER_CAPABILITY_IDS = [
  'research.discovery',
  'research.factor-evaluation',
  'research.fusion',
  'research.scoring',
  'research.promotion',
  'research.governance',
  'research.lstm-training',
] as const;

/**
 * TICKET_1304_16 P2: the `capability/operation` pairs the research worker
 * dispatches to a `nona_algorithm` Python entry point instead of to an
 * in-process C++ kernel. Mirrors `isPythonEntryCommand` in
 * `packages/research-kernels/src/python_entry_commands.cpp`.
 *
 * This list is shared rather than file-local because two callers must agree on
 * it and neither can see the other's copy: the host decides whether to hand the
 * worker an approved interpreter (`STRATCRAFT_RESEARCH_PYTHON_EXECUTABLE`), and
 * the package's worker-contract double mirrors the binary's admission. A
 * private copy on either side means a command that runs in one and refuses in
 * the other -- which is exactly how `research.scoring/score-one-signal` came to
 * be routable by the binary while the host handed it no interpreter
 * (TICKET_1304_16 stream B).
 */
export const RESEARCH_WORKER_PYTHON_ENTRY_COMMANDS = [
  'research.scoring/score-one-signal',
  'research.factor-evaluation/predict-only',
  'research.factor-evaluation/evaluate-signal-on-ohlcv',
  'research.discovery/fit-one',
  'research.discovery/fit-universe',
] as const;

/**
 * True when a worker request would spawn an interpreter, and therefore needs
 * the host-approved Python executable in its enforced environment.
 */
export function isResearchWorkerPythonEntryCommand(
  capabilityId: string,
  operation: unknown,
): boolean {
  if (typeof operation !== 'string' || operation.length === 0) return false;
  return (RESEARCH_WORKER_PYTHON_ENTRY_COMMANDS as readonly string[])
    .includes(`${capabilityId}/${operation}`);
}

export const RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES = 1_048_576 as const;
export const RESEARCH_WORKER_MAX_DATA_REFERENCES = 256 as const;
export const RESEARCH_WORKER_MAX_ARTIFACT_REFERENCES = 256 as const;
export const RESEARCH_WORKER_MAX_CAPABILITIES = 64 as const;
export const RESEARCH_WORKER_MAX_PACKAGE_FILES = 16_384 as const;

/**
 * TICKET_1304_16 section 22: upper bound on `libraryRelativePaths` per platform
 * executable. A worker needs its own bundled library directories on the loader
 * path; a handful is the realistic shape (one vendored runtime plus its
 * dependencies), and the bound keeps a malformed manifest from producing an
 * unbounded loader path.
 */
export const RESEARCH_WORKER_MAX_RUNTIME_PATHS = 8 as const;

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const semanticVersionSchema = z.string().regex(
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const utcSchema = z.string().datetime({ offset: true });
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const portableRelativePathSchema = z.string().min(1).max(1_024).refine((value) => {
  if (value.includes('\\') || value.includes('\0') || value.includes(':')) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}, 'Paths must be normalized portable paths relative to the package or request exchange root.');

const finitePositiveSchema = z.number().positive().finite();
const finiteNonNegativeSchema = z.number().nonnegative().finite();

const lstmUtcWindowSchema = z.object({
  startUtc: utcSchema,
  endUtc: utcSchema,
}).strict().superRefine((window, context) => {
  if (Date.parse(window.startUtc) >= Date.parse(window.endUtc)) {
    context.addIssue({
      code: 'custom',
      path: ['endUtc'],
      message: 'The UTC window must be non-empty.',
    });
  }
});

const lstmFeatureSchema = z.object({
  name: idSchema,
  dataType: z.enum(['float32', 'float64']),
  role: z.enum(['score', 'metadata']),
}).strict();

const lstmCheckpointReferenceSchema = z.object({
  artifactId: idSchema,
  relativePath: portableRelativePathSchema,
  schemaVersion: semanticVersionSchema,
  sha256: hashSchema,
  configurationFingerprint: hashSchema,
}).strict();

export const researchLstmTrainingOperationRequestSchema = z.object({
  operation: z.enum(['prepare', 'train', 'evaluate', 'checkpoint']),
  contractVersion: z.literal(RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION),
  trainingSessionId: idSchema,
  modelId: idSchema,
  modelVersionId: idSchema,
  resourcePlanDecisionId: idSchema,
  data: z.object({
    inputReferenceId: idSchema,
    timestampColumn: idSchema,
    targetEndTimestampColumn: idSchema,
    symbolColumn: idSchema,
    signalIdColumn: idSchema,
    targetColumn: idSchema,
  }).strict(),
  featureSchema: z.array(lstmFeatureSchema).min(2).max(128),
  signalIds: z.array(idSchema).min(2).max(256),
  split: z.object({
    train: lstmUtcWindowSchema,
    validation: lstmUtcWindowSchema,
    test: lstmUtcWindowSchema,
    embargoBars: nonNegativeSafeIntegerSchema,
  }).strict(),
  architecture: z.object({
    kind: z.literal('shared-encoder-lstm-v1'),
    lookbackBars: positiveSafeIntegerSchema.max(4_096),
    hiddenSize: positiveSafeIntegerSchema.max(1_024),
    numLayers: positiveSafeIntegerSchema.max(16),
    dropout: z.number().min(0).max(1).finite(),
    metadataFeatureCount: positiveSafeIntegerSchema.max(127),
  }).strict(),
  optimizer: z.object({
    kind: z.literal('adam'),
    learningRate: finitePositiveSchema,
    beta1: z.number().gt(0).lt(1).finite(),
    beta2: z.number().gt(0).lt(1).finite(),
    epsilon: finitePositiveSchema,
    weightDecay: finiteNonNegativeSchema,
    gradientClipNorm: finitePositiveSchema,
  }).strict(),
  seed: nonNegativeSafeIntegerSchema,
  epochs: positiveSafeIntegerSchema.max(100_000),
  batchSize: positiveSafeIntegerSchema.max(1_048_576),
  earlyStop: z.object({
    patience: positiveSafeIntegerSchema,
    minimumImprovement: finiteNonNegativeSchema,
  }).strict(),
  checkpoint: lstmCheckpointReferenceSchema.nullable(),
}).strict().superRefine((request, context) => {
  const featureNames = request.featureSchema.map(({ name }) => name);
  if (new Set(featureNames).size !== featureNames.length) {
    context.addIssue({
      code: 'custom',
      path: ['featureSchema'],
      message: 'Feature names and their declared order must be unique.',
    });
  }
  if (request.featureSchema.filter(({ role }) => role === 'score').length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['featureSchema'],
      message: 'Shared-encoder training requires exactly one ordered score feature.',
    });
  }
  if (
    request.featureSchema.filter(({ role }) => role === 'metadata').length
      !== request.architecture.metadataFeatureCount
  ) {
    context.addIssue({
      code: 'custom',
      path: ['architecture', 'metadataFeatureCount'],
      message: 'metadataFeatureCount must equal the ordered metadata feature count.',
    });
  }
  if (new Set(request.signalIds).size !== request.signalIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['signalIds'],
      message: 'Signal IDs and their declared order must be unique.',
    });
  }
  const trainEnd = Date.parse(request.split.train.endUtc);
  const validationStart = Date.parse(request.split.validation.startUtc);
  const validationEnd = Date.parse(request.split.validation.endUtc);
  const testStart = Date.parse(request.split.test.startUtc);
  if (trainEnd >= validationStart || validationEnd >= testStart) {
    context.addIssue({
      code: 'custom',
      path: ['split'],
      message: 'Train, validation, and test windows must be ordered and disjoint.',
    });
  }
});

export const researchLstmTrainingOperationResultSchema = z.object({
  operation: z.enum(['prepare', 'train', 'evaluate', 'checkpoint']),
  contractVersion: z.literal(RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION),
  terminalStatus: z.enum(['prepared', 'succeeded', 'checkpointed']),
  trainingSessionId: idSchema,
  modelId: idSchema,
  modelVersionId: idSchema,
  resourcePlanDecisionId: idSchema,
  configurationFingerprint: hashSchema,
  completedGeometry: z.object({
    epochsCompleted: nonNegativeSafeIntegerSchema,
    batchesCompleted: nonNegativeSafeIntegerSchema,
    trainSamples: nonNegativeSafeIntegerSchema,
    validationSamples: nonNegativeSafeIntegerSchema,
    testSamples: nonNegativeSafeIntegerSchema,
    processCount: positiveSafeIntegerSchema,
    threadsPerProcess: positiveSafeIntegerSchema,
  }).strict(),
  metrics: z.object({
    bestValidationSharpe: z.number().finite(),
    holdoutSharpe: z.number().finite(),
    holdoutMeanReturn: z.number().finite(),
    holdoutVolatility: finiteNonNegativeSchema,
  }).strict().nullable(),
  lineage: z.object({
    inputReferenceId: idSchema,
    inputSha256: hashSchema,
    checkpointArtifactId: idSchema.nullable(),
  }).strict(),
  artifacts: z.array(z.object({
    artifactId: idSchema,
    artifactKind: z.enum(['model', 'checkpoint']),
    schemaVersion: semanticVersionSchema,
    sha256: hashSchema,
  }).strict()).max(2),
}).strict();

export const researchWorkerCapabilityIdSchema = z.enum(RESEARCH_WORKER_CAPABILITY_IDS);
export const researchWorkerPlatformSchema = z.enum(RESEARCH_WORKER_PLATFORMS);

export const researchWorkerProtocolRangeSchema = z.object({
  minimum: semanticVersionSchema,
  current: semanticVersionSchema,
}).strict().superRefine((range, context) => {
  const minimum = parseSemanticVersion(range.minimum);
  const current = parseSemanticVersion(range.current);
  if (
    minimum === null
    || current === null
    || compareSemanticVersions(minimum, current) > 0
    || minimum.major !== current.major
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Protocol minimum and current must form an ordered range within one major version.',
    });
  }
});

export const researchWorkerWindowSchema = z.object({
  startUtc: utcSchema,
  endUtc: utcSchema,
}).strict().superRefine((window, context) => {
  if (Date.parse(window.startUtc) >= Date.parse(window.endUtc)) {
    context.addIssue({
      code: 'custom',
      message: 'Window startUtc must be before endUtc.',
    });
  }
});

export const researchWorkerDataReferenceSchema = z.object({
  referenceId: idSchema,
  relativePath: portableRelativePathSchema,
  format: z.enum(RESEARCH_WORKER_BULK_FORMATS),
  schemaId: idSchema,
  schemaVersion: semanticVersionSchema,
  requestedWindow: researchWorkerWindowSchema,
  materializedWindow: researchWorkerWindowSchema.nullable(),
  windowPushdownDecisionId: idSchema,
  rowCount: nonNegativeSafeIntegerSchema,
  byteCount: nonNegativeSafeIntegerSchema,
  sha256: hashSchema,
}).strict().superRefine((reference, context) => {
  if (reference.rowCount === 0) {
    if (reference.byteCount !== 0 || reference.materializedWindow !== null) {
      context.addIssue({
        code: 'custom',
        message: 'An empty data reference must have zero bytes and no materialized window.',
      });
    }
    return;
  }
  if (reference.byteCount === 0 || reference.materializedWindow === null) {
    context.addIssue({
      code: 'custom',
      message: 'A non-empty data reference requires bytes and a materialized window.',
    });
    return;
  }
  if (
    Date.parse(reference.materializedWindow.startUtc) < Date.parse(reference.requestedWindow.startUtc)
    || Date.parse(reference.materializedWindow.endUtc) > Date.parse(reference.requestedWindow.endUtc)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['materializedWindow'],
      message: 'The materialized window must be bounded by the requested window.',
    });
  }
});

export const researchWorkerResourcePlanSchema = z.object({
  schemaVersion: z.literal(RESEARCH_WORKER_CONTRACT_SCHEMA_VERSION),
  decisionId: idSchema,
  effectiveCapacity: z.object({
    hostAvailableCpuCores: z.number().positive().finite(),
    effectiveCpuCores: z.number().positive().finite(),
    hostAvailableMemoryBytes: positiveSafeIntegerSchema,
    effectiveMemoryBytes: positiveSafeIntegerSchema,
    reservedCpuCores: z.number().nonnegative().finite(),
    reservedMemoryBytes: nonNegativeSafeIntegerSchema,
    cpuLimitSource: z.enum(['host', 'cgroup-v1', 'cgroup-v2', 'systemd', 'job-object']),
    memoryLimitSource: z.enum(['host', 'cgroup-v1', 'cgroup-v2', 'systemd', 'job-object']),
  }).strict(),
  workload: z.object({
    processCount: positiveSafeIntegerSchema,
    threadsPerProcess: positiveSafeIntegerSchema,
    totalThreadBudget: positiveSafeIntegerSchema,
    measuredPeakBytesPerProcess: positiveSafeIntegerSchema,
    memorySafetyMarginBytes: nonNegativeSafeIntegerSchema,
    admittedPeakMemoryBytes: positiveSafeIntegerSchema,
    bindingConstraint: z.enum(['cpu', 'memory', 'io', 'configured-cap', 'single-process-floor']),
  }).strict(),
  backpressure: z.object({
    enabled: z.literal(true),
    pauseAboveMemoryBytes: positiveSafeIntegerSchema,
    resumeBelowMemoryBytes: positiveSafeIntegerSchema,
  }).strict(),
  enforcement: z.object({
    decisionId: idSchema,
    kind: z.enum(['cgroup-v1', 'cgroup-v2', 'systemd-scope', 'job-object', 'process-limits']),
    cpuLimitCores: z.number().positive().finite(),
    memoryLimitBytes: positiveSafeIntegerSchema,
  }).strict(),
}).strict().superRefine((plan, context) => {
  const { effectiveCapacity, workload, backpressure, enforcement } = plan;
  const singleProcessThreadFloor = Math.max(1, Math.floor(effectiveCapacity.effectiveCpuCores));
  if (effectiveCapacity.effectiveCpuCores > effectiveCapacity.hostAvailableCpuCores) {
    context.addIssue({
      code: 'custom',
      path: ['effectiveCapacity', 'effectiveCpuCores'],
      message: 'Effective CPU cannot exceed host-available CPU.',
    });
  }
  if (effectiveCapacity.effectiveMemoryBytes > effectiveCapacity.hostAvailableMemoryBytes) {
    context.addIssue({
      code: 'custom',
      path: ['effectiveCapacity', 'effectiveMemoryBytes'],
      message: 'Effective memory cannot exceed host-available memory.',
    });
  }
  if (
    workload.processCount * workload.threadsPerProcess > workload.totalThreadBudget
    || workload.totalThreadBudget > singleProcessThreadFloor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['workload', 'totalThreadBudget'],
      message: 'Process and thread demand must fit the effective CPU share.',
    });
  }
  const computedPeak =
    workload.processCount * workload.measuredPeakBytesPerProcess
    + workload.memorySafetyMarginBytes;
  if (
    workload.admittedPeakMemoryBytes !== computedPeak
    || workload.admittedPeakMemoryBytes > effectiveCapacity.effectiveMemoryBytes
  ) {
    context.addIssue({
      code: 'custom',
      path: ['workload', 'admittedPeakMemoryBytes'],
      message: 'Admitted peak must include every process plus the safety margin and fit memory.',
    });
  }
  if (
    backpressure.resumeBelowMemoryBytes >= backpressure.pauseAboveMemoryBytes
    || backpressure.pauseAboveMemoryBytes > enforcement.memoryLimitBytes
  ) {
    context.addIssue({
      code: 'custom',
      path: ['backpressure'],
      message: 'Backpressure thresholds must be ordered below the enforced memory limit.',
    });
  }
  if (
    enforcement.decisionId !== plan.decisionId
    || enforcement.cpuLimitCores !== effectiveCapacity.effectiveCpuCores
    || enforcement.memoryLimitBytes !== effectiveCapacity.effectiveMemoryBytes
  ) {
    context.addIssue({
      code: 'custom',
      path: ['enforcement'],
      message: 'Admission, runtime, and kernel enforcement must consume the same decision and limits.',
    });
  }
});

const capabilityDescriptorSchema = z.object({
  capabilityId: researchWorkerCapabilityIdSchema,
  contractVersion: semanticVersionSchema,
}).strict();

export const researchDiscoveryOperationRequestSchema = z.object({
  operation: z.literal('discover'),
  workflowId: idSchema,
  inputReferenceIds: z.array(idSchema).min(1).max(RESEARCH_WORKER_MAX_DATA_REFERENCES),
  candidate: z.object({
    candidateId: idSchema,
    featureColumn: idSchema,
    targetColumn: idSchema,
  }).strict(),
  training: z.object({
    kind: z.enum(['ridge', 'python-ridge-v1']),
    l2Regularization: z.number().nonnegative().finite(),
  }).strict(),
  evaluation: z.object({
    minimumRows: positiveSafeIntegerSchema,
  }).strict(),
  artifact: z.object({
    artifactId: idSchema,
  }).strict(),
}).strict().superRefine((request, context) => {
  if (new Set(request.inputReferenceIds).size !== request.inputReferenceIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['inputReferenceIds'],
      message: 'Discovery input reference IDs must be unique.',
    });
  }
  if (request.candidate.featureColumn === request.candidate.targetColumn) {
    context.addIssue({
      code: 'custom',
      path: ['candidate'],
      message: 'Discovery feature and target columns must be different.',
    });
  }
});

const researchDiscoveryInputLineageSchema = z.object({
  referenceId: idSchema,
  sha256: hashSchema,
  requestedWindow: researchWorkerWindowSchema,
  windowPushdownDecisionId: idSchema,
}).strict();

export const researchDiscoveryOperationResultSchema = z.object({
  operation: z.literal('discover'),
  workflowId: idSchema,
  resourceDecisionId: idSchema,
  inputLineage: z.array(researchDiscoveryInputLineageSchema)
    .min(1)
    .max(RESEARCH_WORKER_MAX_DATA_REFERENCES),
  candidateCount: positiveSafeIntegerSchema,
  trainedCandidateCount: positiveSafeIntegerSchema,
  evaluatedCandidateCount: positiveSafeIntegerSchema,
  selectedCandidateId: idSchema,
  metrics: z.object({
    observations: positiveSafeIntegerSchema,
    intercept: z.number().finite(),
    slope: z.number().finite(),
    correlation: z.number().min(-1).max(1).finite(),
    meanSquaredError: z.number().nonnegative().finite(),
  }).strict(),
  publishedArtifactIds: z.array(idSchema).min(1).max(RESEARCH_WORKER_MAX_ARTIFACT_REFERENCES),
}).strict().superRefine((result, context) => {
  if (
    result.trainedCandidateCount > result.candidateCount
    || result.evaluatedCandidateCount > result.trainedCandidateCount
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Discovery candidate counts must decrease monotonically through the workflow.',
    });
  }
  if (new Set(result.inputLineage.map(({ referenceId }) => referenceId)).size
    !== result.inputLineage.length) {
    context.addIssue({
      code: 'custom',
      path: ['inputLineage'],
      message: 'Discovery input lineage references must be unique.',
    });
  }
  if (new Set(result.publishedArtifactIds).size !== result.publishedArtifactIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['publishedArtifactIds'],
      message: 'Published discovery Artifact IDs must be unique.',
    });
  }
});

export const researchWorkerDiscoveryDescriptorSchema = z.object({
  schemaVersion: z.literal(RESEARCH_WORKER_DISCOVERY_SCHEMA_VERSION),
  packageId: z.literal('com.stratcraft.quant-lab'),
  workerId: z.literal('stratcraft-research-worker'),
  packageVersion: semanticVersionSchema,
  protocol: researchWorkerProtocolRangeSchema,
  controlTransport: z.literal(RESEARCH_WORKER_CONTROL_TRANSPORT),
  executableRelativePath: portableRelativePathSchema,
  capabilities: z.array(capabilityDescriptorSchema)
    .min(1)
    .max(RESEARCH_WORKER_MAX_CAPABILITIES),
}).strict().superRefine((descriptor, context) => {
  if (new Set(descriptor.capabilities.map(({ capabilityId }) => capabilityId)).size
    !== descriptor.capabilities.length) {
    context.addIssue({
      code: 'custom',
      path: ['capabilities'],
      message: 'Capability declarations must be unique.',
    });
  }
});

export const researchWorkerHostDiscoverySchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('absent'),
  }).strict(),
  z.object({
    state: z.literal('ready'),
    packageVersion: semanticVersionSchema,
    protocolVersion: semanticVersionSchema,
    capabilities: z.array(capabilityDescriptorSchema)
      .min(1)
      .max(RESEARCH_WORKER_MAX_CAPABILITIES),
    packageManifestSha256: hashSchema,
  }).strict(),
  z.object({
    state: z.literal('error'),
    code: z.enum([
      'WORKER_SIGNATURE_INVALID',
      'WORKER_PROTOCOL_INCOMPATIBLE',
      'WORKER_REQUEST_INVALID',
    ]),
    message: z.string().min(1),
    remediation: z.string().min(1),
  }).strict(),
]);

const platformExecutableSchema = z.object({
  platform: researchWorkerPlatformSchema,
  relativePath: portableRelativePathSchema,
  sha256: hashSchema,
  /**
   * TICKET_1304_16 section 22: directories the worker needs on its own runtime
   * search path, relative to the package root and per platform.
   *
   * The executable links libraries (libtorch) that do not resolve from the
   * default loader path, so without this the process cannot start at all --
   * measured in section 20.1. The host turns these into the platform's loader
   * variable; the package declares WHERE they are because only the package
   * knows its own layout, and the manifest is signed so the host is not
   * trusting an unverified path.
   */
  libraryRelativePaths: z.array(portableRelativePathSchema).max(
    RESEARCH_WORKER_MAX_RUNTIME_PATHS,
  ).optional(),
}).strict();

export const researchWorkerPackageManifestSchema = z.object({
  schemaVersion: z.literal(RESEARCH_WORKER_PACKAGE_SCHEMA_VERSION),
  packageId: z.literal('com.stratcraft.quant-lab'),
  packageVersion: semanticVersionSchema,
  discoveryDescriptorRelativePath: portableRelativePathSchema,
  hostModule: z.object({
    relativePath: portableRelativePathSchema,
    sha256: hashSchema,
    contractVersion: z.literal(RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION),
    operationContractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
    registerExport: z.literal('registerCommercialHostCapabilities'),
    supportedHostRoles: z.array(commercialHostRoleSchema).min(1).max(
      COMMERCIAL_HOST_ROLES.length,
    ),
  }).strict(),
  protocol: researchWorkerProtocolRangeSchema,
  /**
   * TICKET_1304_16 section 22: the `nona_algorithm` package root, relative to
   * the package root.
   *
   * Every Python entry command (`score-one-signal`, `predict-only`, `fit-one`,
   * `fit-universe`) and the signal evaluation operation refuse to run without
   * it -- `python_entry_commands.cpp:109` and
   * `signal_evaluation_operation.cpp:341`. It is optional here because a
   * package that ships no Python entry points owes no algorithm root; the host
   * only exports the variable when the package declares one, so a C++-only
   * package is unaffected.
   */
  algorithmRootRelativePath: portableRelativePathSchema.optional(),
  executables: z.array(platformExecutableSchema).min(1).max(RESEARCH_WORKER_PLATFORMS.length),
  signedFiles: z.array(z.object({
    relativePath: portableRelativePathSchema,
    sha256: hashSchema,
  }).strict()).min(1).max(RESEARCH_WORKER_MAX_PACKAGE_FILES),
  signature: z.object({
    algorithm: z.literal('Ed25519'),
    publisherId: z.literal('com.stratcraft'),
    keyId: idSchema,
    signatureRelativePath: portableRelativePathSchema,
  }).strict(),
  lifecycle: z.object({
    atomicInstall: z.literal(true),
    healthCheckCommand: z.array(z.string().min(1).max(256)).min(1).max(16),
    rollbackSupported: z.literal(true),
    uninstallRemoves: z.array(portableRelativePathSchema).min(1).max(RESEARCH_WORKER_MAX_PACKAGE_FILES),
  }).strict(),
  upgradesFrom: z.array(semanticVersionSchema).max(256),
}).strict().superRefine((manifest, context) => {
  const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
  if (!unique(manifest.executables.map(({ platform }) => platform))) {
    context.addIssue({
      code: 'custom',
      path: ['executables'],
      message: 'A package may declare at most one executable per platform.',
    });
  }
  if (!unique(manifest.signedFiles.map(({ relativePath }) => relativePath))) {
    context.addIssue({
      code: 'custom',
      path: ['signedFiles'],
      message: 'Signed file paths must be unique.',
    });
  }
  if (!unique(manifest.lifecycle.uninstallRemoves)) {
    context.addIssue({
      code: 'custom',
      path: ['lifecycle', 'uninstallRemoves'],
      message: 'Uninstall targets must be unique.',
    });
  }
  if (!unique(manifest.upgradesFrom)) {
    context.addIssue({
      code: 'custom',
      path: ['upgradesFrom'],
      message: 'Upgrade source versions must be unique.',
    });
  }
  if (!unique(manifest.hostModule.supportedHostRoles)) {
    context.addIssue({
      code: 'custom',
      path: ['hostModule', 'supportedHostRoles'],
      message: 'Supported host roles must be unique.',
    });
  }
  const signedPaths = new Set(manifest.signedFiles.map(({ relativePath }) => relativePath));
  const requiredPaths = [
    manifest.discoveryDescriptorRelativePath,
    manifest.hostModule.relativePath,
    ...manifest.executables.map(({ relativePath }) => relativePath),
  ];
  if (requiredPaths.some((path) => !signedPaths.has(path))) {
    context.addIssue({
      code: 'custom',
      path: ['signedFiles'],
      message: 'The discovery descriptor, host module, and every executable must be signed.',
    });
  }
  const signedHostModule = manifest.signedFiles.find(
    ({ relativePath }) => relativePath === manifest.hostModule.relativePath,
  );
  if (signedHostModule !== undefined && signedHostModule.sha256 !== manifest.hostModule.sha256) {
    context.addIssue({
      code: 'custom',
      path: ['hostModule', 'sha256'],
      message: 'The executable host entrypoint hash must match its signed-file hash.',
    });
  }
});

const messageBase = {
  protocolVersion: z.literal(RESEARCH_WORKER_PROTOCOL_VERSION),
  correlationId: idSchema,
  sequence: nonNegativeSafeIntegerSchema,
  sentAt: utcSchema,
};

const requestIdentity = {
  requestId: idSchema,
  decisionId: idSchema,
};

const artifactReferenceSchema = z.object({
  artifactId: idSchema,
  artifactKind: z.enum(['strategy', 'signal', 'model', 'checkpoint', 'evidence', 'result']),
  relativePath: portableRelativePathSchema,
  schemaId: idSchema,
  schemaVersion: semanticVersionSchema,
  byteCount: nonNegativeSafeIntegerSchema,
  sha256: hashSchema,
  publicationTransactionId: idSchema,
  publicationState: z.enum(['staged', 'published']),
}).strict();

export const researchWorkerExecuteRequestSchema = z.object({
  messageType: z.literal('execute'),
  ...messageBase,
  ...requestIdentity,
  capabilityId: researchWorkerCapabilityIdSchema,
  operationContractVersion: semanticVersionSchema,
  dataReferences: z.array(researchWorkerDataReferenceSchema)
    .max(RESEARCH_WORKER_MAX_DATA_REFERENCES),
  resourcePlan: researchWorkerResourcePlanSchema,
  requestPayload: z.record(z.string().min(1).max(128), z.unknown()),
}).strict().superRefine((request, context) => {
  if (request.resourcePlan.decisionId !== request.decisionId) {
    context.addIssue({
      code: 'custom',
      path: ['resourcePlan', 'decisionId'],
      message: 'The worker request must consume its authoritative resource decision.',
    });
  }
  if (new Set(request.dataReferences.map(({ referenceId }) => referenceId)).size
    !== request.dataReferences.length) {
    context.addIssue({
      code: 'custom',
      path: ['dataReferences'],
      message: 'Data reference IDs must be unique.',
    });
  }
  if (request.capabilityId === 'research.discovery') {
    if (request.operationContractVersion !== RESEARCH_DISCOVERY_OPERATION_CONTRACT_VERSION) {
      context.addIssue({
        code: 'custom',
        path: ['operationContractVersion'],
        message: `research.discovery requires contract ${RESEARCH_DISCOVERY_OPERATION_CONTRACT_VERSION}.`,
      });
    }
    const discovery = researchDiscoveryOperationRequestSchema.safeParse(request.requestPayload);
    if (!discovery.success) {
      for (const issue of discovery.error.issues) {
        context.addIssue({
          code: 'custom',
          path: ['requestPayload', ...issue.path],
          message: issue.message,
        });
      }
    } else {
      const declared = new Set(request.dataReferences.map(({ referenceId }) => referenceId));
      const consumed = new Set(discovery.data.inputReferenceIds);
      if (declared.size !== consumed.size || [...declared].some((id) => !consumed.has(id))) {
        context.addIssue({
          code: 'custom',
          path: ['requestPayload', 'inputReferenceIds'],
          message: 'research.discovery must consume every bounded data reference exactly once.',
        });
      }
    }
  }
  if (request.capabilityId === 'research.lstm-training') {
    if (
      request.operationContractVersion
        !== RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operationContractVersion'],
        message:
          `research.lstm-training requires contract ${RESEARCH_LSTM_TRAINING_OPERATION_CONTRACT_VERSION}.`,
      });
    }
    const training = researchLstmTrainingOperationRequestSchema.safeParse(
      request.requestPayload,
    );
    if (!training.success) {
      for (const issue of training.error.issues) {
        context.addIssue({
          code: 'custom',
          path: ['requestPayload', ...issue.path],
          message: issue.message,
        });
      }
    } else {
      if (training.data.resourcePlanDecisionId !== request.decisionId) {
        context.addIssue({
          code: 'custom',
          path: ['requestPayload', 'resourcePlanDecisionId'],
          message: 'LSTM training must consume the authoritative resource-plan decision.',
        });
      }
      const references = request.dataReferences.filter(
        ({ referenceId }) => referenceId === training.data.data.inputReferenceId,
      );
      if (request.dataReferences.length !== 1 || references.length !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['dataReferences'],
          message: 'LSTM training must consume its one bounded data reference exactly once.',
        });
      } else {
        const reference = references[0]!;
        const requestedStart = Date.parse(reference.requestedWindow.startUtc);
        const requestedEnd = Date.parse(reference.requestedWindow.endUtc);
        const splitStart = Date.parse(training.data.split.train.startUtc);
        const splitEnd = Date.parse(training.data.split.test.endUtc);
        if (requestedStart > splitStart || requestedEnd < splitEnd) {
          context.addIssue({
            code: 'custom',
            path: ['dataReferences', 0, 'requestedWindow'],
            message: 'The bounded data window must contain every governed split window.',
          });
        }
      }
    }
  }
});

const hostHelloSchema = z.object({
  messageType: z.literal('host-hello'),
  ...messageBase,
  hostProtocol: researchWorkerProtocolRangeSchema,
  hostVersion: semanticVersionSchema,
  expectedPackageId: z.literal('com.stratcraft.quant-lab'),
  expectedPackageManifestSha256: hashSchema,
}).strict();

const workerHelloSchema = z.object({
  messageType: z.literal('worker-hello'),
  ...messageBase,
  selectedProtocolVersion: z.literal(RESEARCH_WORKER_PROTOCOL_VERSION),
  workerVersion: semanticVersionSchema,
  packageManifestSha256: hashSchema,
  capabilities: z.array(capabilityDescriptorSchema)
    .min(1)
    .max(RESEARCH_WORKER_MAX_CAPABILITIES),
}).strict();

const acceptedSchema = z.object({
  messageType: z.literal('accepted'),
  ...messageBase,
  ...requestIdentity,
}).strict();

const progressSchema = z.object({
  messageType: z.literal('progress'),
  ...messageBase,
  ...requestIdentity,
  phase: z.enum([
    'admission',
    'data-load',
    'matrix-construction',
    'generation',
    'training',
    'kernel-execution',
    'evaluation',
    'checkpoint',
    'persistence',
    'publication',
  ]),
  completedUnits: nonNegativeSafeIntegerSchema,
  totalUnits: positiveSafeIntegerSchema,
  statusText: z.string().min(1).max(512),
}).strict().superRefine((progress, context) => {
  if (progress.completedUnits > progress.totalUnits) {
    context.addIssue({
      code: 'custom',
      path: ['completedUnits'],
      message: 'Progress cannot exceed total units.',
    });
  }
});

const cancelSchema = z.object({
  messageType: z.literal('cancel'),
  ...messageBase,
  ...requestIdentity,
  reason: z.enum(['user-request', 'host-shutdown', 'resource-revocation', 'upgrade']),
}).strict();

const cancelledSchema = z.object({
  messageType: z.literal('cancelled'),
  ...messageBase,
  ...requestIdentity,
  phase: z.enum([
    'queued',
    'admission',
    'data-load',
    'matrix-construction',
    'generation',
    'training',
    'kernel-execution',
    'evaluation',
    'checkpoint',
    'persistence',
    'publication',
  ]),
  artifactsPublished: z.boolean(),
}).strict();

const artifactSchema = z.object({
  messageType: z.literal('artifact'),
  ...messageBase,
  ...requestIdentity,
  artifact: artifactReferenceSchema,
}).strict();

const artifactPublishedSchema = z.object({
  messageType: z.literal('artifact-published'),
  ...messageBase,
  ...requestIdentity,
  artifact: artifactReferenceSchema.superRefine((artifact, context) => {
    if (artifact.publicationState !== 'published') {
      context.addIssue({
        code: 'custom',
        path: ['publicationState'],
        message: 'Artifact publication acknowledgement must contain a published Artifact.',
      });
    }
  }),
}).strict();

const resultSchema = z.object({
  messageType: z.literal('result'),
  ...messageBase,
  ...requestIdentity,
  status: z.literal('succeeded'),
  artifacts: z.array(artifactReferenceSchema)
    .max(RESEARCH_WORKER_MAX_ARTIFACT_REFERENCES),
  resultPayload: z.record(z.string().min(1).max(128), z.unknown()),
}).strict().superRefine((result, context) => {
  if (result.artifacts.some(({ publicationState }) => publicationState !== 'published')) {
    context.addIssue({
      code: 'custom',
      path: ['artifacts'],
      message: 'A successful result may reference only atomically published Artifacts.',
    });
  }
  if (result.resultPayload.operation === 'discover') {
    const discovery = researchDiscoveryOperationResultSchema.safeParse(result.resultPayload);
    if (!discovery.success) {
      for (const issue of discovery.error.issues) {
        context.addIssue({
          code: 'custom',
          path: ['resultPayload', ...issue.path],
          message: issue.message,
        });
      }
    }
  }
  if (
    typeof result.resultPayload.trainingSessionId === 'string'
    && typeof result.resultPayload.modelVersionId === 'string'
  ) {
    const training = researchLstmTrainingOperationResultSchema.safeParse(
      result.resultPayload,
    );
    if (!training.success) {
      for (const issue of training.error.issues) {
        context.addIssue({
          code: 'custom',
          path: ['resultPayload', ...issue.path],
          message: issue.message,
        });
      }
    }
  }
});

const errorSchema = z.object({
  messageType: z.literal('error'),
  ...messageBase,
  requestId: idSchema.optional(),
  decisionId: idSchema.optional(),
  code: z.enum([
    'WORKER_NOT_INSTALLED',
    'WORKER_SIGNATURE_INVALID',
    'WORKER_PROTOCOL_INCOMPATIBLE',
    'WORKER_ENTITLEMENT_REQUIRED',
    'WORKER_REQUEST_INVALID',
    'WORKER_DATA_INVALID',
    'WORKER_RESOURCE_PLAN_INVALID',
    'WORKER_CHECKPOINT_INCOMPATIBLE',
    'WORKER_CANCELLED',
    'WORKER_CRASHED',
    'WORKER_STORAGE_FAILED',
    'WORKER_INTERNAL_ERROR',
  ]),
  phase: z.enum([
    'discovery',
    'verification',
    'negotiation',
    'admission',
    'data-load',
    'training',
    'generation',
    'kernel-execution',
    'evaluation',
    'persistence',
    'publication',
    'shutdown',
  ]),
  message: z.string().min(1).max(2_048),
  retryable: z.boolean(),
  remediation: z.string().min(1).max(2_048),
  diagnosticsReference: idSchema.optional(),
}).strict().superRefine((error, context) => {
  if ((error.requestId === undefined) !== (error.decisionId === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Request-scoped errors must carry both requestId and decisionId.',
    });
  }
});

export const researchWorkerControlMessageSchema = z.discriminatedUnion('messageType', [
  hostHelloSchema,
  workerHelloSchema,
  researchWorkerExecuteRequestSchema,
  acceptedSchema,
  progressSchema,
  cancelSchema,
  cancelledSchema,
  artifactSchema,
  artifactPublishedSchema,
  resultSchema,
  errorSchema,
]);

export const RESEARCH_WORKER_CONTROL_MESSAGE_V1_JSON_SCHEMA = z.toJSONSchema(
  researchWorkerControlMessageSchema,
  {
    target: 'draft-2020-12',
    io: 'input',
    reused: 'ref',
  },
);

export const RESEARCH_WORKER_DISCOVERY_V1_JSON_SCHEMA = z.toJSONSchema(
  researchWorkerDiscoveryDescriptorSchema,
  {
    target: 'draft-2020-12',
    io: 'input',
    reused: 'ref',
  },
);

export const RESEARCH_WORKER_PACKAGE_V1_JSON_SCHEMA = z.toJSONSchema(
  researchWorkerPackageManifestSchema,
  {
    target: 'draft-2020-12',
    io: 'input',
    reused: 'ref',
  },
);

export const RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA = z.toJSONSchema(
  researchDiscoveryOperationRequestSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export const RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA = z.toJSONSchema(
  researchDiscoveryOperationResultSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export const RESEARCH_LSTM_TRAINING_REQUEST_V1_JSON_SCHEMA = z.toJSONSchema(
  researchLstmTrainingOperationRequestSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export const RESEARCH_LSTM_TRAINING_RESULT_V1_JSON_SCHEMA = z.toJSONSchema(
  researchLstmTrainingOperationResultSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

interface ParsedSemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.exec(value);
  if (match === null) return null;
  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  return Object.values(parsed).every(Number.isSafeInteger) ? parsed : null;
}

function compareSemanticVersions(
  left: ParsedSemanticVersion,
  right: ParsedSemanticVersion,
): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export type ResearchWorkerCompatibilityResult =
  | {
    readonly compatible: true;
    readonly selectedProtocolVersion: typeof RESEARCH_WORKER_PROTOCOL_VERSION;
  }
  | {
    readonly compatible: false;
    readonly errorCode: 'WORKER_PROTOCOL_INCOMPATIBLE';
    readonly reason: string;
  };

export function negotiateResearchWorkerProtocol(
  workerRangeInput: unknown,
): ResearchWorkerCompatibilityResult {
  const parsedRange = researchWorkerProtocolRangeSchema.safeParse(workerRangeInput);
  if (!parsedRange.success) {
    return {
      compatible: false,
      errorCode: 'WORKER_PROTOCOL_INCOMPATIBLE',
      reason: 'The commercial worker advertised a malformed protocol range.',
    };
  }
  const host = parseSemanticVersion(RESEARCH_WORKER_PROTOCOL_VERSION);
  const workerMinimum = parseSemanticVersion(parsedRange.data.minimum);
  const workerCurrent = parseSemanticVersion(parsedRange.data.current);
  if (
    host === null
    || workerMinimum === null
    || workerCurrent === null
    || workerMinimum.major !== RESEARCH_WORKER_PROTOCOL_MAJOR
    || workerCurrent.major !== RESEARCH_WORKER_PROTOCOL_MAJOR
    || compareSemanticVersions(host, workerMinimum) < 0
    || compareSemanticVersions(host, workerCurrent) > 0
  ) {
    return {
      compatible: false,
      errorCode: 'WORKER_PROTOCOL_INCOMPATIBLE',
      reason:
        `The host requires commercial worker protocol ${RESEARCH_WORKER_PROTOCOL_VERSION}; `
        + `the worker supports ${parsedRange.data.minimum} through ${parsedRange.data.current}.`,
    };
  }
  return {
    compatible: true,
    selectedProtocolVersion: RESEARCH_WORKER_PROTOCOL_VERSION,
  };
}

export function parseResearchWorkerControlMessage(
  input: unknown,
): ResearchWorkerControlMessage {
  const encodedByteCount = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (encodedByteCount > RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES) {
    throw new Error(
      `Research worker control message is ${encodedByteCount} bytes; `
      + `the limit is ${RESEARCH_WORKER_MAX_CONTROL_MESSAGE_BYTES} bytes.`,
    );
  }
  return researchWorkerControlMessageSchema.parse(input);
}

export type ResearchWorkerControlMessage = z.infer<typeof researchWorkerControlMessageSchema>;
export type ResearchWorkerExecuteRequest = z.infer<typeof researchWorkerExecuteRequestSchema>;
export type ResearchWorkerResourcePlan = z.infer<typeof researchWorkerResourcePlanSchema>;
export type ResearchLstmTrainingOperationRequest = z.infer<
  typeof researchLstmTrainingOperationRequestSchema
>;
export type ResearchLstmTrainingOperationResult = z.infer<
  typeof researchLstmTrainingOperationResultSchema
>;
export type ResearchWorkerDataReference = z.infer<typeof researchWorkerDataReferenceSchema>;
export type ResearchWorkerDiscoveryDescriptor = z.infer<
  typeof researchWorkerDiscoveryDescriptorSchema
>;
export type ResearchWorkerHostDiscovery = z.infer<typeof researchWorkerHostDiscoverySchema>;
export type ResearchWorkerPackageManifest = z.infer<typeof researchWorkerPackageManifestSchema>;
export type ResearchDiscoveryOperationRequest = z.infer<
  typeof researchDiscoveryOperationRequestSchema
>;
export type ResearchDiscoveryOperationResult = z.infer<
  typeof researchDiscoveryOperationResultSchema
>;
