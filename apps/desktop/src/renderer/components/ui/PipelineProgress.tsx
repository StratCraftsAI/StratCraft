/**
 * PipelineProgress - Two-row pipeline progress visualization
 *
 * TICKET_321: Backtest Pipeline Progress Visualization
 * TICKET_077_P2: PipelineProgress Component Spec
 * TICKET_322: Unified column grid layout for bar/label alignment
 *
 * Replaces the DataDownloadProgress strip during backtest execution,
 * providing continuous visual feedback across all 6 pipeline phases.
 *
 * Layout (column grid):
 * - Row 1: Per-column teal block-segment fill (completed columns full, active column partial)
 * - Row 2: Phase labels left-aligned at each column start
 *
 * Time-based estimation for phases without real progress
 * (spawning, initializing, loading_data).
 */

import React, { useEffect, useRef, useState } from 'react';
import { SEMANTIC_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** TICKET_1070 AC4: phases.length above this threshold triggers compact mode */
export const COMPACT_MODE_THRESHOLD = 20;

export interface PipelinePhaseConfig {
  /** Unique phase key */
  key: string;
  /** Display label */
  label: string;
  /** Optional relative weight for column sizing (default 1) */
  weight?: number;
}

export interface PipelineProgressProps {
  /** Phase definitions in order */
  phases: PipelinePhaseConfig[];
  /** Current active phase key, or 'idle'/'complete' */
  currentPhase: string;
  /** Progress of current phase: 0.0 ~ 1.0 */
  progress: number;
  /** Whether the component is visible */
  visible: boolean;
  /** Real-time progress message for console tooltip */
  message?: string;
  /** TICKET_374: Whether backtest was cancelled - shows interrupted phase in red */
  isCancelled?: boolean;
  /** TICKET_1070 AC4: completed phase count for compact overlay (e.g. "34/50") */
  completedCount?: number;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Time-based estimation for phases without real progress
// -----------------------------------------------------------------------------

/** Estimated durations for phases that have no real progress reporting */
const PHASE_ESTIMATED_DURATION_MS: Record<string, number> = {
  spawning: 500,
  initializing: 15000,
  loading_data: 20000,
  finalizing: 500,
};

/** Maximum estimated progress before phase actually completes */
const ESTIMATED_PROGRESS_CAP = 0.9;

/**
 * Hook for time-based progress estimation.
 * Returns a smoothly advancing progress value (0.0 ~ 0.9) based on elapsed
 * time vs estimated duration. Caps at 90% until phase actually transitions.
 */
function useTimeEstimatedProgress(phaseKey: string, isActive: boolean): number {
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!isActive) {
      setProgress(0);
      return;
    }

    const estimatedMs = PHASE_ESTIMATED_DURATION_MS[phaseKey];
    if (!estimatedMs) {
      // No estimation needed for this phase
      return;
    }

    startTimeRef.current = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTimeRef.current;
      // Ease-out curve: progress slows as it approaches cap
      const raw = elapsed / estimatedMs;
      const eased = 1 - Math.pow(1 - Math.min(raw, 1), 2);
      setProgress(Math.min(eased, ESTIMATED_PROGRESS_CAP));
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [phaseKey, isActive]);

  return progress;
}

// -----------------------------------------------------------------------------
// Block-segment background for filled bar portions
// -----------------------------------------------------------------------------
const BLOCK_BG = 'repeating-linear-gradient(90deg, var(--color-terminal-accent-teal) 0px, var(--color-terminal-accent-teal) 8px, transparent 8px, transparent 10px)';
// TICKET_374: Red block background for cancelled/interrupted phase
const BLOCK_BG_CANCELLED = `repeating-linear-gradient(90deg, ${SEMANTIC_COLORS.ERROR_LIGHT} 0px, ${SEMANTIC_COLORS.ERROR_LIGHT} 8px, transparent 8px, transparent 10px)`;

// -----------------------------------------------------------------------------
// Rolling buffer constant
// -----------------------------------------------------------------------------

/** TICKET_328_P1: Max visible lines in CMD-style console tooltip */
const TOOLTIP_MAX_LINES = 8;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const PipelineProgress: React.FC<PipelineProgressProps> = ({
  phases,
  currentPhase,
  progress,
  visible,
  message,
  isCancelled = false,
  completedCount,
  className,
}) => {
  // Find current phase index
  const currentPhaseIndex = phases.findIndex((p) => p.key === currentPhase);
  const isComplete = currentPhase === 'complete';
  const isIdle = currentPhase === 'idle';

  // TICKET_1070 AC4: compact mode hides labels, shows fraction overlay
  const isCompact = phases.length > COMPACT_MODE_THRESHOLD;

  // TICKET_1070: weighted grid columns
  const gridTemplateColumns = React.useMemo(() => {
    const hasWeights = phases.some(p => p.weight != null && p.weight !== 1);
    if (!hasWeights) return `repeat(${phases.length}, 1fr)`;
    return phases.map(p => `${p.weight ?? 1}fr`).join(' ');
  }, [phases]);

  // Time-based estimation for init phases
  const estimatedProgress = useTimeEstimatedProgress(
    currentPhase,
    currentPhaseIndex >= 0 && currentPhase in PHASE_ESTIMATED_DURATION_MS
  );

  // Determine effective progress for current phase
  const effectiveProgress = currentPhase in PHASE_ESTIMATED_DURATION_MS
    ? estimatedProgress
    : progress;

  // ---------------------------------------------------------------------------
  // TICKET_328_P1: Rolling buffer for CMD-style console tooltip
  // ---------------------------------------------------------------------------
  const bufferRef = useRef<string[]>([]);
  const prevMessageRef = useRef<string>('');
  const prevPhaseRef = useRef<string>('');
  const [bufferLines, setBufferLines] = useState<string[]>([]);

  useEffect(() => {
    // Reset buffer on phase change
    if (currentPhase !== prevPhaseRef.current) {
      bufferRef.current = [];
      prevPhaseRef.current = currentPhase;
      prevMessageRef.current = '';
      setBufferLines([]);
    }
    // Push new unique message
    if (message && message !== prevMessageRef.current) {
      prevMessageRef.current = message;
      const next = [
        ...bufferRef.current.slice(-(TOOLTIP_MAX_LINES - 1)),
        message,
      ];
      bufferRef.current = next;
      setBufferLines(next);
    }
  }, [currentPhase, message]);

  // Tooltip visibility: show when buffer has content
  const showTooltip = currentPhaseIndex >= 0 && bufferLines.length > 0;
  // Active phase label for tooltip header
  const activePhaseLabel = currentPhaseIndex >= 0 ? phases[currentPhaseIndex]?.label : '';

  // Tooltip horizontal position: center of active phase column
  const tooltipLeftPct = phases.length > 0 && currentPhaseIndex >= 0
    ? ((currentPhaseIndex + 0.5) / phases.length) * 100
    : 50;

  if (!visible || isIdle) return null;

  return (
    <div
      className={`flex flex-col gap-1.5 px-4 py-2 ${className || ''}`}
    >
      {/* Relative wrapper for tooltip positioning below grid */}
      <div className="relative">
        {/* CMD Console Tooltip - TICKET_328_P1: Rolling buffer */}
        {showTooltip && (
          <div
            className="absolute top-full z-30 mt-2 animate-pipeline-tooltip-enter"
            style={{
              left: `${tooltipLeftPct}%`,
              transform: 'translateX(-50%)',
            }}
          >
            {/* Upward caret */}
            <div className="flex justify-center">
              <div
                className="w-0 h-0"
                style={{
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderBottom: '5px solid var(--color-terminal-border)',
                }}
              />
            </div>
            <div
              className="min-w-[200px] max-w-[320px] rounded border border-color-terminal-border shadow-lg px-3 py-2"
              style={{
                background: 'color-mix(in srgb, var(--color-terminal-surface) 95%, transparent)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="font-mono text-[11px] leading-relaxed">
                <div className="text-color-terminal-accent-teal font-semibold">{'> '}{activePhaseLabel}</div>
                <div className="mt-0.5 space-y-px">
                  {bufferLines.map((line, i) => (
                    <div
                      key={i}
                      className="text-color-terminal-text-secondary"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TICKET_322: Unified column grid - both rows share same columns */}
        <div
          className="grid"
          style={{ gridTemplateColumns, position: isCompact ? 'relative' : undefined }}
        >
          {/* Row 1: Per-column progress bar segments */}
          {phases.map((phase, i) => {
            let fillPercent = 0;
            // TICKET_374: When cancelled, only fill phases up to and including interrupted phase
            if (isCancelled) {
              if (currentPhaseIndex >= 0 && i < currentPhaseIndex) {
                fillPercent = 100;
              } else if (i === currentPhaseIndex) {
                fillPercent = 100; // Interrupted phase fills fully in red
              }
              // Unreached phases stay at 0
            } else if (isComplete || (currentPhaseIndex >= 0 && i < currentPhaseIndex)) {
              fillPercent = 100;
            } else if (i === currentPhaseIndex) {
              fillPercent = Math.round(effectiveProgress * 100);
            }

            const isActiveNoProgress = !isCancelled && i === currentPhaseIndex && fillPercent === 0;
            // TICKET_374: Use red for interrupted phase when cancelled
            const isInterruptedPhase = isCancelled && i === currentPhaseIndex;
            const barBg = isInterruptedPhase ? BLOCK_BG_CANCELLED : BLOCK_BG;

            return (
              <div
                key={`bar-${phase.key}`}
                className="relative h-1.5 bg-color-terminal-border overflow-hidden"
                style={{
                  borderRadius: i === 0 ? '2px 0 0 2px' : i === phases.length - 1 ? '0 2px 2px 0' : '0',
                }}
              >
                {isActiveNoProgress ? (
                  <div className="pipeline-indeterminate" />
                ) : (
                  <div
                    className="h-full transition-all duration-300 ease-out"
                    style={{
                      width: `${fillPercent}%`,
                      background: fillPercent > 0 ? barBg : 'transparent',
                      borderRadius: i === 0 ? '2px 0 0 2px' : '0',
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Row 2: Phase labels (hidden in compact mode) */}
          {!isCompact && phases.map((phase, i) => {
            // TICKET_374: Cancelled state - interrupted phase in red, unreached in muted
            let state: 'pending' | 'active' | 'completed' | 'interrupted' = 'pending';
            if (isCancelled) {
              if (currentPhaseIndex >= 0 && i < currentPhaseIndex) {
                state = 'completed';
              } else if (i === currentPhaseIndex) {
                state = 'interrupted';
              }
              // Unreached phases stay 'pending'
            } else if (isComplete || (currentPhaseIndex >= 0 && i < currentPhaseIndex)) {
              state = 'completed';
            } else if (i === currentPhaseIndex) {
              state = 'active';
            }

            return (
              <span
                key={`label-${phase.key}`}
                className={`font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap pt-1 transition-all duration-300 ${
                  state === 'completed'
                    ? 'text-color-terminal-accent-teal opacity-100'
                    : state === 'active'
                      ? 'text-color-terminal-accent-teal opacity-100 animate-pipeline-pulse'
                      : state === 'interrupted'
                        ? 'text-red-400 opacity-100'
                        : 'text-color-terminal-text-muted opacity-30'
                }`}
              >
                {phase.label}
              </span>
            );
          })}
        </div>
        {/* TICKET_1070 AC4: compact fraction counter overlay */}
        {isCompact && (
          <div
            data-testid="pipeline-compact-counter"
            className="font-mono text-[11px] font-semibold text-color-terminal-accent-teal pt-1 text-center"
          >
            {completedCount ?? (isComplete ? phases.length : currentPhaseIndex >= 0 ? currentPhaseIndex : 0)}/{phases.length}
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineProgress;
