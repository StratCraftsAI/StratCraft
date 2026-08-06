import { describe, expect, it } from 'vitest';
import {
  acceptedArtifactManifestV1Schema,
  candidateArtifactManifestV1Schema,
  parseCandidateArtifactManifestV1,
} from '../artifact';

const hash = (character: string) => character.repeat(64);

function candidate() {
  return {
    schemaVersion: 1,
    candidateId: 'candidate-1',
    artifactKind: 'strategy' as const,
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    taskSpecContentHash: hash('a'),
    workspaceContentHash: hash('b'),
    turnAdmissionFingerprint: hash('c'),
    acceptanceProfileContentHash: hash('d'),
    runtime: {
      runtimeId: 'stratcraft',
      adapterVersion: '1.0.0',
      nativeVersion: '1.0.0',
      protocolVersion: '1.0.0',
      nativeSessionReference: 'session-1',
    },
    files: [{
      role: 'source' as const,
      relativePath: 'source/strategy.cpp',
      byteSize: 100,
      mediaType: 'text/x-c++src',
      sha256: hash('e'),
    }],
    dependencies: [],
    strategyMetadata: {
      language: 'cpp' as const,
      standard: 'c++23' as const,
      abi: 'v2' as const,
      className: 'Strategy',
      factoryMacro: 'QNX_STRATEGY_FACTORY_EXPORT' as const,
    },
    declaredDataWindow: {
      startUtc: '2025-01-01T00:00:00Z',
      endUtc: '2025-02-01T00:00:00Z',
    },
    validationRequest: {
      requirementIds: ['compile'],
    },
  };
}

describe('TICKET_1303_1_2 Candidate and Accepted Artifact contracts', () => {
  it('accepts a strict C++23 ABI v2 Strategy candidate', () => {
    expect(candidateArtifactManifestV1Schema.parse(candidate())).toEqual(candidate());
    expect(parseCandidateArtifactManifestV1(candidate())).toEqual(candidate());
  });

  it('rejects Python, ABI v1, opaque source, bad paths, duplicates, and invalid windows', () => {
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      strategyMetadata: { ...candidate().strategyMetadata, language: 'python' },
    }).success).toBe(false);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      strategyMetadata: { ...candidate().strategyMetadata, abi: 'v1' },
    }).success).toBe(false);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      files: [{
        ...candidate().files[0],
        relativePath: 'source/strategy.so',
        mediaType: 'application/x-sharedlib',
      }],
    }).success).toBe(false);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      files: [{ ...candidate().files[0], relativePath: '../escape.cpp' }],
    }).success).toBe(false);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      files: [candidate().files[0], candidate().files[0]],
    }).success).toBe(false);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      validationRequest: { requirementIds: ['compile', 'compile'] },
    }).success).toBe(false);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      declaredDataWindow: {
        startUtc: '2025-02-01T00:00:00Z',
        endUtc: '2025-01-01T00:00:00Z',
      },
    }).success).toBe(false);
    for (const relativePath of [
      'source\\strategy.cpp',
      'source:strategy.cpp',
      '/source/strategy.cpp',
      'source/strategy.cpp/',
      'source//strategy.cpp',
      'source/./strategy.cpp',
    ]) {
      expect(candidateArtifactManifestV1Schema.safeParse({
        ...candidate(),
        files: [{ ...candidate().files[0], relativePath }],
      }).success).toBe(false);
    }
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...candidate(),
      files: [{
        ...candidate().files[0],
        role: 'evidence',
        relativePath: 'evidence/result.json',
        mediaType: 'application/json',
      }],
    }).success).toBe(false);
  });

  it('accepts canonical Signal declarations and requires a signal file', () => {
    const signal = {
      ...candidate(),
      artifactKind: 'signal' as const,
      files: [{
        role: 'signal' as const,
        relativePath: 'signals/output.json',
        byteSize: 10,
        mediaType: 'application/json',
        sha256: hash('f'),
      }],
      signalMetadata: {
        schemaId: 'canonical-signal-output' as const,
        schemaVersion: '1',
      },
    };
    const { strategyMetadata: _strategyMetadata, ...validSignal } = signal;
    expect(candidateArtifactManifestV1Schema.safeParse(validSignal).success).toBe(true);
    expect(candidateArtifactManifestV1Schema.safeParse({
      ...validSignal,
      files: [{ ...validSignal.files[0], role: 'evidence' }],
    }).success).toBe(false);
  });

  it('keeps accepted manifests portable and linked to canonical storage', () => {
    expect(acceptedArtifactManifestV1Schema.safeParse({
      schemaVersion: 1,
      artifactId: 'artifact-1',
      artifactKind: 'strategy',
      candidateContentHash: hash('a'),
      admissionResultId: 'admission-1',
      taskId: 'task-1',
      policyVersions: { acceptance: '1' },
      toolchainVersion: 'clang-19',
      abiVersion: 'v2',
      evidenceReferences: [{ requirementId: 'compile', contentHash: hash('b') }],
      provenance: { runtime: 'stratcraft', reproducible: true },
      canonicalStorageReference: {
        owner: 'algorithm-storage',
        recordId: '42',
      },
      acceptedAt: '2026-07-26T00:00:00Z',
      rootContentHash: hash('c'),
    }).success).toBe(true);
  });
});
