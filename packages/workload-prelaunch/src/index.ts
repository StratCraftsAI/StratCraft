/**
 * TICKET_1373 R1: the plan fingerprint owner must be usable unchanged by every
 * surface that calls the synchronous contract (TICKET_1306). `node:crypto`
 * satisfied Electron and MCP only -- Vite externalizes it for the browser, so
 * the Guide entry graph threw on evaluation before React mounted and the whole
 * WebUI white-screened. WebCrypto's `subtle.digest` is async and cannot back
 * this synchronous API, so the owner uses an audited, dependency-free,
 * runtime-portable SHA-256 whose digest is byte-for-byte identical to the
 * previous `createHash('sha256')` output (see the parity fixtures in
 * `fingerprint-parity.1373.test.ts`). Existing fingerprints therefore remain
 * valid.
 *
 * `@noble/hashes` is held at v1.x deliberately: this package ships both ESM
 * and CJS (`tsup --format cjs,esm`), and v2 is ESM-only, so a v2 bump makes
 * the CJS build throw ERR_REQUIRE_ESM inside the Electron main process. Any
 * upgrade must keep a `require`-able entry point.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type {
  ConfirmedWorkloadPlan,
  MissingWorkloadParameter,
  ResolvedWorkloadParameter,
  StructuredWorkloadValidationError,
  WorkloadJsonValue,
  WorkloadParameterControl,
  WorkloadParameterImpact,
  WorkloadDateBounds,
  WorkloadParameterVisibility,
  WorkloadPrelaunchErrorCode,
  WorkloadPrelaunchReview,
} from '@StratCraft/types';
import { WORKLOAD_PRELAUNCH_CONTRACT_VERSION } from '@StratCraft/types';

export interface WorkloadParameterDefinition {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly editable: boolean;
  readonly impact: readonly WorkloadParameterImpact[];
  readonly defaultValue?: WorkloadJsonValue;
  readonly defaultSource?: string;
  readonly defaultRole?: 'calculated-from-coverage';
  readonly supportedChoices?: readonly WorkloadJsonValue[];
  readonly validationRequirements?: string;
  readonly control?: WorkloadParameterControl;
  readonly validation?: { readonly minimum?: number; readonly maximum?: number; readonly step?: number };
  readonly nullable?: boolean;
  /**
   * TICKET_1370 R9: renders this parameter only when the named controlling
   * parameter holds one of `equals`. This replaced the R4 `requiredGroup`
   * either/or repair UI: a domain choice with several input modes is one
   * required source parameter plus source-conditional inputs, which is what
   * the validator and the runtime already agree on.
   */
  readonly visibleWhen?: WorkloadParameterVisibility;
  readonly dateBounds?: WorkloadDateBounds;
}

export interface WorkloadParameterSpecification {
  readonly id: string;
  readonly version: string;
  readonly parameters: readonly WorkloadParameterDefinition[];
}

export interface WorkloadResolutionInput {
  readonly explicit?: Readonly<Record<string, WorkloadJsonValue | undefined>>;
  readonly persisted?: Readonly<Record<string, WorkloadJsonValue | undefined>>;
  readonly derived?: Readonly<Record<string, WorkloadJsonValue | undefined>>;
  readonly derivedContextVersion: string;
  readonly estimatedWork?: Readonly<Record<string, WorkloadJsonValue>>;
}

export interface ConfirmationInput {
  readonly planFingerprint: string;
  readonly specificationVersion: string;
  readonly confirmedAtUtc: string;
}

export class WorkloadPrelaunchError extends Error {
  constructor(
    readonly code: WorkloadPrelaunchErrorCode,
    message: string,
    readonly remediation: string,
    readonly freshReview?: WorkloadPrelaunchReview,
  ) {
    super(message);
    this.name = 'WorkloadPrelaunchError';
  }
}

type Validator = (
  values: Readonly<Record<string, WorkloadJsonValue>>,
) => readonly StructuredWorkloadValidationError[];

function canonical(value: WorkloadJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, WorkloadJsonValue>>;
  return `{${Object.keys(object).sort().map(key => (
    `${JSON.stringify(key)}:${canonical(object[key])}`
  )).join(',')}}`;
}

/**
 * TICKET_1373 R1/R2: the single authoritative SHA-256 owner for this package.
 * Exported so parity fixtures assert the digest itself rather than a value
 * reconstructed by a test-local hash.
 */
export function workloadPlanDigest(payload: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(payload)));
}

function fingerprint(
  specification: WorkloadParameterSpecification,
  derivedContextVersion: string,
  parameters: readonly ResolvedWorkloadParameter[],
): string {
  const payload = canonical({
    specificationId: specification.id,
    specificationVersion: specification.version,
    derivedContextVersion,
    parameters: [...parameters]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(parameter => ({
        id: parameter.id,
        value: parameter.value,
        provenance: parameter.provenance,
      })),
  });
  return workloadPlanDigest(payload);
}

export function resolvePrelaunchReview(
  specification: WorkloadParameterSpecification,
  input: WorkloadResolutionInput,
  validate: Validator = () => [],
): WorkloadPrelaunchReview {
  const known = new Set(specification.parameters.map(parameter => parameter.id));
  const unknown = Object.keys(input.explicit ?? {}).filter(id => !known.has(id));
  const validationErrors: StructuredWorkloadValidationError[] = unknown.map(id => ({
    code: 'UNKNOWN_PARAMETER',
    parameterIds: [id],
    message: `Unknown workload parameter '${id}'.`,
    remediation: 'Remove the unsupported parameter and resolve a new review.',
  }));
  const parameters: ResolvedWorkloadParameter[] = [];
  const missingRequired: MissingWorkloadParameter[] = [];
  // TICKET_1370 R12/AC37: input modes of a conditional decision that the
  // current source does not select. Offered so the surface can alternate the
  // controls without a round trip; never a reason the plan is incomplete.
  const availableAlternatives: MissingWorkloadParameter[] = [];

  /**
   * TICKET_1370 R11: a parameter whose `visibleWhen` condition is unsatisfied
   * is not part of this plan, so it resolves to nothing -- not to its default.
   *
   * This became load-bearing once R11 gave `preset` a repository default:
   * switching the market scope to `custom` cleared the preset, the default
   * immediately refilled it, and the confirmed plan carried a stale preset
   * alongside the custom symbol list. The resolver evaluates the condition
   * against the values resolving in this same pass, which is the same order
   * the surface renders them in.
   */
  const conditionSatisfied = (definition: WorkloadParameterDefinition): boolean => {
    const condition = definition.visibleWhen;
    if (condition === undefined) return true;
    const controlling = specification.parameters.find(item => item.id === condition.parameterId);
    if (controlling === undefined) return true;
    const value = input.explicit?.[condition.parameterId]
      ?? input.persisted?.[condition.parameterId]
      ?? controlling.defaultValue
      ?? input.derived?.[condition.parameterId];
    return condition.equals.some(candidate => candidate === value);
  };

  for (const definition of specification.parameters) {
    const sources = conditionSatisfied(definition)
      ? ([
        ['explicit', input.explicit?.[definition.id]],
        ['persisted', input.persisted?.[definition.id]],
        ['default', definition.defaultValue],
        ['derived', input.derived?.[definition.id]],
      ] as const)
      : ([] as const);
    const selected = sources.find(([, value]) => value !== undefined);
    if (selected === undefined) {
      const entry: MissingWorkloadParameter = {
        id: definition.id,
        control: definition.control ?? (definition.supportedChoices ? 'select' : 'text'),
        label: definition.label,
        supportedChoices: definition.supportedChoices,
        validationRequirements: definition.validationRequirements,
        validation: definition.validation,
        ...(definition.nullable === undefined ? {} : { nullable: definition.nullable }),
        visibleWhen: definition.visibleWhen,
        dateBounds: definition.dateBounds,
      };
      // A hidden parameter is not part of this plan, so it is not a gap the
      // user can be asked to fill.
      if (definition.required && conditionSatisfied(definition)) {
        missingRequired.push(entry);
        continue;
      }
      /**
       * TICKET_1370 R12/AC37: an input mode whose condition is NOT currently
       * satisfied is published separately, so a surface can reveal it the
       * instant the user selects its source.
       *
       * Before this, switching the market scope to `custom` hid the preset
       * control and revealed nothing: `symbols` is declared `required: false`
       * (the SOURCE decides which mode is meaningful), so it was never a
       * "missing" value and the owner never emitted it at all. The card had no
       * control to show, which made the decision unmakeable without a server
       * round trip -- and a round trip cannot satisfy "in the same render
       * cycle".
       *
       * These are deliberately NOT in `missingRequired`: that list means "this
       * plan is incomplete" and gates confirmation. An inactive alternative is
       * not a gap, and conflating the two would block a complete preset plan.
       */
      if (definition.visibleWhen !== undefined && !conditionSatisfied(definition)) {
        availableAlternatives.push(entry);
      }
      continue;
    }
    const resolvedValue = selected[1] as WorkloadJsonValue;
    const inferredControl: WorkloadParameterControl = definition.control
      ?? (!definition.editable ? 'readonly'
        : definition.supportedChoices && Array.isArray(resolvedValue) ? 'multi-select'
        : definition.supportedChoices ? 'select'
        : 'text');
    parameters.push({
      id: definition.id,
      // TICKET_1370 R12/AC38: the specification's label travels with the
      // resolved parameter. Dropping it here is what forced surfaces to render
      // the contract id as a user-facing label.
      label: definition.label,
      control: inferredControl,
      value: resolvedValue,
      provenance: selected[0],
      defaultSource: selected[0] === 'default' || selected[0] === 'derived'
        ? definition.defaultSource
        : undefined,
      defaultRole: selected[0] === 'derived' ? definition.defaultRole : undefined,
      editable: definition.editable,
      impact: definition.impact,
      supportedChoices: definition.supportedChoices,
      validation: definition.validation,
      ...(definition.nullable === undefined ? {} : { nullable: definition.nullable }),
      visibleWhen: definition.visibleWhen,
      dateBounds: definition.dateBounds,
    });
  }
  const values = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.value]));
  validationErrors.push(...validate(values));
  return {
    contractVersion: WORKLOAD_PRELAUNCH_CONTRACT_VERSION,
    specificationId: specification.id,
    specificationVersion: specification.version,
    derivedContextVersion: input.derivedContextVersion,
    parameters,
    missingRequired,
    availableAlternatives,
    validationErrors,
    estimatedWork: input.estimatedWork ?? {},
    planFingerprint: fingerprint(specification, input.derivedContextVersion, parameters),
    confirmationRequired: true,
  };
}

/**
 * Re-resolve a review with the supplied edits applied.
 *
 * An edit whose value is `undefined` *clears* the parameter rather than leaving
 * the previous value in place. TICKET_1370 R9 depends on this: switching the
 * market-scope source must drop the other mode's input, so that no downstream
 * layer is ever handed both a preset and a custom symbol list and forced to
 * choose between them.
 */
/**
 * Refuse an attempt to edit a parameter the specification declares read-only.
 *
 * Exposed separately from `applyPrelaunchEdits` so an owning operation can
 * check the *user's* edit keys before it normalizes them. TICKET_1370 R11
 * needs that separation: clearing an owner-derived value such as
 * `horizonByTimeframe` so it re-derives is a legitimate normalization, not a
 * user edit of a read-only field.
 */
export function assertEditableParameters(
  specification: WorkloadParameterSpecification,
  edits: Readonly<Record<string, WorkloadJsonValue | undefined>>,
): void {
  for (const id of Object.keys(edits)) {
    const definition = specification.parameters.find(parameter => parameter.id === id);
    if (definition !== undefined && !definition.editable) {
      throw new WorkloadPrelaunchError(
        'WORKLOAD_PLAN_INVALID',
        `Workload parameter '${id}' is not editable.`,
        'Resolve a new review from the owning workload operation.',
      );
    }
  }
}

export function applyPrelaunchEdits(
  specification: WorkloadParameterSpecification,
  review: WorkloadPrelaunchReview,
  edits: Readonly<Record<string, WorkloadJsonValue | undefined>>,
  input: Omit<WorkloadResolutionInput, 'explicit'>,
  validate: Validator = () => [],
): WorkloadPrelaunchReview {
  const current = Object.fromEntries(review.parameters.map(parameter => [parameter.id, parameter.value]));
  // A cleared edit (`undefined`) removes the value so it re-resolves; it is
  // never an edit of the read-only parameter itself, so only set values are
  // checked here.
  assertEditableParameters(
    specification,
    Object.fromEntries(Object.entries(edits).filter(([, value]) => value !== undefined)),
  );
  return resolvePrelaunchReview(specification, {
    ...input,
    explicit: { ...current, ...edits },
  }, validate);
}

export function confirmPrelaunchReview(
  specification: WorkloadParameterSpecification,
  review: WorkloadPrelaunchReview,
  confirmation: ConfirmationInput,
): ConfirmedWorkloadPlan {
  if (review.missingRequired.length > 0 || review.validationErrors.length > 0) {
    throw new WorkloadPrelaunchError(
      'WORKLOAD_PLAN_INCOMPLETE',
      'The workload plan has unresolved or invalid parameters.',
      'Resolve every required parameter and validation error before confirmation.',
      review,
    );
  }
  const expectedFingerprint = fingerprint(
    specification,
    review.derivedContextVersion,
    review.parameters,
  );
  if (
    confirmation.planFingerprint !== review.planFingerprint
    || review.planFingerprint !== expectedFingerprint
    || confirmation.specificationVersion !== review.specificationVersion
    || review.specificationId !== specification.id
    || review.specificationVersion !== specification.version
  ) {
    throw new WorkloadPrelaunchError(
      'WORKLOAD_PLAN_CONFIRMATION_MISMATCH',
      'The confirmation does not identify the current reviewed plan.',
      'Review and confirm the current parameter document.',
      review,
    );
  }
  return Object.freeze({
    contractVersion: WORKLOAD_PRELAUNCH_CONTRACT_VERSION,
    specificationId: review.specificationId,
    specificationVersion: review.specificationVersion,
    derivedContextVersion: review.derivedContextVersion,
    parameters: Object.freeze([...review.parameters]),
    planFingerprint: review.planFingerprint,
    confirmedAtUtc: confirmation.confirmedAtUtc,
  });
}

export function assertCurrentConfirmedPlan(
  specification: WorkloadParameterSpecification,
  confirmed: ConfirmedWorkloadPlan,
  currentReview: WorkloadPrelaunchReview,
): void {
  if (
    confirmed.specificationId !== specification.id
    || confirmed.specificationVersion !== specification.version
    || confirmed.derivedContextVersion !== currentReview.derivedContextVersion
    || confirmed.planFingerprint !== currentReview.planFingerprint
  ) {
    throw new WorkloadPrelaunchError(
      'WORKLOAD_PLAN_STALE',
      'The confirmed workload plan is stale.',
      'Review the updated parameters and confirm the new fingerprint.',
      currentReview,
    );
  }
}

/** Verify a serialized confirmed plan without reconstructing its provenance. */
export function assertConfirmedPlanIntegrity(
  specification: WorkloadParameterSpecification,
  confirmed: ConfirmedWorkloadPlan,
  currentDerivedContextVersion: string,
): void {
  const expected = fingerprint(
    specification,
    confirmed.derivedContextVersion,
    confirmed.parameters,
  );
  if (
    confirmed.specificationId !== specification.id
    || confirmed.specificationVersion !== specification.version
    || confirmed.derivedContextVersion !== currentDerivedContextVersion
    || confirmed.planFingerprint !== expected
  ) {
    throw new WorkloadPrelaunchError(
      'WORKLOAD_PLAN_STALE',
      'The confirmed workload plan is stale or its normalized parameters changed.',
      'Resolve and confirm a fresh workload review.',
    );
  }
}

export * from './market-scope';
export * from './horizon';
export * from './date-window';
export * from './coverage-window';
export * from './factor-mining';
export * from './data-download';
export * from './validation';
// TICKET_1370 R12/AC38+AC39: display formatting for reviewed values, shared so
// both surfaces render one confirmed plan identically.
export * from './presentation';
