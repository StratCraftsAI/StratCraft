/**
 * LockedPagePlaceholder Component
 *
 * TICKET_105: Plugin Feature Gating UI
 * TICKET_892_4: Simplified -- no buyout-specific props, "SIGN UP FREE" copy.
 */

import React from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TierBadge, { type TierLevel } from './TierBadge';
import { WEBSITE_PRICING_URL } from '@StratCraft/types';

export interface LockedPagePlaceholderProps {
  serviceName: string;
  tier: TierLevel;
  description?: string;
  onLogin?: () => void;
  onViewPlans?: () => void;
  userHasEnabled?: boolean;
}

export const LockedPagePlaceholder: React.FC<LockedPagePlaceholderProps> = ({
  serviceName,
  tier,
  description,
  onLogin,
  onViewPlans,
  userHasEnabled,
}) => {
  const { t } = useTranslation('ui');
  const handleViewPlans = () => {
    if (onViewPlans) {
      onViewPlans();
    } else {
      window.electronAPI?.marketplace?.openPurchaseUrl(WEBSITE_PRICING_URL);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-8">
      <div className="mb-8 opacity-20">
        <Lock className="w-24 h-24 text-white" strokeWidth={1.5} />
      </div>

      <h2 className="text-2xl font-bold mb-3 text-white/70 text-center">
        {serviceName}
      </h2>

      <div className="mb-4">
        <TierBadge tier={tier} />
      </div>

      {description && (
        <p className="text-white/50 mb-8 text-center max-w-md">
          {description}
        </p>
      )}

      {!description && (
        <p className="text-white/40 mb-8 text-center max-w-md">
          {t('locked.requiresTier', { tier: tier.toUpperCase() })}
        </p>
      )}

      {userHasEnabled && (
        <div className="mb-6 px-4 py-3 bg-blue-600/10 border border-blue-500/30 rounded max-w-md">
          <p className="text-blue-400 text-sm">
            {t('locked.serviceEnabled', { tier: tier.toUpperCase() })}
          </p>
        </div>
      )}

      <div className="flex gap-4">
        {onLogin && (
          <button
            onClick={onLogin}
            className="px-6 py-2.5 bg-color-terminal-accent-primary text-black font-medium rounded
                     hover:bg-color-terminal-accent-primary/90 transition-colors"
          >
            {t('auth.signUpFree', 'Sign Up Free')}
          </button>
        )}

        <button
          onClick={handleViewPlans}
          className="px-6 py-2.5 border border-white/20 text-white/80 font-medium rounded
                   hover:border-white/30 hover:bg-white/5 transition-colors"
        >
          {t('auth.viewPlans')}
        </button>
      </div>

      <div className="mt-12 text-center text-white/30 text-sm">
        <p>{t('auth.needHelp')}</p>
      </div>
    </div>
  );
};

export default LockedPagePlaceholder;
