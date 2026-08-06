import { z } from 'zod';

export const RESEARCH_TASK_SCHEMA_VERSION = 1 as const;
export const RESEARCH_TASK_SPEC_SCHEMA_ID =
  'https://stratcraft.ai/schemas/research-task-spec-v1.json' as const;
export const RESEARCH_TASK_TITLE_MAX_CHARS = 200 as const;
export const RESEARCH_TASK_INTENT_MAX_CHARS = 4_000 as const;
export const RESEARCH_TASK_INPUT_ARTIFACT_MAX_ITEMS = 128 as const;

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    'Canonical IDs must contain only ASCII letters, digits, dot, underscore, colon, or hyphen.',
  );
const versionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, 'Versions must be portable ASCII identifiers.');
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.');
const boundedTextSchema = (maximum: number) =>
  z.string().min(1).max(maximum).refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    'Control characters are not allowed.',
  );
const policyReferenceSchema = z.object({
  policyId: canonicalIdSchema,
  version: versionSchema,
}).strict();
const contentReferenceSchema = z.object({
  id: canonicalIdSchema,
  version: versionSchema,
  contentHash: sha256Schema,
}).strict();

export const artifactReferenceV1Schema = z.object({
  artifactId: canonicalIdSchema,
  artifactKind: z.enum(['strategy', 'signal']),
  rootContentHash: sha256Schema,
}).strict();

const requirementBaseSchema = z.object({
  requirementId: canonicalIdSchema,
}).strict();

export const evidenceRequirementV1Schema = z.discriminatedUnion('type', [
  requirementBaseSchema.extend({
    type: z.literal('unit_test'),
    suiteId: canonicalIdSchema,
    requiredPassCount: z.number().int().positive(),
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('integration_test'),
    suiteId: canonicalIdSchema,
    requiredPassCount: z.number().int().positive(),
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('compile'),
    language: z.literal('cpp'),
    standard: z.literal('c++23'),
    abi: z.literal('v2'),
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('backtest'),
    benchmarkId: canonicalIdSchema,
    requiredMetrics: z.array(canonicalIdSchema).min(1).max(64),
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('statistical_validation'),
    method: z.enum(['bh', 'dsr', 'cpcv']),
    policyReference: policyReferenceSchema,
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('leakage_check'),
    policyReference: policyReferenceSchema,
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('resource_measurement'),
    metric: canonicalIdSchema,
    boundReference: policyReferenceSchema,
  }).strict(),
  requirementBaseSchema.extend({
    type: z.literal('provenance'),
    requiredFields: z.array(canonicalIdSchema).min(1).max(64),
  }).strict(),
]);

const criterionBaseSchema = z.object({
  criterionId: canonicalIdSchema,
  requirementId: canonicalIdSchema,
}).strict();

export const completionCriterionV1Schema = z.discriminatedUnion('predicate', [
  criterionBaseSchema.extend({
    predicate: z.literal('passed'),
    value: z.literal(true),
  }).strict(),
  criterionBaseSchema.extend({
    predicate: z.literal('gte'),
    value: z.number().finite(),
  }).strict(),
  criterionBaseSchema.extend({
    predicate: z.literal('lte'),
    value: z.number().finite(),
  }).strict(),
  criterionBaseSchema.extend({
    predicate: z.literal('equals'),
    value: z.union([z.string().max(512), z.number().finite(), z.boolean()]),
  }).strict(),
  criterionBaseSchema.extend({
    predicate: z.literal('present'),
    value: z.literal(true),
  }).strict(),
]);

export const researchTaskSpecV1Schema = z.object({
  schemaVersion: z.literal(RESEARCH_TASK_SCHEMA_VERSION),
  taskId: canonicalIdSchema,
  projectId: canonicalIdSchema,
  objective: boundedTextSchema(RESEARCH_TASK_INTENT_MAX_CHARS),
  artifactKind: z.enum(['strategy', 'signal']),
  workspaceId: canonicalIdSchema,
  inputArtifactRefs: z.array(artifactReferenceV1Schema)
    .max(RESEARCH_TASK_INPUT_ARTIFACT_MAX_ITEMS),
  dataCapabilityManifest: contentReferenceSchema,
  toolCapabilityRequest: z.object({
    profileId: canonicalIdSchema,
    profileVersion: versionSchema,
    requiredSemanticCapabilities: z.array(canonicalIdSchema).min(1).max(256),
  }).strict(),
  commandPolicy: policyReferenceSchema,
  resourceBudget: policyReferenceSchema,
  researchPolicyBundle: contentReferenceSchema,
  acceptanceProfile: z.object({
    id: canonicalIdSchema,
    version: versionSchema,
  }).strict(),
  evidenceRequirements: z.array(evidenceRequirementV1Schema).min(1).max(256),
  completionCriteria: z.array(completionCriterionV1Schema).min(1).max(256),
  title: boundedTextSchema(RESEARCH_TASK_TITLE_MAX_CHARS).optional(),
  locale: z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/).optional(),
  hypothesis: boundedTextSchema(RESEARCH_TASK_INTENT_MAX_CHARS).optional(),
}).strict().superRefine((task, context) => {
  const requirementIds = new Set<string>();
  for (const [index, requirement] of task.evidenceRequirements.entries()) {
    if (requirementIds.has(requirement.requirementId)) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceRequirements', index, 'requirementId'],
        message: `Duplicate requirementId: ${requirement.requirementId}`,
      });
    }
    requirementIds.add(requirement.requirementId);
    if (
      ('requiredMetrics' in requirement
        && new Set(requirement.requiredMetrics).size !== requirement.requiredMetrics.length)
      || ('requiredFields' in requirement
        && new Set(requirement.requiredFields).size !== requirement.requiredFields.length)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceRequirements', index],
        message: 'Requirement lists must not contain duplicate values.',
      });
    }
  }

  const criterionIds = new Set<string>();
  for (const [index, criterion] of task.completionCriteria.entries()) {
    if (criterionIds.has(criterion.criterionId)) {
      context.addIssue({
        code: 'custom',
        path: ['completionCriteria', index, 'criterionId'],
        message: `Duplicate criterionId: ${criterion.criterionId}`,
      });
    }
    criterionIds.add(criterion.criterionId);
    if (!requirementIds.has(criterion.requirementId)) {
      context.addIssue({
        code: 'custom',
        path: ['completionCriteria', index, 'requirementId'],
        message: `Unknown requirementId: ${criterion.requirementId}`,
      });
    }
  }

  const artifactKeys = task.inputArtifactRefs.map(
    (reference) => `${reference.artifactKind}:${reference.artifactId}`,
  );
  if (new Set(artifactKeys).size !== artifactKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['inputArtifactRefs'],
      message: 'Input Artifact references must be unique.',
    });
  }
});

export const researchTaskDraftV1Schema = z.object({
  projectId: canonicalIdSchema,
  artifactKind: z.enum(['strategy', 'signal']),
  objective: boundedTextSchema(RESEARCH_TASK_INTENT_MAX_CHARS),
  title: boundedTextSchema(RESEARCH_TASK_TITLE_MAX_CHARS).optional(),
  hypothesis: boundedTextSchema(RESEARCH_TASK_INTENT_MAX_CHARS).optional(),
  locale: z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/),
  workspaceId: canonicalIdSchema,
  dataCapabilityId: canonicalIdSchema,
  toolCapabilityProfileId: canonicalIdSchema,
  commandPolicyId: canonicalIdSchema,
  resourceBudgetPolicyId: canonicalIdSchema,
  researchPolicyBundleId: canonicalIdSchema,
  acceptanceProfileId: canonicalIdSchema,
  inputArtifactRefs: z.array(artifactReferenceV1Schema)
    .max(RESEARCH_TASK_INPUT_ARTIFACT_MAX_ITEMS),
}).strict();

const generatedResearchTaskSpecV1JsonSchema = z.toJSONSchema(
  researchTaskSpecV1Schema,
  {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'throw',
    reused: 'ref',
  },
) as Readonly<Record<string, unknown>>;

export const RESEARCH_TASK_SPEC_V1_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  $id: RESEARCH_TASK_SPEC_SCHEMA_ID,
  ...generatedResearchTaskSpecV1JsonSchema,
});

export type ArtifactReferenceV1 = z.infer<typeof artifactReferenceV1Schema>;
export type EvidenceRequirementV1 = z.infer<typeof evidenceRequirementV1Schema>;
export type CompletionCriterionV1 = z.infer<typeof completionCriterionV1Schema>;
export type ResearchTaskSpecV1 = z.infer<typeof researchTaskSpecV1Schema>;
export type ResearchTaskDraftV1 = z.infer<typeof researchTaskDraftV1Schema>;

export function parseResearchTaskSpecV1(input: unknown): ResearchTaskSpecV1 {
  return researchTaskSpecV1Schema.parse(input);
}

export function parseResearchTaskDraftV1(input: unknown): ResearchTaskDraftV1 {
  return researchTaskDraftV1Schema.parse(input);
}
