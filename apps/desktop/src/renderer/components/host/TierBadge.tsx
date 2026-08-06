/**
 * TierBadge Component
 *
 * TICKET_105: Plugin Feature Gating UI
 *
 * Displays service tier badges (FREE, BASIC, PRO, GOLD) with consistent styling.
 * TICKET_704: Added BASIC tier for basic plan users with BYOK keys.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

// =============================================================================
// Types
// =============================================================================

export type TierLevel = 'free' | 'basic' | 'pro' | 'gold';

export interface TierBadgeProps {
  tier: TierLevel;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const TierBadge: React.FC<TierBadgeProps> = ({ tier, className = '' }) => {
  const { t } = useTranslation('ui');

  const colors = {
    free: 'bg-green-600/20 text-green-400 border-green-500/30',
    basic: 'bg-cyan-600/20 text-cyan-400 border-cyan-500/30',
    pro: 'bg-blue-600/20 text-blue-400 border-blue-500/30',
    gold: 'bg-yellow-600/20 text-yellow-400 border-yellow-500/30',
  };

  const colorClass = colors[tier] || colors.free;

  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-xs font-medium border rounded ${colorClass} ${className}`}
    >
      {t(`tier.${tier}`)}
    </span>
  );
};

export default TierBadge;
