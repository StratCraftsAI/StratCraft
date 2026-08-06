/**
 * TimeRangeSelector Component
 *
 * Time range selection component with radio options
 * and conditional datetime picker.
 *
 * @see TICKET_077_17 - TimeRangeSelector Specification
 * @see TICKET_077 - StratCraftsAI UI Component Library (component17)
 */

import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type TimeRangeMode = 'latest' | 'custom';

export interface TimeRangeSelectorProps {
  /** Component title (default: "TIME RANGE") */
  title?: string;
  /** Current mode */
  mode: TimeRangeMode;
  /** Custom start time value (ISO format: "YYYY-MM-DDTHH:mm") */
  customTime?: string;
  /** Mode change callback */
  onModeChange: (mode: TimeRangeMode) => void;
  /** Custom time change callback */
  onTimeChange: (time: string) => void;
  /** Radio option labels */
  labels?: {
    latest?: string;
    custom?: string;
  };
  /** Datetime input label */
  timeInputLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Default Props
// -----------------------------------------------------------------------------

const DEFAULT_TITLE = 'TIME RANGE';
const DEFAULT_LABELS = {
  latest: 'Use Latest Data',
  custom: 'Custom Start Time',
};
const DEFAULT_TIME_INPUT_LABEL = 'Start Time';

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/** Get current datetime in local ISO format for datetime-local input */
function getCurrentDateTimeLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  title,
  mode,
  customTime,
  onModeChange,
  onTimeChange,
  labels = DEFAULT_LABELS,
  timeInputLabel = DEFAULT_TIME_INPUT_LABEL,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const mergedLabels = { ...DEFAULT_LABELS, ...labels };
  const componentTitle = title || t('ui.timeRangeSelector.title');
  const latestLabel = mergedLabels.latest || t('ui.timeRangeSelector.latestLabel');
  const customLabel = mergedLabels.custom || t('ui.timeRangeSelector.customLabel');
  const timeInputLbl = timeInputLabel || t('ui.timeRangeSelector.timeInputLabel');

  // Set default custom time when switching to custom mode
  useEffect(() => {
    if (mode === 'custom' && !customTime) {
      onTimeChange(getCurrentDateTimeLocal());
    }
  }, [mode, customTime, onTimeChange]);

  // Handle mode change
  const handleModeChange = useCallback(
    (newMode: TimeRangeMode) => {
      onModeChange(newMode);
    },
    [onModeChange]
  );

  // Handle time change
  const handleTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onTimeChange(e.target.value);
    },
    [onTimeChange]
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Title */}
      <h3 className="font-mono text-sm font-bold uppercase tracking-widest text-color-terminal-accent-gold">
        {componentTitle}
      </h3>

      {/* Radio Options */}
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={componentTitle}>
        {/* Latest Option */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <div
            className={cn(
              'w-[18px] h-[18px] rounded-full border-2',
              'flex items-center justify-center',
              'transition-colors duration-200',
              mode === 'latest'
                ? 'border-color-terminal-accent-teal'
                : 'border-color-terminal-border'
            )}
          >
            {mode === 'latest' && (
              <div className="w-2 h-2 rounded-full bg-color-terminal-accent-teal" />
            )}
          </div>
          <input
            type="radio"
            name="time-range-mode"
            value="latest"
            checked={mode === 'latest'}
            onChange={() => handleModeChange('latest')}
            className="sr-only"
          />
          <span className="text-[13px] text-color-terminal-text">
            {latestLabel}
          </span>
        </label>

        {/* Custom Option */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <div
            className={cn(
              'w-[18px] h-[18px] rounded-full border-2',
              'flex items-center justify-center',
              'transition-colors duration-200',
              mode === 'custom'
                ? 'border-color-terminal-accent-teal'
                : 'border-color-terminal-border'
            )}
          >
            {mode === 'custom' && (
              <div className="w-2 h-2 rounded-full bg-color-terminal-accent-teal" />
            )}
          </div>
          <input
            type="radio"
            name="time-range-mode"
            value="custom"
            checked={mode === 'custom'}
            onChange={() => handleModeChange('custom')}
            className="sr-only"
          />
          <span className="text-[13px] text-color-terminal-text">
            {customLabel}
          </span>
        </label>
      </div>

      {/* Custom Time Picker */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200',
          mode === 'custom' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-1 pl-7">
            <label className="block text-xs font-medium text-color-terminal-text-secondary mb-1.5">
              {timeInputLbl}
            </label>
            <input
              type="datetime-local"
              value={customTime || ''}
              onChange={handleTimeChange}
              className={cn(
                'w-full max-w-[260px]',
                'px-3.5 py-2.5',
                'border border-color-terminal-border rounded',
                'bg-color-terminal-surface text-color-terminal-text',
                'font-mono text-[13px]',
                'focus:outline-none focus:border-color-terminal-accent-teal',
                'transition-colors duration-200',
                // Dark theme calendar picker icon
                '[&::-webkit-calendar-picker-indicator]:invert',
                '[&::-webkit-calendar-picker-indicator]:cursor-pointer'
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimeRangeSelector;
