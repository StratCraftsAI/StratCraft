import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GuidedWizardStep, GuidedAction, WizardField } from '../types'

interface Props {
  data: GuidedWizardStep
  onAction: (action: GuidedAction) => void
}

export function WizardStep({ data, onAction }: Props) {
  const { t } = useTranslation('dashboard')
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const field of data.fields) {
      if ('default' in field && field.default !== undefined) {
        initial[field.name] = field.default
      }
    }
    return initial
  })

  function handleNext() {
    if (data.confirm_action && data.step_index === data.total_steps - 1) {
      onAction(data.confirm_action)
      return
    }
    const merged = { ...(data.accumulated_data ?? {}), ...formData }
    onAction({
      type: 'wizard',
      wizard_id: `${data.wizard_id}:${data.step_index + 1}:${JSON.stringify(merged)}`,
    })
  }

  function handleBack() {
    onAction({
      type: 'wizard',
      wizard_id: `${data.wizard_id}:${data.step_index - 1}:{}`,
    })
  }

  function updateField(name: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const progressPct = ((data.step_index + 1) / data.total_steps) * 100

  return (
    <div className="wizard panel">
      <div className="wz-head">
        <div className="wz-eyebrow">{data.wizard_id.replace(/_/g, ' ')}</div>
        <div className="wz-head-row">
          <h3>{data.title}</h3>
          <div className="wz-step-counter">
            {t('wizard.stepProgress', { current: data.step_index + 1, total: data.total_steps })}
          </div>
        </div>
        <div className="wz-progress-bar">
          <div className="wz-bar" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {data.description && (
        <div className="ip-body" style={{ marginBottom: 14 }}>{data.description}</div>
      )}

      <div className="wz-fields">
        {data.fields.map((field) => (
          <FieldRenderer key={'name' in field ? field.name : field.label} field={field} value={formData} onChange={updateField} />
        ))}
      </div>

      <div className="wz-actions">
        {data.back_enabled && (
          <button onClick={handleBack} className="btn ghost sm">{t('wizard.back')}</button>
        )}
        <button onClick={handleNext} className="btn sm">
          {data.step_index === data.total_steps - 1 ? t('wizard.confirm') : t('wizard.next')}
        </button>
      </div>
    </div>
  )
}

function FieldRenderer({ field, value, onChange }: { field: WizardField; value: Record<string, unknown>; onChange: (name: string, val: unknown) => void }) {
  if (field.type === 'info_row') {
    return (
      <div className="wz-field full" style={{ flexDirection: 'row', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
        <span>{field.label}</span>
        <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12 }}>{field.value}</span>
      </div>
    )
  }

  const currentValue = value[field.name]

  if (field.type === 'select') {
    return (
      <label className="wz-field">
        {field.label}
        <select
          value={(currentValue as string) ?? field.default ?? ''}
          onChange={(e) => onChange(field.name, e.target.value)}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}{opt.description ? ` — ${opt.description}` : ''}</option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === 'multi_select') {
    const selected = (currentValue as string[]) ?? field.default ?? []
    return (
      <label className="wz-field full">
        {field.label}
        <div className="wz-seg">
          {field.options.map((opt) => {
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

  if (field.type === 'number') {
    return (
      <label className="wz-field">
        {field.label}
        <input
          type="number"
          value={(currentValue as number) ?? field.default ?? ''}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(field.name, Number(e.target.value))}
        />
      </label>
    )
  }

  if (field.type === 'text') {
    return (
      <label className="wz-field">
        {field.label}
        <input
          type="text"
          value={(currentValue as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      </label>
    )
  }

  return null
}
