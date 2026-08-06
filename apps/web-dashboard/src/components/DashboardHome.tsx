import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChatInput } from './ChatInput.tsx'
import { MessageBubble } from './MessageBubble.tsx'
import { TypingDots } from './TypingDots.tsx'
import { subscribe } from '../event-stream.ts'
import {
  projectResearchEnvironmentJobMessage,
  subscribeResearchEnvironmentJobs,
} from '../research-environment-job-observer.ts'
import {
  startAgentTurn,
  cancelAgentTurn,
  confirmAgentAction,
  requiresAgentSnapshotRefresh,
  extractAgentChangedFields,
  parseAgentEvent,
  applyAgentEvent,
  acknowledgeConfirmDecision,
  beginConfirmDecision,
  failConfirmDecision,
  setConfirmPhase,
  createPendingTurnState,
  bindPendingTurnState,
  expireAgentEventGap,
} from '../agent-chat.ts'
import { handleGuidedOnboarding } from '../chat-router.ts'
import {
  isConfirmSubmissionAllowed,
  supersedeStalePrelaunchReviews,
  type AgentEvent,
  type ChatMessage,
  type GuidedAction,
  type GuidedFlowDiagram,
} from '../types.ts'
import { useGuideToolbar } from '../guide-toolbar-context.tsx'
import { useGuideAgentConfigStore } from '../stores/useGuideAgentConfigStore.ts'
import { AGENT_EVENT_GAP_CHECK_INTERVAL_MS } from '../constants.ts'
import { FlowDiagram } from './FlowDiagram.tsx'
import {
  GuideControlError,
  ensureControlSession,
  normalizeGuideControlError,
} from '../agent-control-client.ts'

interface SseProgressEvent {
  completed: number
  total: number
  failed: number
  status: string
}

interface Props {
  toolCount: number
  onGuidedAction: (action: GuidedAction) => Promise<ChatMessage>
  onConfigureProvider: (providerId: string) => void
}

const SUGGESTION_ICONS = [
  'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01',
]

function SvgIcon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export function DashboardHome({
  toolCount,
  onGuidedAction,
  onConfigureProvider,
}: Props) {
  const { t } = useTranslation('dashboard')
  const { config: toolbarConfig, refresh: refreshToolbar } = useGuideToolbar()
  const agentMutationPending = useGuideAgentConfigStore(state => state.mutationPending)
  const resubmissionRequired = useGuideAgentConfigStore(state => state.resubmissionRequired)
  const invalidateAgentConfig = useGuideAgentConfigStore(state => state.invalidate)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [onboardingDiagram, setOnboardingDiagram] = useState<GuidedFlowDiagram | null>(null)
  const [onboardingLoading, setOnboardingLoading] = useState(true)
  // TICKET_1237_4: agent turn state -- conversation continuity + cancel target.
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const activeTurnRef = useRef<string | null>(null)
  const turnMessageIdRef = useRef<string | null>(null)
  // D2: events that arrive before send_agent_message returns the turn_id.
  const pendingEventsRef = useRef<AgentEvent[]>([])
  const confirmationSubmissionsRef = useRef(new Set<string>())
  const threadRef = useRef<HTMLDivElement>(null)
  const inChat = messages.length > 0 || isProcessing
  const invalidatedProviderId = toolbarConfig?.llm.invalidatedSelection?.catalogProviderId
    ?? toolbarConfig?.llm.invalidatedSelection?.providerId
  const invalidatedProvider = toolbarConfig?.llm.groups
    .filter(group => group.kind === 'byok')
    .flatMap(group => group.providers)
    .find(provider => provider.id === invalidatedProviderId)

  // TICKET_1310: fetch personalized welcome diagram on mount.
  useEffect(() => {
    let cancelled = false
    handleGuidedOnboarding().then((msg) => {
      if (cancelled) return
      const guided = msg.visualization?.guided
      if (guided?.type === 'flow_diagram') {
        setOnboardingDiagram(guided as GuidedFlowDiagram)
      }
    }).catch(() => {
      // MCP unreachable — static chip fallback (onboardingDiagram stays null)
    }).finally(() => {
      if (!cancelled) setOnboardingLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const lastMilestoneRef = useRef(-1)

  // TICKET_1237_4: fold one agent event into the turn's message; unlock the
  // input on turn_complete. Pure state transitions live in agent-chat.ts.
  const dispatchAgentEvent = useCallback((event: AgentEvent) => {
    const messageId = turnMessageIdRef.current
    if (!messageId) return
    setMessages((prev) => prev.map((m) => (m.id === messageId ? applyAgentEvent(m, event) : m)))
    if (
      event.type === 'turn_completed'
      || event.type === 'turn_cancelled'
      || event.type === 'turn_failed'
      || event.type === 'artifact_accepted'
      || event.type === 'artifact_rejected'
    ) {
      activeTurnRef.current = null
      turnMessageIdRef.current = null
      setActiveTurnId(null)
      setIsProcessing(false)
    }
  }, [])

  useEffect(() => {
    const unsub = subscribe('agent-event', (raw) => {
      const event = parseAgentEvent(raw)
      if (!event) return
      if (activeTurnRef.current === event.turnId) {
        dispatchAgentEvent(event)
      } else if (activeTurnRef.current === null && turnMessageIdRef.current !== null) {
        // Turn started but the tool response (turn_id) has not landed yet:
        // buffer so a fast first event (e.g. no_byok_key) is never lost.
        pendingEventsRef.current.push(event)
      }
    })
    return unsub
  }, [dispatchAgentEvent])

  useEffect(() => subscribeResearchEnvironmentJobs(event => {
    const message: ChatMessage = {
      id: `research-environment-job:${event.jobId}:${event.revision}`,
      role: 'assistant',
      content: projectResearchEnvironmentJobMessage(event),
      timestamp: Date.now(),
    }
    setMessages(previous => {
      const prefix = `research-environment-job:${event.jobId}:`
      const existing = previous.findIndex(candidate => candidate.id.startsWith(prefix))
      if (existing < 0) return [...previous, message]
      return previous.map((candidate, index) => index === existing ? message : candidate)
    })
  }), [])

  useEffect(() => {
    if (!activeTurnId) return
    const timer = window.setInterval(() => {
      setMessages(prev => prev.map(message => expireAgentEventGap(message)))
    }, AGENT_EVENT_GAP_CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [activeTurnId])

  useEffect(() => {
    const unsub = subscribe('sweep-progress', (raw) => {
      const data = raw as SseProgressEvent
      if (data.total <= 0) return

      const pct = Math.floor((data.completed / data.total) * 100)
      const milestone = Math.floor(pct / 10) * 10

      if (data.status === 'completed' || data.status === 'stopped') {
        if (lastMilestoneRef.current !== 101) {
          lastMilestoneRef.current = 101
          setMessages((prev) => [...prev, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: t('chat.sweepCompleteNotification', {
              completed: String(data.completed),
              failed: String(data.failed),
            }),
            timestamp: Date.now(),
          }])
        }
      } else if (milestone > lastMilestoneRef.current && milestone >= 10) {
        lastMilestoneRef.current = milestone
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('chat.sweepProgress', {
            completed: String(data.completed),
            total: String(data.total),
            pct: String(pct),
          }),
          timestamp: Date.now(),
        }])
      }
    })

    return () => {
      unsub()
      lastMilestoneRef.current = -1
    }
  }, [t])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isProcessing])

  // TICKET_1237_4: free text drives the BYOK agent loop (send_agent_message);
  // button-driven guided flows below stay on get_guided_action.
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing || agentMutationPending || resubmissionRequired) return
    const runtimeSnapshot = toolbarConfig?.agent
    if (!runtimeSnapshot) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: t('toolbar.agentUnavailable'),
        timestamp: Date.now(),
      }])
      return
    }
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    }
    const turnMsgId = crypto.randomUUID()
    const turnMsg: ChatMessage = {
      id: turnMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agent: createPendingTurnState(runtimeSnapshot),
    }
    setMessages((prev) => [...prev, userMsg, turnMsg])
    setIsProcessing(true)
    turnMessageIdRef.current = turnMsgId
    pendingEventsRef.current = []
    try {
      const handle = await startAgentTurn(
        text.trim(),
        runtimeSnapshot,
        conversationId ?? undefined,
      )
      if (
        handle.selectionFingerprint !== runtimeSnapshot.selectionFingerprint
        || handle.runtimeCapabilityHash !== runtimeSnapshot.runtimeCapabilityHash
      ) {
        throw new Error(t('toolbar.invalidResponse'))
      }
      setConversationId(handle.conversationId)
      activeTurnRef.current = handle.turnId
      setActiveTurnId(handle.turnId)
      // Bind the turn id to the placeholder, then drain events that raced
      // ahead of the tool response (D2) through the same reducer.
      setMessages((prev) => prev.map((m) => (
        m.id === turnMsgId && m.agent
          ? { ...m, agent: bindPendingTurnState(m.agent, handle) }
          : m
      )))
      const buffered = pendingEventsRef.current.filter((e) => e.turnId === handle.turnId)
      pendingEventsRef.current = []
      for (const event of buffered) dispatchAgentEvent(event)
    } catch (err) {
      if (requiresAgentSnapshotRefresh(err)) {
        const changedFields = extractAgentChangedFields(err)
        void refreshToolbar().finally(() => invalidateAgentConfig(changedFields))
      }
      turnMessageIdRef.current = null
      setMessages((prev) => prev.map((m) => (
        m.id === turnMsgId
          ? {
              ...m,
              agent: m.agent ? {
                ...m.agent,
                status: 'failed',
                terminalOutcome: {
                  code: 'turn_send_failed',
                  executionState: 'not_executed',
                  terminalReason: 'turn_failed',
                  presentation: {
                    messageKey: 'agentOutcome.turnFailed',
                    parameters: {},
                    recoveryKey: 'agentOutcome.reviewDiagnostics',
                    severity: 'error',
                  },
                },
              } : m.agent,
            }
          : m
      )))
      setIsProcessing(false)
    }
  }, [
    agentMutationPending,
    conversationId,
    dispatchAgentEvent,
    isProcessing,
    invalidateAgentConfig,
    refreshToolbar,
    resubmissionRequired,
    t,
    toolbarConfig,
  ])

  const handleCancelTurn = useCallback(async () => {
    const turnId = activeTurnRef.current
    if (!turnId) return
    setMessages(prev => prev.map(message => message.id === turnMessageIdRef.current && message.agent
      ? {
          ...message,
          agent: {
            ...message.agent,
            status: 'cancelling',
            confirms: message.agent.confirms,
          },
        }
      : message))
    try {
      await cancelAgentTurn(turnId)
      // The loop emits turn_complete{cancelled}, which unwinds the UI.
    } catch {
      // Turn already finished server-side -- turn_complete has/will unwind it.
    }
  }, [])

  const handleAgentConfirm = useCallback(async (
    confirmationId: string,
    approved: boolean,
    payload?: Record<string, unknown>,
  ) => {
    const messageId = turnMessageIdRef.current
    const currentMessage = messages.find(message => message.id === messageId)
    if (currentMessage?.agent?.status !== 'streaming') return
    const confirm = currentMessage.agent.confirms
      .find(item => item.scope.requestId === confirmationId)
    if (!confirm || !isConfirmSubmissionAllowed(confirm)
      || confirmationSubmissionsRef.current.has(confirmationId)) return
    if (Date.parse(confirm.expiresAt) <= Date.now()) {
      const error = {
        code: 'permission_expired',
        message: `${t('agentOutcome.confirmExpired')} ${t('agentOutcome.waitForReconciliation')}`,
      }
      if (messageId) {
        setMessages(prev => prev.map(message => message.id === messageId
          ? failConfirmDecision(message, confirmationId, 'pending', error)
          : message))
      }
      return
    }
    confirmationSubmissionsRef.current.add(confirmationId)
    const verdict = approved ? 'approved' : 'declined'
    if (messageId) {
      setMessages((prev) => prev.map((m) => (
        m.id === messageId ? beginConfirmDecision(m, confirmationId, verdict) : m
      )))
    }
    try {
      const expectedPayloadHash = confirm.scope.expectedPayloadHash
      if (!expectedPayloadHash) throw new Error(t('toolbar.invalidResponse'))
      const readiness = await ensureControlSession()
      if (!readiness.authenticatorEligible) {
        throw new GuideControlError(
          'authenticator_unavailable',
          'This browser origin is not eligible for WebAuthn.',
        )
      }
      await confirmAgentAction(
        confirmationId,
        expectedPayloadHash,
        approved,
        payload,
        phase => {
          setMessages(prev => prev.map(message => message.id === messageId
            ? setConfirmPhase(message, confirmationId, phase)
            : message))
        },
      )
      setMessages(prev => prev.map(message => message.id === messageId
        ? acknowledgeConfirmDecision(message, confirmationId, verdict)
        : message))
    } catch (err) {
      const controlError = normalizeGuideControlError(err)
      let phase: 'pending' | 'origin-ineligible' | 'authenticator-unavailable' = 'pending'
      if (controlError.code === 'authenticator_unavailable') phase = 'origin-ineligible'
      else if (controlError.code === 'control_session_invalid') phase = 'authenticator-unavailable'
      const error = {
        code: controlError.code,
        message: controlError.message,
        status: controlError.status,
        details: controlError.details,
      }
      setMessages(prev => prev.map(message => message.id === messageId
        ? failConfirmDecision(message, confirmationId, phase, error)
        : message))
    } finally {
      confirmationSubmissionsRef.current.delete(confirmationId)
    }
  }, [messages, t])

  const dispatchGuidedAction = useCallback(async (action: GuidedAction) => {
    if (isProcessing) return { ok: false as const, error: t('chat.errorPrefix', { message: 'Another action is already in progress.' }) }
    setIsProcessing(true)
    try {
      const response = await onGuidedAction(action)
      setMessages((prev) => [...supersedeStalePrelaunchReviews(prev, response), response])
      return { ok: true as const }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: t('chat.errorPrefix', { message: error }),
        timestamp: Date.now(),
      }])
      return { ok: false as const, error }
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing, onGuidedAction, t])

  const reset = () => {
    if (activeTurnRef.current) void handleCancelTurn()
    activeTurnRef.current = null
    turnMessageIdRef.current = null
    pendingEventsRef.current = []
    setActiveTurnId(null)
    setConversationId(null)
    setMessages([])
    setIsProcessing(false)
  }

  const suggestions = [
    t('home.suggestionMomentum'),
    t('home.suggestionCompare'),
    t('home.suggestionBacktest'),
    t('home.suggestionExplain'),
  ]
  const agentBlocker = toolbarConfig && !toolbarConfig.agent ? (
    <div className="toolbar-notice" role="alert" data-testid="agent-configuration-required">
      <span>{t('toolbar.agentUnavailable')}</span>
      {invalidatedProvider?.availability === 'needs_credential' && (
        <button
          type="button"
          className="btn sm"
          onClick={() => onConfigureProvider(invalidatedProvider.id)}
        >
          {t('llm.configureProviderKey', { provider: invalidatedProvider.name })}
        </button>
      )}
      {invalidatedProvider?.availability === 'credential_error' && (
        <button
          type="button"
          className="btn sm"
          data-testid="credential-storage-error"
          onClick={() => onConfigureProvider(invalidatedProvider.id)}
        >
          {t('llm.configureProviderKey', { provider: invalidatedProvider.name })}
        </button>
      )}
    </div>
  ) : null
  if (inChat) {
    return (
      <div className="dh-chat">
        <div className="dh-chat-bar">
          <button className="btn ghost sm" onClick={reset} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('home.newChat')}
          </button>
          {activeTurnId && (
            <button className="btn ghost sm agent-stop" onClick={() => void handleCancelTurn()} type="button" data-testid="agent-stop">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              {t('agentChat.stop')}
            </button>
          )}
        </div>
        <div className="dh-thread" ref={threadRef}>
          <div className="thread-inner">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onGuidedAction={dispatchGuidedAction}
                onAgentConfirm={handleAgentConfirm}
                onSend={handleSend}
              />
            ))}
            {isProcessing && <TypingDots />}
          </div>
        </div>
        {agentBlocker}
        <ChatInput
          onSend={handleSend}
          disabled={isProcessing || agentMutationPending || resubmissionRequired}
          toolCount={toolCount}
          isStreaming={isProcessing}
          onStop={handleCancelTurn}
        />
      </div>
    )
  }

  return (
    <div className="dh-home">
      <div className="dh-grid">
        <section className="dh-hero">
          <h1 className="dh-greeting">
            <svg className="dh-spark" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            {t('home.greeting')}
          </h1>

          <div className="dh-input-wrap">
            {agentBlocker}
            <ChatInput
              onSend={handleSend}
              disabled={isProcessing || agentMutationPending || resubmissionRequired}
              toolCount={toolCount}
              isStreaming={isProcessing}
              onStop={handleCancelTurn}
            />
          </div>

          {onboardingLoading ? (
            <div className="dh-onboarding-skeleton">
              <div className="skeleton-bar" />
              <div className="skeleton-bar short" />
            </div>
          ) : onboardingDiagram ? (
            <div className="dh-onboarding-diagram">
              <FlowDiagram data={onboardingDiagram} onAction={dispatchGuidedAction} />
            </div>
          ) : (
            <div className="dh-suggestions">
              {suggestions.map((text, i) => (
                <button key={text} className="dh-chip" onClick={() => handleSend(text)} type="button">
                  <SvgIcon d={SUGGESTION_ICONS[i]} />
                  {text}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
