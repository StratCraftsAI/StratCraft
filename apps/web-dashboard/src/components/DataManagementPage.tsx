/**
 * TICKET_1236_3: Webui Data Management Page
 *
 * Thin view over the 1235_2 MCP data-management tools (17 tools).
 * Layout: cache stats strip + tab switcher (catalog / queue / import).
 * Desktop DataManagementPage is design reference only -- zero code imported.
 *
 * Auth: reads free, writes requireAuth, destructive = confirm dialog.
 * State machine: loading -> ready | offline | error (per pilot 1236_2).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import { isAuthenticated } from '../auth-session.ts'
import { DATA_QUEUE_POLL_INTERVAL_MS } from '../constants.ts'
import type { PageId } from '../App.tsx'

// ── Data types mirroring MCP tool response shapes ───────────────────────────

export interface DataProvider {
  id: string
  name: string
  description?: string
  asset_classes?: string[]
}

export interface SymbolSearchResult {
  symbol: string
  name?: string
  asset_class?: string
  provider_id?: string
}

export interface DateRange {
  start: string
  end: string
}

export interface CoverageEntry {
  provider_id: string
  timeframe: string
  bars: number
  start?: string
  end?: string
}

export interface DataSegment {
  id: string
  symbol: string
  provider_id: string
  timeframe: string
  bars: number
  start?: string
  end?: string
  size_bytes?: number
}

export interface CacheStats {
  total_size_bytes?: number
  total_segments?: number
  total_symbols?: number
  providers?: string[]
}

export interface QueueItem {
  id: string
  symbol: string
  provider_id: string
  timeframe: string
  status: string
  progress?: number
  error?: string
}

export interface QueueStatus {
  items?: QueueItem[]
  active?: number
  pending?: number
  completed?: number
  failed?: number
}

export interface ImportedPackage {
  packageName: string
  adjustMode: string
  sourceDialect: string
  createdAt: number
  archivalCadence: string
  assetClass: string
}

// ── State machine ───────────────────────────────────────────────────────────

export type DataPageState = 'loading' | 'ready' | 'offline' | 'error'
export type DataTab = 'catalog' | 'queue' | 'import'

// ── Helpers ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function isOfflineError(msg: string): boolean {
  return msg.includes('not running') || msg.includes('Failed to fetch')
}

// ── Confirm Dialog ──────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string
  message: string
  items?: string[]
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ title, message, items, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
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
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: items?.length ? 8 : 16, lineHeight: 1.5 }}>{message}</p>
        {items && items.length > 0 && (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            {items.map((item, i) => (
              <div key={i} style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)', padding: '2px 0' }}>{item}</div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── SectionCard (shared with HubPage pilot pattern) ─────────────────────────

function SectionCard({ filled, children }: { filled: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${filled ? 'var(--section-filled-border)' : 'var(--section-outline-border)'}`,
        background: filled ? 'var(--section-filled-bg)' : 'var(--section-outline-bg)',
        borderRadius: 'var(--radius)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--accent)', marginBottom: 12 }}>
      {children}
    </h2>
  )
}

// ── Component ───────────────────────────────────────────────────────────────

interface DataManagementPageProps {
  onLogin: () => void
}

export function DataManagementPage({ onLogin }: DataManagementPageProps) {
  const { t } = useTranslation('dashboard')
  const [pageState, setPageState] = useState<DataPageState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DataTab>('catalog')

  // Catalog state
  const [providers, setProviders] = useState<DataProvider[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([])
  const [segments, setSegments] = useState<DataSegment[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<CoverageEntry[]>([])

  // Cache stats
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)

  // Queue state
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Import state
  const [packages, setPackages] = useState<ImportedPackage[]>([])
  const [importPath, setImportPath] = useState('')
  const [registerPath, setRegisterPath] = useState('')

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogProps | null>(null)

  // ── Initial load ──
  const loadInitial = useCallback(async () => {
    try {
      const [provData, statsData] = await Promise.all([
        callTool('list_data_providers'),
        callTool('get_cache_stats'),
      ])

      if (provData && typeof provData === 'object' && 'error' in provData) {
        const obj = provData as { error?: string }
        if (obj.error && typeof obj.error === 'string' && isOfflineError(obj.error)) {
          setPageState('offline')
          setErrorMsg(obj.error)
          return
        }
      }

      const provList = Array.isArray(provData) ? provData as DataProvider[] : []
      setProviders(provList)
      if (provList.length > 0 && !selectedProvider) {
        setSelectedProvider(provList[0].id)
      }
      setCacheStats(statsData as CacheStats)
      setPageState('ready')
      setErrorMsg(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isOfflineError(msg)) {
        setPageState('offline')
        setErrorMsg(msg)
      } else {
        setPageState('error')
        setErrorMsg(msg)
      }
    }
  }, [selectedProvider])

  useEffect(() => { loadInitial() }, [loadInitial])

  // ── Search symbols ──
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !selectedProvider) return
    try {
      const results = await callTool('search_symbols', {
        query: searchQuery,
        provider_id: selectedProvider,
      })
      setSearchResults(Array.isArray(results) ? results as SymbolSearchResult[] : [])
      setSelectedSymbol(null)
      setCoverage([])
      setSegments([])
    } catch {
      setSearchResults([])
    }
  }, [searchQuery, selectedProvider])

  // ── Select symbol -> load coverage + segments ──
  const handleSelectSymbol = useCallback(async (symbol: string) => {
    setSelectedSymbol(symbol)
    try {
      const [covData, segData] = await Promise.all([
        callTool('check_data_coverage', { symbol, provider_id: selectedProvider }),
        callTool('list_data_segments', { symbol, provider_id: selectedProvider }),
        callTool('get_symbol_date_range', { symbol, provider_id: selectedProvider }),
      ])
      setCoverage(Array.isArray(covData) ? covData as CoverageEntry[] : [])
      setSegments(Array.isArray(segData) ? segData as DataSegment[] : [])
    } catch {
      setCoverage([])
      setSegments([])
    }
  }, [selectedProvider])

  // ── Delete segment ──
  const handleDeleteSegment = useCallback((segment: DataSegment) => {
    if (!isAuthenticated()) { onLogin(); return }
    setConfirmDialog({
      title: t('dataManagement.confirmDeleteSegment'),
      message: t('dataManagement.confirmDeleteSegmentMsg'),
      items: [`${segment.symbol} / ${segment.provider_id} / ${segment.timeframe}`],
      confirmLabel: t('dataManagement.delete'),
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await callTool('delete_data_segments', {
            segment_ids: [segment.id],
            confirm: true,
          })
          if (selectedSymbol) handleSelectSymbol(selectedSymbol)
          const stats = await callTool('get_cache_stats')
          setCacheStats(stats as CacheStats)
        } catch { /* error surfaces on next reload */ }
      },
      onCancel: () => setConfirmDialog(null),
    })
  }, [t, selectedSymbol, handleSelectSymbol, onLogin])

  // ── Queue polling ──
  const loadQueue = useCallback(async () => {
    try {
      const [status] = await Promise.all([
        callTool('get_queue_status'),
        callTool('get_download_status'),
      ])
      setQueueStatus(status as QueueStatus)
    } catch { /* swallow in poll */ }
  }, [])

  useEffect(() => {
    if (activeTab === 'queue' && pageState === 'ready') {
      loadQueue()
      pollRef.current = setInterval(loadQueue, DATA_QUEUE_POLL_INTERVAL_MS)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [activeTab, pageState, loadQueue])

  // ── Queue actions ──
  const handleQueueDownload = useCallback(async (symbol: string, providerId: string, timeframe: string) => {
    if (!isAuthenticated()) { onLogin(); return }
    try {
      await callTool('queue_data_download', { symbol, provider_id: providerId, timeframe })
      loadQueue()
    } catch { /* error surfaces on next poll */ }
  }, [onLogin, loadQueue])

  const handleRetryFailed = useCallback(async () => {
    if (!isAuthenticated()) { onLogin(); return }
    try {
      await callTool('retry_failed_downloads')
      loadQueue()
    } catch { /* swallow */ }
  }, [onLogin, loadQueue])

  const handleCancelDownload = useCallback(async (itemId: string) => {
    if (!isAuthenticated()) { onLogin(); return }
    try {
      await callTool('cancel_download', { download_id: itemId })
      loadQueue()
    } catch { /* swallow */ }
  }, [onLogin, loadQueue])

  // ── Import actions ──
  const loadPackages = useCallback(async () => {
    try {
      const pkgs = await callTool('list_imported_packages')
      setPackages(Array.isArray(pkgs) ? pkgs as ImportedPackage[] : [])
    } catch (e) {
      console.error('[DataManagement] list_imported_packages failed:', e)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'import' && pageState === 'ready') {
      loadPackages()
    }
  }, [activeTab, pageState, loadPackages])

  const handleImportPackage = useCallback(async () => {
    if (!isAuthenticated()) { onLogin(); return }
    if (!importPath.trim()) return
    try {
      await callTool('import_data_package', { path: importPath.trim() })
      setImportPath('')
      loadPackages()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
    }
  }, [onLogin, importPath, loadPackages])

  const handleRegisterParquet = useCallback(async () => {
    if (!isAuthenticated()) { onLogin(); return }
    if (!registerPath.trim()) return
    try {
      await callTool('register_parquet_directory', { path: registerPath.trim() })
      setRegisterPath('')
      loadPackages()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
    }
  }, [onLogin, registerPath, loadPackages])

  const handleRemovePackage = useCallback((pkg: ImportedPackage) => {
    if (!isAuthenticated()) { onLogin(); return }
    setConfirmDialog({
      title: t('dataManagement.confirmRemovePackage'),
      message: t('dataManagement.confirmRemovePackageMsg'),
      items: [pkg.packageName],
      confirmLabel: t('dataManagement.remove'),
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await callTool('remove_imported_package', { package_name: pkg.packageName, confirm: true })
          loadPackages()
        } catch (e) {
          console.error('[DataManagement] remove_imported_package failed:', e)
        }
      },
      onCancel: () => setConfirmDialog(null),
    })
  }, [t, onLogin, loadPackages])

  // ── Clear cache ──
  const handleClearCache = useCallback(() => {
    if (!isAuthenticated()) { onLogin(); return }
    setConfirmDialog({
      title: t('dataManagement.confirmClearCache'),
      message: t('dataManagement.confirmClearCacheMsg'),
      items: [],
      confirmLabel: t('dataManagement.clearCache'),
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await callTool('clear_data_cache', { confirm: true })
          const stats = await callTool('get_cache_stats')
          setCacheStats(stats as CacheStats)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setErrorMsg(msg)
        }
      },
      onCancel: () => setConfirmDialog(null),
    })
  }, [t, onLogin])

  // ── Render: loading ──
  if (pageState === 'loading') {
    return (
      <div className="empty">
        <div className="glyph spin">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <h3>{t('dataManagement.loading')}</h3>
      </div>
    )
  }

  // ── Render: offline ──
  if (pageState === 'offline') {
    return (
      <div className="empty">
        <div className="glyph">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
          </svg>
        </div>
        <h3>{t('dataManagement.offlineTitle')}</h3>
        <p>{errorMsg ?? t('dataManagement.offlineDescription')}</p>
      </div>
    )
  }

  // ── Render: error ──
  if (pageState === 'error') {
    return (
      <div className="empty">
        <div className="glyph">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3>{t('dataManagement.errorTitle')}</h3>
        <p>{errorMsg}</p>
        <button className="btn" onClick={loadInitial}>{t('dataManagement.retry')}</button>
      </div>
    )
  }

  // ── Render: ready ──
  const tabs: Array<{ id: DataTab; label: string }> = [
    { id: 'catalog', label: t('dataManagement.tabCatalog') },
    { id: 'queue', label: t('dataManagement.tabQueue') },
    { id: 'import', label: t('dataManagement.tabImport') },
  ]

  return (
    <div className="view-pad" data-testid="data-management-page">
      <div className="view-head">
        <h1>{t('dataManagement.title')}</h1>
      </div>

      {/* ── Cache Stats Strip ── */}
      <SectionCard filled>
        <SectionHeader>{t('dataManagement.cacheStatsSection')}</SectionHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <StatChip label={t('dataManagement.statSegments')} value={String(cacheStats?.total_segments ?? 0)} />
          <StatChip label={t('dataManagement.statSymbols')} value={String(cacheStats?.total_symbols ?? 0)} />
          <StatChip label={t('dataManagement.statSize')} value={formatBytes(cacheStats?.total_size_bytes ?? 0)} />
          <div style={{ flex: 1 }} />
          <button className="btn danger sm" onClick={handleClearCache} data-testid="clear-cache-btn">
            {t('dataManagement.clearCache')}
          </button>
        </div>
      </SectionCard>

      {/* ── Tab Switcher ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, border: '1px dashed var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', width: 'fit-content' }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
            style={{
              padding: '6px 16px',
              fontSize: 10,
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              cursor: 'pointer',
              border: 'none',
              borderRight: i < tabs.length - 1 ? '1px dashed var(--border)' : 'none',
              background: activeTab === tab.id ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'background .15s, color .15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'catalog' && (
        <CatalogSection
          providers={providers}
          selectedProvider={selectedProvider}
          onSelectProvider={setSelectedProvider}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSearch={handleSearch}
          searchResults={searchResults}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={handleSelectSymbol}
          coverage={coverage}
          segments={segments}
          onDeleteSegment={handleDeleteSegment}
          onQueueDownload={handleQueueDownload}
        />
      )}
      {activeTab === 'queue' && (
        <QueueSection
          queueStatus={queueStatus}
          onRetryFailed={handleRetryFailed}
          onCancelDownload={handleCancelDownload}
        />
      )}
      {activeTab === 'import' && (
        <ImportSection
          packages={packages}
          importPath={importPath}
          onImportPathChange={setImportPath}
          onImportPackage={handleImportPackage}
          registerPath={registerPath}
          onRegisterPathChange={setRegisterPath}
          onRegisterParquet={handleRegisterParquet}
          onRemovePackage={handleRemovePackage}
        />
      )}

      {/* ── Confirm Dialog ── */}
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  )
}

// ── Stat Chip ───────────────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div data-testid="stat-chip">
      <div style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ── Catalog Section ─────────────────────────────────────────────────────────

interface CatalogSectionProps {
  providers: DataProvider[]
  selectedProvider: string
  onSelectProvider: (id: string) => void
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  onSearch: () => void
  searchResults: SymbolSearchResult[]
  selectedSymbol: string | null
  onSelectSymbol: (sym: string) => void
  coverage: CoverageEntry[]
  segments: DataSegment[]
  onDeleteSegment: (seg: DataSegment) => void
  onQueueDownload: (symbol: string, providerId: string, timeframe: string) => void
}

function CatalogSection({
  providers, selectedProvider, onSelectProvider,
  searchQuery, onSearchQueryChange, onSearch,
  searchResults, selectedSymbol, onSelectSymbol,
  coverage, segments, onDeleteSegment, onQueueDownload,
}: CatalogSectionProps) {
  const { t } = useTranslation('dashboard')

  return (
    <>
      {/* Provider selector + search */}
      <SectionCard filled={false}>
        <SectionHeader>{t('dataManagement.providerSection')}</SectionHeader>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: 'var(--text-muted)' }}>
              {t('dataManagement.provider')}
            </label>
            <select
              value={selectedProvider}
              onChange={(e) => onSelectProvider(e.target.value)}
              data-testid="provider-select"
              style={{
                padding: '7px 12px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--panel-2)',
                color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)',
                outline: 'none',
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: 'var(--text-muted)' }}>
              {t('dataManagement.symbolSearch')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSearch() }}
                placeholder={t('dataManagement.searchPlaceholder')}
                data-testid="symbol-search-input"
                style={{
                  flex: 1, padding: '7px 12px', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)', background: 'var(--panel-2)',
                  color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)',
                  outline: 'none',
                }}
              />
              <button className="btn sm" onClick={onSearch} data-testid="search-btn">
                {t('dataManagement.search')}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Search results */}
      {searchResults.length > 0 && (
        <SectionCard filled>
          <SectionHeader>{t('dataManagement.searchResultsSection', { count: searchResults.length })}</SectionHeader>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {searchResults.map((sr) => (
              <button
                key={sr.symbol}
                onClick={() => onSelectSymbol(sr.symbol)}
                className={`btn sm ${selectedSymbol === sr.symbol ? 'solid' : 'ghost'}`}
                data-testid={`symbol-btn-${sr.symbol}`}
              >
                {sr.symbol}
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Coverage + Segments for selected symbol */}
      {selectedSymbol && (
        <SectionCard filled={false}>
          <SectionHeader>{t('dataManagement.coverageSection', { symbol: selectedSymbol })}</SectionHeader>

          {coverage.length > 0 && (
            <div className="sb-table-wrap" style={{ marginBottom: 16 }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>{t('dataManagement.colProvider')}</th>
                    <th>{t('dataManagement.colTimeframe')}</th>
                    <th className="num">{t('dataManagement.colBars')}</th>
                    <th>{t('dataManagement.colStart')}</th>
                    <th>{t('dataManagement.colEnd')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c, i) => (
                    <tr key={i}>
                      <td className="mono">{c.provider_id}</td>
                      <td className="mono">{c.timeframe}</td>
                      <td className="num mono">{c.bars.toLocaleString()}</td>
                      <td>{c.start ?? '-'}</td>
                      <td>{c.end ?? '-'}</td>
                      <td>
                        <button
                          className="btn sm"
                          onClick={() => onQueueDownload(selectedSymbol, c.provider_id, c.timeframe)}
                          data-testid={`queue-download-${i}`}
                        >
                          {t('dataManagement.download')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {segments.length > 0 && (
            <>
              <SectionHeader>{t('dataManagement.segmentsSection')}</SectionHeader>
              <div className="sb-table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>{t('dataManagement.colTimeframe')}</th>
                      <th className="num">{t('dataManagement.colBars')}</th>
                      <th>{t('dataManagement.colStart')}</th>
                      <th>{t('dataManagement.colEnd')}</th>
                      <th className="num">{t('dataManagement.colSize')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((seg) => (
                      <tr key={seg.id}>
                        <td className="mono">{seg.timeframe}</td>
                        <td className="num mono">{seg.bars.toLocaleString()}</td>
                        <td>{seg.start ?? '-'}</td>
                        <td>{seg.end ?? '-'}</td>
                        <td className="num mono">{seg.size_bytes ? formatBytes(seg.size_bytes) : '-'}</td>
                        <td>
                          <button
                            className="btn danger sm"
                            onClick={() => onDeleteSegment(seg)}
                            data-testid={`delete-segment-${seg.id}`}
                          >
                            {t('dataManagement.delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {coverage.length === 0 && segments.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('dataManagement.noData')}</p>
          )}
        </SectionCard>
      )}
    </>
  )
}

// ── Queue Section ───────────────────────────────────────────────────────────

interface QueueSectionProps {
  queueStatus: QueueStatus | null
  onRetryFailed: () => void
  onCancelDownload: (id: string) => void
}

function QueueSection({ queueStatus, onRetryFailed, onCancelDownload }: QueueSectionProps) {
  const { t } = useTranslation('dashboard')
  const items = queueStatus?.items ?? []

  return (
    <>
      <SectionCard filled>
        <SectionHeader>{t('dataManagement.queueStatusSection')}</SectionHeader>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatChip label={t('dataManagement.queueActive')} value={String(queueStatus?.active ?? 0)} />
          <StatChip label={t('dataManagement.queuePending')} value={String(queueStatus?.pending ?? 0)} />
          <StatChip label={t('dataManagement.queueCompleted')} value={String(queueStatus?.completed ?? 0)} />
          <StatChip label={t('dataManagement.queueFailed')} value={String(queueStatus?.failed ?? 0)} />
          <div style={{ flex: 1 }} />
          {(queueStatus?.failed ?? 0) > 0 && (
            <button className="btn sm" onClick={onRetryFailed} data-testid="retry-failed-btn">
              {t('dataManagement.retryFailed')}
            </button>
          )}
        </div>
      </SectionCard>

      {items.length > 0 ? (
        <SectionCard filled={false}>
          <SectionHeader>{t('dataManagement.queueItemsSection')}</SectionHeader>
          <div className="sb-table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>{t('dataManagement.colSymbol')}</th>
                  <th>{t('dataManagement.colProvider')}</th>
                  <th>{t('dataManagement.colTimeframe')}</th>
                  <th>{t('dataManagement.colStatus')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{item.symbol}</td>
                    <td className="mono">{item.provider_id}</td>
                    <td className="mono">{item.timeframe}</td>
                    <td>
                      <QueueStatusBadge status={item.status} />
                    </td>
                    <td>
                      {item.status !== 'completed' && (
                        <button
                          className="btn ghost sm"
                          onClick={() => onCancelDownload(item.id)}
                          data-testid={`cancel-download-${item.id}`}
                        >
                          {t('dataManagement.cancel')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <p>{t('dataManagement.queueEmpty')}</p>
        </div>
      )}
    </>
  )
}

function QueueStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('dashboard')
  const badgeClass = status === 'completed' ? 'sig' :
                     status === 'failed' ? 'rej' :
                     status === 'active' ? 'pend' : 'no'
  return (
    <span className={`badge ${badgeClass}`}>
      <span className="bd" />
      {t(`status.${status}`, status)}
    </span>
  )
}

// ── Import Section ──────────────────────────────────────────────────────────

interface ImportSectionProps {
  packages: ImportedPackage[]
  importPath: string
  onImportPathChange: (v: string) => void
  onImportPackage: () => void
  registerPath: string
  onRegisterPathChange: (v: string) => void
  onRegisterParquet: () => void
  onRemovePackage: (pkg: ImportedPackage) => void
}

function ImportSection({
  packages, importPath, onImportPathChange, onImportPackage,
  registerPath, onRegisterPathChange, onRegisterParquet, onRemovePackage,
}: ImportSectionProps) {
  const { t } = useTranslation('dashboard')

  return (
    <>
      {/* Import form */}
      <SectionCard filled>
        <SectionHeader>{t('dataManagement.importPackageSection')}</SectionHeader>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: 'var(--text-muted)' }}>
              {t('dataManagement.importPathLabel')}
            </label>
            <input
              type="text"
              value={importPath}
              onChange={(e) => onImportPathChange(e.target.value)}
              placeholder={t('dataManagement.importPathPlaceholder')}
              data-testid="import-path-input"
              style={{
                padding: '7px 12px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--panel-2)',
                color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)',
                outline: 'none',
              }}
            />
          </div>
          <button className="btn sm" onClick={onImportPackage} data-testid="import-btn">
            {t('dataManagement.importBtn')}
          </button>
        </div>
      </SectionCard>

      {/* Register parquet directory form */}
      <SectionCard filled={false}>
        <SectionHeader>{t('dataManagement.registerParquetSection')}</SectionHeader>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: 'var(--text-muted)' }}>
              {t('dataManagement.registerPathLabel')}
            </label>
            <input
              type="text"
              value={registerPath}
              onChange={(e) => onRegisterPathChange(e.target.value)}
              placeholder={t('dataManagement.registerPathPlaceholder')}
              data-testid="register-path-input"
              style={{
                padding: '7px 12px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--panel-2)',
                color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)',
                outline: 'none',
              }}
            />
          </div>
          <button className="btn sm" onClick={onRegisterParquet} data-testid="register-btn">
            {t('dataManagement.registerBtn')}
          </button>
        </div>
      </SectionCard>

      {/* Imported packages list */}
      <SectionCard filled>
        <SectionHeader>{t('dataManagement.packagesSection')}</SectionHeader>
        {packages.length > 0 ? (
          <div className="sb-table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>{t('dataManagement.colName')}</th>
                  <th>{t('dataManagement.colAssetClass')}</th>
                  <th>{t('dataManagement.colCadence')}</th>
                  <th>{t('dataManagement.colImportedAt')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.packageName}>
                    <td style={{ fontWeight: 600 }}>{pkg.packageName}</td>
                    <td>{pkg.assetClass}</td>
                    <td>{pkg.archivalCadence}</td>
                    <td>{pkg.createdAt ? new Date(pkg.createdAt).toLocaleDateString() : '-'}</td>
                    <td>
                      <button
                        className="btn danger sm"
                        onClick={() => onRemovePackage(pkg)}
                        data-testid={`remove-package-${pkg.packageName}`}
                      >
                        {t('dataManagement.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('dataManagement.noPackages')}</p>
        )}
      </SectionCard>
    </>
  )
}
