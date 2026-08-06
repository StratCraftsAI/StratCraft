/**
 * CodeDisplay Component
 *
 * Displays server-generated code with syntax highlighting, line numbers,
 * and copy functionality. Supports Python and JSON languages.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library (component5)
 * @see TICKET_063 - StratCraftsAI UI Spec
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, AlertCircle, Code } from 'lucide-react';
import { tokenClassName, tokenizeCode } from '@StratCraft/chat-markdown';
import { cn } from '../../lib/utils';
import { THEME_COLORS, CSS_VAR_FALLBACKS, SYNTAX_COLORS, STATUS_PLATE_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type CodeDisplayState = 'idle' | 'loading' | 'success' | 'error';

export interface CodeDisplayProps {
  /** Title displayed in header */
  title?: string;
  /** Code content to display */
  code: string;
  /** Language for syntax highlighting */
  language?: 'python' | 'json' | 'cpp';
  /** Current display state */
  state?: CodeDisplayState;
  /** Error message when state is 'error' */
  errorMessage?: string;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Max height with scroll */
  maxHeight?: string;
  /** Additional class names */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_MAX_HEIGHT = '400px';
import { COPY_FEEDBACK_DURATION_MS } from '@shared/constants/timing';
const SKELETON_LINES = 8;

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

interface CopyButtonProps {
  onCopy: () => void;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ onCopy, copied, copyLabel, copiedLabel }) => (
  <button
    onClick={onCopy}
    className={cn(
      'flex items-center gap-1.5 px-3 py-1.5',
      'text-[10px] font-bold uppercase tracking-wider',
      'border rounded transition-all duration-200',
      copied
        ? 'border-green-500 text-green-500'
        : 'border-color-terminal-border text-color-terminal-text-secondary hover:border-color-terminal-accent-teal hover:text-color-terminal-accent-teal'
    )}
  >
    {copied ? (
      <>
        <Check className="w-3 h-3" />
        {copiedLabel}
      </>
    ) : (
      <>
        <Copy className="w-3 h-3" />
        {copyLabel}
      </>
    )}
  </button>
);

const LoadingSkeleton: React.FC = () => (
  <div className="p-4 space-y-2">
    {Array.from({ length: SKELETON_LINES }).map((_, i) => (
      <div
        key={i}
        className="h-3 rounded skeleton-line"
        style={{
          width: `${Math.random() * 40 + 40}%`,
        }}
      />
    ))}
    <style>{`
      .skeleton-line {
        background: linear-gradient(
          90deg,
          var(--color-terminal-border, ${THEME_COLORS.INPUT_BORDER}) 25%,
          var(--color-terminal-surface, ${THEME_COLORS.INPUT_BG}) 50%,
          var(--color-terminal-border, ${THEME_COLORS.INPUT_BORDER}) 75%
        );
        background-size: 200% 100%;
        animation: skeleton-loading 1.5s infinite;
      }
      @keyframes skeleton-loading {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `}</style>
  </div>
);

interface ErrorDisplayProps {
  message: string;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
    <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
    <p className="text-xs text-red-500">{message}</p>
  </div>
);

const EmptyDisplay: React.FC<{ noCodeLabel: string }> = ({ noCodeLabel }) => (
  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
    <Code className="w-8 h-8 text-color-terminal-text-muted mb-3" />
    <p className="text-xs text-color-terminal-text-muted">{noCodeLabel}</p>
  </div>
);

interface LineNumbersProps {
  count: number;
}

const LineNumbers: React.FC<LineNumbersProps> = ({ count }) => (
  <div
    className="py-4 px-3 text-right select-none border-r terminal-mono text-color-terminal-text-muted bg-black/20 border-color-terminal-border"
    style={{
      fontSize: '12px',
      lineHeight: '1.6',
    }}
  >
    {Array.from({ length: count }).map((_, i) => (
      <div key={i}>{i + 1}</div>
    ))}
  </div>
);

// -----------------------------------------------------------------------------
// CodeDisplay Component
// -----------------------------------------------------------------------------

export const CodeDisplay: React.FC<CodeDisplayProps> = ({
  title,
  code,
  language = 'python',
  state = 'idle',
  errorMessage,
  showLineNumbers = true,
  maxHeight = DEFAULT_MAX_HEIGHT,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  
  const displayTitle = title ?? t('ui.codeDisplayLabels.title');
  const displayErrorMessage = errorMessage ?? t('ui.codeDisplayLabels.errorDefault');
  const copyLabel = t('ui.codeDisplayLabels.copy');
  const copiedLabel = t('ui.codeDisplayLabels.copied');
  const noCodeLabel = t('ui.codeDisplayLabels.noCode');
  
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  // Reset copied state after duration
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Handle copy to clipboard. `code` is already plain text -- TICKET_1318
  // removed the HTML-building tokenizer, so there are no tags to strip.
  const handleCopy = useCallback(async () => {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (err) {
      console.error('[E:UI:COPY_CODE_FAILED] Failed to copy code:', err);
    }
  }, [code]);

  // TICKET_1318 AC5: typed tokens from the shared tokenizer, rendered as React
  // spans. The former inline highlighters returned an HTML string.
  const tokens = useMemo(() => {
    if (!code || state === 'loading' || state === 'error') return [];
    return tokenizeCode(code, language);
  }, [code, language, state]);

  // Count lines for line numbers
  const lineCount = useMemo(() => {
    if (!code) return 0;
    return code.split('\n').length;
  }, [code]);

  // Determine what content to render
  const renderContent = () => {
    if (state === 'loading') {
      return <LoadingSkeleton />;
    }

    if (state === 'error') {
      return <ErrorDisplay message={displayErrorMessage} />;
    }

    if (!code || !code.trim()) {
      return <EmptyDisplay noCodeLabel={noCodeLabel} />;
    }

    return (
      <div className="flex" style={{ maxHeight }}>
        {showLineNumbers && <LineNumbers count={lineCount} />}
        <div
          ref={codeRef}
          className="flex-1 p-4 overflow-auto terminal-mono"
          style={{
            fontSize: '12px',
            lineHeight: '1.6',
            whiteSpace: 'pre',
          }}
        >
          {tokens.map((token, i) => {
            const tokenClass = tokenClassName(token.kind);
            return tokenClass === null ? (
              <span key={i}>{token.content}</span>
            ) : (
              <span key={i} className={tokenClass}>
                {token.content}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        'code-display rounded-lg overflow-hidden border border-color-terminal-border bg-color-terminal-bg',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-color-terminal-border bg-color-terminal-surface/50">
        <h3
          className="terminal-mono font-bold uppercase tracking-widest text-color-terminal-accent-gold"
          style={{
            fontSize: '14px',
            letterSpacing: '0.1em',
          }}
        >
          {displayTitle}
        </h3>
        {code && state !== 'loading' && state !== 'error' && (
          <CopyButton onCopy={handleCopy} copied={copied} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        )}
      </div>

      {/* Content */}
      <div className="overflow-hidden">
        {renderContent()}
      </div>

      {/*
        Token styles using CSS variables from the TICKET_078 theme system.
        TICKET_1318 AC5: selectors match the canonical `token token-${kind}`
        classes emitted by @StratCraft/chat-markdown. The previous code emitted
        `token <kind>` while selecting `.token-<kind>`, so highlighting never
        applied.
      */}
      <style>{`
        .code-display .token-keyword {
          color: var(--color-terminal-accent-teal, ${SYNTAX_COLORS.KEYWORD});
        }
        .code-display .token-string {
          color: var(--color-terminal-accent-green, ${SYNTAX_COLORS.STRING});
        }
        .code-display .token-comment {
          color: var(--color-terminal-text-muted, ${SYNTAX_COLORS.COMMENT});
          font-style: italic;
        }
        .code-display .token-number {
          color: var(--color-terminal-accent-orange, ${SYNTAX_COLORS.NUMBER});
        }
        .code-display .token-function,
        .code-display .token-class-name {
          color: var(--color-terminal-accent-gold, ${SYNTAX_COLORS.FUNCTION});
        }
        .code-display .token-decorator {
          color: var(--color-terminal-accent-teal, ${SYNTAX_COLORS.KEYWORD});
        }
        .code-display .token-builtin {
          color: var(--color-terminal-accent-yellow, ${SYNTAX_COLORS.BUILTIN});
        }
        .code-display .token-property {
          color: var(--color-terminal-accent-blue, ${SYNTAX_COLORS.PROPERTY});
        }
        .code-display .token-preprocessor {
          color: var(--color-terminal-accent-violet, ${SYNTAX_COLORS.PREPROCESSOR});
        }
        .code-display .token-type {
          color: var(--color-terminal-accent-teal, ${SYNTAX_COLORS.KEYWORD});
          font-style: italic;
        }
        .code-display .token-namespace {
          color: var(--color-terminal-accent-blue, ${SYNTAX_COLORS.PROPERTY});
        }
      `}</style>
    </div>
  );
};

export default CodeDisplay;
