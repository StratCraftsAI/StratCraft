import { describe, expect, it } from 'vitest';
import {
  RESEARCH_TASK_SPEC_V1_JSON_SCHEMA,
  completionCriterionV1Schema,
  evidenceRequirementV1Schema,
  researchTaskDraftV1Schema,
  researchTaskSpecV1Schema,
  parseResearchTaskDraftV1,
  parseResearchTaskSpecV1,
  type EvidenceRequirementV1,
} from '../research-task';

const hash = (character: string) => character.repeat(64);

const requirements: EvidenceRequirementV1[] = [
  {
    requirementId: 'unit',
    type: 'unit_test',
    suiteId: 'suite-unit',
    requiredPassCount: 2,
  },
  {
    requirementId: 'integration',
    type: 'integration_test',
    suiteId: 'suite-integration',
    requiredPassCount: 1,
  },
  {
    requirementId: 'compile',
    type: 'compile',
    language: 'cpp',
    standard: 'c++23',
    abi: 'v2',
  },
  {
    requirementId: 'backtest',
    type: 'backtest',
    benchmarkId: 'benchmark',
    requiredMetrics: ['sharpe', 'drawdown'],
  },
  {
    requirementId: 'bh',
    type: 'statistical_validation',
    method: 'bh',
    policyReference: { policyId: 'stats', version: '1' },
  },
  {
    requirementId: 'leakage',
    type: 'leakage_check',
    policyReference: { policyId: 'leakage', version: '1' },
  },
  {
    requirementId: 'rss',
    type: 'resource_measurement',
    metric: 'peak-rss',
    boundReference: { policyId: 'resources', version: '1' },
  },
  {
    requirementId: 'provenance',
    type: 'provenance',
    requiredFields: ['runtime-version', 'source-hash'],
  },
];

function validTask() {
  return {
    schemaVersion: 1,
    taskId: 'task-1',
    projectId: 'project-1',
    objective: 'Produce a deterministic candidate.',
    artifactKind: 'strategy' as const,
    workspaceId: 'workspace-1',
    inputArtifactRefs: [],
    dataCapabilityManifest: {
      id: 'data-1',
      version: '1',
      contentHash: hash('a'),
    },
    toolCapabilityRequest: {
      profileId: 'tools-1',
      profileVersion: '1',
      requiredSemanticCapabilities: ['read-market-data'],
    },
    commandPolicy: { policyId: 'commands-1', version: '1' },
    resourceBudget: { policyId: 'resources-1', version: '1' },
    researchPolicyBundle: {
      id: 'research-1',
      version: '1',
      contentHash: hash('b'),
    },
    acceptanceProfile: { id: 'acceptance-1', version: '1' },
    evidenceRequirements: requirements,
    completionCriteria: [
      {
        criterionId: 'unit-passed',
        requirementId: 'unit',
        predicate: 'passed' as const,
        value: true as const,
      },
    ],
    locale: 'en-US',
  };
}

describe('TICKET_1303_1_2 ResearchTaskSpec v1 contract', () => {
  it('publishes a strict Draft 2020-12 JSON Schema', () => {
    expect(RESEARCH_TASK_SPEC_V1_JSON_SCHEMA.$schema)
      .toBe('https://json-schema.org/draft/2020-12/schema');
    expect(RESEARCH_TASK_SPEC_V1_JSON_SCHEMA.$id)
      .toBe('https://stratcraft.ai/schemas/research-task-spec-v1.json');
    expect(RESEARCH_TASK_SPEC_V1_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('accepts every structured evidence discriminator', () => {
    for (const requirement of requirements) {
      expect(evidenceRequirementV1Schema.safeParse(requirement).success).toBe(true);
    }
    for (const method of ['dsr', 'cpcv'] as const) {
      expect(evidenceRequirementV1Schema.safeParse({
        requirementId: method,
        type: 'statistical_validation',
        method,
        policyReference: { policyId: 'stats', version: '1' },
      }).success).toBe(true);
    }
  });

  it('accepts every typed criterion predicate and rejects wrong value types', () => {
    const valid = [
      { criterionId: 'a', requirementId: 'unit', predicate: 'passed', value: true },
      { criterionId: 'b', requirementId: 'unit', predicate: 'gte', value: 1 },
      { criterionId: 'c', requirementId: 'unit', predicate: 'lte', value: 2 },
      { criterionId: 'd', requirementId: 'unit', predicate: 'equals', value: 'ok' },
      { criterionId: 'e', requirementId: 'unit', predicate: 'present', value: true },
    ];
    expect(valid.every((criterion) =>
      completionCriterionV1Schema.safeParse(criterion).success)).toBe(true);
    expect(completionCriterionV1Schema.safeParse({
      criterionId: 'bad',
      requirementId: 'unit',
      predicate: 'gte',
      value: '1',
    }).success).toBe(false);
  });

  it('requires every frozen semantic field and refuses inline duplicate data', () => {
    expect(researchTaskSpecV1Schema.parse(validTask())).toEqual(validTask());
    expect(parseResearchTaskSpecV1(validTask())).toEqual(validTask());
    const { commandPolicy: _omitted, ...missing } = validTask();
    expect(researchTaskSpecV1Schema.safeParse(missing).success).toBe(false);
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      market: 'forex',
      provider: 'databento',
      window: { startUtc: '2025-01-01T00:00:00Z', endUtc: '2025-02-01T00:00:00Z' },
    }).success).toBe(false);
  });

  it('rejects duplicate IDs, broken references, ABI v1, and unknown fields', () => {
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      evidenceRequirements: [requirements[0], requirements[0]],
    }).success).toBe(false);
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      completionCriteria: [{
        criterionId: 'unknown',
        requirementId: 'missing',
        predicate: 'present',
        value: true,
      }],
    }).success).toBe(false);
    expect(evidenceRequirementV1Schema.safeParse({
      requirementId: 'compile',
      type: 'compile',
      language: 'cpp',
      standard: 'c++23',
      abi: 'v1',
    }).success).toBe(false);
    expect(researchTaskDraftV1Schema.safeParse({
      projectId: 'project',
      artifactKind: 'strategy',
      objective: 'objective',
      locale: 'en-US',
      workspaceId: 'workspace',
      dataCapabilityId: 'data',
      toolCapabilityProfileId: 'tools',
      commandPolicyId: 'commands',
      resourceBudgetPolicyId: 'resources',
      researchPolicyBundleId: 'research',
      acceptanceProfileId: 'acceptance',
      inputArtifactRefs: [],
      policyVersion: 'renderer-must-not-supply-this',
    }).success).toBe(false);
    expect(parseResearchTaskDraftV1({
      projectId: 'project',
      artifactKind: 'strategy',
      objective: 'objective',
      locale: 'en-US',
      workspaceId: 'workspace',
      dataCapabilityId: 'data',
      toolCapabilityProfileId: 'tools',
      commandPolicyId: 'commands',
      resourceBudgetPolicyId: 'resources',
      researchPolicyBundleId: 'research',
      acceptanceProfileId: 'acceptance',
      inputArtifactRefs: [],
    })).toMatchObject({ projectId: 'project' });
  });

  it('rejects duplicate nested lists, criteria, Artifact refs, and control text', () => {
    const duplicateMetrics = {
      ...requirements[3],
      requiredMetrics: ['sharpe', 'sharpe'],
    };
    const duplicateFields = {
      ...requirements[7],
      requiredFields: ['runtime-version', 'runtime-version'],
    };
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      evidenceRequirements: [
        ...requirements.filter(({ requirementId }) =>
          requirementId !== 'backtest' && requirementId !== 'provenance'),
        duplicateMetrics,
        duplicateFields,
      ],
    }).success).toBe(false);
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      completionCriteria: [
        validTask().completionCriteria[0],
        validTask().completionCriteria[0],
      ],
    }).success).toBe(false);
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      inputArtifactRefs: [
        {
          artifactId: 'artifact-1',
          artifactKind: 'strategy',
          rootContentHash: hash('c'),
        },
        {
          artifactId: 'artifact-1',
          artifactKind: 'strategy',
          rootContentHash: hash('d'),
        },
      ],
    }).success).toBe(false);
    expect(researchTaskSpecV1Schema.safeParse({
      ...validTask(),
      objective: 'invalid\u0000objective',
    }).success).toBe(false);
  });
});
