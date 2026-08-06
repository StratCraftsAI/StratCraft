/**
 * TICKET_1335_1 Phase 3 -- environment-level failure presentation (AC7).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 * Presentation is selected from the structured `category`, `stage`, `cause`, and
 * `capability` fields ONLY. `message` and `remediation` are rendered verbatim
 * and never parsed, matched, or branched on. Parsing human text would make the
 * UI's behaviour depend on wording that is localized and free to change, so a
 * copy edit in the service could silently change which error the user sees.
 *
 * WHY A LOOKUP TABLE KEYED BY THE FULL CATEGORY TUPLE:
 * AC7 requires every parent failure category to render a DISTINCT actionable
 * state. Keying a `Record<ResearchEnvironmentFailureCategory, ...>` off the
 * shared tuple means a category added upstream fails to compile here rather than
 * silently falling through to a generic "something went wrong" -- which is the
 * shape this rule exists to prevent.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ResearchEnvironmentFailure } from '@StratCraft/types';
import { type FailureTone, failureTone } from '../presentation';

const TONE_CLASS: Record<FailureTone, string> = {
  blocked: 'border-amber-500/40 bg-amber-500/10',
  recoverable: 'border-red-500/30 bg-red-500/10',
};

export interface EnvironmentFailurePanelProps {
  failure: ResearchEnvironmentFailure;
}

export function EnvironmentFailurePanel({
  failure,
}: EnvironmentFailurePanelProps): JSX.Element {
  const { t } = useTranslation('ui');
  const tone = failureTone(failure.category);
  const headingId = 'environment-failure-heading';

  return (
    <section
      role="alert"
      // AC11: named from its own heading, so landmark navigation reaches the
      // failure directly. `role="alert"` already forces an announcement when it
      // appears; the name is what makes it findable AFTERWARDS, when the user
      // navigates back to read it properly.
      aria-labelledby={headingId}
      data-testid="environment-failure-panel"
      data-category={failure.category}
      data-stage={failure.stage}
      data-cause={failure.cause}
      data-tone={tone}
      className={`border rounded-[6px] p-3 flex flex-col gap-2 ${TONE_CLASS[tone]}`}
    >
      <h2
        id={headingId}
        className="text-[12px] font-semibold uppercase tracking-wide text-gray-100"
      >
        {t(`researchEnvironment.failureCategory.${failure.category}`)}
      </h2>

      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-gray-400">
        <span data-testid="failure-stage">
          {t('researchEnvironment.failure.stage')}
          {': '}
          {t(`researchEnvironment.stages.${failure.stage}`)}
        </span>
        <span data-testid="failure-cause">
          {t('researchEnvironment.failure.cause')}
          {': '}
          {t(`researchEnvironment.causes.${failure.cause}`)}
        </span>
        {/*
          Only `verification_failed` carries a capability. Rendering the field
          conditionally on the discriminant, rather than on `'capability' in
          failure`, keeps the narrowing the shared union already provides.
        */}
        {failure.category === 'verification_failed' && (
          <span data-testid="failure-capability">
            {t('researchEnvironment.failure.capability')}
            {': '}
            {t(`researchEnvironment.capabilities.${failure.capability}.name`)}
          </span>
        )}
      </div>

      {/* Service-authored text: displayed, never parsed. */}
      <p className="text-[11px] text-gray-200">{failure.message}</p>
      <p data-testid="failure-remediation" className="text-[11px] text-gray-300">
        {failure.remediation}
      </p>
    </section>
  );
}

export default EnvironmentFailurePanel;
