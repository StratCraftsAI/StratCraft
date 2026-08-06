/**
 * CompileGateRejectedListener - Host-side bridge from Signal Discovery's
 * Round 4.5 / Round 5 C++ compile-gate rejections to the in-app toast
 * surface.
 *
 * Background: Signal Discovery runs an `-fsyntax-only` compile of the
 * Round 4 blob against the SDK headers before persisting it to
 * `nona_signal`. When the gate rejects (LLM-hallucinated APIs, fabricated
 * struct fields, syntax errors), the run completes without saving and the
 * Discovery progress panel shows the failure inline -- but a user who has
 * scrolled away or switched tabs would silently lose the run otherwise.
 * This bridge surfaces a single warning toast per rejection.
 *
 * Pattern mirrors PersistenceErrorListener (TICKET_775):
 * window CustomEvent -> host useMessage toast.
 *
 * @see TICKET_782_1 - C++ compile-test gate before persisting nona_signal.code
 * @see TICKET_096   - Message Utils / useMessage
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessage } from '@/hooks/useMessage';

export interface CompileGateRejectedDetail {
  signalName: string;
  diagnostics: string[];
}

export function CompileGateRejectedListener(): null {
  const { warning } = useMessage();
  const { t } = useTranslation('errors');

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<CompileGateRejectedDetail>).detail;
      if (!detail) return;
      const firstDiag = detail.diagnostics[0] ?? t('renderer.compileGate.compileFailed');
      // The toast is intentionally short -- the full diagnostic stream is
      // shown in the Discovery panel banner (expandable block). Goal here
      // is just to make sure the user notices the reject even if they have
      // navigated away from the Discovery page.
      warning(
        t('renderer.compileGate.signalRejected', { name: detail.signalName, diag: firstDiag }),
      );
    };
    window.addEventListener('nexus:compile-gate-rejected', handle);
    return () => {
      window.removeEventListener('nexus:compile-gate-rejected', handle);
    };
  }, [warning, t]);

  return null;
}
