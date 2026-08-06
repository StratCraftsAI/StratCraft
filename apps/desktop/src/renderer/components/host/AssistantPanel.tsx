/**
 * AssistantPanel - Contextual Help Panel (TICKET_593_1)
 *
 * Right-side panel displaying read-only teaching content for the current page.
 * Supports panel-internal navigation via assistant: links in Markdown content.
 * Phase 1: Local Markdown-backed content with internal link navigation.
 * Future: Remote URL webview primary, local Markdown fallback for offline.
 *
 * Panel pushes (compresses) main content via flex layout -- not an overlay.
 */

import React, { useCallback } from 'react';
import { X, BookOpen, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAssistantStore } from '@/stores';
import { useAppStore } from '@/stores';
import { resolveHelpContent, getContentByKey } from '@/config/assistant-help-registry';
import { Z_INDEX_ASSISTANT_PANEL } from '@shared/constants/z-index';

// ============================================================================
// Markdown link parser
// ============================================================================

/** Regex to match markdown links: [text](url) */
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** assistant: protocol prefix for panel-internal navigation */
const ASSISTANT_PROTOCOL = 'assistant:';
const INFO_CARDS_DIRECTIVE = ':::info-cards';
const BLOCK_DIRECTIVE_END = ':::';

// ============================================================================
// Inline Markdown renderer
// ============================================================================

function renderInlineMarkdown(
  text: string,
  onAssistantLink?: (key: string) => void
): React.ReactNode[] {
  // First split by markdown links, then handle inline code within segments
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  // Reset regex state
  MARKDOWN_LINK_RE.lastIndex = 0;
  let match = MARKDOWN_LINK_RE.exec(text);

  while (match !== null) {
    // Add text before this link
    if (match.index > lastIndex) {
      parts.push(...renderInlineCode(text.slice(lastIndex, match.index), matchIndex * 1000));
    }

    const linkText = match[1];
    const linkUrl = match[2];

    if (linkUrl.startsWith(ASSISTANT_PROTOCOL) && onAssistantLink) {
      const contentKey = linkUrl.slice(ASSISTANT_PROTOCOL.length);
      parts.push(
        <button
          key={`assistant-link-${matchIndex}`}
          onClick={() => onAssistantLink(contentKey)}
          className="text-left text-color-terminal-accent-teal hover:text-color-terminal-accent-gold underline underline-offset-2 transition-colors cursor-pointer"
        >
          {linkText}
        </button>
      );
    } else {
      // Regular link - render as non-interactive text (no external navigation)
      parts.push(
        <span key={`link-${matchIndex}`} className="text-color-terminal-accent-teal">
          {linkText}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
    matchIndex++;
    match = MARKDOWN_LINK_RE.exec(text);
  }

  // Add remaining text after last link
  if (lastIndex < text.length) {
    parts.push(...renderInlineCode(text.slice(lastIndex), matchIndex * 1000));
  }

  // If no links were found, just do inline code rendering
  if (matchIndex === 0) {
    return renderInlineCode(text, 0);
  }

  return parts;
}

function renderInlineCode(text: string, keyOffset: number): React.ReactNode[] {
  const segments = text.split(/(`[^`]+`)/g);

  return segments
    .filter(Boolean)
    .map((segment, index) => {
      if (segment.startsWith('`') && segment.endsWith('`')) {
        return (
          <code
            key={`inline-code-${keyOffset + index}`}
            className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-color-terminal-accent-gold"
          >
            {segment.slice(1, -1)}
          </code>
        );
      }

      return <React.Fragment key={`text-${keyOffset + index}`}>{segment}</React.Fragment>;
    });
}

function renderInfoCardsBlock(
  lines: string[],
  blockIndex: number,
  onAssistantLink?: (key: string) => void
): React.ReactNode | null {
  const entries = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^::]+)[::]\s*(.+)$/);
      if (!match) {
        return null;
      }

      return {
        label: match[1].trim(),
        value: match[2].trim(),
      };
    })
    .filter((entry): entry is { label: string; value: string } => entry !== null);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div key={`info-cards-${blockIndex}`} className="space-y-2">
      {entries.map((entry, index) => (
        <div
          key={`info-card-${index}`}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-color-terminal-accent-teal">
            {entry.label}
          </div>
          <div className="text-sm leading-6 text-color-terminal-text-primary">
            {renderInlineMarkdown(entry.value, onAssistantLink)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Block-level Markdown renderer
// ============================================================================

function renderMarkdown(
  markdown: string,
  onAssistantLink?: (key: string) => void
): React.ReactNode {
  const lines = markdown.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let infoCardLines: string[] = [];
  let inCodeBlock = false;
  let inInfoCardsBlock = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-6 text-color-terminal-text-secondary">
        {renderInlineMarkdown(paragraph.join(' '), onAssistantLink)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="space-y-2 pl-5 text-sm leading-6 text-color-terminal-text-secondary list-disc"
      >
        {listItems.map((item, index) => (
          <li key={`li-${index}`}>{renderInlineMarkdown(item, onAssistantLink)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCodeBlock = () => {
    if (codeLines.length === 0) return;
    blocks.push(
      <pre
        key={`pre-${blocks.length}`}
        className="overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-6 text-color-terminal-text-primary"
      >
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
    codeLines = [];
  };

  const flushInfoCards = () => {
    if (infoCardLines.length === 0) return;
    const block = renderInfoCardsBlock(infoCardLines, blocks.length, onAssistantLink);
    if (block) {
      blocks.push(block);
    }
    infoCardLines = [];
  };

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      flushInfoCards();
      if (inCodeBlock) {
        flushCodeBlock();
      }
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    if (line.trim() === INFO_CARDS_DIRECTIVE) {
      flushParagraph();
      flushList();
      inInfoCardsBlock = true;
      infoCardLines = [];
      return;
    }

    if (line.trim() === BLOCK_DIRECTIVE_END && inInfoCardsBlock) {
      flushInfoCards();
      inInfoCardsBlock = false;
      return;
    }

    if (inInfoCardsBlock) {
      infoCardLines.push(line);
      return;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-lg font-bold text-color-terminal-text-primary">
          {trimmed.slice(2)}
        </h1>
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2
          key={`h2-${blocks.length}`}
          className="pt-2 text-xs font-bold uppercase tracking-[0.16em] text-color-terminal-accent-teal"
        >
          {trimmed.slice(3)}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h3
          key={`h3-${blocks.length}`}
          className="pt-1 text-sm font-semibold tracking-[0.04em] text-color-terminal-text-primary"
        >
          {trimmed.slice(4)}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith('- ')) {
      flushParagraph();
      listItems.push(trimmed.slice(2));
      return;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^\d+\.\s/, ''));
      return;
    }

    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushCodeBlock();
  flushInfoCards();

  return <div className="space-y-4">{blocks}</div>;
}

// ============================================================================
// AssistantPanel Component
// ============================================================================

export const AssistantPanel: React.FC = () => {
  const { t } = useTranslation('ui');
  const panelOpen = useAssistantStore((s) => s.panelOpen);
  const setPanelOpen = useAssistantStore((s) => s.setPanelOpen);
  const contentOverrideKey = useAssistantStore((s) => s.contentOverrideKey);
  const pushContent = useAssistantStore((s) => s.pushContent);
  const popContent = useAssistantStore((s) => s.popContent);
  const activeView = useAppStore((s) => s.activeView);
  const subPagePath = useAppStore((s) => s.subPagePath);

  const routeContent = resolveHelpContent(activeView, subPagePath);
  const overrideContent = contentOverrideKey ? getContentByKey(contentOverrideKey) : null;
  const helpContent = overrideContent ?? routeContent;
  const isOverride = overrideContent !== null;

  const handleAssistantLink = useCallback(
    (key: string) => {
      const target = getContentByKey(key);
      if (target) {
        pushContent(key);
      }
    },
    [pushContent]
  );

  return (
    <div
      className="overflow-hidden border-l border-color-terminal-border bg-color-terminal-panel/95 backdrop-blur-md transition-all duration-300 ease-in-out flex flex-col"
      style={{
        width: panelOpen ? 320 : 0,
        minWidth: panelOpen ? 320 : 0,
        zIndex: Z_INDEX_ASSISTANT_PANEL,
      }}
      data-testid="assistant-panel"
    >
      {panelOpen && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-color-terminal-border shrink-0">
            <div className="flex items-center gap-2">
              {isOverride ? (
                <button
                  onClick={popContent}
                  className="p-0.5 rounded hover:bg-white/10 text-color-terminal-text-muted hover:text-color-terminal-text-primary transition-colors"
                  aria-label={t('assistant.backToOverview')}
                  data-testid="assistant-panel-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <BookOpen className="w-4 h-4 text-color-terminal-accent-teal" />
              )}
              <h2 className="text-sm font-bold text-color-terminal-text-primary">
                {helpContent?.title ?? t('assistant.panelTitle')}
              </h2>
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              className="p-1 rounded hover:bg-white/10 text-color-terminal-text-muted hover:text-color-terminal-text-primary transition-colors"
              aria-label={t('assistant.closePanel')}
              data-testid="assistant-panel-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {helpContent?.markdownContent ? (
              renderMarkdown(helpContent.markdownContent, handleAssistantLink)
            ) : helpContent ? (
              <div className="text-sm text-color-terminal-text-secondary">{helpContent.title}</div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <BookOpen className="w-8 h-8 text-color-terminal-text-muted/50" />
                <p className="text-sm text-color-terminal-text-muted">
                  {t('assistant.noContent')}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AssistantPanel;
