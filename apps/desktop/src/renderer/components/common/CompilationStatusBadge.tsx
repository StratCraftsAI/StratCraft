import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEMANTIC_COLORS } from '@shared/constants/colors';
import type { CompilationStatusUpdate, ParsedCompilerError } from '@shared/types/compiler';

export type CompilationStatus = 'idle' | 'compiling' | 'success' | 'error';

export type ParsedCompilerErrorView = ParsedCompilerError;

export interface CompilationStatusBadgeProps {
  status: CompilationStatus;
  error?: string;
  parsedErrors?: ParsedCompilerErrorView;
  onRetry?: () => void;
  className?: string;
}

export function CompilationStatusBadge({
  status,
  error,
  parsedErrors,
  onRetry,
  className,
}: CompilationStatusBadgeProps) {
  const { t } = useTranslation('ui');

  if (status === 'idle') {
    return null;
  }

  if (status === 'compiling') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded border border-color-terminal-border/80 bg-color-terminal-panel/70 px-2.5 py-1.5 text-small text-color-terminal-accent-primary',
          className
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>{t('compilation.compiling')}</span>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div
        className={cn(
          `inline-flex items-center gap-2 rounded border border-[${SEMANTIC_COLORS.SUCCESS}]/30 bg-[${SEMANTIC_COLORS.SUCCESS}]/10 px-2.5 py-1.5 text-small text-[${SEMANTIC_COLORS.SUCCESS}]`,
          className
        )}
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t('compilation.compiled')}</span>
      </div>
    );
  }

  return (
    <details
      className={cn(
        `group w-full rounded border border-[${SEMANTIC_COLORS.ERROR}]/35 bg-color-terminal-panel/60 text-small text-[${SEMANTIC_COLORS.ERROR}]`,
        className
      )}
    >
      <summary className={`flex cursor-pointer list-none items-center gap-2 rounded bg-[${SEMANTIC_COLORS.ERROR}]/10 px-2.5 py-1.5 outline-none transition-colors hover:bg-[${SEMANTIC_COLORS.ERROR}]/18 focus-visible:ring-1 focus-visible:ring-[${SEMANTIC_COLORS.ERROR}]/70`}>
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">
          {t('compilation.failed')}{parsedErrors?.summary ? `: ${parsedErrors.summary}` : ''}
        </span>
      </summary>

      <div className={`border-t border-[${SEMANTIC_COLORS.ERROR}]/20 bg-color-terminal-surface/70 p-3 text-color-terminal-text-primary shadow-lg backdrop-blur-md`}>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-color-terminal-border/70 bg-black/25 p-3 font-mono text-[12px] leading-5 text-color-terminal-text-secondary">
          {formatCompilerOutput(error, parsedErrors, t('compilation.noOutput'))}
        </pre>

        {parsedErrors?.rawOutput && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-color-terminal-text-secondary/70 hover:text-color-terminal-text-secondary">
              {t('compilation.showRawOutput')}
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-color-terminal-border/50 bg-black/15 p-2 font-mono text-[11px] leading-4 text-color-terminal-text-secondary/80">
              {parsedErrors.rawOutput}
            </pre>
          </details>
        )}

        {onRetry && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onRetry}
              className={`inline-flex items-center gap-1.5 rounded border border-[${SEMANTIC_COLORS.ERROR}]/35 bg-[${SEMANTIC_COLORS.ERROR}]/10 px-2.5 py-1 text-small font-medium text-[${SEMANTIC_COLORS.ERROR}] transition-colors hover:bg-[${SEMANTIC_COLORS.ERROR}]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[${SEMANTIC_COLORS.ERROR}]/70`}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('compilation.retry')}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

export function useCompilationStatus(algorithmId?: string) {
  const [state, setState] = React.useState<{
    status: CompilationStatus;
    error?: string;
    parsedErrors?: ParsedCompilerErrorView;
  }>({ status: 'idle' });

  React.useEffect(() => {
    const unsubscribe = window.electronAPI?.executor?.onCompilationStatus?.(
      (update: CompilationStatusUpdate) => {
        if (!algorithmId || update.algorithmId === algorithmId) {
          setState({ status: update.status, error: update.error, parsedErrors: update.parsedErrors });
        }
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, [algorithmId]);

  return state;
}

function formatCompilerOutput(
  error: string | undefined,
  parsedErrors: ParsedCompilerErrorView | undefined,
  noOutputMessage: string
): string {
  if (parsedErrors && parsedErrors.errors.length > 0) {
    return parsedErrors.errors
      .map((e) => `${e.severity}: ${e.message}`)
      .join('\n');
  }

  const trimmed = error?.trim();
  if (!trimmed) {
    return noOutputMessage;
  }

  return trimmed
    .split(/\r?\n/)
    .map((line, index) => `${String(index + 1).padStart(3, '0')} | ${line}`)
    .join('\n');
}

export default CompilationStatusBadge;
