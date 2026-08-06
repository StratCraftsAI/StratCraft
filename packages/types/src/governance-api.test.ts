/**
 * TICKET_1303_100 Phase 4: cross-repo contract tests.
 *
 * These tests exist because the projection previously had no consumer. The
 * server generated `types.ts`, nothing imported it, and nothing recomputed its
 * digest -- so a server-side field rename (the `mandate_id` / `task_id` freeze)
 * silently failed to reach the client. A gate that cannot fail is not a gate.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { canonicalAgentJson } from './agent-runtime';
import {
  GOVERNANCE_API_ARTIFACT_PATH,
  GOVERNANCE_API_ENDPOINTS,
  GOVERNANCE_API_ENDPOINT_COUNT,
  GOVERNANCE_API_HASH,
  GOVERNANCE_API_SCHEMA_NAMES,
  GOVERNANCE_API_VERSION,
  getGovernanceApiEndpoint,
} from './governance-api';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = path.join(packageRoot, GOVERNANCE_API_ARTIFACT_PATH);
const artifactText = readFileSync(artifactPath, 'utf8');
const artifact = JSON.parse(artifactText) as {
  info: { version: string };
  paths: Record<string, Record<string, { operationId: string }>>;
  components: { schemas: Record<string, unknown> };
};

const pinnedHash = readFileSync(
  path.join(packageRoot, 'contracts', 'governance-api-v1.HASH'),
  'utf8',
).trim();
const pinnedVersion = readFileSync(
  path.join(packageRoot, 'contracts', 'governance-api-v1.VERSION'),
  'utf8',
).trim();

function digestOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalAgentJson(value), 'utf8').digest('hex')}`;
}

describe('governance API cross-repo contract', () => {
  it('recomputes the nona_server digest from the vendored artifact', () => {
    // The digest is derived, not copied. This is the assertion that would have
    // caught the mandate_id / task_id drift.
    expect(digestOf(artifact)).toBe(pinnedHash);
  });

  it('exports the pinned digest and version', () => {
    expect(GOVERNANCE_API_HASH).toBe(pinnedHash);
    expect(GOVERNANCE_API_VERSION).toBe(pinnedVersion);
    expect(GOVERNANCE_API_VERSION).toBe(artifact.info.version);
  });

  it('detects any drift in the artifact body', () => {
    const mutated = JSON.parse(artifactText) as typeof artifact;
    const firstSchema = Object.keys(mutated.components.schemas).sort()[0]!;
    (mutated.components.schemas[firstSchema] as Record<string, unknown>).x_drift_probe = true;
    // A schema-body-only change leaves the generated TypeScript identical, so a
    // text-diff gate would pass. The digest must still reject it.
    expect(digestOf(mutated)).not.toBe(pinnedHash);
  });

  it('is order-independent, matching RFC 8785 canonicalization', () => {
    const reordered = JSON.parse(artifactText) as Record<string, unknown>;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse());
    expect(digestOf(shuffled)).toBe(pinnedHash);
  });

  it('projects every endpoint declared in the artifact', () => {
    const declared = Object.entries(artifact.paths)
      .flatMap(([routePath, item]) =>
        Object.entries(item).map(([method, operation]) => ({
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path: routePath,
        })),
      )
      .sort((left, right) => (left.operationId < right.operationId ? -1 : 1));
    const projected = [...GOVERNANCE_API_ENDPOINTS]
      .map((endpoint) => ({ ...endpoint }))
      .sort((left, right) => (left.operationId < right.operationId ? -1 : 1));
    expect(projected).toEqual(declared);
    expect(GOVERNANCE_API_ENDPOINT_COUNT).toBe(declared.length);
  });

  it('projects every schema name declared in the artifact', () => {
    expect([...GOVERNANCE_API_SCHEMA_NAMES]).toEqual(
      Object.keys(artifact.components.schemas).sort(),
    );
  });

  it('carries the frozen mandate and task identifiers', () => {
    // The specific fields whose server-side freeze never reached the client.
    const advance = artifact.components.schemas.AdvanceTaskRequest as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(advance.properties)).toContain('expected_mandate_version');
    expect(Object.keys(advance.properties)).toContain('expected_task_version');
  });

  it('declares unique operation ids', () => {
    const ids = GOVERNANCE_API_ENDPOINTS.map((endpoint) => endpoint.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves an endpoint by operation id', () => {
    const first = GOVERNANCE_API_ENDPOINTS[0]!;
    expect(getGovernanceApiEndpoint(first.operationId)).toEqual(first);
  });

  it('fails fast on an unknown operation id', () => {
    expect(() =>
      getGovernanceApiEndpoint('not_a_real_operation' as never),
    ).toThrow(/Unknown governance API operation id/);
  });
});
