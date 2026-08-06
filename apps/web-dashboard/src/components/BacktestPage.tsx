/**
 * TICKET_1236_7: Webui Backtest Page
 *
 * Thin view over the 1235_4 MCP backtest tools (8 tools).
 * Sections: run config form, queue/status (live via event-stream),
 * results list (click navigates to result detail).
 *
 * Auth: reads free, writes requireAuth, cancel_all = confirm dialog.
 * State machine: loading -> ready | offline | error (per pilot 1236_2).
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import { isAuthenticated } from '../auth-session.ts'
import { subscribe, registerFallback, onStateChange } from '../event-stream.ts'
import { BACKTEST_QUEUE_POLL_INTERVAL_MS } from '../constants.ts'

// ── Data types mirroring MCP tool response shapes ───────────────────────────

export interface BacktestResultRow {
  task_id: string
  strategy_name: string
  symbol: string
  timeframe: string
  start_date: string
  end_date: string
  initial_capital: number
  final_capital: number
  total_pnl: number
  total_return: number
  sharpe_ratio: number
  max_drawdown: number
  win_rate: number
  profit_factor: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  execution_time_ms: number
  created_at: string
}

export interface QueueTask {
  taskId: string
  status: string
  strategyName?: string
  createdAt: number
}

export interface QueueStatus {
  tasks: QueueTask[]
  activeCount: number
  queuedCount: number
}

export interface BacktestProgress {
  phase?: string
  progress: number
  detail?: string | null
  elapsedMs?: number | null
}

// ── State machine ───────────────────────────────────────────────────────────

export type BacktestPageState = 'loading' | 'ready' | 'offline' | 'error'

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isOfflineError(msg: string): boolean {
  return msg.includes('not running') || msg.includes('Failed to fetch')
}

export function formatEpoch(epoch: number | string): string {
  if (!epoch) return '-'
  const d = typeof epoch === 'string' ? new Date(epoch) : new Date(epoch)
  return d.toLocaleString()
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return '-'
  return `${(value * 100).toFixed(2)}%`
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '-'
  return value.toFixed(decimals)
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── Confirm Dialog ──────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation('dashboard')
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 24,
          maxWidth: 420,
          width: '90%',
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{title}</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── SectionCard ────────────────────────────────────────────────────────────

function SectionCard({ filled, children }: { filled: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${filled ? 'var(--section-filled-border)' : 'var(--section-outline-border)'}`,
        background: filled ? 'var(--section-filled-bg)' : 'var(--section-outline-bg)',
        borderRadius: 'var(--radius)',
        padding: 16,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  )
}

// ── DegradedNotice ─────────────────────────────────────────────────────────

function DegradedNotice() {
  const { t } = useTranslation('dashboard')
  return (
    <div
      data-testid="degraded-notice"
      style={{
        padding: '6px 12px',
        background: 'rgba(245, 176, 74, 0.1)',
        border: '1px solid rgba(245, 176, 74, 0.3)',
        borderRadius: 'var(--radius)',
        fontSize: 11,
        color: 'var(--text-2)',
        marginBottom: 8,
      }}
    >
      {t('backtest.degradedNotice')}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

interface Props {
  onLogin: () => void
  onNavigateResult: (taskId: string) => void
}

export function BacktestPage({ onLogin, onNavigateResult }: Props) {
  const { t } = useTranslation('dashboard')
  const [pageState, setPageState] = useState<BacktestPageState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [results, setResults] = useState<BacktestResultRow[]>([])
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [progress, setProgress] = useState<BacktestProgress | null>(null)
  const [sseConnected, setSseConnected] = useState(false)
  const [sseDegraded, setSseDegraded] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogProps | null>(null)

  // ── Run form state ────────────────────────────────────────────────
  const [formAlgorithmId, setFormAlgorithmId] = useState('')
  const [formSymbol, setFormSymbol] = useState('AAPL')
  const [formInterval, setFormInterval] = useState('1d')
  const [formStartDate, setFormStartDate] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formInitialCapital, setFormInitialCapital] = useState('100000')
  const [formCommission, setFormCommission] = useState('0.001')
  const [formSlippage, setFormSlippage] = useState('0.0001')
  const [formAllowShort, setFormAllowShort] = useState(true)
  const [formDataSource, setFormDataSource] = useState('yfinance')
  const [formDryRun, setFormDryRun] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Load data ─────────────────────────────────────────────────────

  const loadResults = useCallback(async () => {
    try {
      const data = await callTool('list_backtest_results', { limit: 50 })
      if (Array.isArray(data)) {
        setResults(data as BacktestResultRow[])
      }
      setPageState('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isOfflineError(msg)) {
        setPageState('offline')
      } else {
        setErrorMsg(msg)
        setPageState('error')
      }
    }
  }, [])

  const loadQueue = useCallback(async () => {
    try {
      const data = await callTool('get_backtest_queue')
      const queueData = data as { data?: QueueStatus } | QueueStatus
      if ('data' in queueData && queueData.data) {
        setQueue(queueData.data)
      } else if ('tasks' in queueData) {
        setQueue(queueData as QueueStatus)
      }
    } catch {
      // queue unavailable -- offline section handles this
    }
  }, [])

  useEffect(() => {
    void loadResults()
    void loadQueue()
  }, [loadResults, loadQueue])

  // ── Queue polling ─────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(loadQueue, BACKTEST_QUEUE_POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [loadQueue])

  // ── SSE progress channel ──────────────────────────────────────────

  useEffect(() => {
    const unsubEvent = subscribe('backtest-progress', (data) => {
      setProgress(data as BacktestProgress)
    })
    const unsubFallback = registerFallback('backtest-progress', {
      toolName: 'get_backtest_status',
      args: {},
    })
    const unsubState = onStateChange((state) => {
      setSseConnected(state.connected)
      setSseDegraded(state.degraded)
    })
    return () => {
      unsubEvent()
      unsubFallback()
      unsubState()
    }
  }, [])

  // ── Actions ───────────────────────────────────────────────────────

  const handleRunBacktest = useCallback(async () => {
    if (!isAuthenticated()) { onLogin(); return }
    const algorithmId = parseInt(formAlgorithmId, 10)
    if (isNaN(algorithmId)) {
      setErrorMsg(t('backtest.invalidAlgorithmId'))
      return
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const args: Record<string, unknown> = {
        algorithm_id: algorithmId,
        symbol: formSymbol,
        interval: formInterval,
        initial_capital: parseFloat(formInitialCapital),
        commission: parseFloat(formCommission),
        slippage: parseFloat(formSlippage),
        allow_short: formAllowShort,
        data_source: formDataSource,
        dry_run: formDryRun,
      }
      if (formStartDate) args.start_date = formStartDate
      if (formEndDate) args.end_date = formEndDate
      await callTool('run_backtest', args)
      void loadQueue()
      void loadResults()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    formAlgorithmId, formSymbol, formInterval, formStartDate, formEndDate,
    formInitialCapital, formCommission, formSlippage, formAllowShort,
    formDataSource, formDryRun, onLogin, loadQueue, loadResults, t,
  ])

  const handleCancelBacktest = useCallback(async (taskId: string) => {
    if (!isAuthenticated()) { onLogin(); return }
    try {
      await callTool('cancel_backtest', { task_id: taskId })
      void loadQueue()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }, [onLogin, loadQueue])

  const handleCancelAll = useCallback(() => {
    if (!isAuthenticated()) { onLogin(); return }
    setConfirmDialog({
      title: t('backtest.confirmCancelAllTitle'),
      message: t('backtest.confirmCancelAllMsg'),
      confirmLabel: t('backtest.cancelAll'),
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await callTool('cancel_all_backtests', { confirm: true })
          void loadQueue()
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : String(err))
        }
      },
      onCancel: () => setConfirmDialog(null),
    })
  }, [onLogin, loadQueue, t])

  // ── Render: loading / offline / error ─────────────────────────────

  if (pageState === 'loading') {
    return (
      <div className="view-pad" data-testid="backtest-page">
        <div className="view-head"><h2>{t('backtest.title')}</h2></div>
        <div className="empty"><span className="glyph spin">&#9881;</span> {t('backtest.loading')}</div>
      </div>
    )
  }

  if (pageState === 'offline') {
    return (
      <div className="view-pad" data-testid="backtest-page">
        <div className="view-head"><h2>{t('backtest.title')}</h2></div>
        <div className="empty">
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('backtest.offlineTitle')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('backtest.offlineDescription')}</p>
        </div>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div className="view-pad" data-testid="backtest-page">
        <div className="view-head"><h2>{t('backtest.title')}</h2></div>
        <div className="empty">
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('backtest.errorTitle')}</p>
          {errorMsg && <p data-testid="error-message" style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>{errorMsg}</p>}
          <button className="btn ghost" onClick={() => { setPageState('loading'); void loadResults() }}>{t('backtest.retry')}</button>
        </div>
      </div>
    )
  }

  // ── Render: ready ─────────────────────────────────────────────────

  const hasActiveQueue = queue && (queue.activeCount > 0 || queue.queuedCount > 0)

  return (
    <div className="view-pad" data-testid="backtest-page">
      <div className="view-head">
        <h2>{t('backtest.title')}</h2>
      </div>

      {errorMsg && (
        <div data-testid="error-message" style={{ padding: '8px 12px', background: 'rgba(255,77,77,0.1)', border: '1px solid rgba(255,77,77,0.3)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-2)', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{errorMsg}</span>
          <button className="btn ghost" onClick={() => setErrorMsg(null)} style={{ fontSize: 11 }}>{t('backtest.dismiss')}</button>
        </div>
      )}

      {sseDegraded && <DegradedNotice />}

      {/* ── Run Config Form ──────────────────────────────────────── */}
      <SectionCard filled>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>{t('backtest.runSection')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.algorithmId')}</span>
            <input
              data-testid="algorithm-id-input"
              type="number"
              value={formAlgorithmId}
              onChange={(e) => setFormAlgorithmId(e.target.value)}
              placeholder={t('backtest.algorithmIdPlaceholder')}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.symbol')}</span>
            <input
              data-testid="symbol-input"
              value={formSymbol}
              onChange={(e) => setFormSymbol(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.interval')}</span>
            <select data-testid="interval-select" value={formInterval} onChange={(e) => setFormInterval(e.target.value)} style={inputStyle}>
              {['1m', '5m', '15m', '1h', '4h', '1d'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.dataSource')}</span>
            <select data-testid="data-source-select" value={formDataSource} onChange={(e) => setFormDataSource(e.target.value)} style={inputStyle}>
              {['yfinance', 'dukascopy', 'clickhouse'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.startDate')}</span>
            <input data-testid="start-date-input" type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.endDate')}</span>
            <input data-testid="end-date-input" type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.initialCapital')}</span>
            <input data-testid="initial-capital-input" type="number" value={formInitialCapital} onChange={(e) => setFormInitialCapital(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.commission')}</span>
            <input data-testid="commission-input" type="number" step="0.0001" value={formCommission} onChange={(e) => setFormCommission(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>{t('backtest.slippage')}</span>
            <input data-testid="slippage-input" type="number" step="0.0001" value={formSlippage} onChange={(e) => setFormSlippage(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input data-testid="allow-short-input" type="checkbox" checked={formAllowShort} onChange={(e) => setFormAllowShort(e.target.checked)} />
            <span style={labelTextStyle}>{t('backtest.allowShort')}</span>
          </label>
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input data-testid="dry-run-input" type="checkbox" checked={formDryRun} onChange={(e) => setFormDryRun(e.target.checked)} />
            <span style={labelTextStyle}>{t('backtest.dryRun')}</span>
          </label>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            data-testid="run-btn"
            className="btn"
            disabled={submitting || !formAlgorithmId}
            onClick={handleRunBacktest}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            {submitting ? t('backtest.submitting') : t('backtest.run')}
          </button>
        </div>
      </SectionCard>

      {/* ── Queue / Status ───────────────────────────────────────── */}
      <SectionCard filled={false}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t('backtest.queueSection')}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: sseConnected ? 'var(--green)' : 'var(--text-muted)' }}>
              {sseConnected ? t('backtest.live') : t('backtest.polling')}
            </span>
            {hasActiveQueue && (
              <button
                data-testid="cancel-all-btn"
                className="btn danger"
                onClick={handleCancelAll}
                style={{ fontSize: 11 }}
              >
                {t('backtest.cancelAll')}
              </button>
            )}
          </div>
        </div>

        {progress && (
          <div data-testid="progress-bar" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
              <span>{progress.phase ?? t('backtest.running')}</span>
              <span>{formatPct(progress.progress / 100)}</span>
            </div>
            <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(progress.progress, 100)}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            {progress.detail && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{progress.detail}</div>}
            {progress.elapsedMs != null && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{t('backtest.elapsed')}: {formatMs(progress.elapsedMs)}</div>}
          </div>
        )}

        {queue && queue.tasks.length > 0 ? (
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>{t('backtest.colTaskId')}</th>
                <th style={thStyle}>{t('backtest.colStrategy')}</th>
                <th style={thStyle}>{t('backtest.colStatus')}</th>
                <th style={thStyle}>{t('backtest.colEnqueued')}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {queue.tasks.map((task) => (
                <tr key={task.taskId} data-testid={`queue-row-${task.taskId}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}><span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{task.taskId.slice(0, 8)}</span></td>
                  <td style={tdStyle}>{task.strategyName ?? '-'}</td>
                  <td style={tdStyle}>{t(`status.${task.status}`, task.status)}</td>
                  <td style={tdStyle}>{formatEpoch(task.createdAt)}</td>
                  <td style={tdStyle}>
                    {(task.status === 'queued' || task.status === 'running') && (
                      <button
                        data-testid={`cancel-btn-${task.taskId}`}
                        className="btn ghost"
                        onClick={() => handleCancelBacktest(task.taskId)}
                        style={{ fontSize: 10, padding: '2px 6px' }}
                      >
                        {t('backtest.cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>{t('backtest.queueEmpty')}</div>
        )}
      </SectionCard>

      {/* ── Results List ──────────────────────────────────────────── */}
      <SectionCard filled>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('backtest.resultsSection')}</h3>
        {results.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle}>{t('backtest.colStrategy')}</th>
                  <th style={thStyle}>{t('backtest.colSymbol')}</th>
                  <th style={thStyle}>{t('backtest.colTimeframe')}</th>
                  <th style={thStyle}>{t('backtest.colReturn')}</th>
                  <th style={thStyle}>{t('backtest.colSharpe')}</th>
                  <th style={thStyle}>{t('backtest.colDrawdown')}</th>
                  <th style={thStyle}>{t('backtest.colTrades')}</th>
                  <th style={thStyle}>{t('backtest.colCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr
                    key={row.task_id}
                    data-testid={`result-row-${row.task_id}`}
                    onClick={() => onNavigateResult(row.task_id)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <td style={tdStyle}>{row.strategy_name}</td>
                    <td style={tdStyle}>{row.symbol}</td>
                    <td style={tdStyle}>{row.timeframe}</td>
                    <td style={tdStyle}>{formatPct(row.total_return)}</td>
                    <td style={tdStyle}>{formatNumber(row.sharpe_ratio)}</td>
                    <td style={tdStyle}>{formatPct(row.max_drawdown)}</td>
                    <td style={tdStyle}>{row.total_trades}</td>
                    <td style={tdStyle}>{formatEpoch(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>{t('backtest.noResults')}</div>
        )}
      </SectionCard>

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  )
}

// ── Shared inline styles ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const labelTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-2)',
  fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text)',
  fontFamily: 'var(--sans)',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  color: 'var(--text-muted)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 8px',
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
}
