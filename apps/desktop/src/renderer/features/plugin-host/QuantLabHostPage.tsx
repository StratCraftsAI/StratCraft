import React, { useMemo } from 'react';
import { FlaskConical, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MiniNameplate } from '@/components/common';
import { BreadcrumbBar } from '@/components/host';
import { ViewContainer } from '@/components/host/ViewContainer';
import { VIEW_REGISTRY } from '@/config/view-registry';
import { useAppStore } from '@/stores';

const QuantLabPlaceholder: React.FC = () => {
  const { t } = useTranslation('ui');
  const { setActiveView } = useAppStore();

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <FlaskConical className="w-16 h-16 mx-auto mb-6 text-color-terminal-accent-primary opacity-40" />
        <h2 className="text-xl font-semibold text-color-terminal-text mb-3">
          {t('quantLab.title')}
        </h2>
        <p className="text-color-terminal-text-secondary mb-6 leading-relaxed">
          {t('quantLab.pluginDescription')}
        </p>
        <button
          onClick={() => setActiveView('marketplace')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md
                     bg-color-terminal-accent-primary/20 text-color-terminal-accent-primary
                     hover:bg-color-terminal-accent-primary/30 transition-colors
                     border border-color-terminal-accent-primary/30"
        >
          <Package className="w-4 h-4" />
          {t('quantLab.openMarketplace')}
        </button>
      </div>
    </div>
  );
};

export const QuantLabHostPage: React.FC = () => {
  const { t } = useTranslation('ui');
  const breadcrumbRightContent = useMemo(() => {
    const key = VIEW_REGISTRY.quantLab.shortLabelKey;
    const fallback = VIEW_REGISTRY.quantLab.shortLabel ?? '';
    const title = key ? t(key) : fallback;
    return title ? <MiniNameplate text={title} /> : undefined;
  }, [t]);

  return (
    <div className="flex flex-col h-full bg-StratCraftsAI terminal-theme">
      <BreadcrumbBar rightContent={breadcrumbRightContent} />
      <ViewContainer viewId="quantLab.main" fallback={<QuantLabPlaceholder />} />
    </div>
  );
};

export default QuantLabHostPage;
