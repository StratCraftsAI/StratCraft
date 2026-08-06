/**
 * PersistenceErrorListener - Host-side bridge from plugin persistence
 * failures to the in-app toast surface.
 *
 * Background: Several plugin-layer fire-and-forget IPC persistence calls
 * (Signal Discovery save/load/delete run history) cannot reach the
 * `useMessage` toast hook directly because plugins live outside the React
 * tree where MessageProvider is mounted. The established cross-boundary
 * pattern is a `window` CustomEvent that the host listens for and
 * converts to a toast (mirrors `useCreditStatus` -> `nexus:credit-warning`).
 *
 * This component listens for `nexus:persistence-error`, deduped already at
 * the source by the dispatcher, and surfaces a single warning toast per
 * occurrence. The detail payload carries an actionable hint pointing the
 * user at `main.log` for forensic follow-up.
 *
 * @see TICKET_775 - Surface persistRun / IPC persistence failures to the UI
 * @see TICKET_096 - Message Utils / useMessage
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessage } from '@/hooks/useMessage';

export interface PersistenceErrorDetail {
  op: 'save' | 'load' | 'delete';
  message: string;
  hint?: string;
}

const OP_LABEL_KEYS: Record<PersistenceErrorDetail['op'], string> = {
  save: 'persistence.saveFailed',
  load: 'persistence.restoreFailed',
  delete: 'persistence.deleteFailed',
};

export function PersistenceErrorListener(): null {
  const { warning } = useMessage();
  const { t } = useTranslation('ui');

  useEffect(() => {
    const handlePersistenceError = (event: Event) => {
      const detail = (event as CustomEvent<PersistenceErrorDetail>).detail;
      if (!detail) return;
      const label = t(OP_LABEL_KEYS[detail.op] ?? 'persistence.fallback');
      const hint = detail.hint ? ` ${detail.hint}` : '';
      // Toast content combines a short prefix the user can scan ("Save
      // failed: ...") with the underlying error message and an
      // actionable hint. Dedup happens at the dispatcher, so each toast
      // we render here represents a distinct failure signature.
      warning(`${label}: ${detail.message}.${hint}`);
    };

    window.addEventListener('nexus:persistence-error', handlePersistenceError);
    return () => {
      window.removeEventListener('nexus:persistence-error', handlePersistenceError);
    };
  }, [warning]);

  return null;
}
