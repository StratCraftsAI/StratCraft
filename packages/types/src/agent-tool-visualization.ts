/**
 * TICKET_1370 R6: the single authority that decides whether a tool result is a
 * renderable visualization, and under which discriminant.
 *
 * This lives in `@StratCraft/types` -- not in the MCP server and not in a
 * surface -- because two independent call paths must reach the identical
 * verdict for the identical result:
 *
 *   1. the Agent event stream (`visualizedResult` in the MCP standalone
 *      server's `tool-catalog.ts`, emitting a `tool_visualization` event), and
 *   2. a direct card-originated tool call (Guide WebUI
 *      `App.handleGuidedActionDispatch`, which has no Agent turn to ride on).
 *
 * Before this module existed, (2) hardcoded `json`/`table`, so an edited
 * workload review returned through the card's own button degraded to a JSON
 * blob and could never replace the stale card -- the pre-launch review was a
 * permanent dead end. Per TICKET_1306 the two surfaces must delegate to one
 * shared owner rather than each carrying their own projection, and per
 * TICKET_853 the fix belongs here rather than as a second parser in the SPA.
 */
import {
  AGENT_VISUALIZATION_KINDS,
  type AgentVisualizationKind,
} from './agent-runtime';

/**
 * Tools whose result is a renderable payload rather than narratable text.
 *
 * This cannot be derived from a tool's input schema: it is a property of the
 * tool's *output*, which zod does not describe. It is declared once here and
 * consumed by the MCP registry (`AgentToolRegistry.record`) and by the direct
 * dispatch path alike.
 */
export const AGENT_VISUAL_TOOL_NAMES: readonly string[] = [
  'get_guided_action',
  'review_factor_mining',
  'edit_workload_review',
  'confirm_and_start_factor_mining',
  'start_ai_studio_session',
  'continue_ai_studio_session',
];

/**
 * Tools that return a *bare* review document carrying no `type` discriminant of
 * its own, and therefore must be wrapped under a known kind by name.
 *
 * `review_factor_mining` returns the initial resolution and
 * `edit_workload_review` the re-resolution after an edit round-trip. Both are
 * the same document shape, so both project identically -- omitting either one
 * strands its result on the text path.
 */
const BARE_REVIEW_TOOL_NAMES: readonly string[] = [
  'review_factor_mining',
  'edit_workload_review',
];

const AI_STUDIO_SESSION_TOOL_NAMES: readonly string[] = [
  'start_ai_studio_session',
  'continue_ai_studio_session',
];

const VISUALIZATION_KINDS: ReadonlySet<string> = new Set(AGENT_VISUALIZATION_KINDS);

/** A tool result projected to a renderable payload, or the reason it is not one. */
export type AgentToolVisualization =
  | { ok: true; kind: AgentVisualizationKind; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Project an already-parsed tool result onto a visualization kind.
 *
 * Returns a typed failure rather than throwing or returning null so the caller
 * can degrade to its text/JSON path AND surface the reason (TICKET_858: no
 * silent failures).
 */
export function projectAgentToolVisualization(
  parsed: unknown,
  toolName?: string,
): AgentToolVisualization {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'result is not a JSON object' };
  }
  if (toolName !== undefined && BARE_REVIEW_TOOL_NAMES.includes(toolName)) {
    return {
      ok: true,
      kind: 'workload_prelaunch_review',
      payload: { type: 'workload_prelaunch_review', review: parsed },
    };
  }
  if (toolName !== undefined && AI_STUDIO_SESSION_TOOL_NAMES.includes(toolName)) {
    const record = parsed as Record<string, unknown>;
    const actions = record.available_actions;
    if (Array.isArray(actions) && actions.includes('generate_code')) {
      return {
        ok: true,
        kind: 'ai_studio_action',
        payload: { type: 'ai_studio_action', ...record },
      };
    }
    return { ok: false, reason: 'AI Studio result does not offer generate_code' };
  }
  if (toolName === 'confirm_and_start_factor_mining') {
    const record = parsed as Record<string, unknown>;
    const receipt = record.receipt as Record<string, unknown> | undefined;
    if (record.ok !== true || receipt === undefined || typeof receipt.taskId !== 'string'
      || typeof receipt.acceptedPlanFingerprint !== 'string') {
      return { ok: false, reason: 'launch result carries no typed task receipt' };
    }
    return {
      ok: true,
      kind: 'info_panel',
      payload: {
        type: 'info_panel',
        title: 'Factor mining launched',
        sections: [{
          heading: 'Durable launch receipt',
          body: `Task ID: ${receipt.taskId}\n\nAccepted plan: ${receipt.acceptedPlanFingerprint}\n\nState: ${String(record.state)}`,
        }],
      },
    };
  }
  const kind = (parsed as Record<string, unknown>).type;
  if (typeof kind !== 'string') {
    return { ok: false, reason: 'result has no string `type` discriminant' };
  }
  if (!VISUALIZATION_KINDS.has(kind)) {
    // `tool_call` lands here by design -- it is an execution instruction, not
    // a renderable component, so it must narrate as text like any other tool.
    return { ok: false, reason: `\`${kind}\` is not a renderable visualization kind` };
  }
  return { ok: true, kind: kind as AgentVisualizationKind, payload: parsed as Record<string, unknown> };
}

/**
 * TICKET_1379: `confirm_factor_mining` does not launch anything.
 *
 * Per its own tool description it "returns the immutable plan required by
 * start_factor_mining" -- the launch is a SEPARATE tool that consumes that
 * plan. A surface that dispatches confirm and stops has not started a mining
 * run; it has produced a plan document and thrown it away.
 *
 * That is exactly what the Guide WebUI card did: `handleConfirm` fired
 * `confirm_factor_mining` through `void onAction(...)`, discarding the result,
 * with no `start_factor_mining` call anywhere in the surface. The user saw the
 * plan render as a raw JSON blob and reasonably concluded nothing had started
 * -- nothing had.
 *
 * The continuation lives here rather than in the card because both surfaces
 * (Guide WebUI and the Electron renderer) must chain identically per
 * TICKET_1306, and because only the dispatch site holds the confirm *result*.
 * The card's dispatch contract returns `{ok}` with no payload, so the card
 * structurally cannot chain -- pushing this into the card would require
 * widening that contract and would still leave the Electron path unchained.
 */
export const FACTOR_MINING_CONFIRM_TOOL = 'confirm_factor_mining' as const;
export const FACTOR_MINING_START_TOOL = 'start_factor_mining' as const;

/** The confirmed plan `start_factor_mining` requires, or why it is absent. */
export type FactorMiningLaunchContinuation =
  | { ok: true; toolName: typeof FACTOR_MINING_START_TOOL; args: { plan: Record<string, unknown> } }
  | { ok: false; reason: string };

/**
 * Derive the `start_factor_mining` call that must follow a confirm result.
 *
 * The plan is forwarded EXACTLY as the confirm step returned it. The launch
 * schema is `.strict()` over a fingerprinted document, so merging defaults,
 * re-deriving parameters, or reshaping keys would either fail admission or --
 * worse -- launch a plan the user never saw. TICKET_1370's whole point is that
 * the fingerprint the user accepted is the fingerprint that executes.
 *
 * A confirm result that carries no usable plan returns a typed refusal naming
 * the missing field rather than launching a reconstructed one (TICKET_856,
 * TICKET_858). Silence here would reproduce the original defect.
 */
export function deriveFactorMiningLaunch(confirmResult: unknown): FactorMiningLaunchContinuation {
  if (!confirmResult || typeof confirmResult !== 'object' || Array.isArray(confirmResult)) {
    return { ok: false, reason: 'confirm result is not a JSON object' };
  }
  const record = confirmResult as Record<string, unknown>;
  // The confirm response either IS the plan or carries it under `plan`; both
  // shapes are identified by the fingerprint the launch schema requires.
  const candidate = (typeof record.plan === 'object' && record.plan !== null)
    ? record.plan as Record<string, unknown>
    : record;
  if (typeof candidate.planFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.planFingerprint)) {
    return { ok: false, reason: 'confirm result carries no `planFingerprint`; refusing to launch an unconfirmed plan' };
  }
  if (!Array.isArray(candidate.parameters)) {
    return { ok: false, reason: 'confirm result carries no `parameters` array; refusing to reconstruct them' };
  }
  return { ok: true, toolName: FACTOR_MINING_START_TOOL, args: { plan: candidate } };
}

/**
 * Project a tool result delivered as JSON text (the MCP `content[].text`
 * shape). Parsing is the only thing this adds over
 * `projectAgentToolVisualization`; the verdict itself stays in one place.
 */
export function projectAgentToolVisualizationText(
  text: string,
  toolName?: string,
): AgentToolVisualization {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `result is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return projectAgentToolVisualization(parsed, toolName);
}
