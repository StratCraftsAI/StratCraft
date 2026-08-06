/** TICKET_1363: surface-neutral workload pre-launch contract. */

export const WORKLOAD_PRELAUNCH_CONTRACT_VERSION = '1.0.0' as const;

export type WorkloadJsonPrimitive = string | number | boolean | null;
export type WorkloadJsonValue =
  | WorkloadJsonPrimitive
  | readonly WorkloadJsonValue[]
  | { readonly [key: string]: WorkloadJsonValue };

export type ParameterValueProvenance = 'explicit' | 'persisted' | 'default' | 'derived';
export type WorkloadParameterImpact = 'scope' | 'cost' | 'duration' | 'safety' | 'output';

export interface StructuredWorkloadValidationError {
  readonly code: string;
  readonly parameterIds: readonly string[];
  readonly message: string;
  readonly remediation: string;
}

export type WorkloadParameterControl =
  | 'select'
  | 'multi-select'
  | 'tags'
  | 'date'
  | 'datetime'
  | 'number'
  | 'text'
  | 'readonly';

/**
 * TICKET_1370 R9/AC21: source-conditional presentation. A parameter carrying
 * this metadata is rendered only when the named controlling parameter holds one
 * of `equals`. Surfaces evaluate this generically against the review document;
 * they MUST NOT branch on specific parameter names, which is what made market
 * scope a surface-local decision before.
 */
export interface WorkloadParameterVisibility {
  readonly parameterId: string;
  readonly equals: readonly WorkloadJsonValue[];
}

/**
 * TICKET_1370 R10/AC25+AC27: authoritative bounds for a `date` control. The
 * owner derives these from physical storage coverage, so the picker cannot
 * offer a day the execution layer has no data for.
 */
export interface WorkloadDateBounds {
  readonly minimumDate?: string;
  readonly maximumDate?: string;
}

export interface ResolvedWorkloadParameter {
  readonly id: string;
  /**
   * TICKET_1370 R12/AC38: the authoritative user-facing name, owned by the
   * parameter specification. `id` is a contract/storage identifier and is not
   * presentable: surfaces that fell back to it rendered `MARKETSCOPESOURCE`
   * and `HORIZONBYTIMEFRAME` at the user. Carrying the label on the resolved
   * parameter is what makes both surfaces name a parameter identically without
   * either one owning a private label table.
   */
  readonly label: string;
  readonly control: WorkloadParameterControl;
  readonly value: WorkloadJsonValue;
  readonly provenance: ParameterValueProvenance;
  readonly defaultSource?: string;
  readonly editable: boolean;
  readonly impact: readonly WorkloadParameterImpact[];
  readonly supportedChoices?: readonly WorkloadJsonValue[];
  readonly validation?: { readonly minimum?: number; readonly maximum?: number; readonly step?: number };
  readonly visibleWhen?: WorkloadParameterVisibility;
  readonly dateBounds?: WorkloadDateBounds;
}

export interface MissingWorkloadParameter {
  readonly id: string;
  readonly control: WorkloadParameterControl;
  readonly label: string;
  readonly supportedChoices?: readonly WorkloadJsonValue[];
  readonly validationRequirements?: string;
  readonly validation?: { readonly minimum?: number; readonly maximum?: number; readonly step?: number };
  /**
   * TICKET_1370 R9: superseded the R4 `requiredGroup` either/or repair UI for
   * market scope. A domain choice with two input modes is modelled as one
   * required source parameter plus source-conditional inputs, so the surface
   * renders one decision rather than a set of mutually-exclusive peers.
   */
  readonly visibleWhen?: WorkloadParameterVisibility;
  readonly dateBounds?: WorkloadDateBounds;
}

export interface WorkloadPrelaunchReview {
  readonly contractVersion: typeof WORKLOAD_PRELAUNCH_CONTRACT_VERSION;
  readonly specificationId: string;
  readonly specificationVersion: string;
  readonly derivedContextVersion: string;
  readonly parameters: readonly ResolvedWorkloadParameter[];
  readonly missingRequired: readonly MissingWorkloadParameter[];
  /**
   * TICKET_1370 R12/AC37: input modes of a source-conditional decision that the
   * currently selected source does NOT select -- for market scope, the symbol
   * list while the source is `preset`, and the preset while it is `custom`.
   *
   * A surface renders the one whose `visibleWhen` matches the user's pending
   * choice, which is how the two controls alternate in a single render cycle
   * rather than after a server round trip. These are explicitly NOT
   * `missingRequired`: an inactive alternative does not make the plan
   * incomplete and must never gate confirmation.
   */
  readonly availableAlternatives: readonly MissingWorkloadParameter[];
  readonly validationErrors: readonly StructuredWorkloadValidationError[];
  readonly estimatedWork: Readonly<Record<string, WorkloadJsonValue>>;
  readonly planFingerprint: string;
  readonly confirmationRequired: true;
}

export interface ConfirmedWorkloadPlan {
  readonly contractVersion: typeof WORKLOAD_PRELAUNCH_CONTRACT_VERSION;
  readonly specificationId: string;
  readonly specificationVersion: string;
  readonly derivedContextVersion: string;
  readonly parameters: readonly ResolvedWorkloadParameter[];
  readonly planFingerprint: string;
  readonly confirmedAtUtc: string;
}

export const WORKLOAD_PRELAUNCH_ERROR_CODES = [
  'WORKLOAD_PLAN_INVALID',
  'WORKLOAD_PLAN_INCOMPLETE',
  'WORKLOAD_PLAN_CONFIRMATION_MISMATCH',
  'WORKLOAD_PLAN_STALE',
] as const;

export type WorkloadPrelaunchErrorCode = typeof WORKLOAD_PRELAUNCH_ERROR_CODES[number];

export interface WorkloadPrelaunchErrorResult {
  readonly code: WorkloadPrelaunchErrorCode;
  readonly message: string;
  readonly remediation: string;
  readonly retryable: boolean;
  readonly freshReview?: WorkloadPrelaunchReview;
}
