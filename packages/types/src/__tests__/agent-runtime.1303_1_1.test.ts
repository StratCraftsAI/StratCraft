import { describe, expect, it } from 'vitest';
import {
  canonicalAgentJson,
  type AgentRuntimeCapabilities,
  type GuideAgentSelection,
} from '../agent-runtime';

const selection: GuideAgentSelection = {
  fingerprintSchemaVersion: '1',
  runtimeId: 'stratcraft',
  entitlementSource: 'provider-api-key',
  inferenceRoute: {
    runtimeProviderId: 'OPENAI',
    modelId: 'gpt-5',
  },
  locale: 'en_US',
  task: {
    taskId: 'task-1',
    taskSpecVersion: '1',
    taskSpecContentHash: 'a'.repeat(64),
  },
  workspace: {
    workspaceId: 'workspace-1',
    workspaceVersion: '1',
    workspaceContentHash: 'b'.repeat(64),
  },
  permissionPolicy: {
    kind: 'permission-policy',
    id: 'confirm',
    version: '1',
    contentHash: 'c'.repeat(64),
  },
  researchPolicy: {
    kind: 'research-policy',
    id: 'research',
    version: '1',
    contentHash: 'd'.repeat(64),
  },
  capabilityProfile: {
    kind: 'capability-profile',
    id: 'guide',
    version: '1',
    contentHash: 'e'.repeat(64),
  },
};

describe('TICKET_1303_1_1 canonical Agent runtime contract', () => {
  it('serializes object keys deterministically and omits undefined values', () => {
    expect(canonicalAgentJson({
      z: 1,
      nested: { b: true, a: 'first', omitted: undefined },
      a: 2,
    })).toBe('{"a":2,"nested":{"a":"first","b":true},"z":1}');
  });

  it('preserves array order so set-like callers must sort explicitly', () => {
    expect(canonicalAgentJson({ values: ['b', 'a'] }))
      .not.toBe(canonicalAgentJson({ values: ['a', 'b'] }));
  });

  it('covers every independent selected runtime axis', () => {
    const variants: GuideAgentSelection[] = [
      { ...selection, runtimeId: 'codex' },
      { ...selection, entitlementSource: 'provider-subscription' },
      {
        ...selection,
        inferenceRoute: { ...selection.inferenceRoute, modelId: 'gpt-5.1' },
      },
      { ...selection, locale: 'de_DE' },
      { ...selection, task: { ...selection.task, taskId: 'task-2' } },
      {
        ...selection,
        workspace: { ...selection.workspace, workspaceId: 'workspace-2' },
      },
      {
        ...selection,
        permissionPolicy: { ...selection.permissionPolicy, version: '2' },
      },
      {
        ...selection,
        researchPolicy: { ...selection.researchPolicy, contentHash: 'f'.repeat(64) },
      },
      {
        ...selection,
        capabilityProfile: { ...selection.capabilityProfile, id: 'restricted' },
      },
    ];
    const canonical = canonicalAgentJson(selection);
    expect(variants.every(variant => canonicalAgentJson(variant) !== canonical)).toBe(true);
  });

  it('keeps status diagnostics outside normalized runtime capabilities', () => {
    const capabilities: AgentRuntimeCapabilities = {
      contractVersion: '1.0.0',
      nativeVersion: '1',
      protocolVersion: '1',
      resume: true,
      permissions: true,
      filesystem: 'workspace',
      terminal: false,
      mcp: true,
      plan: true,
      usage: true,
      fileDiff: false,
    };
    expect(canonicalAgentJson(capabilities)).not.toContain('checkedAt');
    expect(canonicalAgentJson(capabilities)).not.toContain('correlationId');
    expect(canonicalAgentJson(capabilities)).not.toContain('diagnostic');
  });

  it('rejects values that JSON cannot fingerprint safely', () => {
    expect(() => canonicalAgentJson({ value: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalAgentJson({ value: 1n })).toThrow(TypeError);
    expect(() => canonicalAgentJson({ value: () => undefined })).toThrow(TypeError);
  });
});
