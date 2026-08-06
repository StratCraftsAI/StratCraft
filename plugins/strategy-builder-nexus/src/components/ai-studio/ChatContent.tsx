/**
 * ChatContent -- AI Studio adapter for the shared chat markdown AST.
 *
 * TICKET_1318 AC6 / AC7 / AC10 / AC11: renders `ChatBlock[]` from
 * `@StratCraft/chat-markdown` in the plugin's Tailwind/`--color-terminal-*`
 * idiom, passes the normalized fence language to the shared tokenizer (the
 * previous renderer captured the language hint and discarded it), and places
 * TICKET_597 algorithm cards as typed React elements.
 *
 * Nothing here uses `dangerouslySetInnerHTML`; model output is rendered through
 * React text nodes only.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';
import {
  parseChatMarkdown,
  tokenClassName,
  tokenizeCode,
  type ChatBlock,
  type CodeLanguage,
  type InlineNode,
  type TableAlignment,
} from '@StratCraft/chat-markdown';
import { cn } from '../../lib/utils';
import { COPY_FEEDBACK_DURATION_MS } from '@shared/constants/timing';
import { SYNTAX_COLORS } from '@shared/constants/colors';
import type { OpensourceAlgorithm } from '@StratCraft/ai-studio-operations/vibing-chat-protocol';
import { AlgorithmCard, placeAlgorithmCards } from './AlgorithmCardList';

export interface ChatContentProps {
  /** Raw message content as produced by the model. */
  content: string;
  /** TICKET_597 metadata driving inline algorithm cards. */
  algorithms?: OpensourceAlgorithm[];
  className?: string;
}

/**
 * Render raw chat content through the shared AST.
 *
 * Block keys are `type + sourceStart` so a streaming code block keeps its
 * identity when its closing fence arrives (AC12).
 */
export const ChatContent: React.FC<ChatContentProps> = ({ content, algorithms, className }) => {
  const { t } = useTranslation('strategy-builder');

  const items = useMemo(
    () => placeAlgorithmCards(parseChatMarkdown(content), algorithms),
    [content, algorithms],
  );

  return (
    <div className={cn('break-words', className)}>
      {items.map((item, i) =>
        item.kind === 'card' ? (
          <AlgorithmCard key={`card:${item.algorithm.id}`} algorithm={item.algorithm} t={t} />
        ) : (
          <Block key={`${item.block.type}:${item.block.sourceStart}:${i}`} block={item.block} />
        ),
      )}
    </div>
  );
};

const Block: React.FC<{ block: ChatBlock }> = ({ block }) => {
  if (block.type === 'code') {
    return <CodeBlock content={block.content} language={block.language} />;
  }

  if (block.type === 'paragraph') {
    return (
      <p className="my-1 first:mt-0 last:mb-0">
        <Inline nodes={block.children} />
      </p>
    );
  }

  if (block.type === 'heading') {
    // TICKET_1318_1 AC6: the parser owns the level; the adapter only maps it.
    const HeadingTag = `h${block.level}` as 'h1';
    return (
      <HeadingTag className={cn('font-bold mt-3 mb-1 first:mt-0', HEADING_SIZES[block.level - 1])}>
        <Inline nodes={block.children} />
      </HeadingTag>
    );
  }

  if (block.type === 'table') {
    return <Table block={block} />;
  }

  const items = block.items.map((item, i) => (
    <li key={i}>
      <Inline nodes={item} />
    </li>
  ));

  return block.type === 'orderedList' ? (
    <ol className="my-1 pl-5 list-decimal">{items}</ol>
  ) : (
    <ul className="my-1 pl-5 list-disc">{items}</ul>
  );
};

/** Per-level heading sizes, indexed by `level - 1`. */
const HEADING_SIZES = [
  'text-base',
  'text-sm',
  'text-sm',
  'text-xs',
  'text-xs',
  'text-xs',
] as const;

/**
 * GFM table (TICKET_1318_1 AC6). Rows arrive normalized to the header's width
 * from the shared parser, so this only applies the declared alignment.
 */
const Table: React.FC<{ block: Extract<ChatBlock, { type: 'table' }> }> = ({ block }) => (
  <div className="my-2 overflow-x-auto">
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {block.header.map((cell, i) => (
            <th
              key={i}
              className="border border-color-terminal-border bg-black/20 px-2 py-1 font-bold align-top"
              style={alignStyle(block.alignments[i])}
            >
              <Inline nodes={cell} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td
                key={c}
                className="border border-color-terminal-border px-2 py-1 align-top"
                style={alignStyle(block.alignments[c])}
              >
                <Inline nodes={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

function alignStyle(alignment: TableAlignment | null): React.CSSProperties | undefined {
  return alignment === null ? undefined : { textAlign: alignment };
}

const Inline: React.FC<{ nodes: InlineNode[] }> = ({ nodes }) => (
  <>
    {nodes.map((node, i) => {
      if (node.type === 'text') return <span key={i}>{node.content}</span>;
      if (node.type === 'hardBreak') return <br key={i} />;
      if (node.type === 'inlineCode') {
        return (
          <code key={i} className="bg-black/10 px-1.5 py-0.5 rounded text-sm font-mono">
            {node.content}
          </code>
        );
      }
      if (node.type === 'strong') {
        return (
          <strong key={i}>
            <Inline nodes={node.children} />
          </strong>
        );
      }
      return (
        <em key={i}>
          <Inline nodes={node.children} />
        </em>
      );
    })}
  </>
);

/**
 * Fenced code block with line numbers and copy-to-clipboard (AC6), rendered
 * from shared typed tokens carrying the canonical `token token-${kind}`
 * classes.
 */
const CodeBlock: React.FC<{ content: string; language: CodeLanguage | null }> = ({
  content,
  language,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
      },
      (err: unknown) => {
        console.error('[E:UI:COPY_CODE_FAILED] Failed to copy code:', err);
      },
    );
  }, [content]);

  const lines = content.split('\n');
  const tokens = tokenizeCode(content, language);

  return (
    <div className="chat-code my-2 rounded border border-color-terminal-border overflow-hidden bg-black/20">
      <div className="flex items-center justify-between gap-3 px-2 py-1 border-b border-color-terminal-border">
        <span className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-muted">
          {language ?? t('aiStudio.plainCode', { defaultValue: 'code' })}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary hover:text-color-terminal-accent-teal"
          aria-label={
            copied
              ? t('aiStudio.copied', { defaultValue: 'Copied' })
              : t('aiStudio.copyMessage', { defaultValue: 'Copy' })
          }
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied
            ? t('aiStudio.copied', { defaultValue: 'Copied' })
            : t('aiStudio.copyMessage', { defaultValue: 'Copy' })}
        </button>
      </div>

      <div className="flex max-h-[400px] overflow-auto">
        <div
          aria-hidden="true"
          className="flex-none py-2 px-2 text-right select-none border-r terminal-mono text-color-terminal-text-muted border-color-terminal-border"
          style={{ fontSize: '12px', lineHeight: '1.6' }}
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre
          className="flex-1 m-0 py-2 px-3 overflow-x-auto terminal-mono"
          style={{ fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre' }}
        >
          <code>
            {tokens.map((token, i) => {
              const cls = tokenClassName(token.kind);
              return cls === null ? (
                <span key={i}>{token.content}</span>
              ) : (
                <span key={i} className={cls}>
                  {token.content}
                </span>
              );
            })}
          </code>
        </pre>
      </div>

      <style>{CHAT_CODE_TOKEN_STYLES}</style>
    </div>
  );
};

/**
 * Canonical token classes mapped to the plugin's terminal variable namespace.
 * Kept in sync with `CodeDisplay`'s block by both consuming `SYNTAX_COLORS`.
 */
const CHAT_CODE_TOKEN_STYLES = `
  .chat-code .token-keyword { color: var(--color-terminal-accent-teal, ${SYNTAX_COLORS.KEYWORD}); }
  .chat-code .token-string { color: var(--color-terminal-accent-green, ${SYNTAX_COLORS.STRING}); }
  .chat-code .token-comment { color: var(--color-terminal-text-muted, ${SYNTAX_COLORS.COMMENT}); font-style: italic; }
  .chat-code .token-number { color: var(--color-terminal-accent-orange, ${SYNTAX_COLORS.NUMBER}); }
  .chat-code .token-function,
  .chat-code .token-class-name { color: var(--color-terminal-accent-gold, ${SYNTAX_COLORS.FUNCTION}); }
  .chat-code .token-decorator { color: var(--color-terminal-accent-teal, ${SYNTAX_COLORS.KEYWORD}); }
  .chat-code .token-builtin { color: var(--color-terminal-accent-yellow, ${SYNTAX_COLORS.BUILTIN}); }
  .chat-code .token-property { color: var(--color-terminal-accent-blue, ${SYNTAX_COLORS.PROPERTY}); }
  .chat-code .token-preprocessor { color: var(--color-terminal-accent-violet, ${SYNTAX_COLORS.PREPROCESSOR}); }
  .chat-code .token-type { color: var(--color-terminal-accent-teal, ${SYNTAX_COLORS.KEYWORD}); font-style: italic; }
  .chat-code .token-namespace { color: var(--color-terminal-accent-blue, ${SYNTAX_COLORS.PROPERTY}); }
`;

export default ChatContent;
