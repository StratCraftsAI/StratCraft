/**
 * Neutral strategy-persist orchestration (TICKET_1306_4, finding D6).
 *
 * This is the single owner of the ORDER in which a generated strategy is
 * committed to `nona_algorithms`:
 *   1. Pre-insert code-integrity validation (TICKET_761 / TICKET_521).
 *   2. Row insert (with the caller's dedup/undelete policy).
 *   3. Post-insert pipeline: validation-report persist + audit state machine +
 *      C++ auto-compile (TICKET_761).
 *
 * The pipeline steps are provided as INJECTED dependencies because they are
 * Electron-Main runtime services (compile toolchain, audit scorer) that a
 * headless surface such as the MCP process cannot construct. A surface that
 * cannot supply them MUST fail here, BEFORE any row is inserted -- never commit
 * a strategy that silently skips the post-insert pipeline (TICKET_860; AC6).
 */

/** Dependencies the owning runtime injects. All are required. */
export interface PersistStrategyDeps {
  /**
   * Pre-insert code-integrity check. Returns the (possibly auto-fixed) code, or
   * throws on unrecoverable validation errors. Runs BEFORE insertion.
   */
  validateBeforeInsert: (
    code: string,
    signalSource: string,
    language: 'cpp' | 'python',
  ) => Promise<{ code: string }>;
  /**
   * Insert the row (owns name-dedup / soft-delete-undelete). Returns the row id
   * and the resolved name (may differ from the requested name on collision).
   */
  insertRow: (
    data: PersistStrategyInsertData,
  ) => Promise<{ id: number; strategyName: string }>;
  /**
   * Fire the TICKET_761 post-insert chain (validation-report persist [sync],
   * audit [fire-and-forget], C++ auto-compile [fire-and-forget]).
   */
  triggerPostInsertPipeline: (input: PostInsertInput) => Promise<void>;
}

/**
 * Row payload for the injected `insertRow`. Fields mirror the
 * `nona_algorithms` insert contract; JSON columns are pre-serialized strings.
 */
export interface PersistStrategyInsertData {
  code: string;
  strategy_name: string;
  strategy_type: number;
  classification_metadata: string;
  strategy_rules: string;
  description?: string;
  user_id: string;
  category?: string;
  record_type?: string;
  local_only?: number;
}

export interface PostInsertInput {
  algorithmId: number;
  parentKind: 'algorithm' | 'signal';
  strategyName: string;
  code: string;
  language: 'cpp' | 'python';
  signalSource: string;
  llmProvider: string;
  llmModel: string;
  regime?: string;
  backendValidationReport?: string | object | null;
}

/** What the caller must supply to persist one generated strategy. */
export interface PersistStrategyInput {
  insertData: PersistStrategyInsertData;
  language: 'cpp' | 'python';
  signalSource: string;
  llmProvider: string;
  llmModel: string;
  regime?: string;
  parentKind?: 'algorithm' | 'signal';
  backendValidationReport?: string | object | null;
}

export interface PersistStrategyResult {
  algorithmId: number;
  strategyName: string;
  /** The (possibly auto-fixed) code that was actually persisted. */
  code: string;
}

/**
 * Raised when a required pipeline dependency is absent. Surfaces MUST NOT catch
 * this into a "persisted without pipeline" success -- it is a fail-before-insert
 * guard (TICKET_860; AC6).
 */
export class MissingPipelineDependencyError extends Error {
  constructor(public readonly dependency: keyof PersistStrategyDeps) {
    super(
      `Cannot persist strategy: required pipeline dependency '${dependency}' ` +
        'is not available in this runtime. Persisting would skip the TICKET_761 ' +
        'post-insert validation/audit/compile pipeline, which is prohibited.',
    );
    this.name = 'MissingPipelineDependencyError';
  }
}

function assertDeps(deps: Partial<PersistStrategyDeps> | undefined): PersistStrategyDeps {
  if (!deps || typeof deps.validateBeforeInsert !== 'function') {
    throw new MissingPipelineDependencyError('validateBeforeInsert');
  }
  if (typeof deps.insertRow !== 'function') {
    throw new MissingPipelineDependencyError('insertRow');
  }
  if (typeof deps.triggerPostInsertPipeline !== 'function') {
    throw new MissingPipelineDependencyError('triggerPostInsertPipeline');
  }
  return deps as PersistStrategyDeps;
}

/**
 * Persist a generated strategy through the shared order-of-operations.
 *
 * Throws `MissingPipelineDependencyError` (before any write) when the runtime
 * cannot run the post-insert pipeline. Otherwise validates, inserts, and fires
 * the pipeline, returning the resolved id / name / persisted code.
 */
export async function persistStrategy(
  input: PersistStrategyInput,
  deps: Partial<PersistStrategyDeps> | undefined,
): Promise<PersistStrategyResult> {
  const resolved = assertDeps(deps);

  const requestedCode = input.insertData.code;
  if (typeof requestedCode !== 'string' || requestedCode.trim() === '') {
    throw new Error('Strategy generation completed without strategy code.');
  }

  // Step 1: pre-insert code-integrity validation (may auto-fix).
  const { code: validatedCode } = await resolved.validateBeforeInsert(
    requestedCode,
    input.signalSource,
    input.language,
  );

  // Step 2: insert with the validated code.
  const insertData: PersistStrategyInsertData = {
    ...input.insertData,
    code: validatedCode,
  };
  const { id: algorithmId, strategyName } = await resolved.insertRow(insertData);

  // Step 3: fire the post-insert pipeline (sync report write; audit + compile
  // are fire-and-forget by the pipeline's own contract).
  await resolved.triggerPostInsertPipeline({
    algorithmId,
    parentKind: input.parentKind ?? 'algorithm',
    strategyName,
    code: validatedCode,
    language: input.language,
    signalSource: input.signalSource,
    llmProvider: input.llmProvider,
    llmModel: input.llmModel,
    regime: input.regime,
    backendValidationReport: input.backendValidationReport ?? null,
  });

  return { algorithmId, strategyName, code: validatedCode };
}
