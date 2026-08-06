/**
 * TICKET_661_1 AC-6 / AC-10: Electron Main adapter over the shared
 * execution-admission operation.
 *
 * This file is a **transport/evidence adapter only**. It acquires storage and
 * file evidence for a saved-strategy record and hands it to the Electron-free
 * `admitStrategyForExecution()` owner in `@StratCraft/types`, then maps a
 * refusal to the localized remedy. It contains no suffix test, no content
 * marker, no `catch`-block language default, and no readiness policy of its
 * own -- per section 5.3.1, adapters must not copy the business decision.
 *
 * Every Main-side execution entry point (Service API `runBacktest`, IPC v3
 * compile/run handlers, headless actions) calls `admitAlgorithmForExecution()`
 * so all boundaries agree on the same state, which AC-6 requires and which
 * repository search on 2026-07-31 found was not true: the only guard lived on
 * the MCP/HTTP path in `backtest-api.ts` and the IPC layer had none.
 */

import { existsSync, readFileSync } from 'fs';
import {
  admitStrategyForExecution,
  type AdmissionRefusal,
  type StrategyExecutionAdmission,
  type StrategyExecutionReadiness,
  type StrategyLanguageEvidence,
} from '@StratCraft/types';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { appLog } from '../utils/logger';

/**
 * The saved-strategy columns this adapter reads. Callers pass the row they
 * already loaded so admission adds no extra query on the hot path.
 */
export interface AlgorithmAdmissionRow {
  id: number | string;
  code?: string | null;
  file_path?: string | null;
  classification_metadata?: string | null;
  /** Explicit artifact kind, when the owning schema records one. */
  code_kind?: string | null;
  /** TICKET_661_1 additive schema; absent on pre-migration records. */
  execution_readiness?: string | null;
  /** TICKET_661_1 additive schema; absent on pre-migration records. */
  archived_at?: string | number | null;
}

const READINESS_VALUES: readonly StrategyExecutionReadiness[] = [
  'unvalidated',
  'valid',
  'compiled',
  'admitted',
  'blocked',
];

function parseReadiness(value: string | null | undefined): StrategyExecutionReadiness | undefined {
  if (value == null) return undefined;
  return READINESS_VALUES.find((candidate) => candidate === value);
}

/**
 * Read attachment bytes for the language decision.
 *
 * A `file_path` that does not exist or cannot be read is reported as
 * unreadable, never as an absent path: section 5.2 requires a missing
 * attachment to become an explicit finding rather than silently disappearing.
 */
function readAttachment(filePath: string | null | undefined): {
  attachmentCode?: string;
  attachmentReadable: boolean;
} {
  if (filePath == null || filePath.trim() === '') {
    return { attachmentReadable: false };
  }
  try {
    if (!existsSync(filePath)) {
      return { attachmentReadable: false };
    }
    return { attachmentCode: readFileSync(filePath, 'utf-8'), attachmentReadable: true };
  } catch (error) {
    appLog.warn(
      `[TICKET_661_1] Attachment unreadable for admission: ${filePath}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return { attachmentReadable: false };
  }
}

/** Build the injected evidence bundle for one saved-strategy row. */
export function collectAlgorithmLanguageEvidence(
  row: AlgorithmAdmissionRow,
): StrategyLanguageEvidence {
  const attachment = readAttachment(row.file_path);
  return {
    dbCode: row.code ?? null,
    filePath: row.file_path ?? null,
    attachmentCode: attachment.attachmentCode ?? null,
    attachmentReadable: attachment.attachmentReadable,
    classificationMetadata: row.classification_metadata ?? null,
    artifactKind: row.code_kind ?? null,
  };
}

/**
 * Decide whether a saved-strategy row may proceed to execution.
 *
 * Call this **before** generating any C++ wrapper. AC-10 makes that ordering
 * contractual: section 3.1 traced a code-only Python record reaching
 * `generateMainCpp()` and surfacing a compiler syntax dump instead of the
 * localized `legacyPythonStrategy` remedy.
 */
export function admitAlgorithmForExecution(
  row: AlgorithmAdmissionRow,
  options: { researchArtifact?: boolean } = {},
): StrategyExecutionAdmission {
  return admitStrategyForExecution({
    evidence: collectAlgorithmLanguageEvidence(row),
    executionReadiness: parseReadiness(row.execution_readiness),
    archived: row.archived_at != null,
    researchArtifact: options.researchArtifact,
  });
}

/**
 * Map a refusal to the localized, actionable remedy that reaches the UI.
 *
 * Every branch produces a user-actionable message (TICKET_858): none of them
 * can degrade into a raw compiler dump, which is the user-visible failure
 * section 3.1 recorded.
 */
export function describeAdmissionRefusal(
  refusal: AdmissionRefusal,
  algorithmId: number | string,
): string {
  const locale = getCurrentMainLocale();
  switch (refusal.code) {
    case 'legacy_python_strategy':
    case 'archived_record':
      return mainT(locale, 'errors', 'main.backtestApi.legacyPythonStrategy', { id: algorithmId });
    case 'python_research_artifact':
      return mainT(locale, 'errors', 'main.backtestApi.pythonResearchArtifact', { id: algorithmId });
    case 'no_source':
      return mainT(locale, 'errors', 'main.backtestApi.noStrategySource', {
        id: algorithmId,
        detail: refusal.detail,
      });
    case 'ambiguous_language':
      return mainT(locale, 'errors', 'main.backtestApi.ambiguousStrategyLanguage', {
        id: algorithmId,
        detail: refusal.detail,
      });
  }
}
