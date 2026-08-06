/**
 * TICKET_1237_4: T2 destructive-tool confirm card.
 *
 * Rendered from a confirm_required agent event. The agent loop is parked
 * until the authority acknowledges a WebAuthn-backed verdict. A local button
 * gesture is never rendered as a terminal decision.
 */
import { useTranslation } from 'react-i18next'
import {
  isConfirmSubmissionAllowed,
  isTerminalConfirmPhase,
  type AgentConfirmState,
} from '../types.ts'
import { usePermissionExpiry } from '../hooks/usePermissionExpiry.ts'

interface Props {
  confirm: AgentConfirmState
  onVerdict: (
    confirmationId: string,
    approved: boolean,
    payload?: Record<string, unknown>,
  ) => void
}

export function AgentConfirmCard({ confirm, onVerdict }: Props) {
  const { t } = useTranslation('dashboard')
  const resolved = isTerminalConfirmPhase(confirm.phase)
  const expired = usePermissionExpiry(confirm.expiresAt)
  const requestId = confirm.scope.requestId

  return (
    <div className="agent-confirm" data-testid="agent-confirm-card">
      <div className="agent-confirm-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        {t('agentChat.confirmTitle')}
      </div>
      <div className="agent-confirm-body">
        {t('agentChat.confirmMessage', { toolName: confirm.operation })}
      </div>
      <dl className="agent-confirm-scope">
        <div><dt>{t('agentChat.permissionRisk')}</dt><dd>{confirm.riskTier}</dd></div>
        <div><dt>{t('agentChat.permissionWorkspace')}</dt><dd>{confirm.scope.workspaceId}</dd></div>
        <div><dt>{t('agentChat.permissionCapability')}</dt><dd>{confirm.scope.capability}</dd></div>
        <div><dt>{t('agentChat.permissionExpiry')}</dt><dd>{confirm.expiresAt}</dd></div>
      </dl>
      {Object.keys(confirm.args).length > 0 && (
        <pre className="agent-confirm-args">{JSON.stringify(confirm.args, null, 2)}</pre>
      )}
      {confirm.commandPreview && <pre className="agent-confirm-args">{confirm.commandPreview}</pre>}
      {confirm.diffPreview && <pre className="agent-confirm-args">{confirm.diffPreview}</pre>}
      {!resolved && (
        <div className="agent-confirm-actions">
          <button
            className="agent-confirm-btn approve"
            onClick={() => onVerdict(requestId, true)}
            type="button"
            data-testid="agent-confirm-approve"
            disabled={!isConfirmSubmissionAllowed(confirm) || expired}
          >
            {t('agentChat.approve')}
          </button>
          <button
            className="agent-confirm-btn decline"
            onClick={() => onVerdict(requestId, false)}
            type="button"
            data-testid="agent-confirm-decline"
            disabled={!isConfirmSubmissionAllowed(confirm) || expired}
          >
            {t('agentChat.decline')}
          </button>
        </div>
      )}
      {!resolved && confirm.phase !== 'pending' && (
        <div className={`agent-confirm-verdict ${confirm.phase}`} data-testid="agent-confirm-state">
          {t('agentChat.verifying')}
        </div>
      )}
      {confirm.error && <p role="alert">{confirm.error.message}</p>}
      {resolved && (
        <div className={`agent-confirm-verdict ${confirm.phase}`} data-testid="agent-confirm-verdict">
          {confirm.phase === 'approved'
            ? t('agentChat.approved')
            : confirm.phase === 'declined'
              ? t('agentChat.declined')
              : confirm.phase === 'expired'
                ? t('agentChat.verdictExpired')
                : t('agentChat.verdictCancelled')}
        </div>
      )}
    </div>
  )
}
