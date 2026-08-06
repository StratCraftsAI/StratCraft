/**
 * TICKET_661_1 section 5.3.1 / AC-6 / AC-10: the shared execution-admission
 * operation.
 *
 * Every execution entry point -- IPC, Service API, MCP, headless, and direct
 * service calls -- delegates to this operation to decide whether a saved
 * strategy record may proceed to execution. Adapters are transport or
 * presentation only: they must not copy the suffix, content-marker,
 * archive-state, or readiness decision (CLAUDE.md surface-layer rule).
 *
 * AC-6 previously failed not because the guard was wrong but because it existed
 * in exactly one place: repository search found no `.py` or
 * `language === 'python'` guard in the IPC layer at all. The correction is not
 * to copy the guard into every adapter -- it is this one owner.
 *
 * The operation is Electron-free and pure: callers inject already-acquired
 * storage and file evidence. It resolves language through
 * `classifyStrategyLanguageEvidence()` **before** any C++ wrapper generation,
 * which is the ordering AC-10 requires and the ordering section 3.1 found
 * violated.
 */

import {
  classifyStrategyLanguageEvidence,
  type StrategyLanguageClassification,
  type StrategyLanguageEvidence,
} from './strategy-language-evidence';

// =============================================================================
// Execution readiness axis (section 5.1)
// =============================================================================

/**
 * Execution-readiness axis. Independent of `resolved_language` and of
 * `semantic_equivalence`: `resolved_language === 'cpp'` alone never authorizes
 * execution, only `admitted` does.
 */
export type StrategyExecutionReadiness =
  | 'unvalidated'
  | 'valid'
  | 'compiled'
  | 'admitted'
  | 'blocked';

/** Semantic-equivalence axis (section 5.1). Never inferred from executability. */
export type StrategySemanticEquivalence =
  | 'unassessed'
  | 'parity_verified'
  | 'accepted_without_parity'
  | 'failed'
  | 'not_applicable';

// =============================================================================
// Refusal contract
// =============================================================================

/**
 * Why admission was refused. Each code maps to one localized, actionable
 * remedy; adapters translate but never re-derive the decision.
 */
export type AdmissionRefusalCode =
  /** Legacy Python saved strategy -- regenerate as C++ (localized
   *  `main.backtestApi.legacyPythonStrategy`). */
  | 'legacy_python_strategy'
  /** Python research artifact from Signal Discovery -- compose via Quant Lab
   *  (localized `main.backtestApi.pythonResearchArtifact`). */
  | 'python_research_artifact'
  /** Contradictory or absent language evidence -- terminal `ambiguous`
   *  (localized `main.backtestApi.ambiguousStrategyLanguage`). */
  | 'ambiguous_language'
  /** The record is an archived legacy strategy: read-only, non-executable. */
  | 'archived_record'
  /** The record has no source bytes at all. */
  | 'no_source';

export interface AdmissionRefusal {
  code: AdmissionRefusalCode;
  /**
   * Non-localized diagnostic detail: the collected signals and conflicts.
   * Adapters surface the localized remedy plus this evidence so the error
   * reaching the UI is actionable (TICKET_858).
   */
  detail: string;
  classification: StrategyLanguageClassification;
}

export type StrategyExecutionAdmission =
  | { admitted: true; classification: StrategyLanguageClassification }
  | { admitted: false; refusal: AdmissionRefusal };

// =============================================================================
// Input
// =============================================================================

export interface StrategyExecutionAdmissionInput {
  /** Already-acquired language evidence for this record. */
  evidence: StrategyLanguageEvidence;
  /**
   * Persisted readiness, when the owning schema records one. `undefined` means
   * the record predates the TICKET_661_1 additive schema; such a record is
   * admitted on language alone, because blocking every pre-migration C++
   * strategy would be a regression unrelated to this defect.
   */
  executionReadiness?: StrategyExecutionReadiness;
  /**
   * Whether this record is an archived legacy strategy (section 5.4). Archived
   * records are read-only and non-executable at every boundary.
   */
  archived?: boolean;
  /**
   * True when the record is a Signal Discovery research artifact rather than a
   * saved strategy. Changes only which localized remedy a Python verdict gets.
   */
  researchArtifact?: boolean;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Decide whether a saved strategy record may proceed to execution.
 *
 * Order is contractual: archive state, then language classification, then
 * persisted readiness. Language is resolved before any caller generates a C++
 * wrapper.
 */
export function admitStrategyForExecution(
  input: StrategyExecutionAdmissionInput,
): StrategyExecutionAdmission {
  const classification = classifyStrategyLanguageEvidence(input.evidence);

  // Archived legacy records are non-executable regardless of language.
  if (input.archived === true) {
    return {
      admitted: false,
      refusal: {
        code: 'archived_record',
        detail: 'Record is an archived legacy strategy: read-only and non-executable.',
        classification,
      },
    };
  }

  if (classification.language === 'python') {
    return {
      admitted: false,
      refusal: {
        code: input.researchArtifact === true
          ? 'python_research_artifact'
          : 'legacy_python_strategy',
        detail: classification.reason,
        classification,
      },
    };
  }

  if (classification.language === 'ambiguous') {
    // Distinguish "no evidence at all because there is no source" from
    // "evidence exists but contradicts", so the remedy is actionable.
    const hasAnySource =
      (input.evidence.dbCode != null && input.evidence.dbCode.trim() !== '') ||
      (input.evidence.attachmentCode != null && input.evidence.attachmentCode.trim() !== '');
    return {
      admitted: false,
      refusal: {
        code: hasAnySource ? 'ambiguous_language' : 'no_source',
        detail: classification.reason,
        classification,
      },
    };
  }

  // language === 'cpp'. Persisted readiness, when recorded, is the only
  // authority for executability (section 5.1).
  if (input.executionReadiness === 'blocked') {
    return {
      admitted: false,
      refusal: {
        code: 'archived_record',
        detail: 'Record persisted execution_readiness is blocked.',
        classification,
      },
    };
  }

  return { admitted: true, classification };
}
