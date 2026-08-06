import { z } from 'zod';
import type { ConfirmedWorkloadPlan, WorkloadJsonValue, WorkloadPrelaunchReview } from './workload-prelaunch';
import type { FactorMiningDraft } from './factor-mining';

export const COMMERCIAL_OPERATION_CONTRACT_VERSION = '1.0.0' as const;
export const COMMERCIAL_HOST_REGISTRATION_CONTRACT_VERSION = '1.0.0' as const;

export const COMMERCIAL_HOST_ROLES = ['electron', 'service-api'] as const;

export const COMMERCIAL_OPERATION_IDS = [
  'worker.capabilities.discover',
  'research.discovery.execute',
  'research.discovery.generate',
  'research.discovery.assemble',
  'research.discovery.status',
  'research.discovery.cancel',
  'research.sweep.launch',
  'research.sweep.status',
  'research.sweep.cancel',
  'research.scoreboard.read',
  'research.scoreboard.refresh',
  'research.roster.read',
  'research.roster.transition',
  'research.roster.remove',
  'research.relegation.config.read',
  'research.relegation.config.write',
  'research.relegation.cycle',
  'research.promotion.status',
  'research.promotion.register',
  'alpha-factory.config.read',
  'alpha-factory.config.write',
  'alpha-factory.signals.add',
  'alpha-factory.execute',
  'alpha-factory.status',
  'alpha-factory.cancel',
  'research.factor-evaluation.execute',
  'research.progress.subscribe',
  'research.storage.read',
  'research.storage.write',
  // TICKET_1304_13_1: the six domains the 1.0.0 freeze omitted while they were
  // still live on the Base Service API. Without these the 60 legacy routes in
  // http-server.ts have no package-owned equivalent and TICKET_1304_16 cannot
  // remove them, so the contract -- not the call site -- is where they belong.
  'research.sweep.queue.read',
  'research.sweep.queue.enqueue',
  'research.sweep.queue.cancel',
  'research.sweep.queue.clear',
  'research.sweep.history.read',
  'research.sweep.coverage.read',
  'research.leaderboard.read',
  'research.definition-rollup.read',
  'research.signal-run.update',
  'research.signal-run.delete',
  'research.signal-source.read',
  'research.signal-source.confirm',
  'research.signal-source.delete',
  'research.custom-factor.save',
  'research.custom-factor.delete',
  'research.remediation.family-bh',
  'research.chip-regimes.read',
  'research.chip-regimes.write',
  'lstm.manifest.read',
  'lstm.version.activate',
  'lstm.version.delete',
  'lstm.snapshot.list',
  'lstm.snapshot.save',
  'lstm.snapshot.restore',
  'lstm.snapshot.delete',
  'lstm.training.start',
  'lstm.training.status',
  'lstm.training.cancel',
  'lstm.training.history',
  'lstm.fit-quality.read',
  'factor-mining.review',
  'factor-mining.edit',
  'factor-mining.confirm',
  'factor-mining.start',
  'factor-mining.status',
  'factor-mining.sessions.list',
  'factor-mining.catalog.list',
  'factor-mining.catalog.activate',
  'factor-mining.catalog.deactivate',
  'factor-mining.formula.generate',
  'factor-mining.formula.persist',
] as const;

const identifierSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
);
const semanticVersionSchema = z.string().regex(
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type CommercialJsonValue =
  | string
  | number
  | boolean
  | null
  | CommercialJsonValue[]
  | { [key: string]: CommercialJsonValue };
export type CommercialJsonObject = { [key: string]: CommercialJsonValue };
type JsonValue = CommercialJsonValue;
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const commercialHostRoleSchema = z.enum(COMMERCIAL_HOST_ROLES);
export const commercialOperationIdSchema = z.enum(COMMERCIAL_OPERATION_IDS);

export const commercialOperationRequestSchema = z.object({
  contractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
  requestId: identifierSchema,
  operationId: commercialOperationIdSchema,
  input: jsonObjectSchema,
}).strict();

const commercialArtifactProjectionSchema = z.object({
  artifactId: identifierSchema,
  artifactKind: identifierSchema,
  schemaId: identifierSchema,
  schemaVersion: semanticVersionSchema,
  sha256: hashSchema,
}).strict();

export const commercialOperationProgressSchema = z.object({
  contractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
  requestId: identifierSchema,
  operationId: commercialOperationIdSchema,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  phase: identifierSchema,
  message: z.string().min(1).max(2_048),
  completedUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  totalUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((progress, context) => {
  if ((progress.completedUnits === undefined) !== (progress.totalUnits === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['completedUnits'],
      message: 'Progress counts must provide both completedUnits and totalUnits.',
    });
  }
  if (
    progress.completedUnits !== undefined
    && progress.totalUnits !== undefined
    && progress.completedUnits > progress.totalUnits
  ) {
    context.addIssue({
      code: 'custom',
      path: ['completedUnits'],
      message: 'Completed progress units cannot exceed total units.',
    });
  }
});

const commercialOperationSuccessSchema = z.object({
  contractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
  requestId: identifierSchema,
  operationId: commercialOperationIdSchema,
  status: z.literal('succeeded'),
  entitlementDecisionId: identifierSchema,
  resourceDecisionId: identifierSchema.nullable(),
  output: jsonObjectSchema,
  artifacts: z.array(commercialArtifactProjectionSchema).max(256),
}).strict();

const commercialOperationFailureSchema = z.object({
  contractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
  requestId: identifierSchema,
  operationId: commercialOperationIdSchema,
  status: z.literal('failed'),
  code: z.enum([
    'COMMERCIAL_PACKAGE_ABSENT',
    'COMMERCIAL_CONTRACT_INCOMPATIBLE',
    'COMMERCIAL_ENTITLEMENT_DENIED',
    'COMMERCIAL_REQUEST_INVALID',
    'COMMERCIAL_BOUNDED_DATA_FAILED',
    'COMMERCIAL_RESOURCE_ADMISSION_FAILED',
    'COMMERCIAL_WORKER_UNAVAILABLE',
    'COMMERCIAL_OPERATION_FAILED',
    'COMMERCIAL_OPERATION_CANCELLED',
    'COMMERCIAL_STORAGE_FAILED',
  ]),
  message: z.string().min(1).max(2_048),
  remediation: z.string().min(1).max(2_048),
  retryable: z.boolean(),
  entitlementDecisionId: identifierSchema.nullable(),
  resourceDecisionId: identifierSchema.nullable(),
}).strict();

export const commercialOperationResultSchema = z.discriminatedUnion('status', [
  commercialOperationSuccessSchema,
  commercialOperationFailureSchema,
]);

export const commercialCapabilityProjectionSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('available'),
    operationId: commercialOperationIdSchema,
    contractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
    packageId: identifierSchema,
    packageVersion: semanticVersionSchema,
    manifestSha256: hashSchema,
  }).strict(),
  z.object({
    state: z.literal('absent'),
    operationId: commercialOperationIdSchema,
    code: z.enum(['COMMERCIAL_PACKAGE_ABSENT', 'COMMERCIAL_OPERATION_UNAVAILABLE']),
    message: z.string().min(1).max(2_048),
    remediation: z.string().min(1).max(2_048),
  }).strict(),
  z.object({
    state: z.literal('activating'),
    operationId: commercialOperationIdSchema,
    message: z.string().min(1).max(2_048),
  }).strict(),
]);

export const commercialOperationInventoryEntrySchema = z.object({
  operationId: commercialOperationIdSchema,
  contractVersion: z.literal(COMMERCIAL_OPERATION_CONTRACT_VERSION),
  authoritativeOwner: z.enum([
    'commercial-operation',
    'commercial-worker',
    'public-host-storage',
  ]),
  entitlement: z.object({
    packageId: z.literal('com.stratcraft.quant-lab'),
    resolver: z.literal('resolveUserTier'),
  }).strict(),
  boundedDataOwner: z.enum(['none', 'public-host-storage']),
  resourcePlan: z.enum(['none', 'public-host-authoritative-plan']),
  workerCapabilityId: z.enum([
    'research.discovery',
    'research.factor-evaluation',
    'research.fusion',
    'research.scoring',
    'research.promotion',
    'research.governance',
    'research.lstm-training',
  ]).nullable(),
  projections: z.array(z.enum(['result', 'progress', 'error', 'artifact'])).min(1),
  adapters: z.object({
    electron: identifierSchema,
    serviceApi: identifierSchema,
  }).strict(),
}).strict();

type InventorySeed = readonly [
  operationId: CommercialOperationId,
  owner: CommercialOperationInventoryEntry['authoritativeOwner'],
  boundedDataOwner: CommercialOperationInventoryEntry['boundedDataOwner'],
  resourcePlan: CommercialOperationInventoryEntry['resourcePlan'],
  workerCapabilityId: CommercialOperationInventoryEntry['workerCapabilityId'],
  projections: CommercialOperationInventoryEntry['projections'],
];

const INVENTORY_SEEDS: readonly InventorySeed[] = [
  ['worker.capabilities.discover', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.discovery.execute', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.discovery', ['result', 'progress', 'error', 'artifact']],
  // TICKET_1304_16 P3: the candidate-GENERATING half of discovery (Base rounds
  // 1, 2 and 4). `research.discovery.execute` above evaluates one fully
  // specified candidate; this produces candidates from a category via the LLM
  // seam. Package-owned because no kernel runs -- the three rounds are LLM
  // calls through `context.host.llm.generate`, and the C++ worker links no
  // network stack and is handed no credential, so it can never be the owner.
  // It therefore reserves neither bounded data nor a resource plan, and names
  // no worker capability. `progress` is projected because round 2 generates
  // test code per hypothesis and reports each one.
  ['research.discovery.generate', 'commercial-operation', 'none', 'none', null, ['result', 'progress', 'error']],
  // TICKET_1304_16 P3 wiring: round 4 (signal assembly) split out so the
  // orchestrator can run statistical validation between rounds 2 and 4.
  // Takes hypotheses + testResults + iterationId from the generate call and
  // produces the assembled signal code via `discovery.signal-assembly` LLM purpose.
  ['research.discovery.assemble', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.discovery.status', 'commercial-operation', 'none', 'none', null, ['result', 'progress', 'error']],
  ['research.discovery.cancel', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.sweep.launch', 'commercial-operation', 'public-host-storage', 'public-host-authoritative-plan', 'research.discovery', ['result', 'progress', 'error', 'artifact']],
  ['research.sweep.status', 'commercial-operation', 'none', 'none', null, ['result', 'progress', 'error']],
  ['research.sweep.cancel', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.scoreboard.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.scoreboard.refresh', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.scoring', ['result', 'progress', 'error', 'artifact']],
  ['research.roster.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.roster.transition', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.roster.remove', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.relegation.config.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.relegation.config.write', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.relegation.cycle', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.governance', ['result', 'progress', 'error', 'artifact']],
  ['research.promotion.status', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.promotion.register', 'commercial-operation', 'none', 'none', 'research.promotion', ['result', 'error', 'artifact']],
  ['alpha-factory.config.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['alpha-factory.config.write', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['alpha-factory.signals.add', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['alpha-factory.execute', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.fusion', ['result', 'progress', 'error', 'artifact']],
  ['alpha-factory.status', 'commercial-operation', 'none', 'none', null, ['result', 'progress', 'error']],
  ['alpha-factory.cancel', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.factor-evaluation.execute', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.factor-evaluation', ['result', 'progress', 'error', 'artifact']],
  ['research.progress.subscribe', 'commercial-operation', 'none', 'none', null, ['progress', 'error']],
  ['research.storage.read', 'public-host-storage', 'none', 'none', null, ['result', 'error', 'artifact']],
  ['research.storage.write', 'public-host-storage', 'none', 'none', null, ['result', 'error', 'artifact']],
  // TICKET_1304_13_1: the six domains omitted by the 1.0.0 freeze. Owners here
  // match the package dispatch tables in host/commercial-operation.cjs exactly:
  // a worker capability id is present only for the four long-running executions,
  // and every other entry resolves through the public storage transaction.
  ['research.sweep.queue.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.sweep.queue.enqueue', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.discovery', ['result', 'progress', 'error', 'artifact']],
  ['research.sweep.queue.cancel', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.sweep.queue.clear', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.sweep.history.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.sweep.coverage.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.leaderboard.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.definition-rollup.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.signal-run.update', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.signal-run.delete', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.signal-source.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.signal-source.confirm', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.signal-source.delete', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.custom-factor.save', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.custom-factor.delete', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['research.remediation.family-bh', 'commercial-operation', 'none', 'none', 'research.scoring', ['result', 'error', 'artifact']],
  ['research.chip-regimes.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['research.chip-regimes.write', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['lstm.manifest.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['lstm.version.activate', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['lstm.version.delete', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['lstm.snapshot.list', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['lstm.snapshot.save', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['lstm.snapshot.restore', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['lstm.snapshot.delete', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['lstm.training.start', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.lstm-training', ['result', 'progress', 'error', 'artifact']],
  ['lstm.training.status', 'commercial-operation', 'none', 'none', null, ['result', 'progress', 'error']],
  ['lstm.training.cancel', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['lstm.training.history', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['lstm.fit-quality.read', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['factor-mining.review', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['factor-mining.edit', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['factor-mining.confirm', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['factor-mining.start', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.factor-evaluation', ['result', 'progress', 'error', 'artifact']],
  ['factor-mining.status', 'commercial-operation', 'none', 'none', null, ['result', 'progress', 'error']],
  ['factor-mining.sessions.list', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['factor-mining.catalog.list', 'commercial-operation', 'none', 'none', null, ['result', 'error']],
  ['factor-mining.catalog.activate', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['factor-mining.catalog.deactivate', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
  ['factor-mining.formula.generate', 'commercial-worker', 'public-host-storage', 'public-host-authoritative-plan', 'research.factor-evaluation', ['result', 'progress', 'error', 'artifact']],
  ['factor-mining.formula.persist', 'commercial-operation', 'none', 'none', 'research.governance', ['result', 'error', 'artifact']],
];

export const COMMERCIAL_OPERATION_INVENTORY = Object.freeze(
  INVENTORY_SEEDS.map(([
    operationId,
    authoritativeOwner,
    boundedDataOwner,
    resourcePlan,
    workerCapabilityId,
    projections,
  ]) => Object.freeze({
    operationId,
    contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
    authoritativeOwner,
    entitlement: Object.freeze({
      packageId: 'com.stratcraft.quant-lab' as const,
      resolver: 'resolveUserTier' as const,
    }),
    boundedDataOwner,
    resourcePlan,
    workerCapabilityId,
    projections,
    adapters: Object.freeze({
      electron: `commercial.${operationId}`,
      serviceApi: `commercial.${operationId}`,
    }),
  })),
) satisfies readonly CommercialOperationInventoryEntry[];

export const COMMERCIAL_OPERATION_REQUEST_V1_JSON_SCHEMA = z.toJSONSchema(
  commercialOperationRequestSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export const COMMERCIAL_OPERATION_RESULT_V1_JSON_SCHEMA = z.toJSONSchema(
  commercialOperationResultSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export const COMMERCIAL_OPERATION_PROGRESS_V1_JSON_SCHEMA = z.toJSONSchema(
  commercialOperationProgressSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export const COMMERCIAL_CAPABILITY_PROJECTION_V1_JSON_SCHEMA = z.toJSONSchema(
  commercialCapabilityProjectionSchema,
  { target: 'draft-2020-12', io: 'input', reused: 'ref' },
);

export type CommercialHostRole = typeof COMMERCIAL_HOST_ROLES[number];
export type CommercialOperationId = typeof COMMERCIAL_OPERATION_IDS[number];
export type CommercialOperationRequest = z.infer<typeof commercialOperationRequestSchema>;
export type CommercialOperationResult = z.infer<typeof commercialOperationResultSchema>;
export type CommercialOperationProgress = z.infer<typeof commercialOperationProgressSchema>;
export type CommercialCapabilityProjection = z.infer<typeof commercialCapabilityProjectionSchema>;
export type CommercialOperationInventoryEntry = z.infer<
  typeof commercialOperationInventoryEntrySchema
>;

export interface CommercialOperationExecutionContext {
  readonly hostRole: CommercialHostRole;
  readonly packageIdentity: {
    readonly packageId: 'com.stratcraft.quant-lab';
    readonly packageVersion: string;
    readonly manifestSha256: string;
  };
  readonly resolveUserTier: (packageId: 'com.stratcraft.quant-lab') => string | Promise<string>;
  /**
   * Host-owned entitlement policy evaluation. The package supplies only its
   * identity and the tier returned by the shared resolveUserTier owner; it
   * never carries a private tier ordering or reconstructs admission policy.
   */
  readonly authorizeEntitlement: (input: {
    readonly packageId: 'com.stratcraft.quant-lab';
    readonly operationId: CommercialOperationId;
    readonly resolvedUserTier: string;
  }) => Promise<CommercialEntitlementDecision>;
  /** Public storage and worker mechanisms available to the package owner. */
  readonly host: CommercialOperationHostServices;
  readonly publishProgress: (progress: CommercialOperationProgress) => void;
}

export interface CommercialEntitlementDecision {
  readonly decisionId: string;
  readonly entitled: boolean;
  readonly message?: string;
  readonly remediation?: string;
}

export interface CommercialWindowedDatasetRequest {
  readonly referenceId: string;
  readonly datasetId: string;
  readonly format: 'arrow-ipc' | 'parquet';
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly requestedWindow: {
    readonly startUtc: string;
    readonly endUtc: string;
  };
}

export interface CommercialStorageTransactionResult {
  readonly transactionId: string;
  readonly output: CommercialJsonObject;
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly artifactKind: string;
    readonly schemaId: string;
    readonly schemaVersion: string;
    readonly sha256: string;
    readonly publicationTransactionId: string;
  }[];
}

export interface CommercialOperationHostServices {
  readonly factorMining: {
    readonly review: (draft: FactorMiningDraft) => Promise<WorkloadPrelaunchReview>;
    readonly edit: (review: WorkloadPrelaunchReview, planFingerprint: string, edits: Record<string, WorkloadJsonValue>) => Promise<WorkloadPrelaunchReview>;
    readonly confirm: (review: WorkloadPrelaunchReview, planFingerprint: string) => ConfirmedWorkloadPlan;
    readonly confirmAndLaunch: (input: {
      readonly review: WorkloadPrelaunchReview;
      readonly planFingerprint: string;
      readonly idempotencyKey: string;
      readonly requestId: string;
      readonly governanceDecisionId: string;
    }) => Promise<CommercialJsonObject>;
    readonly launch: (input: {
      readonly confirmedPlan: ConfirmedWorkloadPlan;
      readonly requestId: string;
      readonly governanceDecisionId: string;
    }) => Promise<CommercialJsonObject>;
    readonly status: (taskId: string) => Promise<CommercialJsonObject | null>;
    readonly sessions: () => Promise<readonly CommercialJsonObject[]>;
  };
  readonly storage: {
    /** Materializes the requested window at the public storage boundary. */
    readonly materializeWindowedDataset: (
      request: CommercialWindowedDatasetRequest,
    ) => Promise<CommercialJsonObject>;
    /** Resolves a DB-owned algorithm Artifact inside the authoritative root. */
    readonly resolveAlgorithmArtifact: (input: {
      readonly artifactPath: string;
    }) => Promise<CommercialJsonObject>;
    /**
     * Runs a package-composed storage lifecycle in one observable host-owned
     * transaction. Implementations must roll back writes and Artifact
     * publication together on failure.
     */
    readonly transact: (input: {
      readonly requestId: string;
      readonly operationId: CommercialOperationId;
      readonly mode: 'read' | 'write';
      readonly payload: CommercialJsonObject;
      /** Package-owned store logic executed inside the host transaction. */
      readonly execute?: (database: unknown) => CommercialStorageTransactionValue;
    }) => Promise<CommercialStorageTransactionResult>;
    /** Resolves a content-keyed Artifact previously persisted by the host. */
    readonly lookupManagedArtifact: (input: {
      readonly namespace: string;
      readonly key: string;
    }) => Promise<CommercialJsonObject | null>;
    /** Atomically persists a just-published worker Artifact under a stable key. */
    readonly persistManagedArtifact: (input: {
      readonly namespace: string;
      readonly key: string;
      readonly artifactToken: string;
      readonly metadata: CommercialJsonObject;
    }) => Promise<CommercialJsonObject>;
  };
  readonly worker: {
    readonly discover: () => Promise<CommercialJsonObject>;
    readonly execute: (
      request: {
        readonly capabilityId: string;
        readonly operationContractVersion: typeof COMMERCIAL_OPERATION_CONTRACT_VERSION;
        readonly requestPayload: CommercialJsonObject;
        readonly dataInputs: readonly CommercialJsonObject[];
      },
      onProgress: (progress: {
        readonly requestId: string;
        readonly phase: string;
        readonly completedUnits: number;
        readonly totalUnits: number;
        readonly statusText: string;
      }) => void,
    ) => Promise<CommercialJsonObject>;
    readonly cancel: (requestId: string) => Promise<boolean>;
    readonly getActiveRequestIds: () => readonly string[];
    /**
     * Admits the request against the host's enforced CPU/memory plan and
     * returns the decision the package echoes to the worker. Declared here
     * because `requireContext()` has always demanded it and
     * `executeLstmTraining` has always called it; only the type and the
     * Electron host were missing it (TICKET_1304_16 P1).
     */
    readonly requestResourcePlan: () => Promise<CommercialResourcePlanDecision>;
  };
  /**
   * Public compiler mechanism for signed package-owned C++ strategy modules.
   * The package supplies source; the host supplies and validates the installed
   * toolchain and returns an immutable content-addressed module projection.
   */
  readonly compiler: {
    readonly compileStrategyModule: (input: {
      readonly source: string;
      readonly referenceId: string;
    }) => Promise<CommercialJsonObject>;
  };
  /**
   * TICKET_1304_16 P1 -- the LLM invocation seam (section 10.12, option 2).
   *
   * Discovery hypothesis generation and factor-formula generation need an LLM.
   * The package must not acquire one itself: the API key lives in the
   * Electron keyring-backed secure store and is readable only by
   * `llm-key-resolver.ts` in the main process, and the C++ research worker
   * links no network stack and is handed no credential, so neither the
   * package nor the worker can be the owner of this call.
   *
   * The package therefore declares *intent* -- a purpose and the structured
   * fields the backend prompt template consumes -- and the host owns every
   * decision that is not the package's to make: provider and model
   * resolution, BYOK key injection, endpoint selection, bearer auth, and
   * timeout. This keeps prompt templates and routing server-side per
   * TICKET_435 Open Core, and keeps the key on the machine that stores it.
   */
  readonly llm: {
    readonly generate: (
      request: CommercialLlmGenerateRequest,
      cancellationSignal?: AbortSignal,
    ) => Promise<CommercialJsonObject>;
  };
}

/**
 * Host admission decision for a worker run. `decisionId` is the field the
 * package forwards to the worker so the run is attributable to the plan that
 * admitted it.
 */
export interface CommercialResourcePlanDecision extends CommercialJsonObject {
  readonly decisionId: string;
}

/**
 * The package-declarable half of an LLM call.
 *
 * The split is by ownership, not by convenience. `llmProvider` / `llmModel`
 * are the *user's* selection and arrive as operation input, so the package
 * carries them. The API key, endpoint, bearer token and timeout are host
 * property -- the key is readable only by the main-process secure store --
 * so they are deliberately not expressible in this shape. A package cannot
 * name a URL and cannot supply a credential.
 */
export interface CommercialLlmGenerateRequest {
  /**
   * Names the host-side route. The host maps a purpose onto a concrete
   * endpoint; the package cannot address an arbitrary URL.
   */
  readonly purpose: CommercialLlmPurpose;
  /** The user's selected provider, as carried in the operation input. */
  readonly llmProvider: string;
  /** The user's selected model, as carried in the operation input. */
  readonly llmModel: string;
  /** Structured fields the server-side prompt template consumes. */
  readonly payload: CommercialJsonObject;
  /** Shape the caller parses the response as. */
  readonly responseFormat: 'json' | 'code';
  /**
   * Server-generated id from a prior turn in the same exchange, echoed for
   * cross-caller replay protection. Required by the purposes that continue
   * an exchange rather than start one.
   */
  readonly exchangeId?: string;
}

export const COMMERCIAL_LLM_PURPOSES = [
  'discovery.hypothesis',
  'discovery.test-code',
  'discovery.signal-assembly',
  'factor-formula.generate',
] as const;

export type CommercialLlmPurpose = typeof COMMERCIAL_LLM_PURPOSES[number];

export interface CommercialStorageTransactionValue {
  readonly output: CommercialJsonObject;
  readonly artifacts?: CommercialStorageTransactionResult['artifacts'];
}

export interface CommercialOperationRegistration {
  readonly operationId: CommercialOperationId;
  readonly contractVersion: typeof COMMERCIAL_OPERATION_CONTRACT_VERSION;
  readonly execute: (
    request: CommercialOperationRequest,
    context: CommercialOperationExecutionContext,
  ) => Promise<CommercialOperationResult>;
  readonly cancel?: (requestId: string) => Promise<boolean>;
}

export interface CommercialHostRegistrationTransaction {
  readonly contractVersion: typeof COMMERCIAL_HOST_REGISTRATION_CONTRACT_VERSION;
  readonly hostRole: CommercialHostRole;
  readonly stageOperation: (registration: CommercialOperationRegistration) => void;
}

export type CommercialHostModuleRegistrar = (
  transaction: CommercialHostRegistrationTransaction,
) => void | Promise<void>;
