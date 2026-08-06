import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Package } from 'lucide-react';
import { AccessGate } from '@plugins/strategy-builder-nexus/components/ui/AccessGate';
import { useAppStore } from '@/stores';

export interface EntitlementExpiredBannerProps {
  pluginId: string;
  requiredTier?: string;
  grantedTier?: string;
}

export const EntitlementExpiredBanner: React.FC<EntitlementExpiredBannerProps> = ({
  pluginId: _pluginId,
  requiredTier,
  grantedTier,
}) => {
  const { t } = useTranslation('ui');
  const { setActiveView } = useAppStore();

  const description = requiredTier && grantedTier
    ? t(
        'entitlement.expired.descriptionWithTier',
        'Requires {{required}} tier (current: {{current}}). Upgrade your plan to access this feature.',
        { required: requiredTier.toUpperCase(), current: grantedTier.toUpperCase() },
      )
    : t(
        'entitlement.expired.description',
        'Upgrade your plan or purchase Sigma to use Alpha Factory features.',
      );

  return (
    <AccessGate
      icon={ShieldAlert}
      title={t('entitlement.expired.title', 'Sigma access required')}
      description={description}
      ctaLabel={t('entitlement.expired.cta', 'Get Sigma Access')}
      ctaIcon={Package}
      onAction={() => setActiveView('marketplace')}
      testId="entitlement-expired-banner"
    />
  );
};
