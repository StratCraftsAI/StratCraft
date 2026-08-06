import { useTranslation } from 'react-i18next'
import { Suspense } from 'react'
import type {
  AgentToolOutcomeV1,
  AgentUsageV1,
  GovernanceAttributionPresentationV1,
} from '@StratCraft/types'
import { projectGovernanceAttribution } from '@StratCraft/types'
import { isTerminalConfirmPhase, type ChatMessage, type GuidedAction, type GuidedActionDispatchResult, type GuidedAIStudioAction } from '../types.ts'
import { ChoiceCard } from './ChoiceCard.tsx'
import { WizardStep } from './WizardStep.tsx'
import { InfoPanel } from './InfoPanel.tsx'
import { ChatContent } from './ChatContent.tsx'
import { FlowDiagram } from './FlowDiagram.tsx'
import { FieldManifestCard } from './FieldManifestCard.tsx'
import { WorkloadPrelaunchReview } from './WorkloadPrelaunchReview.tsx'
import { AgentToolTrace } from './AgentToolTrace.tsx'
import { AgentConfirmCard } from './AgentConfirmCard.tsx'
import { AIStudioActionCard } from './AIStudioActionCard.tsx'
import { optionalPage } from '../optional-page.tsx'

const RegimeStrategyConfigCard = optionalPage(
  () => import(/* @vite-ignore */ '../commercial-pages'),
  'RegimeStrategyConfigCard',
)

interface Props {
  message: ChatMessage
  onGuidedAction?: (action: GuidedAction) => Promise<GuidedActionDispatchResult>
  /** AI Studio actions require the admitted Guide Agent turn owned by onSend. */
  onAgentMessage?: (text: string) => void
  /** TICKET_1237_4: deliver a T2 confirm verdict for a paused agent tool call. */
  onAgentConfirm?: (
    confirmationId: string,
    approved: boolean,
    payload?: Record<string, unknown>,
  ) => void
}

export function MessageBubble({ message, onGuidedAction, onAgentMessage, onAgentConfirm }: Props) {
  const { t } = useTranslation('dashboard')
  const isUser = message.role === 'user'
  const handleAction = onGuidedAction ?? (async () => ({ ok: false as const, error: 'Guided actions are unavailable.' }))
  const agent = message.agent
  // Messages created before TICKET_1353 have no persisted presentation list.
  // Their only reconstructable item is the terminal assistant content.
  const presentation = agent && (agent.presentation?.length ?? 0) > 0
    ? agent.presentation
    : agent && message.content
      ? [{ kind: 'summary' as const, sequence: agent.lastSeq }]
      : []

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'} fade-in`}>
      <div className="role-label">
        {isUser ? t('message.you') : t('message.stratcraft')}
      </div>

      {/*
        TICKET_1318 AC1: every message -- agent turns included -- renders through
        the shared markdown AST. The former agent branch passed raw content as
        children, which is why fence markers and `**bold**` were visible on
        screen.
      */}
      {!agent && message.content && (
        <ChatContent className="bubble" content={message.content} />
      )}

      {/* TICKET_1237_4: agent turn -- typing indicator, tool trace, confirm cards, status notes */}
      {agent && agent.status === 'streaming' && !message.content && agent.trace.length === 0 && agent.confirms.length === 0 && (
        <div className="bubble typing">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      )}

      {agent && presentation.map(item => {
        if (item.kind === 'summary') {
          return (
            <div key={`summary-${item.sequence}`}>
              {agent.terminalOutcome && (
                <div className={`agent-note ${agent.terminalOutcome.presentation.severity}`}>
                  {localizeAgentOutcome(t, agent.terminalOutcome)}
                </div>
              )}
              {message.content && <ChatContent className="bubble" content={message.content} />}
            </div>
          )
        }
        if (item.kind === 'tool') {
          const entry = agent.trace.find(candidate => candidate.callId === item.callId)
          const confirmation = agent.confirms.find(confirm => confirm.callId === item.callId)
          if (!entry || (confirmation && !isTerminalConfirmPhase(confirmation.phase))) return null
          return <AgentToolTrace key={`tool-${item.callId}`} entries={[entry]} />
        }
        const confirm = agent.confirms.find(candidate => candidate.scope.requestId === item.requestId)
        if (!confirm) return null
        return confirm.operation === 'generate_strategy'
          ? (
            <Suspense key={`confirm-${item.requestId}`} fallback={null}>
              <RegimeStrategyConfigCard
                confirm={confirm}
                onVerdict={onAgentConfirm ?? (() => {})}
              />
            </Suspense>
          )
          : (
            <AgentConfirmCard
              key={`confirm-${item.requestId}`}
              confirm={confirm}
              onVerdict={onAgentConfirm ?? (() => {})}
            />
          )
      })}

      {agent?.terminalOutcome && !presentation.some(item => item.kind === 'summary') && (
        <div className={`agent-note ${agent.terminalOutcome.presentation.severity}`}>
          {localizeAgentOutcome(t, agent.terminalOutcome)}
        </div>
      )}

      {agent?.protocolError && (
        <div className="agent-note error">
          {localizeAgentOutcome(t, agent.protocolError)}
        </div>
      )}

      {agent?.thoughts && (
        <details className="agent-thoughts">
          <summary>{t('agentChat.thoughts')}</summary>
          <div>{agent.thoughts}</div>
        </details>
      )}

      {agent && agent.plan.length > 0 && (
        <ol className="agent-plan">
          {agent.plan.map(item => <li key={item.id} data-status={item.status}>{item.text}</li>)}
        </ol>
      )}

      {agent && (agent.inferenceUsage || agent.governanceAttribution) && (
        <div className="agent-usage">
          <span>{t('agentChat.inferenceUsage')}: {formatUsage(agent.inferenceUsage)}</span>
          <GovernanceUsage
            presentation={projectGovernanceAttribution(agent.governanceAttribution)}
            translate={t}
          />
        </div>
      )}

      {agent?.artifactAdmission && (
        <div className={`agent-admission ${agent.artifactAdmission.status}`}>
          <strong>{t('agentChat.artifactAdmission')}</strong>
          {agent.artifactAdmission.stages.map(stage => (
            <div key={stage.stageId}>{stage.label}: {stage.status}</div>
          ))}
          {agent.artifactAdmission.rejectionMessage && <div>{agent.artifactAdmission.rejectionMessage}</div>}
        </div>
      )}

      {message.toolCall && (
        <div className="tool-call">
          {t('message.toolPrefix')} {message.toolCall.name}
          {message.toolCall.status === 'done' && (
            <span className="pos">{t('message.statusDone')}</span>
          )}
          {message.toolCall.status === 'error' && (
            <span className="neg">{t('message.statusError')}</span>
          )}
        </div>
      )}

      {message.visualization?.type === 'iframe' && message.visualization.src && (
        <div className="viz-wrap">
          {message.visualization.title && (
            <div className="viz-title">{message.visualization.title}</div>
          )}
          <iframe
            src={message.visualization.src}
            style={{ width: '100%', height: message.visualization.height ?? 500, border: 'none', display: 'block' }}
            sandbox="allow-scripts allow-same-origin"
            title={message.visualization.title ?? t('message.visualization')}
          />
        </div>
      )}

      {message.visualization?.type === 'table' && !!message.visualization.data && (
        <div className="viz-wrap">
          {message.visualization.title && (
            <div className="viz-title">{message.visualization.title}</div>
          )}
          <div style={{ overflowX: 'auto', maxHeight: 400 }}>
            <DataTable data={message.visualization.data as Record<string, unknown>[]} />
          </div>
        </div>
      )}

      {message.visualization?.type === 'json' && !!message.visualization.data && (
        <div className="viz-wrap">
          {message.visualization.title && (
            <div className="viz-title">{message.visualization.title}</div>
          )}
          <pre style={{ padding: '12px 14px', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-2)', background: 'var(--panel)', overflowX: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', margin: 0 }}>
            {JSON.stringify(message.visualization.data, null, 2)}
          </pre>
        </div>
      )}

      {message.visualization?.type === 'choice_card' && message.visualization.guided?.type === 'choice_card' && (
        <ChoiceCard data={message.visualization.guided} onAction={handleAction} />
      )}

      {message.visualization?.type === 'wizard_step' && message.visualization.guided?.type === 'wizard_step' && (
        <WizardStep data={message.visualization.guided} onAction={handleAction} />
      )}

      {message.visualization?.type === 'info_panel' && message.visualization.guided?.type === 'info_panel' && (
        <InfoPanel data={message.visualization.guided} onAction={handleAction} />
      )}

      {message.visualization?.type === 'flow_diagram' && message.visualization.guided?.type === 'flow_diagram' && (
        <FlowDiagram data={message.visualization.guided} onAction={handleAction} />
      )}

      {message.visualization?.type === 'field_manifest' && message.visualization.guided?.type === 'field_manifest' && (
        <FieldManifestCard data={message.visualization.guided} onAction={handleAction} />
      )}

      {message.visualization?.type === 'workload_prelaunch_review' && message.visualization.guided?.type === 'workload_prelaunch_review' && (
        <WorkloadPrelaunchReview
          data={message.visualization.guided}
          onAction={handleAction}
          superseded={message.visualization.superseded === true}
        />
      )}

      {message.visualization?.type === 'ai_studio_action' && message.visualization.guided?.type === 'ai_studio_action' && (
        <AIStudioActionCard
          data={message.visualization.guided as GuidedAIStudioAction}
          onSend={onAgentMessage ?? (() => {})}
        />
      )}
    </div>
  )
}

function DataTable({ data }: { data: Record<string, unknown>[] }) {
  const { t } = useTranslation('dashboard')
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="empty"><p>{t('message.noData')}</p></div>
  }

  const cols = Object.keys(data[0])

  return (
    <table className="dt">
      <thead>
        <tr>
          {cols.map((col) => (
            <th key={col}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {cols.map((col) => (
              <td key={col} className="mono">{formatCell(row[col])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatUsage(usage: AgentUsageV1 | undefined): string {
  if (!usage) return 'n/a'
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  return `${usage.payerClass} / ${tokens} tokens / ${usage.completeness}`
}

function GovernanceUsage({
  presentation,
  translate,
}: {
  presentation: GovernanceAttributionPresentationV1
  translate: (key: string) => string
}) {
  if (presentation.attributionState === 'absent') {
    return <span>{translate(presentation.attributionMessageKey)}</span>
  }
  return (
    <span>
      {translate('agentGovernance.localAdmission')}: {translate(presentation.localAdmission.messageKey)};
      {' '}{translate('agentGovernance.remoteSubmission')}: {translate(presentation.remoteSubmission.messageKey)}
      {presentation.credit && ` / ${presentation.credit.value} ${presentation.credit.unit}`}
    </span>
  )
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'object') return JSON.stringify(val).slice(0, 60)
  return String(val)
}

/** Render only validated localization keys from the canonical outcome. */
export function localizeAgentOutcome(
  t: (key: string, opts?: Record<string, unknown>) => string,
  outcome: AgentToolOutcomeV1,
): string {
  const message = t(outcome.presentation.messageKey, outcome.presentation.parameters)
  return outcome.presentation.recoveryKey
    ? `${message} ${t(outcome.presentation.recoveryKey, outcome.presentation.parameters)}`
    : message
}
