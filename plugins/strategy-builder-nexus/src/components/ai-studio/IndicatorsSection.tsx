/**
 * IndicatorsSection Component
 *
 * Displays technical indicators used by the strategy (read-only).
 * Indicators are tool/data sources, not filter logic.
 *
 * @see TICKET_530 - AI Studio Indicator Display Separation
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CollapsiblePanel } from '../ui/CollapsiblePanel';
import type { StrategyIndicator } from '../../services/vibing-chat-service';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const INDICATOR_CONFIG = {
  default: {
    icon: Activity,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
  },
};

// -----------------------------------------------------------------------------
// Sub-component: IndicatorItem (Internal, Read-only)
// -----------------------------------------------------------------------------

const IndicatorItem: React.FC<{ indicator: StrategyIndicator }> = ({ indicator }) => {
  const config = INDICATOR_CONFIG.default;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg',
        'border transition-colors',
        config.bgColor,
        config.borderColor
      )}
    >
      {/* Icon */}
      <div className={cn('flex-shrink-0 mt-0.5', config.color)}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Indicator Name and Params */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-color-terminal-text">
            {indicator.name}({indicator.params})
          </span>
        </div>

        {/* Description (optional) */}
        {indicator.description && (
          <p className="text-xs text-color-terminal-text-muted leading-relaxed">
            {indicator.description}
          </p>
        )}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export interface IndicatorsSectionProps {
  /** List of technical indicators */
  indicators: StrategyIndicator[];
  /** Additional CSS classes */
  className?: string;
}

export const IndicatorsSection: React.FC<IndicatorsSectionProps> = ({
  indicators,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');

  // Don't render if no indicators
  if (indicators.length === 0) {
    return null;
  }

  return (
    <CollapsiblePanel
      title={t('aiStudio.technicalIndicators')}
      badge={String(indicators.length)}
      defaultExpanded={true}
      className={className}
    >
      <div className="space-y-2">
        {indicators.map((indicator, idx) => (
          <IndicatorItem key={idx} indicator={indicator} />
        ))}
      </div>
    </CollapsiblePanel>
  );
};

export default IndicatorsSection;
