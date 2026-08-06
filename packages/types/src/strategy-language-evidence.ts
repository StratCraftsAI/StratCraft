/**
 * TICKET_661_1 section 5.1 / AC-10: the authoritative strategy-language
 * classifier.
 *
 * This module is the single owner of the "is this saved strategy C++, Python,
 * or ambiguous?" decision. It is deliberately Electron-free and dependency-free
 * so both Electron Main and the standalone MCP/Guide surface consume the exact
 * same operation (CLAUDE.md surface-layer rule); callers inject already-acquired
 * evidence rather than having this module read paths, spawn processes, or touch
 * Electron state.
 *
 * The contract that makes it correct is **evidence-collecting, not
 * short-circuiting**: every available signal is gathered for every record
 * before any verdict is formed. Priority only breaks ties among *agreeing*
 * signals. Conflict outranks priority, and both "no usable signal" and
 * "unresolved conflict" terminate in `ambiguous` -- never in an assumed C++
 * success.
 *
 * TICKET_661_1 section 3.1 recorded the inverted form of this rule as a live
 * P0 defect: `backtest-api.ts` treated absent / non-JSON
 * `classification_metadata` as C++ "backward compatible", so a code-only legacy
 * Python record was fed to the C++ wrapper generator and surfaced a compiler
 * syntax dump instead of the localized `legacyPythonStrategy` remedy.
 */

// =============================================================================
// Contract version
// =============================================================================

/**
 * Version of the classification contract. Persisted with inventory results
 * (section 5.2 "inventory classifier version") so a later run can tell whether
 * a stored verdict was produced by the current rules.
 */
export const STRATEGY_LANGUAGE_CLASSIFIER_VERSION = 1;

// =============================================================================
// Types
// =============================================================================

/** Resolved language axis (section 5.1). Independent of executability. */
export type ResolvedStrategyLanguage = 'cpp' | 'python' | 'ambiguous';

/** Which piece of evidence a signal was read from. */
export type StrategyLanguageSignalSource =
  /** Signal 1: explicit artifact kind recorded by the owning schema. */
  | 'artifact_kind'
  /** Signal 2: recognized file extension on `file_path`. */
  | 'file_extension'
  /** Signal 3a: content markers in the DB `code` column. */
  | 'db_code_markers'
  /** Signal 3b: content markers in the attachment bytes at `file_path`. */
  | 'attachment_markers'
  /** Signal 1b: `classification_metadata.language`, when parseable and valid. */
  | 'classification_metadata';

/** A single collected signal. `null` language means "read but indeterminate". */
export interface StrategyLanguageSignal {
  source: StrategyLanguageSignalSource;
  /** The language this signal names, or `null` when the signal was
   *  readable but carried no recognizable marker. */
  language: 'cpp' | 'python' | null;
  /** Human-readable evidence for the audit trail / UI remedy. */
  detail: string;
}

/** Two collected signals naming different languages. */
export interface StrategyLanguageConflict {
  left: StrategyLanguageSignalSource;
  leftLanguage: 'cpp' | 'python';
  right: StrategyLanguageSignalSource;
  rightLanguage: 'cpp' | 'python';
}

/**
 * Evidence handed to the classifier. Every field is optional because a legacy
 * record can legitimately lack any of them -- that is precisely the section 3.1
 * shape. Absence never implies C++.
 */
export interface StrategyLanguageEvidence {
  /** Bytes of the `code` column, when the row carries inline source. */
  dbCode?: string | null;
  /** The `file_path` column value, whether or not the file exists. */
  filePath?: string | null;
  /**
   * Bytes read from `filePath`. Callers that cannot read the attachment leave
   * this `undefined` and set `attachmentReadable: false`; `null` means the
   * attachment exists but is empty.
   */
  attachmentCode?: string | null;
  /**
   * Whether `filePath` resolved to readable bytes. `false` with a non-empty
   * `filePath` is recorded as a missing-attachment finding (section 5.2) and
   * suppresses the attachment-content signal without inventing a language.
   */
  attachmentReadable?: boolean;
  /**
   * Raw `classification_metadata` column. Passed as the raw string so the
   * classifier -- not each caller -- owns the parse and the non-JSON outcome.
   */
  classificationMetadata?: string | null;
  /**
   * Explicit artifact kind from the owning schema (e.g. `code_kind`), when the
   * schema records one. Unrecognized values are ignored rather than guessed.
   */
  artifactKind?: string | null;
}

export interface StrategyLanguageClassification {
  language: ResolvedStrategyLanguage;
  /** Every signal that was collected, in collection order. */
  signals: StrategyLanguageSignal[];
  /** Every disagreement found among collected signals. Non-empty implies
   *  `language === 'ambiguous'`. */
  conflicts: StrategyLanguageConflict[];
  /** Why the verdict is what it is; suitable for an actionable UI remedy. */
  reason: string;
  /** True when `filePath` is set but its bytes were not readable. */
  missingAttachment: boolean;
  classifierVersion: number;
}

// =============================================================================
// Content markers
// =============================================================================

/**
 * C++ strategy content markers. Covers every C++ strategy template:
 * backtest (`main.cpp.template`, `workflow.cpp.template`) and live
 * (`live.cpp.template`). Kept in sync with the legacy detector this owner
 * replaces (`detectCodeLanguage`, TICKET_660).
 */
const CPP_CONTENT_MARKERS: readonly string[] = [
  '#include <stratforge/',
  '#include <nonabt/',
  'stratforge::Strategy',
  'nonabt::Strategy',
  'QNX_STRATEGY_FACTORY_EXPORT',
  'qnx_live::',
  'namespace qnx_live',
  'qnx_strategy_sdk',
  'qnx_workflow::',
];

/**
 * Python strategy content markers. Legacy saved strategies are Backtrader-style
 * (`import backtrader as bt`, `class X(bt.Strategy)`) or plain Python modules.
 * These are matched with word-boundary anchors so a C++ comment mentioning
 * "import" does not register.
 */
const PYTHON_CONTENT_PATTERNS: readonly { pattern: RegExp; detail: string }[] = [
  { pattern: /^\s*import\s+backtrader\b/m, detail: 'import backtrader' },
  { pattern: /^\s*from\s+backtrader\b/m, detail: 'from backtrader' },
  { pattern: /\bbt\.Strategy\b/, detail: 'bt.Strategy base class' },
  { pattern: /\bbacktrader\.Strategy\b/, detail: 'backtrader.Strategy base class' },
  { pattern: /^\s*def\s+\w+\s*\([^)]*\)\s*:/m, detail: 'Python def statement' },
  { pattern: /^\s*class\s+\w+\s*\([^)]*\)\s*:/m, detail: 'Python class statement' },
  { pattern: /^\s*from\s+[\w.]+\s+import\s+/m, detail: 'Python from-import' },
  { pattern: /^\s*import\s+(?:numpy|pandas|talib|sys|os|math)\b/m, detail: 'Python stdlib/scientific import' },
  { pattern: /\bself\.\w+\s*=/, detail: 'Python self assignment' },
];

/** Recognized source extensions. Anything else contributes no extension signal. */
const CPP_EXTENSIONS: readonly string[] = ['.cpp', '.cc', '.cxx', '.hpp', '.h'];
const PYTHON_EXTENSIONS: readonly string[] = ['.py'];

/**
 * Detect content markers in a source body.
 *
 * Returns `null` when the body carries no recognizable marker for either
 * language -- an explicitly indeterminate result, never a default.
 */
function detectContentMarkers(
  code: string,
): { language: 'cpp' | 'python' | null; detail: string } {
  const cppHits = CPP_CONTENT_MARKERS.filter((marker) => code.includes(marker));
  const pythonHits = PYTHON_CONTENT_PATTERNS.filter((entry) => entry.pattern.test(code));

  if (cppHits.length > 0 && pythonHits.length === 0) {
    return { language: 'cpp', detail: `C++ markers: ${cppHits.join(', ')}` };
  }
  if (pythonHits.length > 0 && cppHits.length === 0) {
    return {
      language: 'python',
      detail: `Python markers: ${pythonHits.map((entry) => entry.detail).join(', ')}`,
    };
  }
  if (cppHits.length > 0 && pythonHits.length > 0) {
    // Both languages' markers in one body. This is itself a contradiction and
    // must not be resolved by "C++ wins" -- it is reported as indeterminate so
    // the caller-level conflict rule sees no confident language here, and the
    // detail preserves both sides for the remedy.
    return {
      language: null,
      detail:
        `mixed markers -- C++: ${cppHits.join(', ')}; ` +
        `Python: ${pythonHits.map((entry) => entry.detail).join(', ')}`,
    };
  }
  return { language: null, detail: 'no recognizable C++ or Python markers' };
}

function extensionLanguage(filePath: string): { language: 'cpp' | 'python' | null; detail: string } {
  const lower = filePath.toLowerCase();
  const cppExt = CPP_EXTENSIONS.find((ext) => lower.endsWith(ext));
  if (cppExt) return { language: 'cpp', detail: `extension ${cppExt}` };
  const pyExt = PYTHON_EXTENSIONS.find((ext) => lower.endsWith(ext));
  if (pyExt) return { language: 'python', detail: `extension ${pyExt}` };
  return { language: null, detail: 'unrecognized extension' };
}

function normalizeArtifactKind(kind: string): 'cpp' | 'python' | null {
  const lower = kind.trim().toLowerCase();
  if (lower === 'cpp' || lower === 'c++' || lower === 'cxx') return 'cpp';
  if (lower === 'python' || lower === 'py') return 'python';
  return null;
}

/**
 * Signal priority for tie-breaking among *agreeing* signals only
 * (section 5.1 resolution rule). Lower index = higher priority.
 */
const SIGNAL_PRIORITY: readonly StrategyLanguageSignalSource[] = [
  'artifact_kind',
  'classification_metadata',
  'file_extension',
  'attachment_markers',
  'db_code_markers',
];

// =============================================================================
// Classifier
// =============================================================================

/**
 * TICKET_661_1 AC-10: the authoritative, pure, evidence-collecting classifier.
 *
 * All signals are collected before any verdict. When every collected signal
 * agrees, the highest-priority one names the language. When any two disagree --
 * including a `.cpp` extension disagreeing with its own file's content markers,
 * or the DB `code` column disagreeing with the attachment -- the record is
 * `ambiguous`. Conflict outranks priority. No usable signal is also `ambiguous`.
 */
export function classifyStrategyLanguageEvidence(
  evidence: StrategyLanguageEvidence,
): StrategyLanguageClassification {
  const signals: StrategyLanguageSignal[] = [];

  // --- Signal 1: explicit artifact kind recorded by the owning schema ---
  if (evidence.artifactKind != null && evidence.artifactKind.trim() !== '') {
    const language = normalizeArtifactKind(evidence.artifactKind);
    signals.push({
      source: 'artifact_kind',
      language,
      detail: language
        ? `artifact kind '${evidence.artifactKind}'`
        : `unrecognized artifact kind '${evidence.artifactKind}'`,
    });
  }

  // --- Signal 1b: classification_metadata.language ---
  // The parse lives here so no caller re-implements it, and a non-JSON body is
  // recorded as an indeterminate signal instead of the section 3.1 C++ default.
  // Defensive on TYPE, not on value: the declared contract is a raw string, but
  // this field is read straight off a database row / IPC payload whose runtime
  // shape callers do not always control. A non-string here previously threw on
  // `.trim()`, which turned a classification question into an unrelated crash
  // at the caller. A non-string is treated as "no metadata signal" -- never as
  // a language, which would be the section 5.1 silent downgrade.
  const classificationMetadata =
    typeof evidence.classificationMetadata === 'string'
      ? evidence.classificationMetadata
      : null;

  if (classificationMetadata != null && classificationMetadata.trim() !== '') {
    let language: 'cpp' | 'python' | null = null;
    let detail: string;
    try {
      const parsed: unknown = JSON.parse(classificationMetadata);
      const raw =
        parsed !== null && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>).language
          : undefined;
      if (typeof raw === 'string') {
        language = normalizeArtifactKind(raw);
        detail = language
          ? `classification_metadata.language='${raw}'`
          : `classification_metadata.language='${raw}' is not a recognized language`;
      } else {
        detail = 'classification_metadata carries no language field';
      }
    } catch {
      // TICKET_661_1 section 3.1: the replaced `catch` block assigned C++ here.
      // Non-JSON metadata is now an explicitly indeterminate signal.
      detail = 'classification_metadata is not valid JSON';
    }
    signals.push({ source: 'classification_metadata', language, detail });
  }

  // --- Signal 2: recognized file extension ---
  const hasFilePath = evidence.filePath != null && evidence.filePath.trim() !== '';
  if (hasFilePath) {
    const ext = extensionLanguage(evidence.filePath!);
    signals.push({ source: 'file_extension', language: ext.language, detail: ext.detail });
  }

  // --- Signal 3b: attachment content markers (read separately from DB code) ---
  const attachmentReadable =
    evidence.attachmentReadable ?? (evidence.attachmentCode != null);
  const missingAttachment = hasFilePath && !attachmentReadable;
  if (attachmentReadable && evidence.attachmentCode != null && evidence.attachmentCode.trim() !== '') {
    const markers = detectContentMarkers(evidence.attachmentCode);
    signals.push({
      source: 'attachment_markers',
      language: markers.language,
      detail: `attachment: ${markers.detail}`,
    });
  }

  // --- Signal 3a: DB code column content markers ---
  if (evidence.dbCode != null && evidence.dbCode.trim() !== '') {
    const markers = detectContentMarkers(evidence.dbCode);
    signals.push({
      source: 'db_code_markers',
      language: markers.language,
      detail: `db code: ${markers.detail}`,
    });
  }

  // --- Resolution: conflict outranks priority ---
  const decisive = signals.filter(
    (signal): signal is StrategyLanguageSignal & { language: 'cpp' | 'python' } =>
      signal.language !== null,
  );

  const conflicts: StrategyLanguageConflict[] = [];
  for (let i = 0; i < decisive.length; i += 1) {
    for (let j = i + 1; j < decisive.length; j += 1) {
      if (decisive[i].language !== decisive[j].language) {
        conflicts.push({
          left: decisive[i].source,
          leftLanguage: decisive[i].language,
          right: decisive[j].source,
          rightLanguage: decisive[j].language,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      language: 'ambiguous',
      signals,
      conflicts,
      reason:
        'Contradictory language evidence: ' +
        conflicts
          .map((c) => `${c.left}=${c.leftLanguage} vs ${c.right}=${c.rightLanguage}`)
          .join('; '),
      missingAttachment,
      classifierVersion: STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
    };
  }

  if (decisive.length === 0) {
    // Signal 4: absence of any usable signal. Terminal `ambiguous`, never C++.
    return {
      language: 'ambiguous',
      signals,
      conflicts,
      reason:
        signals.length === 0
          ? 'No language evidence available: the record carries no artifact kind, metadata, file path, attachment, or source code.'
          : `No usable language signal: ${signals.map((s) => s.detail).join('; ')}`,
      missingAttachment,
      classifierVersion: STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
    };
  }

  // All decisive signals agree; the highest-priority one names the language.
  const winner = decisive.reduce((best, candidate) =>
    SIGNAL_PRIORITY.indexOf(candidate.source) < SIGNAL_PRIORITY.indexOf(best.source)
      ? candidate
      : best,
  );

  return {
    language: winner.language,
    signals,
    conflicts,
    reason: `Resolved ${winner.language} from ${winner.source} (${winner.detail}); ${decisive.length} signal(s) agree.`,
    missingAttachment,
    classifierVersion: STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
  };
}
