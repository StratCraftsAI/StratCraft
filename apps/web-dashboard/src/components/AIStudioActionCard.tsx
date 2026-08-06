import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GuidedAIStudioAction } from '../types.ts'

interface Props {
  data: GuidedAIStudioAction
  onSend: (text: string) => void
}

function formatRuleValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function AIStudioActionCard({ data, onSend }: Props) {
  const { t } = useTranslation('dashboard')
  const [dispatched, setDispatched] = useState(false)

  const hasGenerate = data.available_actions.includes('generate_code')
  const rules = data.strategy_rules

  const handleGenerate = () => {
    setDispatched(true)
    onSend('Generate the strategy code now.')
  }

  return (
    <div
      className={`regime-config-card${dispatched ? ' resolved' : ''}`}
      data-testid="ai-studio-action-card"
    >
      <div className="regime-config-header">
        <div>
          <div className="regime-config-eyebrow">
            {t('agentChat.aiStudioAction.eyebrow')}
          </div>
          <h3>
            {hasGenerate
              ? t('agentChat.aiStudioAction.titleGenerate')
              : t('agentChat.aiStudioAction.eyebrow')}
          </h3>
        </div>
        <span className="regime-config-status">
          {dispatched
            ? t('agentChat.aiStudioAction.dispatched')
            : t('agentChat.aiStudioAction.review')}
        </span>
      </div>

      {rules && (
        <div className="regime-config-section filled">
          <div className="regime-config-section-title">
            {t('agentChat.aiStudioAction.strategyRules')}
          </div>
          <StrategyRulesSummary rules={rules} />
        </div>
      )}

      {data.strategy_code && (
        <div className="regime-config-section outline">
          <div className="regime-config-section-title">
            {data.class_name ?? 'Strategy Code'}
          </div>
          <pre
            style={{
              fontSize: 12,
              fontFamily: 'var(--mono)',
              color: 'var(--text-2)',
              overflowX: 'auto',
              maxHeight: 300,
              whiteSpace: 'pre-wrap',
              margin: 0,
              padding: '8px 10px',
            }}
          >
            {data.strategy_code}
          </pre>
        </div>
      )}

      {!dispatched && (
        <div className="regime-config-actions">
          {hasGenerate && (
            <button
              className="btn solid"
              type="button"
              data-testid="ai-studio-generate"
              onClick={handleGenerate}
            >
              {t('agentChat.aiStudioAction.generate')}
            </button>
          )}
        </div>
      )}

      {dispatched && (
        <div className="regime-config-verdict approved">
          {t('agentChat.aiStudioAction.dispatched')}
        </div>
      )}
    </div>
  )
}

function StrategyRulesSummary({ rules }: { rules: Record<string, unknown> }) {
  const { t } = useTranslation('dashboard')
  const entries = rules.entry_conditions ?? rules.entries ?? rules.entry
  const exits = rules.exit_conditions ?? rules.exits ?? rules.exit
  const indicators = rules.indicators ?? rules.indicator
  const status = rules.status

  if (!entries && !exits && !indicators) {
    const flat = Object.entries(rules).filter(
      ([key]) => key !== 'status' && key !== 'missing_fields',
    )
    if (flat.length === 0) {
      return <div className="regime-config-empty">{t('agentChat.aiStudioAction.noRules')}</div>
    }
    return (
      <dl className="ai-studio-rules-dl">
        {flat.map(([key, value]) => (
          <div key={key}>
            <dt>{key.replace(/_/g, ' ')}</dt>
            <dd>{formatRuleValue(value)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <div className="ai-studio-rules-structured">
      {entries != null && (
        <div>
          <div className="regime-config-subtitle">
            {t('agentChat.aiStudioAction.entryConditions')}
          </div>
          <RuleList items={entries} />
        </div>
      )}
      {exits != null && (
        <div>
          <div className="regime-config-subtitle">
            {t('agentChat.aiStudioAction.exitConditions')}
          </div>
          <RuleList items={exits} />
        </div>
      )}
      {indicators != null && (
        <div>
          <div className="regime-config-subtitle">
            {t('agentChat.aiStudioAction.indicators')}
          </div>
          <RuleList items={indicators} />
        </div>
      )}
      {typeof status === 'string' && (
        <div className="ai-studio-rules-status">
          <strong>Status:</strong> {status}
        </div>
      )}
    </div>
  )
}

function RuleList({ items }: { items: unknown }) {
  if (Array.isArray(items)) {
    return (
      <ul className="ai-studio-rules-list">
        {items.map((item, i) => (
          <li key={i}>
            {typeof item === 'object' && item !== null
              ? formatRuleObject(item as Record<string, unknown>)
              : String(item)}
          </li>
        ))}
      </ul>
    )
  }
  if (typeof items === 'object' && items !== null) {
    return (
      <dl className="ai-studio-rules-dl">
        {Object.entries(items as Record<string, unknown>).map(([key, value]) => (
          <div key={key}>
            <dt>{key.replace(/_/g, ' ')}</dt>
            <dd>{formatRuleValue(value)}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return <span>{String(items)}</span>
}

function formatRuleObject(obj: Record<string, unknown>): string {
  const type = obj.type ?? obj.direction ?? obj.name ?? ''
  const condition = obj.condition ?? obj.signal ?? obj.rule ?? ''
  if (type && condition) return `${String(type).toUpperCase()} - ${String(condition)}`
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${formatRuleValue(v)}`)
    .join(', ')
}
