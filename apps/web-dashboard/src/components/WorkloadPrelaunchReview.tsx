import { useEffect, useState } from 'react'
import type { WorkloadJsonValue } from '@StratCraft/types'
// TICKET_1370 R12/AC38+AC39: presentation of reviewed values is owned by the
// shared package, so the Guide WebUI and the Electron renderer cannot describe
// one confirmed plan differently. The surface formats; it never re-derives.
import {
  formatWorkloadMapAssignments,
  formatWorkloadScalar,
  isDisplayableMap,
} from '@StratCraft/workload-prelaunch'
import type {
  GuidedWorkloadPrelaunchReview,
  GuidedAction,
  GuidedActionDispatchResult,
} from '../types.ts'

interface Props {
  data: GuidedWorkloadPrelaunchReview
  onAction: (action: GuidedAction) => Promise<GuidedActionDispatchResult> | void
  /**
   * TICKET_1370 AC16: a newer review has replaced this one. The card stays
   * visible as history but must not be actionable -- its plan fingerprint is
   * stale, and its `validationErrors` describe a draft that no longer exists.
   */
  superseded?: boolean
}

type ParamValue = unknown

export function validationErrorIsPending(
  parameterIds: readonly string[],
  editedParameterIds: ReadonlySet<string>,
): boolean {
  return parameterIds.some(id => editedParameterIds.has(id))
}

function ParameterControl({
  id, value, editable, control, supportedChoices, validation, dateBounds, onChange,
}: {
  id: string
  value: ParamValue
  editable: boolean
  control: string
  supportedChoices?: unknown[]
  validation?: { minimum?: number; maximum?: number; step?: number }
  dateBounds?: { minimumDate?: string; maximumDate?: string }
  onChange: (id: string, value: ParamValue) => void
}) {
  // TICKET_1370 R12/AC39: a non-editable value is still a value the user is
  // accepting, so it is rendered readable, not as its transport encoding. A
  // keyed map becomes ordered `key -> value` assignments; the canonical value
  // itself is untouched and still drives the fingerprint and execution.
  if (!editable || control === 'readonly') {
    if (isDisplayableMap(value as WorkloadJsonValue)) {
      return (
        <div className="wz-assignments">
          {formatWorkloadMapAssignments(value as Record<string, WorkloadJsonValue>).map(assignment => (
            <span key={assignment.key} className="wz-assignment">
              {assignment.key} -&gt; {assignment.value}
            </span>
          ))}
        </div>
      )
    }
    return <code>{formatWorkloadScalar(value as WorkloadJsonValue)}</code>
  }

  if (control === 'multi-select' && supportedChoices && supportedChoices.length > 0) {
    const selected = new Set((Array.isArray(value) ? value as unknown[] : []).map(String))
    return (
      <div className="wz-seg">
        {supportedChoices.map(choice => {
          const key = String(choice)
          const active = selected.has(key)
          return (
            <button
              key={key}
              className={`wz-opt${active ? ' active' : ''}`}
              onClick={() => {
                const next = active
                  ? [...selected].filter(v => v !== key)
                  : [...selected, key]
                onChange(id, next)
              }}
            >
              {key}
            </button>
          )
        })}
      </div>
    )
  }

  if (control === 'select' && supportedChoices && supportedChoices.length > 0) {
    return (
      <select
        value={String(value ?? '')}
        onChange={e => {
          const raw = e.target.value
          const numeric = Number(raw)
          onChange(id, Number.isFinite(numeric) && raw === String(numeric) ? numeric : raw)
        }}
      >
        {value === undefined || value === null ? <option value="">--</option> : null}
        {supportedChoices.map(choice => (
          <option key={String(choice)} value={String(choice)}>{String(choice)}</option>
        ))}
      </select>
    )
  }

  if (control === 'number') {
    return (
      <input
        type="number"
        value={value === null ? '' : String(value)}
        min={validation?.minimum}
        max={validation?.maximum}
        step={validation?.step ?? 'any'}
        onChange={e => {
          const raw = e.target.value
          onChange(id, raw === '' ? null : Number(raw))
        }}
      />
    )
  }

  // TICKET_1370 R10/AC25: a native date picker, bounded by the authoritative
  // coverage range. The user selects a calendar day; the shared adapter owns
  // the conversion to the canonical half-open UTC interval, so no surface asks
  // anyone to type a transport timestamp.
  if (control === 'date' || control === 'datetime') {
    return (
      <input
        type="date"
        value={String(value ?? '')}
        min={dateBounds?.minimumDate}
        max={dateBounds?.maximumDate}
        onChange={e => onChange(id, e.target.value)}
      />
    )
  }

  if (control === 'tags') {
    return (
      <input
        type="text"
        value={Array.isArray(value) ? (value as unknown[]).join(', ') : String(value ?? '')}
        placeholder="comma-separated values"
        onChange={e => {
          const raw = e.target.value
          onChange(id, raw.split(',').map(s => s.trim()).filter(Boolean))
        }}
      />
    )
  }

  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={e => onChange(id, e.target.value)}
    />
  )
}

function MissingParameterControl({
  id, label, control, supportedChoices, validationRequirements, validation, dateBounds, onChange,
}: {
  id: string
  label: string
  control: string
  supportedChoices?: unknown[]
  validationRequirements?: string
  validation?: { minimum?: number; maximum?: number; step?: number }
  dateBounds?: { minimumDate?: string; maximumDate?: string }
  onChange: (id: string, value: ParamValue) => void
}) {
  if (control === 'select' && supportedChoices && supportedChoices.length > 0) {
    return (
      <div className="wz-field">
        <span>{label}</span>
        <select
          defaultValue=""
          onChange={e => {
            const raw = e.target.value
            if (!raw) return
            const numeric = Number(raw)
            onChange(id, Number.isFinite(numeric) && raw === String(numeric) ? numeric : raw)
          }}
        >
          <option value="" disabled>-- select --</option>
          {supportedChoices.map(choice => (
            <option key={String(choice)} value={String(choice)}>{String(choice)}</option>
          ))}
        </select>
      </div>
    )
  }

  if (control === 'multi-select' && supportedChoices && supportedChoices.length > 0) {
    return (
      <div className="wz-field">
        <span>{label}</span>
        <select
          defaultValue=""
          onChange={e => {
            const raw = e.target.value
            if (!raw) return
            const numeric = Number(raw)
            onChange(id, [Number.isFinite(numeric) && raw === String(numeric) ? numeric : raw])
          }}
        >
          <option value="" disabled>-- select --</option>
          {supportedChoices.map(choice => (
            <option key={String(choice)} value={String(choice)}>{String(choice)}</option>
          ))}
        </select>
      </div>
    )
  }

  if (control === 'number') {
    return (
      <div className="wz-field">
        <span>{label}{validationRequirements ? ` (${validationRequirements})` : ''}</span>
        <input
          type="number"
          min={validation?.minimum}
          max={validation?.maximum}
          step={validation?.step ?? 'any'}
          placeholder={validationRequirements ?? label}
          onChange={e => {
            const raw = e.target.value
            if (raw) onChange(id, Number(raw))
          }}
        />
      </div>
    )
  }

  // TICKET_1370 R10/AC25: same native date control as the resolved case.
  if (control === 'date' || control === 'datetime') {
    return (
      <div className="wz-field">
        <span>{label}{validationRequirements ? ` (${validationRequirements})` : ''}</span>
        <input
          type="date"
          min={dateBounds?.minimumDate}
          max={dateBounds?.maximumDate}
          onChange={e => {
            const raw = e.target.value
            if (raw) onChange(id, raw)
          }}
        />
      </div>
    )
  }

  if (control === 'tags') {
    return (
      <div className="wz-field">
        <span>{label}{validationRequirements ? ` (${validationRequirements})` : ''}</span>
        <input
          type="text"
          placeholder="comma-separated values"
          onChange={e => {
            const raw = e.target.value
            if (raw) onChange(id, raw.split(',').map(s => s.trim()).filter(Boolean))
          }}
        />
      </div>
    )
  }

  return (
    <div className="wz-field">
      <span>{label}{validationRequirements ? ` (${validationRequirements})` : ''}</span>
      <input
        type="text"
        placeholder={validationRequirements ?? label}
        onChange={e => {
          const raw = e.target.value
          if (raw) onChange(id, raw)
        }}
      />
    </div>
  )
}

export function WorkloadPrelaunchReview({ data, onAction, superseded = false }: Props) {
  const review = data.review
  const [edits, setEdits] = useState<Record<string, ParamValue>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [editInFlight, setEditInFlight] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setEdits({})
    setEditInFlight(false)
    setConfirmed(false)
    setActionError(null)
  }, [data])

  /**
   * TICKET_1370 R9/AC21: when a controlling parameter changes, drop pending
   * edits for inputs that its new value hides. Otherwise a symbol list typed
   * under `custom` would still be submitted after switching to `preset`, and
   * the owner would receive both inputs for one decision.
   */
  const handleChange = (id: string, value: ParamValue) => {
    setActionError(null)
    setEdits(prev => {
      const next = { ...prev, [id]: value }
      for (const parameter of [...review.parameters, ...review.missingRequired]) {
        const condition = parameter.visibleWhen
        if (condition?.parameterId !== id) continue
        if (!condition.equals.some(candidate => candidate === value)) delete next[parameter.id]
      }
      return next
    })
  }

  const hasEdits = Object.keys(edits).length > 0

  /**
   * TICKET_1370 R9/AC21: evaluate a parameter's `visibleWhen` against the
   * effective (edited-or-current) value of its controlling parameter, so
   * choosing a market-scope source immediately reveals that mode's input.
   *
   * This is generic contract evaluation, not parameter-name logic: the surface
   * never mentions `marketScopeSource`, `preset`, or `symbols`.
   */
  const effectiveValue = (id: string): ParamValue => {
    if (edits[id] !== undefined) return edits[id]
    return review.parameters.find(parameter => parameter.id === id)?.value
  }
  const isVisible = (visibleWhen?: { parameterId: string; equals: readonly unknown[] }): boolean => {
    if (visibleWhen === undefined) return true
    const current = effectiveValue(visibleWhen.parameterId)
    return visibleWhen.equals.some(candidate => candidate === current)
  }
  const editedParameterIds = new Set(Object.keys(edits))
  const activeValidationErrors = review.validationErrors.filter(
    error => !validationErrorIsPending(error.parameterIds, editedParameterIds),
  )
  const pendingValidationCount = review.validationErrors.length - activeValidationErrors.length
  /**
   * TICKET_1370 R12/AC37: the owner publishes the inactive input modes of a
   * conditional decision in `availableAlternatives`, so switching the source
   * reveals the other mode's control in the same render cycle. An alternative
   * that the pending choice has just activated becomes a real input; one the
   * user has switched away from disappears.
   *
   * Only `missingRequired` gates confirmation -- an inactive alternative does
   * not make the plan incomplete.
   */
  const alternatives = (review.availableAlternatives ?? []).filter(item => isVisible(item.visibleWhen))
  const visibleMissing = review.missingRequired.filter(item => isVisible(item.visibleWhen))
  const hasMissing = visibleMissing.length > 0
  const hasErrors = review.validationErrors.length > 0
  const settled = confirmed || editInFlight || superseded
  // TICKET_1370 AC16: `Confirm & launch` requires a clean review, but
  // `Apply edits & review` is precisely the control that repairs an unclean
  // one -- gating both on `canConfirm` made the errors unfixable, which is the
  // deadlock this ticket exists to remove. A superseded card is inert either
  // way: its plan fingerprint no longer describes the live draft.
  const canConfirm = !hasMissing && !hasErrors && !settled
  const canSubmit = hasEdits ? !settled : canConfirm

  /**
   * TICKET_1370 R11/AC31: the owner supplies the prompt and the work summary in
   * `estimatedWork`; the surface renders them and derives nothing. Keeping the
   * wording server-side is what stops a second surface from describing the same
   * plan differently.
   */
  const work = review.estimatedWork as Record<string, unknown> | undefined
  const reviewPrompt = typeof work?.reviewPrompt === 'string' ? work.reviewPrompt : undefined
  const workSummary = (() => {
    if (work === undefined) return null
    const parts: string[] = []
    if (typeof work.resolvedSymbolCount === 'number') parts.push(`${work.resolvedSymbolCount} symbols`)
    if (Array.isArray(work.timeframes) && work.timeframes.length > 0) {
      parts.push(`timeframes ${(work.timeframes as unknown[]).map(String).join(', ')}`)
    }
    if (typeof work.cells === 'number') parts.push(`${work.cells} cells`)
    return parts.length > 0 ? parts.join(' | ') : null
  })()

  const handleConfirm = async () => {
    if (hasEdits) {
      setEditInFlight(true)
      setActionError(null)
      const result = await onAction({
        type: 'tool',
        tool_name: 'edit_workload_review',
        args: {
          specification_id: review.specificationId,
          plan_fingerprint: review.planFingerprint,
          review,
          edits,
        },
      })
      if (result?.ok === false) {
        setEditInFlight(false)
        setActionError(result.error)
      }
    } else {
      setConfirmed(true)
      void onAction({
        type: 'tool',
        tool_name: 'confirm_factor_mining',
        args: {
          review,
          plan_fingerprint: review.planFingerprint,
        },
      })
    }
  }

  return (
    <section className="wizard panel workload-prelaunch-review">
      <div className="wz-head">
        <div className="wz-eyebrow">{review.specificationId}</div>
        <h3>Workload pre-launch review</h3>
      </div>

      {/*
        TICKET_1370 R11/AC31: authoritative defaults keep the review actionable,
        but a default is never an implicit launch. The owner-supplied prompt and
        work summary make the high-impact values visible as values the user is
        accepting, and state that editing them re-derives the plan (AC35).
      */}
      {reviewPrompt !== undefined && (
        <div className="agent-note" style={{ marginBottom: 12 }}>
          <strong>{reviewPrompt}</strong>
          {workSummary !== null && <div style={{ marginTop: 4 }}>{workSummary}</div>}
        </div>
      )}

      <div className="wz-fields">
        {review.parameters.filter(parameter => isVisible(parameter.visibleWhen)).map(parameter => (
          <div key={parameter.id} className={`wz-field${Array.isArray(parameter.value) ? ' full' : ''}`}>
            <span>
              {/*
                TICKET_1370 R12/AC38: the owner's authoritative label. Rendering
                `parameter.id` here is what put `MARKETSCOPESOURCE` and
                `HORIZONBYTIMEFRAME` in front of the user -- contract
                identifiers are transport, not presentation.
              */}
              {parameter.label}
              {parameter.provenance !== 'explicit' && (
                <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.6 }}>{parameter.provenance}</span>
              )}
            </span>
            <ParameterControl
              id={parameter.id}
              value={edits[parameter.id] !== undefined ? edits[parameter.id] : parameter.value}
              editable={parameter.editable}
              control={parameter.control ?? 'text'}
              supportedChoices={parameter.supportedChoices}
              validation={parameter.validation}
              dateBounds={parameter.dateBounds}
              onChange={handleChange}
            />
          </div>
        ))}
        {/*
          TICKET_1370 R12/AC37: an input mode the user has just selected is a
          normal parameter of the plan, not a gap -- it belongs beside the other
          fields, under the same heading, and NOT under "Missing required".
          Rendering it here is what makes the preset control and the symbol tag
          input alternate in place.
        */}
        {alternatives.map(item => (
          <MissingParameterControl
            key={item.id}
            id={item.id}
            label={item.label}
            control={item.control ?? 'text'}
            supportedChoices={item.supportedChoices}
            validationRequirements={item.validationRequirements}
            validation={item.validation}
            dateBounds={item.dateBounds}
            onChange={handleChange}
          />
        ))}
      </div>

      {hasMissing && (
        <>
          <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: 'var(--yellow, #e6a700)' }}>Missing required</h4>
          <div className="wz-fields">
            {/*
              TICKET_1370 R9: source-conditional inputs are hidden until their
              controlling parameter selects them. This replaced the R4 "Choose
              exactly one" repair UI, which exposed the storage representation
              as two peer fields instead of the one decision the user makes.
            */}
            {visibleMissing.map(item => (
              <MissingParameterControl
                key={item.id}
                id={item.id}
                label={item.label}
                control={item.control ?? 'text'}
                supportedChoices={item.supportedChoices}
                validationRequirements={item.validationRequirements}
                validation={item.validation}
                dateBounds={item.dateBounds}
                onChange={handleChange}
              />
            ))}
          </div>
        </>
      )}

      {activeValidationErrors.length > 0 && (
        <>
          <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: 'var(--red, #ff4d4d)' }}>Validation errors</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--red, #ff4d4d)' }}>
            {activeValidationErrors.map(error => (
              <li key={`${error.code}:${error.parameterIds.join(',')}`}>
                <code>{error.code}</code> [{error.parameterIds.join(', ')}]: {error.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {pendingValidationCount > 0 && (
        <div className="agent-note" style={{ marginTop: 12 }}>
          Changes entered. Waiting for server validation.
        </div>
      )}

      {actionError && (
        <div className="agent-note error" style={{ marginTop: 12 }} role="alert">
          Apply failed: {actionError}. Review the values and try again.
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
        fingerprint: {review.planFingerprint.slice(0, 16)}...
      </div>

      <div className="wz-actions">
        <button
          className={`btn${canSubmit ? ' solid' : ''}`}
          disabled={!canSubmit}
          onClick={() => { void handleConfirm() }}
        >
          {superseded
            ? 'Superseded'
            : confirmed
              ? 'Submitted'
              : editInFlight
                ? 'Applying...'
                : hasEdits ? 'Apply edits & review' : 'Confirm & launch'}
        </button>
      </div>
    </section>
  )
}
