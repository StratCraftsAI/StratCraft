/**
 * FloatingMonitor Component
 *
 * Draggable, collapsible floating panel for real-time progress monitoring.
 * Generic overlay: domain-specific wiring happens in the host consumer.
 *
 * @see TICKET_077_28 - FloatingMonitor Specification
 * @see TICKET_897 - Sweep Progress Floating Monitor
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface FloatingMonitorGauge {
  /** Stable identity for React keys (must be unique within the gauges array) */
  id: string;
  /** Gauge label (e.g. "CPU", "MEM") -- display text, not an identity */
  label: string;
  /** Value 0-100 */
  value: number;
  /** Formatted display (e.g. "68%" or "4.2 / 16 GB") */
  displayValue: string;
}

export interface FloatingMonitorCounter {
  /** Stable identity for React keys (must be unique within the counters array) */
  id: string;
  /** Counter label (e.g. "Succeeded") -- display text, not an identity */
  label: string;
  /** Numeric value */
  value: number;
  /** Visual variant */
  variant?: 'default' | 'success' | 'error' | 'info';
}

export interface FloatingMonitorAction {
  /** Button label (e.g. "Stop Sweep") */
  label: string;
  /** Click handler */
  onClick: () => void;
  /** Button variant */
  variant?: 'danger' | 'default';
  /** Disabled state */
  disabled?: boolean;
}

export interface FloatingMonitorProps {
  /** Panel title */
  title: string;
  /** Whether the monitor is visible */
  visible: boolean;
  /** Controlled expanded state */
  expanded?: boolean;
  /** Expand/collapse callback */
  onExpandedChange?: (expanded: boolean) => void;
  /** Dismiss callback (hides the monitor) */
  onDismiss?: () => void;
  /** Primary progress 0.0-1.0 */
  progress: number;
  /** Progress label (e.g. "12/663 arms") */
  progressLabel: string;
  /** Status line below progress bar */
  statusLine?: string;
  /** Secondary info lines (e.g. phase label, training cores) */
  detailLines?: string[];
  /** Resource gauges to display */
  gauges?: FloatingMonitorGauge[];
  /** Summary counters */
  counters?: FloatingMonitorCounter[];
  /** Primary action button */
  action?: FloatingMonitorAction;
  /** Collapsed pill content (falls back to progressLabel if not provided) */
  pillLabel?: string;
  /** Whether the task is complete (shows check icon instead of spinner) */
  complete?: boolean;
  /** z-index for the fixed-position panel */
  zIndex?: number;
  /** Additional CSS classes */
  className?: string;
  /** Test hook */
  testId?: string;
  /** Additional content rendered after the action button (expanded view only) */
  children?: React.ReactNode;
}

// -----------------------------------------------------------------------------
// Icons (inline SVG -- no external dependency)
// -----------------------------------------------------------------------------

const SpinnerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const MinimizeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
);

const MaximizeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);

// -----------------------------------------------------------------------------
// Gauge bar sub-component
// -----------------------------------------------------------------------------

const GaugeBar: React.FC<{ gauge: FloatingMonitorGauge }> = ({ gauge }) => (
  <div className="flex items-center gap-2 text-[11px] font-mono">
    <span className="w-8 text-color-terminal-text-muted shrink-0">{gauge.label}</span>
    <div className="flex-1 h-2.5 bg-color-terminal-border/40 rounded-sm overflow-hidden">
      <div
        className={cn(
          'h-full rounded-sm transition-all duration-500',
          gauge.value > 90
            ? 'bg-red-500'
            : gauge.value > 70
              ? 'bg-color-terminal-accent-gold'
              : 'bg-color-terminal-accent-teal',
        )}
        style={{ width: `${Math.min(100, Math.max(0, gauge.value))}%` }}
      />
    </div>
    <span className="w-20 text-right text-color-terminal-text-muted shrink-0">
      {gauge.displayValue}
    </span>
  </div>
);

// -----------------------------------------------------------------------------
// Counter variant styles
// -----------------------------------------------------------------------------

const counterColor: Record<string, string> = {
  default: 'text-color-terminal-text-muted',
  success: 'text-green-400',
  error: 'text-red-400',
  info: 'text-blue-400',
};

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const FloatingMonitor: React.FC<FloatingMonitorProps> = ({
  title,
  visible,
  expanded: controlledExpanded,
  onExpandedChange,
  onDismiss,
  progress,
  progressLabel,
  statusLine,
  detailLines,
  gauges,
  counters,
  action,
  pillLabel,
  complete = false,
  zIndex,
  className,
  testId,
  children,
}) => {
  const { t } = useTranslation('strategy-builder');
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isControlled = controlledExpanded !== undefined;
  const isExpanded = isControlled ? controlledExpanded : internalExpanded;

  // ---- drag state ----
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleToggle = useCallback(() => {
    const next = !isExpanded;
    if (!isControlled) setInternalExpanded(next);
    onExpandedChange?.(next);
  }, [isExpanded, isControlled, onExpandedChange]);

  // ---- drag handlers (title bar only) ----
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setOffset({ x: dragState.current.origX + dx, y: dragState.current.origY + dy });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  // Reset drag offset when hidden so next show starts anchored
  useEffect(() => {
    if (!visible) setOffset({ x: 0, y: 0 });
  }, [visible]);

  if (!visible) return null;

  const clampedProgress = Math.min(1, Math.max(0, progress));

  // ---- collapsed pill ----
  if (!isExpanded) {
    return (
      <div
        ref={panelRef}
        data-testid={testId ? `${testId}-pill` : undefined}
        className={cn(
          'fixed top-3 right-3',
          'flex items-center gap-2 px-3 py-1.5 rounded-full',
          'bg-color-terminal-surface border border-color-terminal-border',
          'shadow-lg backdrop-blur-sm',
          'font-mono text-[11px] text-color-terminal-text',
          'cursor-default select-none',
          className,
        )}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, zIndex }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {complete ? (
          <CheckIcon className="w-3.5 h-3.5 text-green-500 shrink-0" />
        ) : (
          <SpinnerIcon className="w-3.5 h-3.5 text-color-terminal-accent-teal animate-spin shrink-0" />
        )}
        <span className="text-color-terminal-accent-gold">{pillLabel ?? progressLabel}</span>
        {statusLine && (
          <span className="text-color-terminal-text-muted">({statusLine})</span>
        )}
        {action && !action.disabled && (
          <button
            type="button"
            onClick={action.onClick}
            className="p-0.5 rounded hover:bg-red-500/20 transition-colors text-red-400"
            title={action.label}
          >
            <StopIcon className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          onClick={handleToggle}
          className="p-0.5 rounded hover:bg-white/10 transition-colors text-color-terminal-text-muted"
          title={t('floatingMonitor.action.expand')}
        >
          <MaximizeIcon className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ---- expanded panel ----
  return (
    <div
      ref={panelRef}
      data-testid={testId}
      className={cn(
        'fixed top-3 right-3',
        'w-80 rounded-lg overflow-hidden',
        'bg-color-terminal-surface border border-color-terminal-border',
        'shadow-xl backdrop-blur-sm',
        'font-mono text-[11px]',
        'select-none',
        className,
      )}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, zIndex }}
    >
      {/* Title bar -- draggable */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-color-terminal-panel border-b border-color-terminal-border cursor-move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="flex items-center gap-2">
          {complete ? (
            <CheckIcon className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <SpinnerIcon className="w-3.5 h-3.5 text-color-terminal-accent-teal animate-spin" />
          )}
          <span className="text-[12px] font-bold text-color-terminal-text">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggle}
            className="p-0.5 rounded hover:bg-white/10 transition-colors text-color-terminal-text-muted"
            title={t('floatingMonitor.action.collapse')}
          >
            <MinimizeIcon className="w-3.5 h-3.5" />
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-0.5 rounded hover:bg-white/10 transition-colors text-color-terminal-text-muted"
              title={t('floatingMonitor.action.dismiss')}
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2.5">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-color-terminal-accent-gold">{progressLabel}</span>
          </div>
          <div className="h-2 bg-color-terminal-border/40 rounded-sm overflow-hidden">
            <div
              className={cn(
                'h-full rounded-sm transition-all duration-500',
                complete ? 'bg-green-500' : 'bg-color-terminal-accent-teal',
              )}
              style={{
                width: `${clampedProgress * 100}%`,
                backgroundImage: complete
                  ? undefined
                  : 'repeating-linear-gradient(90deg, currentColor 0px, currentColor 8px, transparent 8px, transparent 10px)',
              }}
            />
          </div>
        </div>

        {/* Status line (ETA + throughput) */}
        {statusLine && (
          <div className="text-color-terminal-text-muted">{statusLine}</div>
        )}

        {/* Detail lines (phase, training cores, etc.) */}
        {detailLines && detailLines.length > 0 && (
          <div className="space-y-0.5">
            {detailLines.map((line, i) => (
              <div key={i} className="text-color-terminal-text">{line}</div>
            ))}
          </div>
        )}

        {/* Gauges */}
        {gauges && gauges.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-color-terminal-border/50">
            {gauges.map((g) => (
              <GaugeBar key={g.id} gauge={g} />
            ))}
          </div>
        )}

        {/* Counters */}
        {counters && counters.length > 0 && (
          <div className="flex items-center gap-3 pt-1 border-t border-color-terminal-border/50">
            {counters.map((c) => (
              <span key={c.id} className={counterColor[c.variant ?? 'default']}>
                {c.label}: <span className="text-color-terminal-text">{c.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* Action button */}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(
              'w-full py-1.5 rounded text-[11px] font-bold uppercase tracking-wider',
              'border transition-colors',
              action.disabled
                ? 'border-color-terminal-border/30 text-color-terminal-text-muted/40 cursor-not-allowed'
                : action.variant === 'danger'
                  ? 'border-red-500/60 text-red-400 hover:bg-red-500/10'
                  : 'border-color-terminal-border text-color-terminal-text hover:bg-white/5',
            )}
          >
            {action.label}
          </button>
        )}

        {/* Extended content (queue sections, etc.) */}
        {children}
      </div>
    </div>
  );
};

export default FloatingMonitor;
