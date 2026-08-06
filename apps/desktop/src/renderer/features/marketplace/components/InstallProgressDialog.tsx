/**
 * InstallProgressDialog - Installation progress modal
 *
 * TICKET_051: Plugin Marketplace Implementation
 */

import React from 'react';
import { Loader2, Check, X, Download, Shield, Package, Settings, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { InstallProgress, InstallPhase } from '@shared/types/marketplace';

interface InstallProgressDialogProps {
  progress: InstallProgress;
}

const PHASE_ICONS: Record<InstallPhase, React.ComponentType<{ className?: string }>> = {
  downloading: Download,
  verifying: Shield,
  resolving_dependencies: Package,
  extracting: Package,
  installing_python_deps: Settings,
  finalizing: Settings,
  complete: CheckCircle,
  error: X,
};

export function InstallProgressDialog({ progress }: InstallProgressDialogProps) {
  const { t } = useTranslation('marketplace');
  const Icon = PHASE_ICONS[progress.phase] || Loader2;
  const isComplete = progress.phase === 'complete';
  const isError = progress.phase === 'error';
  const phaseLabel = t(`install.phases.${progress.phase}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              isComplete && 'bg-green-500/10',
              isError && 'bg-red-500/10',
              !isComplete && !isError && 'bg-primary/10'
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                isComplete && 'text-green-500',
                isError && 'text-red-500',
                !isComplete && !isError && 'animate-spin text-primary'
              )}
            />
          </div>
          <div>
            <h3 className="font-semibold">{t('install.installingPlugin')}</h3>
            <p className="text-sm text-muted-foreground">{progress.pluginId}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{phaseLabel}</span>
            <span className="font-medium">{progress.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full transition-all duration-300',
                isComplete && 'bg-green-500',
                isError && 'bg-red-500',
                !isComplete && !isError && 'bg-primary'
              )}
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>

        {/* Message */}
        <p
          className={cn(
            'text-sm',
            isError ? 'text-red-500' : 'text-muted-foreground'
          )}
        >
          {t(progress.message, { defaultValue: progress.message })}
        </p>

        {/* Phase Steps */}
        <div className="mt-6 space-y-2">
          {Object.entries(PHASE_ICONS)
            .filter(([phase]) => phase !== 'error')
            .map(([phase]) => {
              const phaseOrder = getPhaseOrder(phase as InstallPhase);
              const currentOrder = getPhaseOrder(progress.phase);
              const isActive = phase === progress.phase;
              const isCompleted = phaseOrder < currentOrder;

              return (
                <div
                  key={phase}
                  className={cn(
                    'flex items-center gap-2 text-xs',
                    isActive && 'text-primary',
                    isCompleted && 'text-green-500',
                    !isActive && !isCompleted && 'text-muted-foreground'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-3 w-3" />
                  ) : isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <div className="h-3 w-3 rounded-full border border-current" />
                  )}
                  <span>{t(`install.phases.${phase}`)}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function getPhaseOrder(phase: InstallPhase): number {
  const order: Record<InstallPhase, number> = {
    downloading: 0,
    verifying: 1,
    resolving_dependencies: 2,
    extracting: 3,
    installing_python_deps: 4,
    finalizing: 5,
    complete: 6,
    error: -1,
  };
  return order[phase] ?? -1;
}

export default InstallProgressDialog;
