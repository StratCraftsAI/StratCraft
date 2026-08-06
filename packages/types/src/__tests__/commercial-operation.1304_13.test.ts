import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_CAPABILITY_PROJECTION_V1_JSON_SCHEMA,
  COMMERCIAL_HOST_ROLES,
  COMMERCIAL_OPERATION_CONTRACT_VERSION,
  COMMERCIAL_OPERATION_IDS,
  COMMERCIAL_OPERATION_INVENTORY,
  COMMERCIAL_OPERATION_PROGRESS_V1_JSON_SCHEMA,
  COMMERCIAL_OPERATION_REQUEST_V1_JSON_SCHEMA,
  COMMERCIAL_OPERATION_RESULT_V1_JSON_SCHEMA,
  commercialCapabilityProjectionSchema,
  commercialOperationInventoryEntrySchema,
  commercialOperationProgressSchema,
  commercialOperationRequestSchema,
  commercialOperationResultSchema,
} from '../commercial-operation';

describe('TICKET_1304_13 shared commercial operation contract', () => {
  it('inventories every operation once with both surface adapters and one entitlement resolver', () => {
    expect(COMMERCIAL_OPERATION_INVENTORY).toHaveLength(COMMERCIAL_OPERATION_IDS.length);
    expect(new Set(COMMERCIAL_OPERATION_INVENTORY.map(({ operationId }) => operationId))).toEqual(
      new Set(COMMERCIAL_OPERATION_IDS),
    );
    for (const entry of COMMERCIAL_OPERATION_INVENTORY) {
      expect(commercialOperationInventoryEntrySchema.parse(entry)).toEqual(entry);
      expect(entry.entitlement).toEqual({
        packageId: 'com.stratcraft.quant-lab',
        resolver: 'resolveUserTier',
      });
      expect(entry.adapters.electron).toBe(`commercial.${entry.operationId}`);
      expect(entry.adapters.serviceApi).toBe(`commercial.${entry.operationId}`);
    }
    expect(COMMERCIAL_HOST_ROLES).toEqual(['electron', 'service-api']);
  });

  /**
   * TICKET_1304_16 P3: the resource-shape invariant every inventory row obeys.
   *
   * WHY THIS EXISTS. The test above checks that every operation is inventoried
   * once, parses against the schema, and derives its adapters -- it never
   * checks what a row SAYS. `authoritativeOwner`, `workerCapabilityId` and
   * `projections` carry the row's whole semantic content, no runtime code
   * reads the inventory (only `COMMERCIAL_OPERATION_IDS` drives dispatch), and
   * TICKET_1304_13 section 2 names `authoritativeOwner` as a column without
   * defining its values. The content was therefore unfalsifiable: a new row
   * could claim anything and nothing would notice.
   *
   * WHAT IS ASSERTED, AND WHY ONLY THIS. The rule below is derived from the
   * committed data (65 rows), not invented: a `commercial-worker` row is
   * exactly one that reserves host storage and an authoritative resource plan
   * and names a worker capability. It holds 9/9 today.
   *
   * WHAT IS DELIBERATELY *NOT* ASSERTED. An earlier attempt at this gate
   * asserted `authoritativeOwner === 'commercial-worker'` iff the package
   * routes the operation through `WORKER_OPERATIONS`. That rule is false in
   * BOTH directions and would have encoded a contract this codebase never had:
   *
   *   worker-owned, absent from WORKER_OPERATIONS:
   *     research.relegation.cycle, research.sweep.queue.enqueue,
   *     factor-mining.formula.generate
   *   in WORKER_OPERATIONS, not worker-owned:
   *     research.sweep.launch
   *
   * The two track different questions. `WORKER_OPERATIONS` is a ROUTING table
   * ("does the generic passthrough dispatch this?" -- several members are
   * listed only so the admission audit finds them, and are intercepted before
   * the lookup). `authoritativeOwner` is a PROVENANCE claim ("who is
   * authoritative for the result?" -- `research.sweep.launch` is package-owned
   * because the package orchestrates an arm loop and owns the composite
   * outcome, even though each arm reaches the worker).
   *
   * Provenance cannot be checked mechanically until the field's values are
   * defined, which is a design decision and not derivable from code that never
   * reads it. This gate gates the part that IS derivable; the open question is
   * recorded in TICKET_1304_16 rather than silently resolved here.
   */
  it('binds commercial-worker ownership to the storage + resource-plan + capability shape', () => {
    for (const entry of COMMERCIAL_OPERATION_INVENTORY) {
      const reservesHostResources = entry.boundedDataOwner === 'public-host-storage'
        && entry.resourcePlan === 'public-host-authoritative-plan';

      if (entry.authoritativeOwner === 'commercial-worker') {
        expect(
          reservesHostResources,
          `${entry.operationId}: a commercial-worker operation must reserve host storage `
            + 'and an authoritative resource plan.',
        ).toBe(true);
        expect(
          entry.workerCapabilityId,
          `${entry.operationId}: a commercial-worker operation must name the capability it runs.`,
        ).not.toBeNull();
      }

      // `public-host-storage` operations are the storage primitives themselves;
      // they neither reserve a plan nor name a capability.
      if (entry.authoritativeOwner === 'public-host-storage') {
        expect(entry.boundedDataOwner, entry.operationId).toBe('none');
        expect(entry.resourcePlan, entry.operationId).toBe('none');
        expect(entry.workerCapabilityId, entry.operationId).toBeNull();
      }
    }
  });

  /**
   * A row that reserves host storage must also reserve the resource plan, and
   * vice versa: they are two halves of one reservation. Asserted independently
   * of ownership so a malformed row fails here whatever it claims to be.
   */
  it('reserves bounded data and the resource plan together or not at all', () => {
    for (const entry of COMMERCIAL_OPERATION_INVENTORY) {
      expect(
        entry.boundedDataOwner === 'public-host-storage',
        `${entry.operationId}: boundedDataOwner and resourcePlan must agree.`,
      ).toBe(entry.resourcePlan === 'public-host-authoritative-plan');
    }
  });

  /**
   * Every operation must be able to report a result or an error; an operation
   * projecting neither can report nothing and is a malformed row.
   */
  it('projects at least one terminal channel on every operation', () => {
    for (const entry of COMMERCIAL_OPERATION_INVENTORY) {
      expect(
        entry.projections.includes('result') || entry.projections.includes('error'),
        `${entry.operationId}: must project a terminal channel.`,
      ).toBe(true);
      expect(new Set(entry.projections).size, `${entry.operationId}: duplicate projection.`)
        .toBe(entry.projections.length);
    }
  });

  it('keeps business request and terminal result envelopes transport-neutral and strict', () => {
    const request = {
      contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
      requestId: 'request-1',
      operationId: 'research.discovery.execute',
      input: { universeId: 'g10' },
    } as const;
    expect(commercialOperationRequestSchema.parse(request)).toEqual(request);
    expect(commercialOperationRequestSchema.safeParse({ ...request, ipcEvent: {} }).success).toBe(false);
    expect(commercialOperationRequestSchema.safeParse({
      ...request,
      input: { callback: () => undefined },
    }).success).toBe(false);

    const success = {
      contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
      requestId: 'request-1',
      operationId: 'research.discovery.execute',
      status: 'succeeded',
      entitlementDecisionId: 'entitlement-1',
      resourceDecisionId: 'resource-1',
      output: { discovered: 2 },
      artifacts: [{
        artifactId: 'artifact-1',
        artifactKind: 'result',
        schemaId: 'research-discovery-result',
        schemaVersion: '1.0.0',
        sha256: 'a'.repeat(64),
      }],
    } as const;
    expect(commercialOperationResultSchema.parse(success)).toEqual(success);

    const failure = {
      contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
      requestId: 'request-2',
      operationId: 'research.scoreboard.read',
      status: 'failed',
      code: 'COMMERCIAL_ENTITLEMENT_DENIED',
      message: 'Quant Lab entitlement is required.',
      remediation: 'Install or renew Quant Lab.',
      retryable: false,
      entitlementDecisionId: 'entitlement-2',
      resourceDecisionId: null,
    } as const;
    expect(commercialOperationResultSchema.parse(failure)).toEqual(failure);
  });

  it('validates progress bounds and typed package absence', () => {
    const progress = {
      contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
      requestId: 'request-1',
      operationId: 'alpha-factory.execute',
      sequence: 1,
      phase: 'evaluation',
      message: 'Evaluating candidates.',
      completedUnits: 2,
      totalUnits: 3,
    } as const;
    expect(commercialOperationProgressSchema.parse(progress)).toEqual(progress);
    expect(commercialOperationProgressSchema.safeParse({
      ...progress,
      completedUnits: 4,
    }).success).toBe(false);
    expect(commercialOperationProgressSchema.safeParse({
      ...progress,
      totalUnits: undefined,
    }).success).toBe(false);

    expect(commercialCapabilityProjectionSchema.parse({
      state: 'absent',
      operationId: 'research.discovery.execute',
      code: 'COMMERCIAL_PACKAGE_ABSENT',
      message: 'Quant Lab is not installed.',
      remediation: 'Install the signed package.',
    }).state).toBe('absent');
  });

  it('publishes generated Draft 2020-12 schemas from the runtime owners', () => {
    for (const schema of [
      COMMERCIAL_OPERATION_REQUEST_V1_JSON_SCHEMA,
      COMMERCIAL_OPERATION_RESULT_V1_JSON_SCHEMA,
      COMMERCIAL_OPERATION_PROGRESS_V1_JSON_SCHEMA,
      COMMERCIAL_CAPABILITY_PROJECTION_V1_JSON_SCHEMA,
    ]) {
      expect(schema).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema' });
    }
  });
});
