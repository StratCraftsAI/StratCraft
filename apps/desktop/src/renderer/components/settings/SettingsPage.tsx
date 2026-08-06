/**
 * SettingsPage - Main Settings Container
 *
 * TICKET_046: System-Level Configuration Implementation (Phase 3)
 * TICKET_875: The CONFIG/ADVANCED tab switcher was removed; the useful
 * ADVANCED sections were folded into ConfigSettings' left-nav scroll layout,
 * so Settings is now a single unified page.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { BreadcrumbBar } from '@/components/host';
import { MiniNameplate } from '@/components/common';
// TICKET_300: windowApi breadcrumb removed - breadcrumbs derived from VIEW_REGISTRY
import { ConfigSettings } from './ConfigSettings';

// =============================================================================
// Component
// =============================================================================

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation('settings');

  // TICKET_300: Breadcrumbs auto-derived from VIEW_REGISTRY['settings'].shortLabel = 'SETTINGS'
  // Nameplate always shows SYSTEM for the system settings page.
  const nameplateText = t('sections.system').toUpperCase();

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb Bar with the SYSTEM nameplate centered */}
      <BreadcrumbBar centerContent={<MiniNameplate text={nameplateText} />} />

      {/* Unified settings content (TICKET_875: no tab switcher) */}
      <div className="flex-1 overflow-hidden">
        <ConfigSettings />
      </div>
    </div>
  );
}

export default SettingsPage;
