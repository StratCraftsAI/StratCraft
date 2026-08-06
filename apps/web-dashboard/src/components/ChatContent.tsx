/**
 * ChatContent -- Guide WebUI adapter for the shared chat markdown AST.
 *
 * TICKET_1318 AC1 / AC6 / AC11: renders `ChatBlock[]` from
 * `@StratCraft/chat-markdown` using web-dashboard's own CSS variables
 * (`--accent`, `--panel`, `--border`). It decides no markdown itself -- bold,
 * emphasis, inline code, lists, line breaks, fences, fence language, heading
 * level, and table shape/alignment (TICKET_1318_1) all come from the shared
 * parser.
 *
 * Everything is rendered through React text nodes; nothing here reaches
 * `dangerouslySetInnerHTML`, so hostile model output stays inert.
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  parseChatMarkdown,
  tokenClassName,
  tokenizeCode,
  type ChatBlock,
  type CodeLanguage,
  type InlineNode,
  type TableAlignment,
} from '@StratCraft/chat-markdown'
import { COPY_FEEDBACK_DURATION_MS } from '../constants'

interface Props {
  /** Raw message content as produced by the model. */
  content: string
  /** Extra class applied to the wrapper (e.g. `bubble`). */
  className?: string
}

/**
 * Render raw chat content through the shared AST.
 *
 * Block keys are `type + sourceStart` so a code block keeps its identity when a
 * closing fence arrives mid-stream and is not remounted (AC12).
 */
export function ChatContent({ content, className }: Props) {
  const blocks = parseChatMarkdown(content)

  return (
    <div className={className}>
      {blocks.map((block) => (
        <Block key={`${block.type}:${block.sourceStart}`} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: ChatBlock }) {
  if (block.type === 'code') {
    return (
      <CodeBlock content={block.content} language={block.language} />
    )
  }

  if (block.type === 'paragraph') {
    return <p className="cm-paragraph"><Inline nodes={block.children} /></p>
  }

  if (block.type === 'heading') {
    // TICKET_1318_1 AC6: the parser owns the level; the adapter only maps it.
    const HeadingTag = `h${block.level}` as 'h1'
    return <HeadingTag className="cm-heading"><Inline nodes={block.children} /></HeadingTag>
  }

  if (block.type === 'table') {
    return <Table block={block} />
  }

  const ListTag = block.type === 'orderedList' ? 'ol' : 'ul'
  return (
    <ListTag className="cm-list">
      {block.items.map((item, i) => (
        <li key={i}><Inline nodes={item} /></li>
      ))}
    </ListTag>
  )
}

/**
 * GFM table (TICKET_1318_1 AC6). Rows are already normalized to the header's
 * width by the shared parser, so the adapter never has to reason about ragged
 * input; it only applies the declared column alignment.
 */
function Table({ block }: { block: Extract<ChatBlock, { type: 'table' }> }) {
  return (
    <div className="cm-table-wrap">
      <table className="cm-table">
        <thead>
          <tr>
            {block.header.map((cell, i) => (
              <th key={i} style={alignStyle(block.alignments[i])}>
                <Inline nodes={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={alignStyle(block.alignments[c])}>
                  <Inline nodes={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function alignStyle(alignment: TableAlignment | null) {
  return alignment === null ? undefined : { textAlign: alignment }
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === 'text') return <span key={i}>{node.content}</span>
        if (node.type === 'hardBreak') return <br key={i} />
        if (node.type === 'inlineCode') {
          return <code key={i} className="cm-inline-code">{node.content}</code>
        }
        if (node.type === 'strong') {
          return <strong key={i}><Inline nodes={node.children} /></strong>
        }
        return <em key={i}><Inline nodes={node.children} /></em>
      })}
    </>
  )
}

/**
 * Fenced code block with line numbers and copy-to-clipboard (AC6).
 *
 * Syntax tokens come from the shared tokenizer and are rendered as spans
 * carrying the canonical `token token-${kind}` classes; `styles.css` maps those
 * classes to web-dashboard's variable namespace.
 */
function CodeBlock({ content, language }: { content: string; language: CodeLanguage | null }) {
  const { t } = useTranslation('dashboard')
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS)
      },
      (err: unknown) => {
        console.error('[E:UI:COPY_CODE_FAILED] Failed to copy code:', err)
      },
    )
  }, [content])

  const lines = content.split('\n')
  const tokens = tokenizeCode(content, language)

  return (
    <div className="cm-code">
      <div className="cm-code-header">
        <span className="cm-code-lang">{language ?? t('chatContent.plainCode')}</span>
        <button type="button" className="cm-code-copy" onClick={handleCopy}>
          {copied ? t('chatContent.copied') : t('chatContent.copy')}
        </button>
      </div>
      <div className="cm-code-body">
        <div className="cm-code-gutter" aria-hidden="true">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre className="cm-code-text">
          <code>
            {tokens.map((token, i) => {
              const cls = tokenClassName(token.kind)
              return cls === null
                ? <span key={i}>{token.content}</span>
                : <span key={i} className={cls}>{token.content}</span>
            })}
          </code>
        </pre>
      </div>
    </div>
  )
}
