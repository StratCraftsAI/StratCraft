/**
 * TICKET_1345: Authoritative operation policy registry.
 *
 * Every exposed operation (MCP tool, IPC channel, Service API route) must
 * register exactly one `OperationAdmissionPolicy`. The registry rejects
 * duplicates at registration time and rejects registrations after freeze.
 *
 * A `FrozenPolicyRegistry` is the immutable snapshot consumed by the
 * `OperationAdmissionAuthority`. Once frozen, no new policies can be added
 * and the authority receives a stable, enumerable map.
 */

import type { OperationAdmissionPolicy } from '@StratCraft/types';

export class OperationPolicyRegistry {
  private readonly policies = new Map<string, OperationAdmissionPolicy>();
  private frozen = false;

  register(policy: OperationAdmissionPolicy): void {
    if (this.frozen) {
      throw new Error(
        `OperationPolicyRegistry is frozen; cannot register '${policy.operationId}'`,
      );
    }
    if (this.policies.has(policy.operationId)) {
      throw new Error(
        `Duplicate operation policy: '${policy.operationId}' is already registered`,
      );
    }
    this.policies.set(policy.operationId, policy);
  }

  registerAll(policies: readonly OperationAdmissionPolicy[]): void {
    for (const policy of policies) {
      this.register(policy);
    }
  }

  lookup(operationId: string): OperationAdmissionPolicy | undefined {
    return this.policies.get(operationId);
  }

  has(operationId: string): boolean {
    return this.policies.has(operationId);
  }

  size(): number {
    return this.policies.size;
  }

  freeze(): FrozenPolicyRegistry {
    this.frozen = true;
    return new FrozenPolicyRegistry(new Map(this.policies));
  }
}

export class FrozenPolicyRegistry {
  constructor(
    private readonly policies: ReadonlyMap<string, OperationAdmissionPolicy>,
  ) {}

  lookup(operationId: string): OperationAdmissionPolicy | undefined {
    return this.policies.get(operationId);
  }

  has(operationId: string): boolean {
    return this.policies.has(operationId);
  }

  entries(): ReadonlyMap<string, OperationAdmissionPolicy> {
    return this.policies;
  }

  size(): number {
    return this.policies.size;
  }
}
