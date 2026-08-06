import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import type { GuidedFieldManifest, GuidedAction, ManifestField, DataSource, WizardOption } from '../types.ts'

interface Props {
  data: GuidedFieldManifest
  onAction: (action: GuidedAction) => void
}

interface FieldState {
  options: WizardOption[]
  value: unknown
  loading: boolean
  error: string | null
}

const STATIC_TIMEFRAMES: WizardOption[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1d' },
]

async function resolveOptions(ds: DataSource, t: (key: string, opts?: Record<string, unknown>) => string): Promise<WizardOption[]> {
  switch (ds.type) {
    case 'strategy_signals': {
      const result = await callTool('list_signal_sources') as Array<{ id: string; name: string; template_id: string }>
      return result.map((s) => ({ value: String(s.id), label: s.name || s.template_id }))
    }
    case 'trained_signals': {
      const result = await callTool('get_signal_scoreboard', { limit: 50 }) as Array<{ algo_id: string; template_id: string; score: number }>
      return result.map((s) => ({ value: String(s.algo_id), label: s.template_id, description: t('fieldManifest.score', { score: s.score }) }))
    }
    case 'available_providers':
      return [
        { value: 'yfinance', label: 'Yahoo Finance' },
        { value: 'databento', label: 'Databento' },
        { value: 'dukascopy', label: 'Dukascopy' },
        { value: 'ccxt', label: 'CCXT' },
      ]
    case 'provider_symbols': {
      const result = await callTool('list_strategies', { limit: 1 }) as unknown
      return Array.isArray(result) ? [] : []
    }
    case 'timeframes':
      return STATIC_TIMEFRAMES
    case 'strategies': {
      const result = await callTool('list_strategies', { limit: 50 }) as Array<{ id: number; name: string; code: string }>
      return result.map((s) => ({ value: String(s.id), label: s.name || s.code }))
    }
    case 'templates': {
      const result = await callTool('list_sweep_templates') as Array<{ template_id: string; display_name?: string }>
      return result.map((tmpl) => ({ value: tmpl.template_id, label: tmpl.display_name || tmpl.template_id }))
    }
    case 'static':
      return ds.options.map((o) => ({ value: o.value, label: o.label }))
    case 'provider_date_range':
      return []
    default:
      return []
  }
}

export function FieldManifestCard({ data, onAction }: Props) {
  const { t } = useTranslation('dashboard')
  const [fields, setFields] = useState<Record<string, FieldState>>({})
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    const initial: Record<string, FieldState> = {}
    for (const field of data.fields) {
      initial[field.name] = { options: [], value: getDefaultValue(field), loading: !isDependentField(field, data.fields), error: null }
    }
    setFields(initial)

    for (const field of data.fields) {
      if (!isDependentField(field, data.fields)) {
        resolveOptions(field.data_source, t)
          .then((options) => {
            setFields((prev) => ({
              ...prev,
              [field.name]: { ...prev[field.name], options, loading: false, value: prefill(field, options, prev[field.name]?.value) },
            }))
          })
          .catch((err) => {
            setFields((prev) => ({
              ...prev,
              [field.name]: { ...prev[field.name], loading: false, error: err instanceof Error ? err.message : String(err) },
            }))
          })
      }
    }
  }, [data, t])

  const resolveDependent = useCallback((fieldName: string, parentValue: unknown) => {
    const field = data.fields.find((f) => f.name === fieldName)
    if (!field) return

    setFields((prev) => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], loading: true, options: [], value: getDefaultValue(field), error: null },
    }))

    resolveOptions(field.data_source, t)
      .then((options) => {
        setFields((prev) => ({
          ...prev,
          [fieldName]: { ...prev[fieldName], options, loading: false, value: prefill(field, options, undefined) },
        }))
      })
      .catch((err) => {
        setFields((prev) => ({
          ...prev,
          [fieldName]: { ...prev[fieldName], loading: false, error: err instanceof Error ? err.message : String(err) },
        }))
      })
  }, [data.fields, t])

  const handleChange = useCallback((fieldName: string, value: unknown) => {
    setFields((prev) => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], value },
    }))

    const dependents = data.fields.filter((f) => f.depends_on === fieldName)
    for (const dep of dependents) {
      resolveDependent(dep.name, value)
    }
  }, [data.fields, resolveDependent])

  const handleRun = useCallback(async () => {
    setExecuting(true)
    try {
      const args: Record<string, unknown> = { name: data.action_name }
      const actionArgs: Record<string, unknown> = {}
      for (const field of data.fields) {
        const state = fields[field.name]
        if (state?.value !== undefined && state.value !== null && state.value !== '') {
          actionArgs[field.name] = state.value
        }
      }
      args.args = actionArgs
      onAction({ type: 'tool', tool_name: 'run_action', args })
    } finally {
      setExecuting(false)
    }
  }, [data, fields, onAction])

  const allResolved = data.fields.every((f) => {
    const state = fields[f.name]
    if (!state) return false
    if (state.loading) return false
    if (f.required && (state.value === undefined || state.value === null || state.value === '')) return false
    return true
  })

  return (
    <div className="wizard panel">
      <div className="wz-head">
        <div className="wz-eyebrow">{data.action_name.replace(/\//g, ' / ')}</div>
        <h3>{data.explanation}</h3>
      </div>

      <div className="wz-fields">
        {data.fields.map((field) => {
          const state = fields[field.name]
          if (!state) return null
          return (
            <ManifestFieldRenderer
              key={field.name}
              field={field}
              state={state}
              onChange={handleChange}
            />
          )
        })}
      </div>

      <div className="wz-actions">
        <button onClick={handleRun} className="btn sm" disabled={!allResolved || executing}>
          {executing ? t('fieldManifest.executing') : t('fieldManifest.run')}
        </button>
      </div>
    </div>
  )
}

function ManifestFieldRenderer({ field, state, onChange }: {
  field: ManifestField
  state: FieldState
  onChange: (name: string, value: unknown) => void
}) {
  const { t } = useTranslation('dashboard')

  if (state.loading) {
    return (
      <label className="wz-field">
        {field.label}
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('fieldManifest.loading')}</span>
      </label>
    )
  }

  if (state.error) {
    return (
      <label className="wz-field">
        {field.label}
        <span style={{ color: 'var(--red)', fontSize: 12 }}>{state.error}</span>
      </label>
    )
  }

  if (field.field_type === 'select') {
    return (
      <label className="wz-field">
        {field.label}
        {field.description && <span style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginBottom: 4 }}>{field.description}</span>}
        <select
          value={(state.value as string) ?? ''}
          onChange={(e) => onChange(field.name, e.target.value)}
        >
          <option value="">--</option>
          {state.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}{opt.description ? ` -- ${opt.description}` : ''}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.field_type === 'multi_select') {
    const selected = (state.value as string[]) ?? []
    return (
      <label className="wz-field full">
        {field.label}
        {field.description && <span style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginBottom: 4 }}>{field.description}</span>}
        <div className="wz-seg">
          {state.options.map((opt) => {
            const active = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => {
                  const next = active ? selected.filter((v) => v !== opt.value) : [...selected, opt.value]
                  onChange(field.name, next)
                }}
                className={`wz-opt${active ? ' active' : ''}`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </label>
    )
  }

  if (field.field_type === 'number') {
    return (
      <label className="wz-field">
        {field.label}
        <input
          type="number"
          value={(state.value as number) ?? ''}
          onChange={(e) => onChange(field.name, Number(e.target.value))}
        />
      </label>
    )
  }

  if (field.field_type === 'text') {
    return (
      <label className="wz-field">
        {field.label}
        <input
          type="text"
          value={(state.value as string) ?? ''}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      </label>
    )
  }

  if (field.field_type === 'date_range') {
    const range = (state.value as { start?: string; end?: string }) ?? {}
    return (
      <label className="wz-field full">
        {field.label}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="date"
            value={range.start ?? ''}
            onChange={(e) => onChange(field.name, { ...range, start: e.target.value })}
          />
          <span style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>~</span>
          <input
            type="date"
            value={range.end ?? ''}
            onChange={(e) => onChange(field.name, { ...range, end: e.target.value })}
          />
        </div>
      </label>
    )
  }

  return null
}

function isDependentField(field: ManifestField, allFields: ManifestField[]): boolean {
  return !!field.depends_on && allFields.some((f) => f.name === field.depends_on)
}

function getDefaultValue(field: ManifestField): unknown {
  if (field.field_type === 'multi_select') return []
  if (field.field_type === 'date_range') return {}
  return undefined
}

function prefill(field: ManifestField, options: WizardOption[], currentValue: unknown): unknown {
  if (currentValue !== undefined && currentValue !== null) return currentValue
  if (field.field_type === 'multi_select') return options.map((o) => o.value)
  if (field.field_type === 'select' && options.length > 0) return options[0].value
  return getDefaultValue(field)
}
