/**
 * TICKET_1237_4: Tool-call trace for an agent turn.
 *
 * One row per tool call streamed via tool_call_started / tool_result;
 * rows expand to show request arguments. Terminal result payloads remain in
 * the bounded diagnostic sink and are never rendered here (TICKET_1352).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentToolTraceEntry } from '../types.ts'

interface Props {
  entries: AgentToolTraceEntry[]
}

export function AgentToolTrace({ entries }: Props) {
  const { t } = useTranslation('dashboard')
  if (entries.length === 0) return null

  return (
    <div className="agent-trace" data-testid="agent-trace">
      <div className="agent-trace-title">
        {t('agentChat.traceTitle', { count: entries.length })}
      </div>
      {entries.map((entry) => (
        <TraceRow key={entry.callId} entry={entry} />
      ))}
    </div>
  )
}

function TraceRow({ entry }: { entry: AgentToolTraceEntry }) {
  const { t } = useTranslation('dashboard')
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`agent-trace-row ${entry.status}`}>
      <button
        className="agent-trace-head"
        onClick={() => setExpanded((v) => !v)}
        type="button"
        data-testid="agent-trace-row"
      >
        <StatusGlyph status={entry.status} />
        <span className="agent-trace-name">{entry.toolName}</span>
        <span className={`agent-trace-status ${entry.status}`}>
          {t(`agentChat.status${STATUS_LABEL_SUFFIX[entry.status]}`)}
        </span>
        <span className="agent-trace-caret">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="agent-trace-detail">
          <div className="agent-trace-label">{t('agentChat.traceArgs')}</div>
          <pre>{JSON.stringify(entry.args, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

/**
 * TICKET_1323 AC7: `cancelled` gets its own label, not the failure label --
 * "this never ran" must be distinguishable from "this ran and failed".
 */
const STATUS_LABEL_SUFFIX: Record<AgentToolTraceEntry['status'], string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  cancelled: 'NotExecuted',
}

function StatusGlyph({ status }: { status: AgentToolTraceEntry['status'] }) {
  if (status === 'running') {
    return <span className="agent-trace-glyph running" aria-hidden="true" />
  }
  if (status === 'cancelled') {
    // A struck-through circle: terminal, but visually neither success nor
    // failure -- the call was skipped.
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M6 18L18 6" />
      </svg>
    )
  }
  if (status === 'error') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l5 5L20 6" />
    </svg>
  )
}
