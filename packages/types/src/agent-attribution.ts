import { z } from 'zod';
import {
  AGENT_ENTITLEMENT_SOURCES,
  AGENT_RUNTIME_IDS,
  AGENT_USAGE_CONTRACT_VERSION,
  type AgentUsageV1,
} from './agent-runtime';

export const INFERENCE_ATTRIBUTION_SCHEMA_VERSION = '1.0.0' as const;
export const GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION = '1.0.0' as const;
export const GOVERNANCE_EVIDENCE_ENVELOPE_VERSION = '1' as const;
export const GOVERNANCE_EVIDENCE_SCHEMA_VERSION = '1.0.0' as const;

export const GOVERNANCE_MAX_POLICIES = 16;
export const GOVERNANCE_MAX_GATES = 16;
export const GOVERNANCE_MAX_DEPENDENCY_HASHES = 64;
export const GOVERNANCE_MAX_IDENTIFIER_CHARS = 128;
export const GOVERNANCE_MAX_VERSION_CHARS = 64;
export const GOVERNANCE_MAX_ENVELOPE_BYTES = 65_536;
export const GOVERNANCE_MAX_METRIC_VALUE = 1_000_000_000;

const idSchema = z.string()
  .min(1)
  .max(GOVERNANCE_MAX_IDENTIFIER_CHARS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const versionSchema = z.string()
  .min(1)
  .max(GOVERNANCE_MAX_VERSION_CHARS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
const rawHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const governedHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });
const boundedCountSchema = z.number()
  .int()
  .min(0)
  .max(GOVERNANCE_MAX_METRIC_VALUE);

export const agentUsageV1Schema: z.ZodType<AgentUsageV1> = z.object({
  contractVersion: z.literal(AGENT_USAGE_CONTRACT_VERSION),
  providerEventId: idSchema.optional(),
  taskId: idSchema,
  turnId: idSchema,
  admissionFingerprint: rawHashSchema,
  runtimeId: z.enum(AGENT_RUNTIME_IDS),
  entitlementSource: z.enum(AGENT_ENTITLEMENT_SOURCES),
  payerClass: z.enum(['user', 'stratcraft', 'provider', 'local']),
  providerId: idSchema,
  modelId: idSchema,
  source: z.enum(['provider_reported', 'server_reported', 'unavailable']),
  completeness: z.enum(['complete', 'partial', 'unavailable']),
  inputTokens: boundedCountSchema.optional(),
  outputTokens: boundedCountSchema.optional(),
  cacheReadTokens: boundedCountSchema.optional(),
  cacheWriteTokens: boundedCountSchema.optional(),
  providerCost: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(64).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  pricingReference: idSchema.optional(),
}).strict().superRefine((usage, context) => {
  const reportedValues = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.providerCost,
    usage.currency,
    usage.pricingReference,
  ];
  if (usage.source === 'unavailable') {
    if (
      usage.completeness !== 'unavailable'
      || usage.providerEventId !== undefined
      || reportedValues.some(value => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unavailable usage cannot contain provider-reported values.',
      });
    }
    return;
  }
  if (usage.completeness === 'unavailable') {
    context.addIssue({
      code: 'custom',
      message: 'Reported usage cannot have unavailable completeness.',
    });
  }
  if (!usage.providerEventId) {
    context.addIssue({
      code: 'custom',
      path: ['providerEventId'],
      message: 'Reported usage requires the provider event ID.',
    });
  }
  if (
    usage.providerCost !== undefined
    && (usage.currency === undefined || usage.pricingReference === undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['providerCost'],
      message: 'Provider cost requires currency and pricing reference.',
    });
  }
});

export type InferenceAttributionStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface InferenceAttributionV1 {
  readonly schemaVersion: typeof INFERENCE_ATTRIBUTION_SCHEMA_VERSION;
  readonly recordId: string;
  readonly correctionOf?: string;
  readonly subjectScopeHash: string;
  readonly taskId: string;
  readonly turnId: string;
  readonly admissionFingerprint: string;
  readonly runtimeId: AgentUsageV1['runtimeId'];
  readonly adapterContractVersion: string;
  readonly nativeVersion: string;
  readonly protocolVersion: string;
  readonly entitlementSource: AgentUsageV1['entitlementSource'];
  readonly payerClass: AgentUsageV1['payerClass'];
  readonly providerId: string;
  readonly modelId: string;
  readonly usage: AgentUsageV1;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: InferenceAttributionStatus;
  readonly nativeDiagnosticId?: string;
  readonly recordedAt: string;
}

export const inferenceAttributionV1Schema: z.ZodType<InferenceAttributionV1> = z.object({
  schemaVersion: z.literal(INFERENCE_ATTRIBUTION_SCHEMA_VERSION),
  recordId: idSchema,
  correctionOf: idSchema.optional(),
  subjectScopeHash: rawHashSchema,
  taskId: idSchema,
  turnId: idSchema,
  admissionFingerprint: rawHashSchema,
  runtimeId: z.enum(AGENT_RUNTIME_IDS),
  adapterContractVersion: versionSchema,
  nativeVersion: versionSchema,
  protocolVersion: versionSchema,
  entitlementSource: z.enum(AGENT_ENTITLEMENT_SOURCES),
  payerClass: z.enum(['user', 'stratcraft', 'provider', 'local']),
  providerId: idSchema,
  modelId: idSchema,
  usage: agentUsageV1Schema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.optional(),
  status: z.enum(['started', 'completed', 'failed', 'cancelled']),
  nativeDiagnosticId: idSchema.optional(),
  recordedAt: timestampSchema,
}).strict().superRefine((record, context) => {
  if (
    record.usage.taskId !== record.taskId
    || record.usage.turnId !== record.turnId
    || record.usage.admissionFingerprint !== record.admissionFingerprint
    || record.usage.runtimeId !== record.runtimeId
    || record.usage.entitlementSource !== record.entitlementSource
    || record.usage.payerClass !== record.payerClass
    || record.usage.providerId !== record.providerId
    || record.usage.modelId !== record.modelId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['usage'],
      message: 'Usage attribution must match the admitted route and turn.',
    });
  }
  if (record.status === 'started' && record.endedAt !== undefined) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'A started record cannot have endedAt.' });
  }
  if (record.status !== 'started' && record.endedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'A terminal record requires endedAt.' });
  }
});

export const governanceAssuranceLevelSchema = z.enum([
  'claim_recorded',
  'client_verified',
  'server_verified',
]);
export type GovernanceAssuranceLevel = z.infer<typeof governanceAssuranceLevelSchema>;

export const governanceSubmissionStateSchema = z.enum([
  'not_submitted',
  'queued_offline',
  'submitted',
  'claim_recorded',
  'client_verified',
  'server_verified',
  'rejected',
  'revoked',
  'failed',
]);
export type GovernanceSubmissionState = z.infer<typeof governanceSubmissionStateSchema>;

export type GovernanceAttributionMessageKey =
  | 'agentGovernance.attributionAbsent'
  | 'agentGovernance.localAccepted'
  | 'agentGovernance.localRejected'
  | 'agentGovernance.localResultUnavailable'
  | 'agentGovernance.remoteNotSubmitted'
  | 'agentGovernance.remoteQueuedOffline'
  | 'agentGovernance.remoteSubmitted'
  | 'agentGovernance.remoteClaimRecorded'
  | 'agentGovernance.remoteClientVerified'
  | 'agentGovernance.remoteServerVerified'
  | 'agentGovernance.remoteRejected'
  | 'agentGovernance.remoteRevoked'
  | 'agentGovernance.remoteFailed';

export type GovernanceAttributionPresentationV1 =
  | {
    readonly attributionState: 'absent';
    readonly attributionMessageKey: 'agentGovernance.attributionAbsent';
  }
  | {
    readonly attributionState: 'present';
    readonly localAdmission: {
      readonly result: GovernanceAttributionV1['localResult'] | 'unavailable';
      readonly messageKey: GovernanceAttributionMessageKey;
    };
    readonly remoteSubmission: {
      readonly state: GovernanceSubmissionState;
      readonly messageKey: GovernanceAttributionMessageKey;
    };
    readonly credit?: {
      readonly value: string;
      readonly unit: string;
    };
  };

export const governanceOperationSchema = z.enum([
  'local_admission',
  'evidence_receipt_requested',
  'evidence_receipt_recorded',
  'credit_recorded',
]);
export type GovernanceOperation = z.infer<typeof governanceOperationSchema>;

export interface GovernanceAttributionV1 {
  readonly schemaVersion: typeof GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION;
  readonly eventId: string;
  readonly taskId: string;
  readonly artifactId?: string;
  readonly artifactRootHash?: string;
  readonly admissionId?: string;
  readonly admissionFingerprint: string;
  readonly policyHashes: readonly string[];
  readonly evidenceHashes: readonly string[];
  readonly operation: GovernanceOperation;
  readonly localResult?: 'accepted' | 'rejected';
  readonly serverReceiptId?: string;
  readonly receiptSignature?: string;
  readonly receiptKeyId?: string;
  readonly assuranceLevel?: GovernanceAssuranceLevel;
  readonly receiptRevokedAt?: string;
  readonly creditUnit?: string;
  readonly creditValue?: string;
  readonly submissionState: GovernanceSubmissionState;
  readonly occurredAt: string;
  readonly recordedAt: string;
}

const GOVERNANCE_SUBMISSION_MESSAGE_KEYS: Readonly<
  Record<GovernanceSubmissionState, GovernanceAttributionMessageKey>
> = {
  not_submitted: 'agentGovernance.remoteNotSubmitted',
  queued_offline: 'agentGovernance.remoteQueuedOffline',
  submitted: 'agentGovernance.remoteSubmitted',
  claim_recorded: 'agentGovernance.remoteClaimRecorded',
  client_verified: 'agentGovernance.remoteClientVerified',
  server_verified: 'agentGovernance.remoteServerVerified',
  rejected: 'agentGovernance.remoteRejected',
  revoked: 'agentGovernance.remoteRevoked',
  failed: 'agentGovernance.remoteFailed',
};

/** Shared Guide/Electron projection of local admission and remote evidence state. */
export function projectGovernanceAttribution(
  attribution: GovernanceAttributionV1 | undefined,
): GovernanceAttributionPresentationV1 {
  if (!attribution) {
    return {
      attributionState: 'absent',
      attributionMessageKey: 'agentGovernance.attributionAbsent',
    };
  }

  const localResult = attribution.localResult ?? 'unavailable';
  const localMessageKey: GovernanceAttributionMessageKey = localResult === 'accepted'
    ? 'agentGovernance.localAccepted'
    : localResult === 'rejected'
      ? 'agentGovernance.localRejected'
      : 'agentGovernance.localResultUnavailable';
  return {
    attributionState: 'present',
    localAdmission: { result: localResult, messageKey: localMessageKey },
    remoteSubmission: {
      state: attribution.submissionState,
      messageKey: GOVERNANCE_SUBMISSION_MESSAGE_KEYS[attribution.submissionState],
    },
    ...(attribution.creditValue !== undefined && attribution.creditUnit !== undefined
      ? { credit: { value: attribution.creditValue, unit: attribution.creditUnit } }
      : {}),
  };
}

export const governanceAttributionV1Schema: z.ZodType<GovernanceAttributionV1> = z.object({
  schemaVersion: z.literal(GOVERNANCE_ATTRIBUTION_SCHEMA_VERSION),
  eventId: idSchema,
  taskId: idSchema,
  artifactId: idSchema.optional(),
  artifactRootHash: governedHashSchema.optional(),
  admissionId: idSchema.optional(),
  admissionFingerprint: rawHashSchema,
  policyHashes: z.array(governedHashSchema).max(GOVERNANCE_MAX_POLICIES),
  evidenceHashes: z.array(governedHashSchema).max(GOVERNANCE_MAX_DEPENDENCY_HASHES),
  operation: governanceOperationSchema,
  localResult: z.enum(['accepted', 'rejected']).optional(),
  serverReceiptId: idSchema.optional(),
  receiptSignature: z.string().min(1).max(4096).optional(),
  receiptKeyId: idSchema.optional(),
  assuranceLevel: governanceAssuranceLevelSchema.optional(),
  receiptRevokedAt: timestampSchema.optional(),
  creditUnit: idSchema.optional(),
  creditValue: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(64).optional(),
  submissionState: governanceSubmissionStateSchema,
  occurredAt: timestampSchema,
  recordedAt: timestampSchema,
}).strict().superRefine((event, context) => {
  const hasReceipt = event.serverReceiptId !== undefined;
  const receiptFields = [
    event.receiptSignature,
    event.receiptKeyId,
    event.assuranceLevel,
    event.receiptRevokedAt,
  ];
  if (!hasReceipt && receiptFields.some(value => value !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['serverReceiptId'],
      message: 'Receipt metadata requires an authoritative server receipt ID.',
    });
  }
  if (
    event.submissionState === 'claim_recorded'
    || event.submissionState === 'client_verified'
    || event.submissionState === 'server_verified'
  ) {
    if (!hasReceipt || event.assuranceLevel !== event.submissionState) {
      context.addIssue({
        code: 'custom',
        path: ['assuranceLevel'],
        message: 'Receipt state must preserve the exact authoritative assurance level.',
      });
    }
  }
  if (event.submissionState === 'revoked' && !event.receiptRevokedAt) {
    context.addIssue({
      code: 'custom',
      path: ['receiptRevokedAt'],
      message: 'A revoked receipt requires its authoritative revocation timestamp.',
    });
  }
  if ((event.creditUnit === undefined) !== (event.creditValue === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['creditValue'],
      message: 'Credit unit and value must be recorded together.',
    });
  }
});

const policyReferenceSchema = z.object({
  id: idSchema,
  version: versionSchema,
  hash: governedHashSchema,
}).strict();

const gateBase = {
  version: versionSchema,
  passed: z.boolean(),
  evidenceHash: governedHashSchema,
} as const;

export const governanceGateResultSchema = z.discriminatedUnion('gateName', [
  z.object({
    gateName: z.literal('contract'),
    ...gateBase,
    summary: z.object({
      checkedFields: boundedCountSchema,
      violations: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('security'),
    ...gateBase,
    summary: z.object({
      checks: boundedCountSchema,
      findings: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('source'),
    ...gateBase,
    summary: z.object({
      files: boundedCountSchema,
      bytes: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('compile-abi'),
    ...gateBase,
    summary: z.object({
      warnings: boundedCountSchema,
      errors: boundedCountSchema,
      abiVersion: z.literal(2),
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('tests-leakage'),
    ...gateBase,
    summary: z.object({
      passedTests: boundedCountSchema,
      failedTests: boundedCountSchema,
      leakageFindings: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('research-operations'),
    ...gateBase,
    summary: z.object({
      observations: boundedCountSchema,
      satisfiedCriteria: boundedCountSchema,
      failedCriteria: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('persistence'),
    ...gateBase,
    summary: z.object({
      persistedReferences: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('schema'),
    ...gateBase,
    summary: z.object({
      checkedFields: boundedCountSchema,
      violations: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('compile'),
    ...gateBase,
    summary: z.object({
      warnings: boundedCountSchema,
      errors: boundedCountSchema,
      abiVersion: z.literal(2),
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('test'),
    ...gateBase,
    summary: z.object({
      testsPassed: boundedCountSchema,
      testsFailed: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('leakage'),
    ...gateBase,
    summary: z.object({
      violations: boundedCountSchema,
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('backtest'),
    ...gateBase,
    summary: z.object({
      oosSharpe: z.number().finite().min(-20).max(20),
      maxDrawdown: z.number().finite().min(0).max(1),
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('bh_correction'),
    ...gateBase,
    summary: z.object({
      adjustedP: z.number().finite().min(0).max(1),
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('dsr'),
    ...gateBase,
    summary: z.object({
      dsr: z.number().finite().min(0).max(1),
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('cpcv'),
    ...gateBase,
    summary: z.object({
      foldCount: z.number().int().min(2).max(100),
    }).strict(),
  }).strict(),
  z.object({
    gateName: z.literal('cost_capacity'),
    ...gateBase,
    summary: z.object({
      costBps: z.number().finite().min(0).max(10_000),
      capacityUsd: z.number().finite().min(0).max(1_000_000_000_000_000),
    }).strict(),
  }).strict(),
]);
export type GovernanceGateResultV1 = z.infer<typeof governanceGateResultSchema>;

export const governanceEvidenceEnvelopeV1Schema = z.object({
  envelopeVersion: z.literal(GOVERNANCE_EVIDENCE_ENVELOPE_VERSION),
  schemaVersion: z.literal(GOVERNANCE_EVIDENCE_SCHEMA_VERSION),
  // TICKET_1303_100_7 Fix C: the provenance binding back to the
  // ResearchTaskSpec this evidence was produced against. Required, not
  // optional: an attestation receipt that cannot be tied to its mandate and
  // task cannot satisfy TICKET_1303_100_2 section 4.3 rule 8, which obliges
  // the server to verify that mandate, task, artifact, policy and device all
  // belong to the same tenant. The server treats both as claims and resolves
  // them against the authenticated tenant.
  mandateId: idSchema,
  taskId: idSchema,
  taskKind: z.enum(['strategy-research', 'signal-research']),
  objectiveClassification: idSchema,
  artifact: z.object({
    type: z.enum(['strategy', 'signal']),
    rootHash: governedHashSchema,
  }).strict(),
  runtime: z.object({
    runtimeId: z.enum(AGENT_RUNTIME_IDS),
    adapterClass: idSchema,
    adapterVersion: versionSchema,
    nativeVersion: versionSchema,
  }).strict(),
  policies: z.array(policyReferenceSchema).max(GOVERNANCE_MAX_POLICIES),
  gates: z.array(governanceGateResultSchema).max(GOVERNANCE_MAX_GATES),
  dependencyHashes: z.array(governedHashSchema).max(GOVERNANCE_MAX_DEPENDENCY_HASHES),
  privacyClassification: z.enum(['public-metadata', 'internal-metadata']),
  envelopeByteCount: z.number().int().positive().max(GOVERNANCE_MAX_ENVELOPE_BYTES),
}).strict().superRefine((envelope, context) => {
  const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
  if (!unique(envelope.policies.map(policy => `${policy.id}\u0000${policy.version}`))) {
    context.addIssue({ code: 'custom', path: ['policies'], message: 'Policy references must be unique.' });
  }
  if (!unique(envelope.gates.map(gate => gate.gateName))) {
    context.addIssue({ code: 'custom', path: ['gates'], message: 'Gate names must be unique.' });
  }
  if (!unique(envelope.dependencyHashes)) {
    context.addIssue({ code: 'custom', path: ['dependencyHashes'], message: 'Dependency hashes must be unique.' });
  }
});
export type GovernanceEvidenceEnvelopeV1 = z.infer<typeof governanceEvidenceEnvelopeV1Schema>;

export type GovernanceEvidenceEnvelopeDraftV1 =
  Omit<GovernanceEvidenceEnvelopeV1, 'envelopeByteCount'>;

export const GOVERNANCE_EVIDENCE_ENVELOPE_V1_JSON_SCHEMA = z.toJSONSchema(
  governanceEvidenceEnvelopeV1Schema,
  {
    target: 'draft-2020-12',
    reused: 'ref',
  },
);
