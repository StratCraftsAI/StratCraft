/**
 * OwnershipBadge Component
 *
 * TICKET_892_4 Step 5: Simplified ownership badge.
 * Replaces BuyoutBadge -- shows "OWNED" (green) when the user has
 * server-authoritative entitlement, nothing otherwise.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';

export interface OwnershipBadgeProps {
  owned: boolean;
  className?: string;
}

const BADGE_BASE = 'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded';
const PALETTE_GREEN = 'bg-green-600/20 text-green-400 border-green-500/30';

export const OwnershipBadge: React.FC<OwnershipBadgeProps> = ({ owned, className = '' }) => {
  const { t } = useTranslation('ui');

  if (!owned) return null;

  return (
    <span className={`${BADGE_BASE} ${PALETTE_GREEN} ${className}`}>
      <CheckCircle className="h-3 w-3" />
      {t('entitlement.ownership.badge.owned')}
    </span>
  );
};

export default OwnershipBadge;
