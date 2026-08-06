/**
 * @StratCraft/ai-studio-operations
 *
 * Electron-free shared authority for AI Studio workflow state and the vibing
 * chat protocol. Both surfaces -- Electron Main (ai-studio-api.ts,
 * http-server.ts) and the standalone MCP server (handlers/strategies.ts,
 * agent/ai-studio-workflow-binding.ts) -- consume these contracts from this
 * single package rather than reconstructing them per surface.
 *
 * TICKET_1315 (vibing chat protocol) / TICKET_1317 (workflow contract).
 *
 * Runtime boundary: this barrel re-exports the workflow contract, which hashes
 * via `node:crypto` and is therefore Node-only. Browser surfaces (the
 * strategy-builder plugin renderer) must import the protocol-only subpath
 * `@StratCraft/ai-studio-operations/vibing-chat-protocol` instead, which
 * carries no Node dependency.
 */

export * from './vibing-chat-protocol';
export * from './ai-studio-workflow-contract';
