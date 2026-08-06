/**
 * TICKET_650 Phase 4: Backend Validation Report Panel
 *
 * Displays per-layer validation status from the backend C++ validation pipeline.
 * Follows CompilationStatusBadge patterns for StratCraftsAI styling.
 */
import React from 'react';
import { CheckCircle2, XCircle, MinusCircle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type {
  ValidationReport,
  ValidationLayerName,
  ValidationLayerStatus,
} from '../../../shared/types/validation-report';
import {
  VALIDATION_ERROR_MESSAGES,
  VALIDATION_LAYER_LABELS,
} from '../../../shared/types/validation-report';
import { SEMANTIC_COLORS } from '@shared/constants/colors';

export interface ValidationReportPanelProps {
  report: ValidationReport | null;
  className?: string;
}

const LAYER_ORDER: ValidationLayerName[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

function StatusIcon({ status }: { status: ValidationLayerStatus }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className={`h-3.5 w-3.5 text-[${SEMANTIC_COLORS.SUCCESS}]`} aria-hidden="true" />;
    case 'fail':
      return <XCircle className={`h-3.5 w-3.5 text-[${SEMANTIC_COLORS.ERROR}]`} aria-hidden="true" />;
    case 'skip':
      return <MinusCircle className="h-3.5 w-3.5 text-color-terminal-text-secondary" aria-hidden="true" />;
  }
}

function statusLabel(status: ValidationLayerStatus, t: (key: string) => string): string {
  switch (status) {
    case 'pass': return t('validation.pass');
    case 'fail': return t('validation.fail');
    case 'skip': return t('validation.skip');
  }
}

function resolveErrorMessage(errorCode?: string, errorMessage?: string): string {
  if (errorCode && VALIDATION_ERROR_MESSAGES[errorCode]) {
    return VALIDATION_ERROR_MESSAGES[errorCode];
  }
  return errorMessage || '';
}

export function ValidationReportPanel({ report, className }: ValidationReportPanelProps) {
  const { t } = useTranslation('ui');

  if (!report) {
    return null;
  }

  const overallFailed = report.status === 'fail';

  return (
    <details
      className={cn(
        'group w-full rounded border bg-color-terminal-panel/70 text-small backdrop-blur-md',
        overallFailed
          ? `border-[${SEMANTIC_COLORS.ERROR}]/30`
          : 'border-color-terminal-border/80',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-2.5 py-1.5 outline-none transition-colors hover:bg-color-terminal-surface/50 focus-visible:ring-1 focus-visible:ring-color-terminal-accent-primary/70">
        <ShieldCheck
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            overallFailed ? `text-[${SEMANTIC_COLORS.ERROR}]` : `text-[${SEMANTIC_COLORS.SUCCESS}]`,
          )}
          aria-hidden="true"
        />
        <span className="font-medium text-color-terminal-text-primary">
          {t('validation.backendReport')}
        </span>
        {overallFailed && report.failed_layer && (
          <span className={`ml-auto text-[${SEMANTIC_COLORS.ERROR}] text-[11px]`}>
            {t('validation.fail')}: {VALIDATION_LAYER_LABELS[report.failed_layer]}
          </span>
        )}
      </summary>

      <div className="border-t border-color-terminal-border/40 p-3">
        {/* Per-layer rows */}
        <div className="space-y-1.5">
          {LAYER_ORDER.map((layerName) => {
            const layer = report.validation_layers[layerName];
            if (!layer) return null;

            const hasFailed = layer.status === 'fail';
            const hasErrors = hasFailed && layer.errors && layer.errors.length > 0;

            return (
              <div key={layerName}>
                <div className="flex items-center gap-2 py-0.5">
                  <StatusIcon status={layer.status} />
                  <span className="text-color-terminal-text-secondary text-[11px] w-6 shrink-0 font-mono">
                    {layerName}
                  </span>
                  <span className="text-color-terminal-text-primary text-[12px]">
                    {t(`validation.${layerName}`)}
                  </span>
                  <span className={cn(
                    'ml-auto text-[11px]',
                    layer.status === 'pass' && `text-[${SEMANTIC_COLORS.SUCCESS}]`,
                    layer.status === 'fail' && `text-[${SEMANTIC_COLORS.ERROR}]`,
                    layer.status === 'skip' && 'text-color-terminal-text-secondary',
                  )}>
                    {statusLabel(layer.status, t)}
                  </span>
                  {layer.compile_time_ms != null && (
                    <span className="text-color-terminal-text-secondary text-[10px] ml-1">
                      ({layer.compile_time_ms}ms)
                    </span>
                  )}
                </div>

                {/* Expandable error details */}
                {hasErrors && (
                  <div className="ml-8 mt-1 mb-1">
                    <pre className={`max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[${SEMANTIC_COLORS.ERROR}]/20 bg-black/25 p-2 font-mono text-[11px] leading-4 text-color-terminal-text-secondary`}>
                      {layer.errors!.join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Overall error message */}
        {overallFailed && (report.error_code || report.error_message) && (
          <div className={`mt-2 rounded border border-[${SEMANTIC_COLORS.ERROR}]/20 bg-[${SEMANTIC_COLORS.ERROR}]/5 p-2`}>
            <p className={`text-[12px] text-[${SEMANTIC_COLORS.ERROR}]`}>
              {resolveErrorMessage(report.error_code, report.error_message)}
            </p>
          </div>
        )}

        {/* stderr excerpt */}
        {report.stderr_excerpt && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-color-terminal-text-secondary hover:text-color-terminal-text-primary">
              {t('validation.stderrOutput')}
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-color-terminal-border/40 bg-black/25 p-2 font-mono text-[11px] leading-4 text-color-terminal-text-secondary">
              {report.stderr_excerpt}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}

export default ValidationReportPanel;
