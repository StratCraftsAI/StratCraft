/**
 * ModeDetailsPanel Component (component22)
 *
 * Mode details display panel showing configuration parameters for the selected preset mode.
 * Displays title with icon, description, and a key-value details table.
 * Hidden when "bespoke" mode is selected.
 *
 * @see TICKET_077_19 - Kronos AI Entry Components
 * @see TICKET_211 - Page 34 - Kronos AI Entry
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TraderPresetMode } from './TraderPresetSelector';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ModeDetail {
  title: string;
  description: string;
  details: Record<string, string>;
}

export interface ModeDetailsPanelProps {
  /** Current mode key */
  mode: TraderPresetMode;
  /** Mode details configuration */
  modeDetails?: Record<TraderPresetMode, ModeDetail>;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Constants - Default Mode Details
// -----------------------------------------------------------------------------

const DEFAULT_MODE_DETAILS: Record<TraderPresetMode, ModeDetail> = {
  baseline: {
    title: 'Baseline Mode',
    description: 'Maximize absolute returns without extra constraints.',
    details: {
      'Core Goal': 'Maximize absolute returns without extra constraints',
      'Risk Tolerance': 'Medium to High (Model decided)',
      'Position Limits': 'None or very loose',
      'Trading Frequency': 'Unlimited (High frequency or long term)',
      'Leverage': '1x (No leverage) or very low',
      'Risk Metrics': 'Sharpe Ratio, Max Drawdown',
      'Decision Inputs': 'Market data, News, Fundamentals',
      'Model Requirements': 'Comprehensive capabilities',
    },
  },
  monk: {
    title: 'Monk Mode',
    description: 'Strict discipline, stability, and risk-adjusted returns.',
    details: {
      'Core Goal': 'Stability and risk-adjusted returns under strict limits',
      'Risk Tolerance': 'Very Low (Mandatory rules)',
      'Position Limits': 'Strict (e.g., <2% per trade, sector limits)',
      'Trading Frequency': 'Very Low (Daily/Weekly caps, forced asceticism)',
      'Leverage': 'Forbidden',
      'Risk Metrics': 'Sortino Ratio, Max Drawdown, Volatility',
      'Decision Inputs': 'Filter short-term noise, focus on long-term trends',
      'Model Requirements': 'Discipline, Patience, Long-term value',
    },
  },
  warrior: {
    title: 'Warrior Mode',
    description: 'Aggressive assault with high leverage and risk.',
    details: {
      'Core Goal': 'Maximize returns through aggressive market engagement',
      'Risk Tolerance': 'Very High (Aggressive pursuit)',
      'Position Limits': 'Flexible (Concentrated positions allowed)',
      'Trading Frequency': 'High (Active market participation)',
      'Leverage': 'High (5x-10x or more)',
      'Risk Metrics': 'Absolute Returns, Recovery Speed',
      'Decision Inputs': 'Real-time data, Momentum, Volatility',
      'Model Requirements': 'Precise execution, Quick adaptation, Stop-loss discipline',
    },
  },
  bespoke: {
    title: 'Bespoke Mode',
    description: 'Fully customized strategy tailored to your specific needs.',
    details: {
      'Core Goal': 'Customized objectives based on user configuration',
      'Risk Tolerance': 'User defined',
      'Position Limits': 'User defined',
      'Trading Frequency': 'User defined',
      'Leverage': 'User defined',
      'Risk Metrics': 'User defined',
      'Decision Inputs': 'User defined',
      'Model Requirements': 'Tailored to specific needs',
    },
  },
};

// -----------------------------------------------------------------------------
// ModeDetailsPanel Component
// -----------------------------------------------------------------------------

export const ModeDetailsPanel: React.FC<ModeDetailsPanelProps> = ({
  mode,
  modeDetails = DEFAULT_MODE_DETAILS,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');

  // Hide panel when bespoke mode is selected
  if (mode === 'bespoke') {
    return null;
  }

  const currentMode = modeDetails[mode];
  if (!currentMode) {
    return null;
  }

  // Get translated title
  const translatedTitle = t(`ui.modeDetails.${mode}Title` as any) || currentMode.title;
  const translatedDesc = t(`ui.modeDetails.${mode}Desc` as any) || currentMode.description;

  const detailEntries = Object.entries(currentMode.details);

  return (
    <div
      className={cn(
        'mode-details-panel',
        'mb-6 p-5',
        'bg-color-terminal-surface',
        'rounded-lg',
        'border border-color-terminal-border',
        className
      )}
    >
      {/* Title with Icon */}
      <h3 className="flex items-center gap-2 text-base font-semibold text-color-terminal-text mb-2">
        <Settings className="w-5 h-5 text-color-terminal-accent-teal" />
        {translatedTitle}
      </h3>

      {/* Description */}
      <p className="text-sm text-color-terminal-text-secondary mb-4 leading-relaxed">
        {translatedDesc}
      </p>

      {/* Details Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {detailEntries.map(([key, value], index) => {
              // TICKET_786_16: Translate detail keys and values via existing i18n keys
              const keyId = key.replace(/\s+/g, '');
              const keyIdCamel = keyId.charAt(0).toLowerCase() + keyId.slice(1);
              const translatedKey = t(`ui.modeDetails.${keyIdCamel}` as any, { defaultValue: key });
              const translatedValue = t(`ui.modeDetails.${mode}${keyId}` as any, { defaultValue: value });
              return (
                <tr
                  key={key}
                  className={cn(
                    index !== detailEntries.length - 1 &&
                      'border-b border-color-terminal-border'
                  )}
                >
                  <th
                    className={cn(
                      'text-left py-2.5 px-3',
                      'text-[13px] font-medium',
                      'text-color-terminal-text-muted',
                      'bg-white/[0.02]',
                      'w-[180px] min-w-[140px]'
                    )}
                  >
                    {translatedKey}
                  </th>
                  <td
                    className={cn(
                      'py-2.5 px-3',
                      'text-[13px]',
                      'text-color-terminal-text'
                    )}
                  >
                    {translatedValue}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ModeDetailsPanel;
