/**
 * TICKET_1236_7: Webui Backtest Result Page
 *
 * Single-result detail view: metrics readout + per-mode telemetry +
 * dependency-free inline SVG equity sparkline + running-state header
 * driven by backtest-progress SSE events.
 *
 * Auth: reads free. Back navigation to backtest list.
 * State machine: loading -> ready | offline | error.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import { subscribe, onStateChange } from '../event-stream.ts'
import type { BacktestProgress } from './BacktestPage.tsx'

// ── Data types ──────────────────────────────────────────────────────────────

export interface BacktestDetail {
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
  equity_curve?: number[]
}

export interface TelemetryByMode {
  [mode: string]: { success: number; failed: number }
}

export type ResultPageState = 'loading' | 'ready' | 'offline' | 'error'

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isOfflineError(msg: string): boolean {
  return msg.includes('not running') || msg.includes('Failed to fetch')
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

export function formatEpoch(epoch: number | string): string {
  if (!epoch) return '-'
  const d = typeof epoch === 'string' ? new Date(epoch) : new Date(epoch)
  return d.toLocaleString()
}

// ── SVG Equity Sparkline ────────────────────────────────────────────────────

export function equitySparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = width / (values.length - 1)
  const points = values.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return `M${points.join('L')}`
}

const SPARKLINE_WIDTH = 400
const SPARKLINE_HEIGHT = 80

function EquitySparkline({ values }: { values: number[] }) {
  const path = equitySparklinePath(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT)
  if (!path) return null
  const isPositive = values.length >= 2 && values[values.length - 1] >= values[0]
  const color = isPositive ? 'var(--green)' : 'var(--red)'
  return (
    <svg
      data-testid="equity-sparkline"
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      style={{ display: 'block', margin: '8px 0' }}
    >
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
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

// ── MetricCard ─────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{value}</div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

interface Props {
  taskId: string
  onBack: () => void
}

export function BacktestResultPage({ taskId, onBack }: Props) {
  const { t } = useTranslation('dashboard')
  const [pageState, setPageState] = useState<ResultPageState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [detail, setDetail] = useState<BacktestDetail | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryByMode | null>(null)
  const [progress, setProgress] = useState<BacktestProgress | null>(null)
  const [sseConnected, setSseConnected] = useState(false)

  const loadDetail = useCallback(async () => {
    try {
      const data = await callTool('get_backtest_result', { task_id: taskId })
      setDetail(data as BacktestDetail)
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
  }, [taskId])

  const loadTelemetry = useCallback(async () => {
    try {
      const data = await callTool('get_backtest_telemetry_by_mode')
      setTelemetry(data as TelemetryByMode)
    } catch {
      // telemetry unavailable -- non-critical
    }
  }, [])

  useEffect(() => {
    void loadDetail()
    void loadTelemetry()
  }, [loadDetail, loadTelemetry])

  // ── SSE for running-state header ──────────────────────────────────

  useEffect(() => {
    const unsubEvent = subscribe('backtest-progress', (data) => {
      setProgress(data as BacktestProgress)
    })
    const unsubState = onStateChange((state) => {
      setSseConnected(state.connected)
    })
    return () => {
      unsubEvent()
      unsubState()
    }
  }, [])

  // ── Render: loading / offline / error ─────────────────────────────

  if (pageState === 'loading') {
    return (
      <div className="view-pad" data-testid="backtest-result-page">
        <div className="view-head">
          <button className="btn ghost" onClick={onBack} style={{ marginRight: 8 }}>&larr;</button>
          <h2>{t('backtestResult.title')}</h2>
        </div>
        <div className="empty"><span className="glyph spin">&#9881;</span> {t('backtestResult.loading')}</div>
      </div>
    )
  }

  if (pageState === 'offline') {
    return (
      <div className="view-pad" data-testid="backtest-result-page">
        <div className="view-head">
          <button className="btn ghost" onClick={onBack} style={{ marginRight: 8 }}>&larr;</button>
          <h2>{t('backtestResult.title')}</h2>
        </div>
        <div className="empty">
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('backtestResult.offlineTitle')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('backtestResult.offlineDescription')}</p>
        </div>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div className="view-pad" data-testid="backtest-result-page">
        <div className="view-head">
          <button className="btn ghost" onClick={onBack} style={{ marginRight: 8 }}>&larr;</button>
          <h2>{t('backtestResult.title')}</h2>
        </div>
        <div className="empty">
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('backtestResult.errorTitle')}</p>
          {errorMsg && <p data-testid="error-message" style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>{errorMsg}</p>}
          <button className="btn ghost" onClick={() => { setPageState('loading'); void loadDetail() }}>{t('backtestResult.retry')}</button>
        </div>
      </div>
    )
  }

  if (!detail) return null

  // ── Render: ready ─────────────────────────────────────────────────

  return (
    <div className="view-pad" data-testid="backtest-result-page">
      <div className="view-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn ghost" onClick={onBack} data-testid="back-btn">&larr;</button>
        <h2>{detail.strategy_name}</h2>
        <span style={{ fontSize: 10, color: sseConnected ? 'var(--green)' : 'var(--text-muted)', marginLeft: 'auto' }}>
          {sseConnected ? t('backtestResult.live') : ''}
        </span>
      </div>

      {/* ── Running-state header ─────────────────────────────────── */}
      {progress && (
        <SectionCard filled={false}>
          <div data-testid="running-header" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)' }}>
            <span>{progress.phase ?? t('backtestResult.running')}</span>
            <span>{progress.progress != null ? `${progress.progress.toFixed(1)}%` : ''}</span>
          </div>
          <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
            <div style={{ height: '100%', width: `${Math.min(progress.progress ?? 0, 100)}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          {progress.elapsedMs != null && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{t('backtestResult.elapsed')}: {formatMs(progress.elapsedMs)}</div>}
        </SectionCard>
      )}

      {/* ── Summary Metrics ──────────────────────────────────────── */}
      <SectionCard filled>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>{t('backtestResult.metricsSection')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          <MetricCard label={t('backtestResult.totalReturn')} value={formatPct(detail.total_return)} />
          <MetricCard label={t('backtestResult.totalPnl')} value={formatNumber(detail.total_pnl)} />
          <MetricCard label={t('backtestResult.sharpeRatio')} value={formatNumber(detail.sharpe_ratio)} />
          <MetricCard label={t('backtestResult.maxDrawdown')} value={formatPct(detail.max_drawdown)} />
          <MetricCard label={t('backtestResult.winRate')} value={formatPct(detail.win_rate)} />
          <MetricCard label={t('backtestResult.profitFactor')} value={formatNumber(detail.profit_factor)} />
          <MetricCard label={t('backtestResult.totalTrades')} value={String(detail.total_trades)} />
          <MetricCard label={t('backtestResult.winningTrades')} value={String(detail.winning_trades)} />
          <MetricCard label={t('backtestResult.losingTrades')} value={String(detail.losing_trades)} />
          <MetricCard label={t('backtestResult.initialCapital')} value={formatNumber(detail.initial_capital, 0)} />
          <MetricCard label={t('backtestResult.finalCapital')} value={formatNumber(detail.final_capital, 0)} />
          <MetricCard label={t('backtestResult.executionTime')} value={formatMs(detail.execution_time_ms)} />
        </div>
      </SectionCard>

      {/* ── Config Info ───────────────────────────────────────────── */}
      <SectionCard filled={false}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('backtestResult.configSection')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12 }}>
          <div style={{ color: 'var(--text-muted)' }}>{t('backtestResult.symbol')}</div>
          <div style={{ color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{detail.symbol}</div>
          <div style={{ color: 'var(--text-muted)' }}>{t('backtestResult.timeframe')}</div>
          <div style={{ color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{detail.timeframe}</div>
          <div style={{ color: 'var(--text-muted)' }}>{t('backtestResult.period')}</div>
          <div style={{ color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{detail.start_date} - {detail.end_date}</div>
          <div style={{ color: 'var(--text-muted)' }}>{t('backtestResult.taskId')}</div>
          <div style={{ color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 10 }}>{detail.task_id}</div>
          <div style={{ color: 'var(--text-muted)' }}>{t('backtestResult.created')}</div>
          <div style={{ color: 'var(--text-2)' }}>{formatEpoch(detail.created_at)}</div>
        </div>
      </SectionCard>

      {/* ── Equity Sparkline ──────────────────────────────────────── */}
      {detail.equity_curve && detail.equity_curve.length >= 2 && (
        <SectionCard filled>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{t('backtestResult.equitySection')}</h3>
          <EquitySparkline values={detail.equity_curve} />
        </SectionCard>
      )}

      {/* ── Telemetry by Mode ─────────────────────────────────────── */}
      {telemetry && (
        <SectionCard filled={false}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('backtestResult.telemetrySection')}</h3>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>{t('backtestResult.colMode')}</th>
                <th style={thStyle}>{t('backtestResult.colSuccess')}</th>
                <th style={thStyle}>{t('backtestResult.colFailed')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(telemetry).map(([mode, counts]) => (
                <tr key={mode} data-testid={`telemetry-row-${mode}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{mode}</td>
                  <td style={{ ...tdStyle, color: 'var(--green)' }}>{counts.success}</td>
                  <td style={{ ...tdStyle, color: counts.failed > 0 ? 'var(--red)' : 'var(--text-2)' }}>{counts.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}
    </div>
  )
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
