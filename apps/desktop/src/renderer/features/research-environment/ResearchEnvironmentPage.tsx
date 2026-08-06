/**
 * TICKET_1335_1 -- Research Environment manager page.
 *
 * D2: a registered host view reached from the bottom system-tool rail, whose
 * nameplate reads SYSTEM (matching Settings) while the heading identifies the
 * page. It is a PEER of Settings, not a section inside it.
 *
 * This page owns presentation only. Parent TICKET_1335 owns the locked
 * `pixi.toml` + `pixi.lock` pair, `ResearchEnvironmentService`, install
 * exclusion, durable jobs, and exact-interpreter verification. Nothing here
 * runs Pixi, pip, Python, Julia, or a shell, and nothing infers readiness from
 * the filesystem -- every state shown is the service's own verdict, read
 * through the preload bridge.
 *
 * Phase 3 composes the summary, per-capability cards, and job progress panel on
 * top of the Phase 2 store. The composition rule is that this file decides
 * LAYOUT only: which action is offered, which card is blamed, and whether an
 * operation is running are all decided by the shared contract and read back
 * through selectors, never re-derived here.
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RESEARCH_CAPABILITIES, type ResearchEnvironmentOperation } from '@StratCraft/types';
import { BreadcrumbBar } from '@/components/host';
import { MiniNameplate } from '@/components/common';
import {
  selectCapabilityCards,
  selectFailure,
  selectIsBusy,
  selectPrimaryAction,
  useResearchEnvironmentStore,
} from '@/stores/useResearchEnvironmentStore';
import { EnvironmentSummary } from './components/EnvironmentSummary';
import { EnvironmentFailurePanel } from './components/EnvironmentFailurePanel';
import { EnvironmentJobProgress } from './components/EnvironmentJobProgress';
import { ResearchCapabilityCard } from './components/ResearchCapabilityCard';
import { environmentAnnouncement, isApprovalDeclined } from './presentation';

export function ResearchEnvironmentPage(): JSX.Element {
  const { t } = useTranslation('ui');
  // D2: the nameplate reads SYSTEM, exactly as SettingsPage derives it, because
  // this page is that page's peer in the system-tool zone. Reusing the same key
  // rather than a literal keeps the two from drifting apart in translation.
  const { t: tSettings } = useTranslation('settings');

  const hydrate = useResearchEnvironmentStore((s) => s.hydrate);
  const requestInstall = useResearchEnvironmentStore((s) => s.requestInstall);
  const requestRepair = useResearchEnvironmentStore((s) => s.requestRepair);
  const requestVerify = useResearchEnvironmentStore((s) => s.requestVerify);
  const requestUninstall = useResearchEnvironmentStore((s) => s.requestUninstall);
  const requestRemoveGpquant = useResearchEnvironmentStore((s) => s.requestRemoveGpquant);
  const status = useResearchEnvironmentStore((s) => s.status);
  const job = useResearchEnvironmentStore((s) => s.job);
  const requestError = useResearchEnvironmentStore((s) => s.requestError);
  const primaryAction = useResearchEnvironmentStore(selectPrimaryAction);
  const isBusy = useResearchEnvironmentStore(selectIsBusy);
  const failure = useResearchEnvironmentStore(selectFailure);
  const capabilityCards = useResearchEnvironmentStore(selectCapabilityCards);

  /**
   * One read on mount. This is also the reconnect path: if a job is already
   * running -- started before this page mounted, or before the renderer
   * reloaded -- `hydrate` finds it through the status payload's `activeJobId`
   * and resumes following it (AC6 / AC6a). The store keeps polling if the user
   * navigates away, so coming back does not restart anything.
   */
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /**
   * Route the one offered action to the one matching parent operation.
   *
   * Exhaustive over `ResearchEnvironmentOperation` rather than defaulting, so a
   * new operation added to the shared tuple fails to compile here instead of
   * silently falling through to install -- which is the direction that would do
   * damage.
   */
  const handleAction = (operation: ResearchEnvironmentOperation): void => {
    switch (operation) {
      case 'install':
        void requestInstall();
        return;
      case 'repair':
        void requestRepair();
        return;
      case 'verify':
        void requestVerify();
        return;
      case 'uninstall':
        void requestUninstall();
        return;
      case 'remove_capability':
        void requestRemoveGpquant();
        return;
      case 'restore_capability':
        void requestInstall();
    }
  };

  const declined = isApprovalDeclined(requestError);

  /**
   * AC11: the one page-level live region.
   *
   * A screen-reader user gets no state badge flipping colour and no progress
   * panel appearing, so the transitions that matter -- an operation starting,
   * and above all a multi-minute install ENDING -- are spoken here. It is
   * `polite` rather than `assertive` because none of these interrupt a task the
   * user is in the middle of; and it is ONE region rather than several, so two
   * simultaneous changes cannot talk over each other.
   *
   * The decision of WHAT to announce lives in `environmentAnnouncement`, which
   * returns a key rather than a sentence, keeping the wording localized and the
   * decision testable without a DOM.
   */
  const announcement = environmentAnnouncement(status, job);

  return (
    <div className="h-full flex flex-col terminal-theme bg-StratCraftsAI">
      <BreadcrumbBar
        centerContent={
          <MiniNameplate text={tSettings('sections.system').toUpperCase()} />
        }
      />

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
        <h1
          id="research-environment-heading"
          className="text-sm font-bold uppercase tracking-wider text-gray-200"
        >
          {t('viewRegistry.researchEnvironment.label')}
        </h1>

        {/*
          Visually hidden, not `display: none` -- a hidden live region is not
          announced at all. `aria-atomic` makes the whole sentence re-read on
          change rather than only the words that differ.
        */}
        <div
          data-testid="environment-live-region"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {/*
            `values.operation` is itself a translation KEY, resolved here rather
            than in `environmentAnnouncement` so that function stays free of the
            i18n runtime and testable without one.
          */}
          {announcement
            ? t(
                announcement.key,
                announcement.values
                  ? { operation: t(announcement.values.operation) }
                  : undefined,
              )
            : ''}
        </div>

        {requestError && (
          <div
            // A decline is informational, not an alert -- `role="alert"` would
            // interrupt a screen reader to announce that nothing happened.
            role={declined ? 'status' : 'alert'}
            data-testid={declined ? 'approval-declined-notice' : 'request-error'}
            className={`px-3 py-2 border text-[12px] rounded-[6px] ${
              declined
                ? 'border-gray-500/30 bg-gray-500/10 text-gray-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {declined
              ? t('researchEnvironment.approvalDeclined')
              : requestError.message}
          </div>
        )}

        {/*
          `status === null` is "not yet known", which the store keeps distinct
          from `absent` on purpose: rendering an Install button before the first
          read resolves would offer a CLICKABLE answer to a question nobody has
          answered yet.
        */}
        {status === null ? (
          <p data-testid="environment-loading" className="text-[11px] text-gray-500">
            {t('researchEnvironment.loading')}
          </p>
        ) : (
          <>
            <EnvironmentSummary
              status={status}
              primaryAction={primaryAction}
              isBusy={isBusy}
              onAction={handleAction}
            />

            {status.state === 'ready' && !isBusy && (
              <button
                type="button"
                data-testid="environment-uninstall-action"
                onClick={() => handleAction('uninstall')}
                className="self-start px-3 py-1.5 rounded-[6px] border border-red-500/40 bg-red-500/10 text-[11px] text-red-200 hover:bg-red-500/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
              >
                {t('researchEnvironment.actions.uninstall')}
              </button>
            )}

            {/*
              The environment-level failure panel. A `verification_failed`
              failure is ALSO rendered inside the card it blames, which is not
              duplication: the panel says the environment is failed and why, and
              the card says which package is responsible. Suppressing either one
              would leave a user looking at the wrong half of the answer.
            */}
            {failure && <EnvironmentFailurePanel failure={failure} />}

            {job && isBusy && <EnvironmentJobProgress job={job} />}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/*
                Order comes from `selectCapabilityCards`, which iterates the
                shared `RESEARCH_CAPABILITIES` tuple rather than object keys, so
                a capability added upstream appears here with no edit (AC3).
              */}
              {capabilityCards.map((card) => (
                <ResearchCapabilityCard
                  key={card.capability}
                  capability={card.capability}
                  status={card.status}
                  failure={failure}
                />
              ))}
            </div>

            {/*
              D3: these packages share ONE locked environment, so there is no
              per-package install. Saying so is what keeps the absence of those
              buttons legible as a contract rather than as a missing feature.
            */}
            <p className="text-[11px] text-gray-500">
              {t('researchEnvironment.sharedEnvironmentNotice', {
                count: RESEARCH_CAPABILITIES.length,
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ResearchEnvironmentPage;
