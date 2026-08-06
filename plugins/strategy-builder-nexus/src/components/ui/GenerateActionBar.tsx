/**
 * GenerateActionBar Component (TICKET_298)
 *
 * Shared Zone D action bar for all Builder pages.
 * Replaces duplicated generate button code with a centralized component.
 *
 * States:
 * - Initial: Single full-width gold "Start Generate" button
 * - Generating: Single full-width disabled spinner button
 * - Success: Dual layout - REGENERATE (ghost, left) + RETURN (teal, right)
 *
 * REGENERATE requires confirmation via globalThis.nexus.window.showConfirm().
 * RETURN navigates back to NONA hub via globalThis.nexus.window API.
 *
 * @see TICKET_298 - Builder Post-Generation Action Bar Redesign
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Loader2, RotateCcw, ArrowLeft, CheckCircle2, XCircle, MinusCircle, ShieldCheck, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

// =============================================================================
// TICKET_650: Compilation status types and hook (plugin-local)
// =============================================================================

type CompilationStatus = 'idle' | 'compiling' | 'success' | 'error';

function useCompilationStatus(algorithmId?: number | null) {
  const [state, setState] = useState<{
    status: CompilationStatus;
    error?: string;
  }>({ status: 'idle' });

  useEffect(() => {
    if (!algorithmId) {
      setState({ status: 'idle' });
      return;
    }

    // Optimistically assume compiling while we set up subscription + query
    setState({ status: 'compiling' });

    const algIdStr = String(algorithmId);

    // Subscribe to live status events first
    const unsubscribe = window.electronAPI?.executor?.onCompilationStatus?.(
      (update) => {
        if (update.algorithmId === algIdStr) {
          setState({ status: update.status, error: update.error });
        }
      }
    );

    // Then query current DB status to catch compilations that completed
    // before the subscription was established
    window.electronAPI?.executor?.getCompilationStatus?.(algorithmId)
      .then((result: any) => {
        if (result?.success && result.data) {
          const dbStatus = result.data.status as string;
          // Only update if DB has a terminal state (success/error);
          // if still pending/compiling, the live event will arrive
          if (dbStatus === 'success' || dbStatus === 'error') {
            setState({ status: dbStatus as CompilationStatus, error: result.data.error });
          }
        }
      })
      .catch(() => {});

    return () => {
      unsubscribe?.();
    };
  }, [algorithmId]);

  return state;
}

// =============================================================================
// TICKET_650 Phase 4: Backend validation report hook (plugin-local)
// =============================================================================

type ValidationLayerStatus = 'pass' | 'fail' | 'skip';
type ValidationLayerName = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

interface ValidationLayer {
  status: ValidationLayerStatus;
  errors?: string[];
  compile_time_ms?: number;
}

interface ValidationReport {
  task_id: string;
  code_kind: 'cpp' | 'python';
  status: 'ok' | 'fail' | 'skip';
  failed_layer?: ValidationLayerName;
  error_code?: string;
  error_message?: string;
  stderr_excerpt?: string;
  validation_layers: Partial<Record<ValidationLayerName, ValidationLayer>>;
}

const LAYER_ORDER: ValidationLayerName[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

function useBackendValidationReport(algorithmId?: number | null) {
  const [report, setReport] = useState<ValidationReport | null>(null);
  // Retry counter incremented by compilation status subscription to
  // re-fetch the report after compilation completes (report may be
  // persisted asynchronously in some API paths)
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!algorithmId) {
      setReport(null);
      return;
    }

    // Subscribe to compilation status events to trigger re-fetch when
    // compilation finishes (the validation report may be written after save)
    const algIdStr = String(algorithmId);
    const unsubscribe = window.electronAPI?.executor?.onCompilationStatus?.(
      (update) => {
        if (update.algorithmId === algIdStr && (update.status === 'success' || update.status === 'error')) {
          setRetryTick(t => t + 1);
        }
      }
    );
    return () => { unsubscribe?.(); };
  }, [algorithmId]);

  useEffect(() => {
    if (!algorithmId) {
      setReport(null);
      return;
    }

    window.electronAPI?.executor?.getValidationReport?.(algorithmId)
      .then((result: any) => {
        if (result?.success && result.data) {
          setReport(result.data);
        }
      })
      .catch(() => {});
  }, [algorithmId, retryTick]);

  return report;
}

export interface GenerateActionBarProps {
  isGenerating: boolean;
  hasResult: boolean;
  onGenerate: () => void;
  /** TICKET_701 Phase 2: Cancel callback for in-flight generation */
  onCancel?: () => void;
  generateLabel?: string;
  generatingLabel?: string;
  /** TICKET_650: Saved algorithm ID for C++ compilation tracking */
  savedAlgorithmId?: number | null;
  /** TICKET_650: Whether the generated strategy is C++ */
  isCpp?: boolean;
}

export const GenerateActionBar: React.FC<GenerateActionBarProps> = ({
  isGenerating,
  hasResult,
  onGenerate,
  onCancel,
  generateLabel,
  generatingLabel,
  savedAlgorithmId,
  isCpp,
}) => {
  // TICKET_650: Track C++ compilation status
  const compilationState = useCompilationStatus(isCpp ? savedAlgorithmId : null);
  // TICKET_650 Phase 4: Fetch backend validation report
  const validationReport = useBackendValidationReport(isCpp ? savedAlgorithmId : null);

  const handleRetryCompile = useCallback(() => {
    if (!savedAlgorithmId) return;
    void window.electronAPI?.executor?.compileAlgorithm?.({
      algorithmId: savedAlgorithmId,
    }).catch((err) => {
      console.error('[E:STRATEGY:RETRY_COMPILE_FAILED] [GenerateActionBar] Retry compile failed:', err);
    });
  }, [savedAlgorithmId]);
  const { t } = useTranslation('strategy-builder');
  const genLabel = generateLabel || t('ui.generateActionBarLabels.startGenerate');
  const geningLabel = generatingLabel || t('ui.generateActionBarLabels.generating');
  const stopLabel = t('ui.generateActionBarLabels.stop');
  const regenerateLabel = t('ui.generateActionBarLabels.regenerate');
  const returnLabel = t('ui.generateActionBarLabels.return');
  const regenerateConfirmMsg = t('ui.generateActionBarLabels.regenerateConfirmMsg');
  const regenerateConfirmTitle = t('ui.generateActionBarLabels.regenerateConfirmTitle');
  // TICKET_300: Only navigate - breadcrumbs auto-derived from view state
  const handleReturn = useCallback(() => {
    globalThis.nexus?.window?.openView('strategy.hub');
  }, []);

  const handleRegenerate = useCallback(async () => {
    const confirmed = await globalThis.nexus?.window?.showConfirm(
      regenerateConfirmMsg,
      { title: regenerateConfirmTitle }
    );
    if (confirmed) {
      onGenerate();
    }
  }, [onGenerate, regenerateConfirmMsg, regenerateConfirmTitle]);

  return (
    <div className="flex-shrink-0 border-t border-color-terminal-border bg-color-terminal-surface/50 p-4">
      {isGenerating ? (
        // TICKET_701 Phase 2: Generating state with Stop button
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold border rounded',
              'border-color-terminal-border bg-color-terminal-surface text-color-terminal-text-muted'
            )}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {geningLabel}
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className={cn(
                'flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold border rounded transition-all',
                'border-color-terminal-accent-red/50 bg-color-terminal-accent-red/10 text-color-terminal-accent-red hover:bg-color-terminal-accent-red/20'
              )}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {stopLabel}
            </button>
          )}
        </div>
      ) : hasResult ? (
        // Success state: dual layout - REGENERATE (left) + RETURN (right) + compilation badge
        <div className="space-y-3">
          {/* TICKET_650: C++ compilation status badge */}
          {isCpp && compilationState.status !== 'idle' && (
            <div className="w-full">
              {compilationState.status === 'compiling' && (
                <div className="inline-flex items-center gap-2 rounded border border-color-terminal-border/80 bg-color-terminal-panel/70 px-2.5 py-1.5 text-small text-color-terminal-accent-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('generate.compilingCpp')}</span>
                </div>
              )}
              {compilationState.status === 'success' && (
                <div className="inline-flex items-center gap-2 rounded border border-color-terminal-accent-teal/30 bg-color-terminal-accent-teal/10 px-2.5 py-1.5 text-small text-color-terminal-accent-teal">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>{t('ui:compilation.compiled')}</span>
                </div>
              )}
              {compilationState.status === 'error' && (
                <details className="group w-full rounded border border-color-terminal-accent-red/35 bg-color-terminal-panel/60 text-small text-color-terminal-accent-red">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-2.5 py-1.5 outline-none transition-colors hover:bg-color-terminal-accent-red/10">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{t('ui:compilation.failed')}</span>
                  </summary>
                  <div className="border-t border-color-terminal-accent-red/20 bg-color-terminal-surface/70 p-3 text-color-terminal-text-primary">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-color-terminal-border/70 bg-black/25 p-3 font-mono text-[12px] leading-5 text-color-terminal-text-secondary">
                      {compilationState.error?.trim() || t('ui:compilation.noOutput')}
                    </pre>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={handleRetryCompile}
                        className="inline-flex items-center gap-1.5 rounded border border-color-terminal-accent-red/35 bg-color-terminal-accent-red/10 px-2.5 py-1 text-small font-medium text-color-terminal-accent-red transition-colors hover:bg-color-terminal-accent-red/20"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('ui:compilation.retry')}
                      </button>
                    </div>
                  </div>
                </details>
              )}
            </div>
          )}
          {/* TICKET_650 Phase 4: Backend validation report */}
          {isCpp && validationReport && (
            <details
              className={cn(
                'group w-full rounded border bg-color-terminal-panel/70 text-small backdrop-blur-md',
                validationReport.status === 'fail'
                  ? 'border-color-terminal-accent-red/30'
                  : 'border-color-terminal-border/80',
              )}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-2.5 py-1.5 outline-none transition-colors hover:bg-color-terminal-surface/50">
                <ShieldCheck
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    validationReport.status === 'fail' ? 'text-color-terminal-accent-red' : 'text-color-terminal-accent-teal',
                  )}
                />
                <span className="font-medium text-color-terminal-text-primary">{t('ui:validation.title')}</span>
                {validationReport.status === 'fail' && validationReport.failed_layer && (
                  <span className="ml-auto text-color-terminal-accent-red text-[11px]">
                    {t('ui:validation.failedAt', { layer: t(`ui:validation.${validationReport.failed_layer}`) })}
                  </span>
                )}
              </summary>
              <div className="border-t border-color-terminal-border/40 p-3">
                <div className="space-y-1.5">
                  {LAYER_ORDER.map((layerName) => {
                    const layer = (validationReport.validation_layers as Record<string, ValidationLayer>)[layerName];
                    if (!layer) return null;
                    return (
                      <div key={layerName}>
                        <div className="flex items-center gap-2 py-0.5">
                          {layer.status === 'pass' && <CheckCircle2 className="h-3.5 w-3.5 text-color-terminal-accent-teal" />}
                          {layer.status === 'fail' && <XCircle className="h-3.5 w-3.5 text-color-terminal-accent-red" />}
                          {layer.status === 'skip' && <MinusCircle className="h-3.5 w-3.5 text-color-terminal-text-secondary" />}
                          <span className="text-color-terminal-text-secondary text-[11px] w-6 shrink-0 font-mono">{layerName}</span>
                          <span className="text-color-terminal-text-primary text-[12px]">{t(`ui:validation.${layerName}`)}</span>
                          <span className={cn(
                            'ml-auto text-[11px]',
                            layer.status === 'pass' && 'text-color-terminal-accent-teal',
                            layer.status === 'fail' && 'text-color-terminal-accent-red',
                            layer.status === 'skip' && 'text-color-terminal-text-secondary',
                          )}>
                            {layer.status === 'pass' ? t('ui:validation.pass') : layer.status === 'fail' ? t('ui:validation.fail') : t('ui:validation.skip')}
                          </span>
                          {layer.compile_time_ms != null && (
                            <span className="text-color-terminal-text-secondary text-[10px] ml-1">({layer.compile_time_ms}ms)</span>
                          )}
                        </div>
                        {layer.status === 'fail' && layer.errors && layer.errors.length > 0 && (
                          <div className="ml-8 mt-1 mb-1">
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-color-terminal-accent-red/20 bg-black/25 p-2 font-mono text-[11px] leading-4 text-color-terminal-text-secondary">
                              {layer.errors.join('\n')}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {validationReport.stderr_excerpt && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-color-terminal-text-secondary hover:text-color-terminal-text-primary">
                      {t('generate.stderrOutput')}
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-color-terminal-border/40 bg-black/25 p-2 font-mono text-[11px] leading-4 text-color-terminal-text-secondary">
                      {validationReport.stderr_excerpt}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          )}
          <div className="flex justify-between gap-3">
            <button
              onClick={handleRegenerate}
              className={cn(
                'flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold border rounded transition-all',
                'border-color-terminal-border text-color-terminal-text-muted hover:text-color-terminal-accent-gold hover:border-color-terminal-accent-gold'
              )}
            >
              <RotateCcw className="w-4 h-4" />
              {regenerateLabel}
            </button>
            <button
              onClick={handleReturn}
              className={cn(
                'flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold border rounded transition-all',
                'border-color-terminal-accent-teal bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/20'
              )}
            >
              <ArrowLeft className="w-4 h-4" />
              {returnLabel}
            </button>
          </div>
        </div>
      ) : (
        // Initial state: single gold button
        <div className="space-y-2">
          <button
            onClick={onGenerate}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold border rounded transition-all',
              'border-color-terminal-accent-gold bg-color-terminal-accent-gold/10 text-color-terminal-accent-gold hover:bg-color-terminal-accent-gold/20'
            )}
          >
            <Play className="w-4 h-4" />
            {genLabel}
          </button>
        </div>
      )}
    </div>
  );
};
