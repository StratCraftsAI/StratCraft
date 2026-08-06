/**
 * AlgorithmCardList -- typed algorithm card + placement contract (component19M)
 *
 * TICKET_597: an assistant message that describes open-source algorithms gets
 * an inline capability card placed at the end of each algorithm's description
 * block.
 *
 * TICKET_1318 AC10: this used to scan rendered HTML (`<br/>`, `<strong>`) and
 * return another HTML string for `dangerouslySetInnerHTML`. That contract is
 * incompatible with the shared typed AST and unsafe. Placement now consumes
 * `ChatBlock[]` and returns typed placements that render as React elements; the
 * placement *behavior* -- multiple algorithms, the final algorithm in a
 * response, localized badge labels, and cards adjacent to code blocks -- is
 * unchanged.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 */

import React from 'react';
import type { ChatBlock, InlineNode } from '@StratCraft/chat-markdown';
import type { OpensourceAlgorithm } from '@StratCraft/ai-studio-operations/vibing-chat-protocol';
import {
  ALGORITHM_CATEGORY_COLORS,
  ALGORITHM_DEFAULT_BADGE,
  CODE_READY_BADGE,
  REF_ONLY_BADGE,
} from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

interface BadgeStyle {
  bg: string;
  text: string;
  border: string;
}

/**
 * Strategy type display config: label + color tokens from colors.ts.
 *
 * TICKET_786_11: `label` is the English fallback; the card renders
 * `translateFn(labelKey)` with `label` as its default value.
 */
const STRATEGY_TYPE_STYLES: Record<string, { label: string; labelKey: string } & BadgeStyle> = {
  indicator: { label: 'Indicator', labelKey: 'strategyType.indicator', ...ALGORITHM_CATEGORY_COLORS.indicator },
  ML: { label: 'ML', labelKey: 'strategyType.ml', ...ALGORITHM_CATEGORY_COLORS.ML },
  RL: { label: 'RL', labelKey: 'strategyType.rl', ...ALGORITHM_CATEGORY_COLORS.RL },
  breakout: { label: 'Breakout', labelKey: 'strategyType.breakout', ...ALGORITHM_CATEGORY_COLORS.breakout },
  mean_reversion: { label: 'Mean Reversion', labelKey: 'strategyType.meanReversion', ...ALGORITHM_CATEGORY_COLORS.mean_reversion },
  momentum: { label: 'Momentum', labelKey: 'strategyType.momentum', ...ALGORITHM_CATEGORY_COLORS.momentum },
  grid: { label: 'Grid', labelKey: 'strategyType.grid', ...ALGORITHM_CATEGORY_COLORS.grid },
  trend_following: { label: 'Trend Following', labelKey: 'strategyType.trendFollowing', ...ALGORITHM_CATEGORY_COLORS.trend_following },
  market_making: { label: 'Market Making', labelKey: 'strategyType.marketMaking', ...ALGORITHM_CATEGORY_COLORS.market_making },
  arbitrage: { label: 'Arbitrage', labelKey: 'strategyType.arbitrage', ...ALGORITHM_CATEGORY_COLORS.arbitrage },
  factor: { label: 'Factor', labelKey: 'strategyType.factor', ...ALGORITHM_CATEGORY_COLORS.factor },
  execution: { label: 'Execution', labelKey: 'strategyType.execution', ...ALGORITHM_CATEGORY_COLORS.execution },
};

const DEFAULT_STYLE = { label: 'Other', labelKey: 'strategyType.other', ...ALGORITHM_DEFAULT_BADGE };

/** Translate function accepted by the card (TICKET_786_11). */
export type TranslateFn = (key: string, options?: { defaultValue: string }) => string;

// -----------------------------------------------------------------------------
// Placement contract
// -----------------------------------------------------------------------------

/** One rendered item: either a markdown block or an algorithm card after it. */
export type PlacedItem =
  | { kind: 'block'; block: ChatBlock }
  | { kind: 'card'; algorithm: OpensourceAlgorithm };

/**
 * Place algorithm cards into a block sequence.
 *
 * Mirrors the TICKET_597 line-scanning rules, lifted from rendered HTML onto
 * the typed AST:
 *
 * - An algorithm "header" is a block whose leading text names an algorithm from
 *   the metadata -- as bold text, as a list item, or as plain `Name (id)` text.
 * - The card is emitted after the last block of that algorithm's description,
 *   which ends at the next algorithm header, at any other bold header, or at
 *   the end of the message.
 * - Each algorithm is placed at most once, so a name repeated later in the
 *   response does not duplicate its card.
 */
export function placeAlgorithmCards(
  blocks: ChatBlock[],
  algorithms: OpensourceAlgorithm[] | undefined,
): PlacedItem[] {
  const items: PlacedItem[] = blocks.map((block) => ({ kind: 'block', block } as PlacedItem));
  if (algorithms === undefined || algorithms.length === 0) return items;

  const pending = new Map<string, OpensourceAlgorithm>();
  for (const algorithm of algorithms) {
    pending.set(algorithm.name.toLowerCase(), algorithm);
  }

  const result: PlacedItem[] = [];
  let current: OpensourceAlgorithm | null = null;
  /** Index in `result` after which the current algorithm's card is inserted. */
  let insertAfter = -1;

  const flush = (): void => {
    if (current === null) return;
    result.splice(insertAfter + 1, 0, { kind: 'card', algorithm: current });
    current = null;
    insertAfter = -1;
  };

  for (const block of blocks) {
    const matched = matchAlgorithmHeader(block, pending);

    if (matched !== null) {
      flush();
      result.push({ kind: 'block', block });
      pending.delete(matched.name.toLowerCase());
      current = matched;
      insertAfter = result.length - 1;
      continue;
    }

    // Any other bold header ends the current algorithm's description block.
    if (current !== null && isBoldHeader(block)) {
      flush();
      result.push({ kind: 'block', block });
      continue;
    }

    result.push({ kind: 'block', block });
    if (current !== null) insertAfter = result.length - 1;
  }

  flush();
  return result;
}

/** The algorithm this block introduces, if it is a header for a pending one. */
function matchAlgorithmHeader(
  block: ChatBlock,
  pending: Map<string, OpensourceAlgorithm>,
): OpensourceAlgorithm | null {
  for (const candidate of headerCandidates(block)) {
    const algorithm = pending.get(candidate.toLowerCase());
    if (algorithm !== undefined) return algorithm;
  }
  return null;
}

/**
 * Candidate algorithm names a block could be announcing: the text of a leading
 * bold span, and the identifier preceding a parenthesized id.
 */
function headerCandidates(block: ChatBlock): string[] {
  const candidates: string[] = [];

  for (const nodes of inlineGroups(block)) {
    const leadingStrong = nodes.find((node) => node.type === 'strong');
    if (leadingStrong !== undefined && leadingStrong.type === 'strong') {
      const text = flattenInline(leadingStrong.children).trim();
      candidates.push(text);
      // `Name (id)` inside the bold header.
      const withoutId = /^(.+?)\s*\([^)]*\)\s*$/.exec(text);
      if (withoutId !== null) candidates.push(withoutId[1].trim());
    }

    const plain = flattenInline(nodes).trim();
    const listMatch = /^-?\s*([A-Za-z0-9_]+)\s*\([^)]+\)/.exec(plain);
    if (listMatch !== null) candidates.push(listMatch[1]);
  }

  return candidates;
}

/**
 * True when the block is a section header, which ends the current algorithm's
 * description.
 *
 * TICKET_1318_1: an ATX heading is a section boundary by definition -- before
 * the parser recognized `##`, such a line arrived as a plain paragraph and only
 * counted when the model also bolded it.
 */
function isBoldHeader(block: ChatBlock): boolean {
  if (block.type === 'heading') return true;
  for (const nodes of inlineGroups(block)) {
    if (nodes.some((node) => node.type === 'strong')) return true;
  }
  return false;
}

/**
 * Inline node groups a block contains: one per paragraph, heading, list item,
 * or table cell.
 *
 * TICKET_1318_1: headings and tables are groups too. A heading is in fact the
 * most natural place for a model to announce an algorithm name, so folding it
 * in here is what keeps TICKET_597 cards attaching after the parser learned to
 * recognize `## Name`.
 */
function inlineGroups(block: ChatBlock): InlineNode[][] {
  if (block.type === 'paragraph' || block.type === 'heading') return [block.children];
  if (block.type === 'code') return [];
  if (block.type === 'table') return [...block.header, ...block.rows.flat()];
  return block.items;
}

function flattenInline(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return node.content;
      if (node.type === 'inlineCode') return node.content;
      if (node.type === 'hardBreak') return '\n';
      return flattenInline(node.children);
    })
    .join('');
}

// -----------------------------------------------------------------------------
// Card component
// -----------------------------------------------------------------------------

const Badge: React.FC<{ label: string; style: BadgeStyle; icon?: React.ReactNode }> = ({
  label,
  style,
  icon,
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      padding: '1px 6px',
      fontSize: 10,
      fontWeight: 500,
      borderRadius: 4,
      border: `1px solid ${style.border}`,
      background: style.bg,
      color: style.text,
      whiteSpace: 'nowrap',
    }}
  >
    {icon !== undefined && (
      <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 2 }}>{icon}</span>
    )}
    {label}
  </span>
);

const CheckIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const InfoIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export interface AlgorithmCardProps {
  algorithm: OpensourceAlgorithm;
  /** TICKET_786_11: renders badge labels in the user's locale. */
  t: TranslateFn;
}

/**
 * Inline capability card for one open-source algorithm.
 *
 * Every value is rendered as a React text node, so algorithm metadata coming
 * from the model can never inject markup (TICKET_1318 AC11).
 */
export const AlgorithmCard: React.FC<AlgorithmCardProps> = ({ algorithm, t }) => {
  const typeStyle = STRATEGY_TYPE_STYLES[algorithm.strategy_type] ?? DEFAULT_STYLE;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        margin: '4px 0 2px 0',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <Badge label={t(typeStyle.labelKey, { defaultValue: typeStyle.label })} style={typeStyle} />
      {algorithm.rule_extractable ? (
        <Badge
          label={t('strategyType.codeReady', { defaultValue: 'Code Ready' })}
          style={CODE_READY_BADGE}
          icon={<CheckIcon />}
        />
      ) : (
        <Badge
          label={t('strategyType.referenceOnly', { defaultValue: 'Reference Only' })}
          style={REF_ONLY_BADGE}
          icon={<InfoIcon />}
        />
      )}
    </div>
  );
};
