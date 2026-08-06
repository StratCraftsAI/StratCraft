/**
 * TICKET_1310_1: canonical client-surface identity.
 *
 * The surface (`web` = Guide WebUI over Streamable HTTP, `stdio` = an MCP
 * client over the stdio transport) is a **property of the transport that owns
 * the connection**, never a decision for the LLM and never a caller-supplied
 * argument.
 *
 * Root cause this module closes: `get_guided_action` branched on an optional
 * model-authored `client_type` argument because no channel existed to carry
 * the real surface. On the agent-loop path the model authors the tool
 * arguments and has no way to know which surface it serves, so the correct
 * value was reachable only by luck -- a Guide WebUI user received the stdio
 * `choice_card` instead of the personalized flow diagram.
 *
 * The surface is resolved exactly once, where the transport is chosen
 * (`server.ts` -- `--http` yields `web`, otherwise `stdio`), bound into the
 * tool registration path, and threaded through `ToolDispatchExtra` and the
 * frozen per-turn `TurnExecutionContext` -- the same ambient-context pattern
 * already used for `sessionId`.
 */

/** The transports that can own an MCP connection. */
export const CLIENT_SURFACES = ['web', 'stdio'] as const;

export type ClientSurface = (typeof CLIENT_SURFACES)[number];

/**
 * The surface assumed when a handler is reached outside any transport, i.e.
 * the in-process eval harness (`buildAgentRegistry`) and unit tests that
 * construct a registry directly.
 *
 * `web` is correct rather than merely convenient: the structured payload
 * (`flow_diagram`) is the richer, non-degraded contract, and the eval harness
 * exercises the same surface the Guide WebUI drives. This is an explicit,
 * documented default for a caller that genuinely has no transport -- not a
 * fallback masking a missing value on a real connection, where the surface is
 * always known (TICKET_856).
 */
export const DEFAULT_CLIENT_SURFACE: ClientSurface = 'web';

/**
 * Resolve the surface from the transport mode `parseArgs()` selected. Total
 * over the mode union, so a new transport cannot silently inherit a surface.
 */
export function resolveClientSurface(mode: 'stdio' | 'http'): ClientSurface {
  return mode === 'http' ? 'web' : 'stdio';
}

export function isClientSurface(value: unknown): value is ClientSurface {
  return typeof value === 'string' && (CLIENT_SURFACES as readonly string[]).includes(value);
}

/**
 * Read the surface off a tool handler's `extra`.
 *
 * A registered handler is invoked by two dispatchers: the MCP SDK (whose
 * `RequestHandlerExtra` knows nothing of our ambient context) and
 * `AgentToolRegistry.execute` (which passes `ToolDispatchExtra`). This is the
 * single reconciliation point between those two shapes.
 *
 * Returns undefined for the SDK path -- the caller then uses the surface bound
 * at registration, which describes the same transport. This is a structural
 * type gap between two dispatchers, not a missing value being papered over.
 */
export function dispatchClientSurface(extra: unknown): ClientSurface | undefined {
  const candidate = (extra as { clientSurface?: unknown } | undefined)?.clientSurface;
  return isClientSurface(candidate) ? candidate : undefined;
}
