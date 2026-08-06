import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'

/** One parameter declaration inside a template's PARAM_SCHEMA. */
interface ParamSpec {
  name: string
  type: 'int' | 'float' | 'enum' | 'dict' | string
  choices?: Array<string | number | boolean>
  range?: [number, number]
  default: string | number | boolean | Record<string, unknown>
  group?: string
}

/**
 * Shape returned by `list_sweep_templates`.
 *
 * Bridge path (Electron running): full `ToolSweepTemplate` with `param_schema`.
 * Fallback path (standalone MCP):  `{ templateId, isStaticEntry }` only.
 *
 * Fields use snake_case (bridge) or camelCase (fallback) depending on origin;
 * the normaliser below handles both.
 */
interface McpTemplateRow {
  templateId?: string
  template_id?: string
  isStaticEntry?: boolean
  description?: string
  modelType?: string
  model_type?: string
  param_schema?: {
    template_id: string
    params: ParamSpec[]
  }
}

interface TemplateRow {
  templateId: string
  isStaticEntry: boolean
  description: string
  modelType: string
  paramSchema: ParamSpec[]
  paramCount: number
}

interface Props {
  onUseInSweep?: (templateId: string) => void
}

/** Derive model type from template id (fallback when MCP response lacks it). */
function inferModelType(templateId: string): string {
  const id = templateId.toLowerCase()
  if (id.includes('xgboost')) return 'XGBoost'
  if (id.includes('lstm')) return 'LSTM'
  if (id.includes('mlp')) return 'MLP'
  if (id.includes('ridge')) return 'Ridge'
  if (id.includes('hmm')) return 'HMM'
  if (id.includes('ngram')) return 'N-gram'
  if (id.includes('rsi') || id.includes('macd') || id.includes('sma')) return 'TA'
  return 'ML'
}

/** Derive description i18n key from template id (fallback when MCP response lacks it). */
function inferDescriptionKey(templateId: string): string {
  const id = templateId.toLowerCase()
  if (id.includes('xgboost_return_v3')) return 'templates.descXgboostV3'
  if (id.includes('xgboost_return_v2')) return 'templates.descXgboostV2'
  if (id.includes('xgboost_return_v1')) return 'templates.descXgboostV1'
  if (id.includes('lstm')) return 'templates.descLstm'
  if (id.includes('mlp')) return 'templates.descMlp'
  if (id.includes('ridge')) return 'templates.descRidge'
  if (id.includes('hmm')) return 'templates.descHmm'
  if (id.includes('ngram')) return 'templates.descNgram'
  if (id.includes('rsi')) return 'templates.descRsi'
  if (id.includes('macd')) return 'templates.descMacd'
  if (id.includes('sma_cross')) return 'templates.descSmaCross'
  return 'templates.descDefault'
}

/** Normalise a raw MCP row into the canonical TemplateRow shape. */
function normaliseRow(raw: McpTemplateRow): TemplateRow {
  const templateId = raw.templateId ?? raw.template_id ?? ''
  const params = raw.param_schema?.params ?? []
  return {
    templateId,
    isStaticEntry: raw.isStaticEntry ?? false,
    description: raw.description ?? inferDescriptionKey(templateId),
    modelType: raw.modelType ?? raw.model_type ?? inferModelType(templateId),
    paramSchema: params,
    paramCount: params.length,
  }
}

/** Format a param default value for display. */
function formatDefault(val: string | number | boolean | Record<string, unknown>): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

/** Format param range or choices for display. */
function formatRangeOrChoices(param: ParamSpec): string {
  if (param.choices && param.choices.length > 0) {
    return param.choices.map(String).join(', ')
  }
  if (param.range) {
    return `${param.range[0]} – ${param.range[1]}`
  }
  return '—'
}

function modelTypeIcon(modelType: string): string {
  switch (modelType) {
    case 'XGBoost': return 'T'
    case 'LSTM': return 'R'
    case 'MLP': return 'N'
    case 'Ridge': return 'L'
    case 'HMM': return 'H'
    case 'N-gram': return 'G'
    case 'TA': return 'I'
    default: return 'M'
  }
}

export function TemplateBrowserPage({ onUseInSweep }: Props) {
  const { t } = useTranslation('dashboard')
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const data = await callTool('list_sweep_templates') as McpTemplateRow[]
      if (Array.isArray(data)) {
        setTemplates(data.map(normaliseRow))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = templates.filter((tpl) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return tpl.templateId.toLowerCase().includes(q) || tpl.modelType.toLowerCase().includes(q)
  })

  if (loading) {
    return (
      <div className="view-pad">
        <div className="view-head"><h1>{t('templates.title')}</h1></div>
        <div className="empty">
          <div className="glyph spin">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeLinecap="round" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>{t('header.processing')}</p>
        </div>
      </div>
    )
  }

  if (error && templates.length === 0) {
    return (
      <div className="view-pad">
        <div className="view-head"><h1>{t('templates.title')}</h1></div>
        <div className="empty">
          <div className="glyph" style={{ borderColor: 'var(--red)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
              <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3>{error}</h3>
        </div>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="view-pad">
        <div className="view-head"><h1>{t('templates.title')}</h1></div>
        <div className="empty">
          <div className="glyph">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3>{t('templates.emptyTitle')}</h3>
          <p>{t('templates.emptyDescription')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="view-pad">
      <div className="view-head">
        <h1>{t('templates.title')}</h1>
        <span className="sb-count">{t('templates.count', { count: filtered.length })}</span>
      </div>

      <div className="sb-toolbar">
        <div className="sb-filter-wrap">
          <svg className="sb-filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="sb-filter"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('templates.filter')}
          />
        </div>
      </div>

      <div className="tpl-grid">
        {filtered.map((tpl) => {
          const isExpanded = expandedId === tpl.templateId
          return (
            <div key={tpl.templateId} className={`tpl-card ${isExpanded ? 'expanded' : ''}`}>
              <div className="tpl-card-header" onClick={() => setExpandedId(isExpanded ? null : tpl.templateId)}>
                <div className="tpl-icon">
                  <span>{modelTypeIcon(tpl.modelType)}</span>
                </div>
                <div className="tpl-meta">
                  <div className="tpl-name">{tpl.templateId}</div>
                  <div className="tpl-desc">{t(tpl.description, tpl.description)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className="tag-mono" title={t('templates.paramCountLabel')}>
                    {tpl.paramCount > 0 ? t('templates.paramCountValue', { count: tpl.paramCount }) : '—'}
                  </span>
                  <span className="tag-mono">{tpl.modelType}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="tpl-detail">
                  <div className="tpl-detail-row">
                    <span className="tpl-detail-label">{t('templates.detailId')}</span>
                    <span className="tpl-detail-value mono">{tpl.templateId}</span>
                  </div>
                  <div className="tpl-detail-row">
                    <span className="tpl-detail-label">{t('templates.detailType')}</span>
                    <span className="tpl-detail-value">{tpl.modelType}</span>
                  </div>
                  <div className="tpl-detail-row">
                    <span className="tpl-detail-label">{t('templates.detailSource')}</span>
                    <span className="tpl-detail-value">{tpl.isStaticEntry ? t('templates.builtIn') : t('templates.discovered')}</span>
                  </div>
                  <div className="tpl-detail-row">
                    <span className="tpl-detail-label">{t('templates.detailParams')}</span>
                    <span className="tpl-detail-value">{tpl.paramCount > 0 ? String(tpl.paramCount) : '—'}</span>
                  </div>

                  {tpl.paramSchema.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="tpl-detail-label" style={{ marginBottom: 6 }}>{t('templates.paramSchemaTitle')}</div>
                      <table className="tpl-schema-table">
                        <thead>
                          <tr>
                            <th>{t('templates.schemaName')}</th>
                            <th>{t('templates.schemaType')}</th>
                            <th>{t('templates.schemaRangeChoices')}</th>
                            <th>{t('templates.schemaDefault')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tpl.paramSchema.map((p) => (
                            <tr key={p.name}>
                              <td className="mono">{p.name}</td>
                              <td>{p.type}</td>
                              <td>{formatRangeOrChoices(p)}</td>
                              <td className="mono">{formatDefault(p.default)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {tpl.paramSchema.length === 0 && (
                    <div style={{ marginTop: 8 }}>
                      <span className="tpl-detail-value" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {t('templates.noParamSchema')}
                      </span>
                    </div>
                  )}

                  {onUseInSweep && (
                    <div style={{ marginTop: 12 }}>
                      <button className="btn solid" onClick={() => onUseInSweep(tpl.templateId)}>
                        {t('templates.useInSweep')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
