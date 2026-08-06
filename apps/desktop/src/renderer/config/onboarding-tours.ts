/**
 * Onboarding Tour Step Definitions (TICKET_593)
 *
 * Declarative tour configurations consumed by driver.js via useOnboarding hook.
 * Each tour has a unique tourId and an array of steps referencing data-onboarding attributes.
 *
 * Step titles/descriptions use i18n keys resolved at runtime.
 */

import type { DriveStep } from 'driver.js';

// ============================================================================
// Tour Step Factory (i18n-aware)
// ============================================================================

export interface TourDefinition {
  tourId: string;
  steps: (t: (key: string) => string) => DriveStep[];
}

// ============================================================================
// Welcome Tour (Phase 1)
// ============================================================================

export const welcomeTour: TourDefinition = {
  tourId: 'welcome',
  steps: (t) => [
    {
      element: '[data-onboarding="sidebar"]',
      popover: {
        title: t('ui:onboarding.welcome.sidebar.title'),
        description: t('ui:onboarding.welcome.sidebar.description'),
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '[data-onboarding="sidebar-settings"]',
      popover: {
        title: t('ui:onboarding.welcome.settings.title'),
        description: t('ui:onboarding.welcome.settings.description'),
        side: 'right',
        align: 'center',
      },
    },
    {
      element: '[data-onboarding="toolbar-auth"]',
      popover: {
        title: t('ui:onboarding.welcome.auth.title'),
        description: t('ui:onboarding.welcome.auth.description'),
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-onboarding="statusbar-llm"]',
      popover: {
        title: t('ui:onboarding.welcome.llm.title'),
        description: t('ui:onboarding.welcome.llm.description'),
        side: 'top',
        align: 'start',
      },
    },
    {
      element: '[data-onboarding="statusbar-language"]',
      popover: {
        title: t('ui:onboarding.welcome.language.title'),
        description: t('ui:onboarding.welcome.language.description'),
        side: 'top',
        align: 'start',
      },
    },
    {
      popover: {
        title: t('ui:onboarding.welcome.finish.title'),
        description: t('ui:onboarding.welcome.finish.description'),
      },
    },
  ],
};

// ============================================================================
// Tour Registry
// ============================================================================

export const TOUR_REGISTRY: Record<string, TourDefinition> = {
  welcome: welcomeTour,
};
