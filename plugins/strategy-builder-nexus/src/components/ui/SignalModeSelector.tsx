/**
 * SignalModeSelector Component
 *
 * Signal mode selector for auto-reverse feature.
 * Uses SegmentedControl styling from TICKET_077.
 *
 * @see TICKET_260 - Regime Detector vs Entry Responsibility Clarification
 * @see TICKET_077 - StratCraftsAI UI Component Library (SegmentedControl)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Signal mode type
 * - auto-reverse: Automatically generate reverse condition
 * - manual: User defines both conditions separately
 */
export type SignalMode = 'auto-reverse' | 'manual';

/**
 * Context type determines description text
 * - detector: Range = inverse of Trend
 * - entry: Short = inverse of Long
 */
export type SignalModeContext = 'detector' | 'entry';

export interface SignalModeSelectorProps {
  /** Current signal mode value */
  value: SignalMode;
  /** Callback when mode changes */
  onChange: (mode: SignalMode) => void;
  /** Context determines description text */
  context: SignalModeContext;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const SignalModeSelector: React.FC<SignalModeSelectorProps> = ({
  value,
  onChange,
  context,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');

  const autoReverseTooltip = t(`ui.signalModeSelectorLabels.${context}AutoReverse`);
  const manualTooltip = t(`ui.signalModeSelectorLabels.${context}Manual`);

  return (
    <div className={cn('space-y-1', className)}>
      {/* Label */}
      <label className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
        {t('ui.signalModeSelectorLabels.title')}
      </label>

      {/* Segmented Control */}
      <div className="inline-flex border border-dashed border-white/20 rounded">
        {/* Auto-Reverse Button */}
        <button
          type="button"
          title={autoReverseTooltip}
          onClick={() => onChange('auto-reverse')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 transition-all duration-200 rounded-l',
            'border-r border-dashed border-white/20',
            value === 'auto-reverse'
              ? 'bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal'
              : 'bg-transparent text-color-terminal-text-muted hover:text-color-terminal-accent-teal hover:bg-white/5'
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider">{t('ui.signalModeSelectorLabels.autoReverse')}</span>
        </button>

        {/* Manual Button */}
        <button
          type="button"
          title={manualTooltip}
          onClick={() => onChange('manual')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 transition-all duration-200 rounded-r',
            value === 'manual'
              ? 'bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal'
              : 'bg-transparent text-color-terminal-text-muted hover:text-color-terminal-accent-teal hover:bg-white/5'
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider">{t('ui.signalModeSelectorLabels.manual')}</span>
        </button>
      </div>
    </div>
  );
};

export default SignalModeSelector;
