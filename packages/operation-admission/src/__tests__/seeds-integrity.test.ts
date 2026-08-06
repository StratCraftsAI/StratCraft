/**
 * TICKET_1345 Phase 3: Seed integrity tests.
 *
 * Validates the representative operation policy seeds have no duplicates,
 * no invalid shapes, and consistent capability references.
 */
import { describe, it, expect } from 'vitest';
import type { OperationAdmissionPolicy } from '@StratCraft/types';
import {
  REPRESENTATIVE_POLICIES,
  MCP_TOOL_POLICIES,
  IPC_CHANNEL_POLICIES,
  SERVICE_API_POLICIES,
  OperationPolicyRegistry,
} from '../index';

describe('seed integrity', () => {
  it('no duplicate operationIds within the representative set', () => {
    const ids = REPRESENTATIVE_POLICIES.map(p => p.operationId);
    const unique = new Set(ids);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    expect(unique.size).toBe(ids.length);
  });

  it('no duplicate operationIds across surfaces', () => {
    const allIds = [
      ...MCP_TOOL_POLICIES.map(p => p.operationId),
      ...IPC_CHANNEL_POLICIES.map(p => p.operationId),
      ...SERVICE_API_POLICIES.map(p => p.operationId),
    ];
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it('every policy has a non-empty operationId and capabilityId', () => {
    for (const p of REPRESENTATIVE_POLICIES) {
      expect(p.operationId.length).toBeGreaterThan(0);
      expect(p.capabilityId.length).toBeGreaterThan(0);
    }
  });

  it('mutation policies always have a delegation policy', () => {
    for (const p of REPRESENTATIVE_POLICIES) {
      if (p.mutationAuthority === 'human-origin-required') {
        expect(p.delegationPolicy).toBeDefined();
        expect(['direct-only', 'session-trust-eligible']).toContain(p.delegationPolicy);
      }
    }
  });

  it('read-only policies never have a delegation policy', () => {
    for (const p of REPRESENTATIVE_POLICIES) {
      if (p.mutationAuthority === 'none') {
        expect(p.delegationPolicy).toBeUndefined();
      }
    }
  });

  it('MCP tool operationIds are prefixed with mcp:', () => {
    for (const p of MCP_TOOL_POLICIES) {
      expect(p.operationId).toMatch(/^mcp:/);
    }
  });

  it('IPC channel operationIds are prefixed with ipc:', () => {
    for (const p of IPC_CHANNEL_POLICIES) {
      expect(p.operationId).toMatch(/^ipc:/);
    }
  });

  it('Service API operationIds are prefixed with api:', () => {
    for (const p of SERVICE_API_POLICIES) {
      expect(p.operationId).toMatch(/^api:/);
    }
  });

  it('all policies register into a registry without error', () => {
    const registry = new OperationPolicyRegistry();
    expect(() => registry.registerAll(REPRESENTATIVE_POLICIES)).not.toThrow();
    expect(registry.size()).toBe(REPRESENTATIVE_POLICIES.length);
  });

  it('frozen registry has all entries', () => {
    const registry = new OperationPolicyRegistry();
    registry.registerAll(REPRESENTATIVE_POLICIES);
    const frozen = registry.freeze();
    for (const p of REPRESENTATIVE_POLICIES) {
      expect(frozen.has(p.operationId)).toBe(true);
    }
  });

  it('policyRevision is a positive integer for all seeds', () => {
    for (const p of REPRESENTATIVE_POLICIES) {
      expect(p.policyRevision).toBeGreaterThan(0);
      expect(Number.isInteger(p.policyRevision)).toBe(true);
    }
  });

  it('plugin-tier policies have a non-empty pluginId', () => {
    for (const p of REPRESENTATIVE_POLICIES) {
      if (p.entitlement.kind === 'plugin-tier') {
        expect(p.entitlement.pluginId.length).toBeGreaterThan(0);
        expect(p.entitlement.requirementSource).toBe('current-registry');
      }
    }
  });
});
