/**
 * TICKET_1335_1 Phase 3 -- one readiness card per locked capability (AC3).
 *
 * The card set is rendered by iterating the shared runtime tuple
 * `RESEARCH_CAPABILITIES` (see the page), not by enumerating a TypeScript union,
 * which is erased at runtime. This component renders ONE member of that tuple.
 *
 * WHAT THIS CARD DELIBERATELY DOES NOT HAVE:
 * - No per-package Install button (AC4/D3). These packages share one locked
 *   environment and one compatible numerical stack; a per-card install would
 *   misrepresent the contract and recreate the dependency drift TICKET_1335
 *   exists to remove. The only actions are environment-level, in the summary.
 * - No factor-catalog activation state (AC15/D6b). Engine Store governs whether
 *   a catalog is active; this page governs whether the environment behind it is
 *   ready. Neither surface reports the other's state, and the `pandas_ta` card
 *   is the single owner of `pandas-ta` readiness.
 * - No parsing of `failure.message` or `failure.remediation` (AC7). Which card
 *   is blamed, and what row inside it is blamed, is decided from the structured
 *   `capability` / `stage` / `cause` fields alone.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ResearchCapability,
  ResearchCapabilityStatus,
  ResearchEnvironmentFailure,
} from '@StratCraft/types';
import {
  PYSR_CAPABILITY,
  PYSR_LAYERS,
  capabilityFailure,
  pysrLayerState,
} from '../presentation';

export interface ResearchCapabilityCardProps {
  capability: ResearchCapability;
  status: ResearchCapabilityStatus;
  /**
   * The environment-level failure, or null. Passed whole and unparsed; the card
   * decides whether it is the blamed one by comparing `failure.capability`.
   */
  failure: ResearchEnvironmentFailure | null;
}

const STATE_CLASS: Record<string, string> = {
  ready: 'text-green-400 border-green-500/30 bg-green-500/10',
  failed: 'text-red-300 border-red-500/30 bg-red-500/10',
  installing: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  repairing: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  verifying: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  absent: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
  pending: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
};

function StateBadge({
  state,
  label,
  accessibleLabel,
}: {
  state: string;
  label: string;
  /**
   * AC11: what a screen reader hears instead of the bare state word. The badge
   * says "Failed"; only its position says failed AT WHAT, and position is
   * exactly what a screen reader does not convey.
   */
  accessibleLabel: string;
}): JSX.Element {
  return (
    <span
      data-testid={`capability-state-${state}`}
      aria-label={accessibleLabel}
      className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${
        STATE_CLASS[state] ?? STATE_CLASS.absent
      }`}
    >
      {label}
    </span>
  );
}

export function ResearchCapabilityCard({
  capability,
  status,
  failure,
}: ResearchCapabilityCardProps): JSX.Element {
  const { t } = useTranslation('ui');
  const blamedFailure = capabilityFailure(failure, capability);
  const name = t(`researchEnvironment.capabilities.${capability}.name`);
  const headingId = `research-capability-heading-${capability}`;

  return (
    // AC11: a named landmark per card, so a screen-reader user can move between
    // capabilities directly instead of reading every card linearly to find the
    // failed one. The name comes from the heading via `aria-labelledby` rather
    // than a duplicated `aria-label`, so the two cannot drift.
    <section
      data-testid={`research-capability-card-${capability}`}
      aria-labelledby={headingId}
      // TICKET_910 tier A (filled): cards are the primary content of this page.
      className="border rounded-[6px] p-3 flex flex-col gap-2 border-[#233554] bg-[#112240]"
    >
      <div className="flex items-center justify-between gap-2">
        {/*
          A real heading rather than a styled span: heading navigation is how a
          screen-reader user skims a page, and a card whose title is a `<span>`
          is invisible to it.
        */}
        <h2 id={headingId} className="text-[12px] font-semibold text-gray-200">
          {name}
        </h2>
        <StateBadge
          state={status.state}
          label={t(`researchEnvironment.states.${status.state}`)}
          accessibleLabel={t('researchEnvironment.a11y.capabilityState', {
            capability: name,
            state: t(`researchEnvironment.states.${status.state}`),
          })}
        />
      </div>

      <p className="text-[11px] text-gray-500">
        {t(`researchEnvironment.capabilities.${capability}.description`)}
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-gray-500">{t('researchEnvironment.capability.expected')}</dt>
        <dd data-testid={`capability-expected-${capability}`} className="text-gray-300 font-mono">
          {status.expected}
        </dd>
        <dt className="text-gray-500">{t('researchEnvironment.capability.installed')}</dt>
        <dd data-testid={`capability-installed-${capability}`} className="text-gray-300 font-mono">
          {/*
            An absent version is rendered as an explicit dash rather than an
            empty cell: "not verified yet" and "verified as blank" must not look
            the same. The shared schema only permits `installed` to be missing
            while the environment is not `ready`.
          */}
          {status.installed ?? t('researchEnvironment.capability.notInstalled')}
        </dd>
      </dl>

      {capability === PYSR_CAPABILITY && (
        <div
          data-testid="pysr-layers"
          // TICKET_910: nested inside a filled card, so the child alternates to
          // the outline tier.
          className="border rounded-[6px] p-2 flex flex-col gap-1 border-[#233554]"
        >
          {PYSR_LAYERS.map((layer) => {
            const layerState = pysrLayerState(status, failure, layer);
            const layerName = t(`researchEnvironment.pysr.${layer}`);
            return (
              <div
                key={layer}
                data-testid={`pysr-layer-${layer}`}
                data-state={layerState}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-[11px] text-gray-400">{layerName}</span>
                <StateBadge
                  state={layerState}
                  label={t(`researchEnvironment.layerStates.${layerState}`)}
                  // AC8 is a claim about what the user can DISTINGUISH. Two
                  // badges reading "Ready" and "Not verified" in sequence are
                  // distinguishable only by the row they sit in, so each names
                  // its own layer.
                  accessibleLabel={t('researchEnvironment.a11y.capabilityState', {
                    capability: layerName,
                    state: t(`researchEnvironment.layerStates.${layerState}`),
                  })}
                />
              </div>
            );
          })}
        </div>
      )}

      {status.verification && (
        <p
          data-testid={`capability-verification-${capability}`}
          className="text-[11px] text-gray-400"
        >
          {/* Displayed, never branched on (AC7). */}
          {status.verification}
        </p>
      )}

      {blamedFailure && (
        <div
          data-testid={`capability-failure-${capability}`}
          className="border border-red-500/30 bg-red-500/10 rounded-[6px] p-2 flex flex-col gap-1"
        >
          <span className="text-[11px] font-semibold text-red-300">
            {/*
              The headline is chosen from the structured `cause`, so an import
              failure, a probe failure, and a backend-initialization failure read
              differently without anyone reading the message text.
            */}
            {t(`researchEnvironment.capabilityCause.${blamedFailure.cause}`)}
          </span>
          <span className="text-[11px] text-red-200">{blamedFailure.message}</span>
          <span className="text-[11px] text-gray-300">{blamedFailure.remediation}</span>
        </div>
      )}
    </section>
  );
}

export default ResearchCapabilityCard;
