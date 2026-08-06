import path from 'node:path';

interface DiagResult {
  name: string;
  pass: boolean;
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
}

interface DiagModule {
  name: string;
  description: string;
  run(args: Record<string, unknown>): Promise<DiagResult>;
}

interface ActionResult {
  name: string;
  ok: boolean;
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
}

interface ActionModule {
  name: string;
  description: string;
  run(args: Record<string, unknown>): Promise<ActionResult>;
}

/**
 * Resolve the headless diagnostics directory at runtime.
 * MCP standalone compiles to dist/src/handlers/ which shifts the directory
 * depth vs the source tree -- static relative imports break because tsc
 * preserves the source-level path literally. Using __dirname at runtime
 * gives us the correct base regardless of compilation layout.
 */
function headlessDiagnosticsDir(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', '..', 'headless', 'diagnostics');
}

function headlessActionsDir(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', '..', 'headless', 'actions');
}

const DIAG_NAMES = [
  'fx-calendar-holidays',
  'dukascopy-fetch-probe',
  'trading-day-coverage',
  'download-queue-history',
  'cache-catalog',
  'sweep-process-status',
  'rdagent-process-status',
];

const ACTION_NAMES = [
  'data-manager/queue-download',
  'data-manager/retry-failed',
  'data-manager/get-download-status',
  'data-manager/delete-segment',
  'quant-lab/start-sweep',
  'quant-lab/stop-sweep',
  'quant-lab/get-sweep-status',
  'scoreboard/get-scoreboard',
  'scoreboard/refresh-scoreboard',
  'remediation/re-rollup-verdict',
  'strategy-builder/list-strategies',
  'strategy-builder/generate-strategy',
  'backtester/run-backtest',
  'backtester/get-backtest-status',
  'quant-lab/run-single-cell',
  'signal-builder/import-rdagent-factors',
  'signal-builder/run-factor-sweep',
  'data-manager/import-package',
  'data-manager/register-parquet-directory',
  'remediation/refit-artifact',
];

function listDiagnostics(): string[] {
  return DIAG_NAMES;
}

async function runDiagnostic(
  name: string,
  args: Record<string, unknown> = {},
): Promise<DiagResult> {
  if (!DIAG_NAMES.includes(name)) {
    throw new Error(
      `Unknown diagnostic '${name}'. Available: ${DIAG_NAMES.join(', ')}`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod: { default: DiagModule } = require(path.join(headlessDiagnosticsDir(), name));
  return mod.default.run(args);
}

function listActions(): string[] {
  return ACTION_NAMES;
}

async function runAction(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ActionResult> {
  if (!ACTION_NAMES.includes(name)) {
    throw new Error(
      `Unknown action '${name}'. Available: ${ACTION_NAMES.join(', ')}`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod: { default: ActionModule } = require(path.join(headlessActionsDir(), name));
  return mod.default.run(args);
}

// ---------------------------------------------------------------------------
// Diagnostic handlers
// ---------------------------------------------------------------------------

export async function handleListDiagnostics(): Promise<{ content: { type: 'text'; text: string }[] }> {
  const names = listDiagnostics();
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ diagnostics: names }, null, 2) }],
  };
}

export async function handleRunDiagnostic(
  params: { name: string; args?: Record<string, unknown> },
): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const result: DiagResult = await runDiagnostic(params.name, params.args ?? {});
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.pass,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

export async function handleListActions(): Promise<{ content: { type: 'text'; text: string }[] }> {
  const names = listActions();
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ actions: names }, null, 2) }],
  };
}

export async function handleRunAction(
  params: { name: string; args?: Record<string, unknown> },
): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const result: ActionResult = await runAction(params.name, params.args ?? {});
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
      isError: true,
    };
  }
}
