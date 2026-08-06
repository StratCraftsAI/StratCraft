/**
 * @StratCraft/chat-markdown -- the single authoritative chat markdown contract.
 *
 * TICKET_1318: every surface that renders LLM chat output (Guide WebUI
 * MessageBubble/InfoPanel, Electron AI Studio, and the builder `CodeDisplay`)
 * consumes this package. It exports pure logic and a token contract only -- no
 * React components, no styling-system assumption -- so each surface keeps its
 * own presentational wrapper.
 */

export { parseChatMarkdown, parseInline } from './markdown.js';
export type { ChatBlock, InlineNode, TableAlignment } from './markdown.js';

export { splitContentSegments } from './segment.js';
export type { Segment } from './segment.js';

export { normalizeLanguage } from './language.js';
export type { CodeLanguage } from './language.js';

export { tokenizeCode } from './highlight.js';

export { tokenClassName, SYNTAX_TOKEN_KINDS, SYNTAX_COLORS } from './tokens.js';
export type { HighlightToken, SyntaxTokenKind } from './tokens.js';

// AC14: cross-surface parity golden, consumed by both surfaces' runtime tests.
export { PARITY_FIXTURE, parityFingerprint } from './parity.js';
export type { ParityFingerprint } from './parity.js';
