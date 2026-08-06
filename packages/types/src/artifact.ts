import { z } from 'zod';

export const CANDIDATE_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const ACCEPTED_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_ADMISSION_RESULT_SCHEMA_VERSION = 1 as const;

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const versionSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const portableRelativePathSchema = z.string().min(1).max(1_024).refine((value) => {
  if (value.includes('\\') || value.includes('\0') || value.includes(':')) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}, 'Artifact paths must be normalized portable paths relative to the task workspace.');

export const candidateArtifactFileV1Schema = z.object({
  role: z.enum(['source', 'test', 'evidence', 'signal', 'dependency']),
  relativePath: portableRelativePathSchema,
  byteSize: z.number().int().nonnegative(),
  mediaType: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9.+-]*\/[A-Za-z0-9][A-Za-z0-9.+-]*$/),
  sha256: hashSchema,
}).strict();

const candidateBase = z.object({
  schemaVersion: z.literal(CANDIDATE_ARTIFACT_SCHEMA_VERSION),
  candidateId: idSchema,
  taskId: idSchema,
  workspaceId: idSchema,
  taskSpecContentHash: hashSchema,
  workspaceContentHash: hashSchema,
  turnAdmissionFingerprint: hashSchema,
  acceptanceProfileContentHash: hashSchema,
  runtime: z.object({
    runtimeId: idSchema,
    adapterVersion: versionSchema,
    nativeVersion: versionSchema,
    protocolVersion: versionSchema,
    nativeSessionReference: idSchema,
  }).strict(),
  files: z.array(candidateArtifactFileV1Schema).min(1).max(2_048),
  dependencies: z.array(z.object({
    name: idSchema,
    version: versionSchema,
    contentHash: hashSchema.optional(),
  }).strict()).max(256),
  declaredDataWindow: z.object({
    startUtc: z.string().datetime({ offset: true }),
    endUtc: z.string().datetime({ offset: true }),
  }).strict(),
  validationRequest: z.object({
    requirementIds: z.array(idSchema).min(1).max(256),
  }).strict(),
});

export const candidateStrategyArtifactManifestV1Schema = candidateBase.extend({
  artifactKind: z.literal('strategy'),
  strategyMetadata: z.object({
    language: z.literal('cpp'),
    standard: z.literal('c++23'),
    abi: z.literal('v2'),
    className: idSchema,
    factoryMacro: z.literal('QNX_STRATEGY_FACTORY_EXPORT'),
  }).strict(),
}).strict();

export const candidateSignalArtifactManifestV1Schema = candidateBase.extend({
  artifactKind: z.literal('signal'),
  signalMetadata: z.object({
    schemaId: z.literal('canonical-signal-output'),
    schemaVersion: versionSchema,
  }).strict(),
}).strict();

export const candidateArtifactManifestV1Schema = z.discriminatedUnion(
  'artifactKind',
  [
    candidateStrategyArtifactManifestV1Schema,
    candidateSignalArtifactManifestV1Schema,
  ],
).superRefine((manifest, context) => {
  const paths = manifest.files.map((file) => file.relativePath);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({
      code: 'custom',
      path: ['files'],
      message: 'Candidate file declarations must have unique relative paths.',
    });
  }
  if (new Set(manifest.validationRequest.requirementIds).size
    !== manifest.validationRequest.requirementIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['validationRequest', 'requirementIds'],
      message: 'Validation requirement IDs must be unique.',
    });
  }
  if (Date.parse(manifest.declaredDataWindow.startUtc)
    >= Date.parse(manifest.declaredDataWindow.endUtc)) {
    context.addIssue({
      code: 'custom',
      path: ['declaredDataWindow'],
      message: 'Declared data window must have startUtc before endUtc.',
    });
  }
  const sourceFiles = manifest.files.filter((file) => file.role === 'source');
  if (manifest.artifactKind === 'strategy') {
    if (
      sourceFiles.length !== 1
      || !sourceFiles[0].relativePath.endsWith('.cpp')
      || sourceFiles[0].mediaType !== 'text/x-c++src'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'A Strategy candidate must declare exactly one C++ source file.',
      });
    }
  } else if (manifest.files.filter((file) => file.role === 'signal').length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['files'],
      message: 'A Signal candidate must declare at least one canonical signal file.',
    });
  }
});

export const acceptedArtifactManifestV1Schema = z.object({
  schemaVersion: z.literal(ACCEPTED_ARTIFACT_SCHEMA_VERSION),
  artifactId: idSchema,
  artifactKind: z.enum(['strategy', 'signal']),
  candidateContentHash: hashSchema,
  admissionResultId: idSchema,
  taskId: idSchema,
  policyVersions: z.record(idSchema, versionSchema),
  toolchainVersion: versionSchema.optional(),
  abiVersion: z.literal('v2').optional(),
  evidenceReferences: z.array(z.object({
    requirementId: idSchema,
    contentHash: hashSchema,
  }).strict()).max(256),
  provenance: z.record(idSchema, z.union([z.string(), z.number(), z.boolean()])),
  canonicalStorageReference: z.object({
    owner: z.enum(['algorithm-storage', 'signal-storage']),
    recordId: idSchema,
  }).strict(),
  acceptedAt: z.string().datetime({ offset: true }),
  rootContentHash: hashSchema,
}).strict();

export const CANDIDATE_ARTIFACT_MANIFEST_V1_JSON_SCHEMA = Object.freeze(
  z.toJSONSchema(candidateArtifactManifestV1Schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'throw',
    reused: 'ref',
  }),
);

export type CandidateArtifactFileV1 = z.infer<typeof candidateArtifactFileV1Schema>;
export type CandidateArtifactManifestV1 = z.infer<typeof candidateArtifactManifestV1Schema>;
export type AcceptedArtifactManifestV1 = z.infer<typeof acceptedArtifactManifestV1Schema>;

export function parseCandidateArtifactManifestV1(
  input: unknown,
): CandidateArtifactManifestV1 {
  return candidateArtifactManifestV1Schema.parse(input);
}
