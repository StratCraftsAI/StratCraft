/**
 * TICKET_1236_5: Webui Marketplace Page
 * TICKET_1368 Phase 7: Sigma card eligibility, progress, and terminal states
 *
 * Thin view over the 1235_7 MCP plugin tools (11 tools). Renders plugin
 * browse / install / entitlements with inline detail panel, config editing,
 * and entitlement badges. Design reference only:
 * apps/desktop/src/renderer/features/marketplace/MarketplacePage.tsx
 *
 * Data: list_plugins + list_entitlements (no auth), install/uninstall/
 * activate/deactivate/set_plugin_config/toggle_entitlement_service (auth).
 * Auth: reads free, writes gated, destructive = confirm dialog.
 *
 * Sigma: get_sigma_install_eligibility (read-only eligibility check),
 * install_sigma_plugin (governed mutation), get_sigma_install_status
 * (durable operation observation). The card renders all verdict states
 * and never infers readiness from UI plugin presence alone.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import { isAuthenticated } from '../auth-session.ts'

// ── Data types mirroring MCP tool response shapes ─────────────────────────

export interface PluginManifest {
  id: string
  name: string
  displayName?: string
  version: string
  description?: string
  tier?: number
}

export interface PluginStatus {
  active?: boolean
  activatedAt?: number
}

export interface PluginEntry {
  id: string
  path: string
  source: 'bundled' | 'user'
  manifest: PluginManifest
  status: PluginStatus | null
  installed?: boolean
}

export interface EntitlementEntry {
  plugin_id: string
  entitled?: boolean
  services?: EntitlementService[]
}

export interface EntitlementService {
  id: string
  name?: string
  enabled?: boolean
}

export interface PluginConfig {
  [key: string]: unknown
}

// ── Sigma eligibility types (mirrors @StratCraft/types marketplace-product) ──

export type SigmaEligibilityVerdict =
  | 'signed_out'
  | 'purchase_required'
  | 'upgrade_required'
  | 'installable'
  | 'installed'
  | 'update_available'
  | 'unavailable'

export interface SigmaEligibilityAction {
  kind: 'login' | 'purchase' | 'upgrade' | 'launch' | 'update' | 'none'
  url?: string
  label?: string
}

export interface SigmaEligibilityResult {
  verdict: SigmaEligibilityVerdict
  action: SigmaEligibilityAction
  decisionId: string
  resolvedVersion: string | null
  installedVersion: string | null
  currentTier: string | null
  requiredTier: string
}

export type SigmaInstallTerminalState =
  | 'ready'
  | 'restart_required'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'invalid'
  | 'incompatible'
  | 'rolled_back'

export type SigmaInstallStage =
  | 'registry_resolution'
  | 'entitlement_resolution'
  | 'presentation_download'
  | 'presentation_verification'
  | 'commercial_download'
  | 'commercial_verification'
  | 'staging'
  | 'publication'
  | 'activation'
  | 'readiness'

export interface SigmaInstallOperation {
  operationInstanceId: string
  currentStage: SigmaInstallStage
  completedStages: string[]
  progressFraction: number
  terminalState: SigmaInstallTerminalState | null
  errorCode: string | null
  errorMessage: string | null
  remediationHint: string | null
  resolvedVersion: string | null
  restartRequired?: boolean
}

export type SigmaCardState =
  | 'loading'
  | 'signed_out'
  | 'purchase_required'
  | 'upgrade_required'
  | 'installable'
  | 'installing'
  | 'installed'
  | 'update_available'
  | 'unavailable'
  | 'ready'
  | 'restart_required'
  | 'failed'
  | 'error'

const SIGMA_DISPLAY_NAME = 'Quant Lab (Sigma)'
const SIGMA_DESCRIPTION = 'Alpha Factory - Simons-style signal discovery, factor sweep, multi-layer evaluation, and quantitative strategy orchestration'

const SIGMA_STATUS_POLL_INTERVAL_MS = 2000
const SIGMA_STATUS_POLL_MAX_MS = 300_000

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'ready', 'restart_required', 'failed', 'cancelled',
  'interrupted', 'invalid', 'incompatible', 'rolled_back',
])

export function isSigmaTerminalState(state: string | null): boolean {
  return state !== null && TERMINAL_STATES.has(state)
}

export function sigmaStageLabel(stage: SigmaInstallStage): string {
  const labels: Record<SigmaInstallStage, string> = {
    registry_resolution: 'Resolving registry',
    entitlement_resolution: 'Checking entitlement',
    presentation_download: 'Downloading plugin',
    presentation_verification: 'Verifying plugin',
    commercial_download: 'Downloading package',
    commercial_verification: 'Verifying package',
    staging: 'Staging artifacts',
    publication: 'Publishing',
    activation: 'Activating',
    readiness: 'Checking readiness',
  }
  return labels[stage] ?? stage
}

// ── State machine ─────────────────────────────────────────────────────────

export type MarketplaceState = 'loading' | 'ready' | 'offline' | 'error'

// ── Filter types ──────────────────────────────────────────────────────────

export type TierFilter = 'all' | 'tier0' | 'tier1'
export type StatusFilter = 'all' | 'installed' | 'notInstalled' | 'enabled' | 'disabled'

// ── Helpers ───────────────────────────────────────────────────────────────

export function isOfflineError(msg: string): boolean {
  return msg.includes('not running') || msg.includes('Failed to fetch')
}

export function isUserFacing(plugin: PluginEntry): boolean {
  return (plugin.manifest.tier ?? 1) !== 0
}

export function getPluginTier(plugin: PluginEntry): number {
  return plugin.manifest.tier ?? 1
}

export function isPluginActive(plugin: PluginEntry): boolean {
  return !!plugin.status?.active
}

export function isPluginInstalled(plugin: PluginEntry): boolean {
  return plugin.installed !== false
}

export function matchesFilter(plugin: PluginEntry, tier: TierFilter, status: StatusFilter, search: string): boolean {
  if (tier === 'tier0' && getPluginTier(plugin) !== 0) return false
  if (tier === 'tier1' && getPluginTier(plugin) === 0) return false
  if (status === 'installed' && !isPluginInstalled(plugin)) return false
  if (status === 'notInstalled' && isPluginInstalled(plugin)) return false
  if (status === 'enabled' && !isPluginActive(plugin)) return false
  if (status === 'disabled' && isPluginActive(plugin)) return false
  if (search) {
    const q = search.toLowerCase()
    const label = (plugin.manifest.displayName || plugin.manifest.name).toLowerCase()
    const desc = (plugin.manifest.description ?? '').toLowerCase()
    const id = plugin.id.toLowerCase()
    if (!label.includes(q) && !desc.includes(q) && !id.includes(q)) return false
  }
  return true
}

export function buildEntitlementMap(entitlements: EntitlementEntry[]): Map<string, EntitlementEntry> {
  const map = new Map<string, EntitlementEntry>()
  for (const e of entitlements) map.set(e.plugin_id, e)
  return map
}

const INSTALL_POLL_INTERVAL_MS = 1500
const INSTALL_POLL_MAX_ATTEMPTS = 20

// ── Component ─────────────────────────────────────────────────────────────

interface MarketplacePageProps {
  onLogin: () => void
}

export function MarketplacePage({ onLogin }: MarketplacePageProps) {
  const { t } = useTranslation('dashboard')
  const [state, setState] = useState<MarketplaceState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<PluginEntry[]>([])
  const [entitlements, setEntitlements] = useState<EntitlementEntry[]>([])

  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [detailConfig, setDetailConfig] = useState<PluginConfig | null>(null)
  const [configEditKey, setConfigEditKey] = useState('')
  const [configEditValue, setConfigEditValue] = useState('')

  const [actionPending, setActionPending] = useState<string | null>(null)
  const [installPolling, setInstallPolling] = useState<string | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<{ pluginId: string; pluginName: string } | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Sigma state ──
  const [sigmaCardState, setSigmaCardState] = useState<SigmaCardState>('loading')
  const [sigmaEligibility, setSigmaEligibility] = useState<SigmaEligibilityResult | null>(null)
  const [sigmaOperation, setSigmaOperation] = useState<SigmaInstallOperation | null>(null)
  const [sigmaError, setSigmaError] = useState<string | null>(null)
  const sigmaStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sigmaOperationIdRef = useRef<string | null>(null)

  // ── Data loading ──

  const loadData = useCallback(async () => {
    try {
      const [pluginData, entitlementData] = await Promise.all([
        callTool('list_plugins'),
        callTool('list_entitlements').catch(() => []),
      ])
      if (!Array.isArray(pluginData)) {
        const obj = pluginData as { error?: string }
        if (obj?.error && typeof obj.error === 'string' && obj.error.includes('not running')) {
          setState('offline')
          setErrorMsg(obj.error)
          return
        }
        throw new Error(t('marketplace.unexpectedResponse'))
      }
      setPlugins(pluginData as PluginEntry[])
      setEntitlements(Array.isArray(entitlementData) ? entitlementData as EntitlementEntry[] : [])
      setState('ready')
      setErrorMsg(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isOfflineError(msg)) {
        setState('offline')
        setErrorMsg(msg)
      } else {
        setState('error')
        setErrorMsg(msg)
      }
    }
  }, [t])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (sigmaStatusPollRef.current) clearInterval(sigmaStatusPollRef.current)
    }
  }, [])

  // ── Sigma eligibility ──

  const loadSigmaEligibility = useCallback(async () => {
    setSigmaCardState('loading')
    setSigmaError(null)
    try {
      const result = await callTool('get_sigma_install_eligibility') as SigmaEligibilityResult | null
      if (!result || !result.verdict) {
        setSigmaCardState('unavailable')
        return
      }
      setSigmaEligibility(result)
      const verdict = result.verdict
      if (verdict === 'signed_out' || verdict === 'purchase_required' ||
          verdict === 'upgrade_required' || verdict === 'installable' ||
          verdict === 'installed' || verdict === 'update_available' ||
          verdict === 'unavailable') {
        setSigmaCardState(verdict)
      } else {
        setSigmaCardState('unavailable')
      }
    } catch {
      setSigmaCardState('error')
      setSigmaError(t('marketplace.sigma.eligibilityFailed'))
    }
  }, [t])

  useEffect(() => { loadSigmaEligibility() }, [loadSigmaEligibility])

  const stopSigmaStatusPoll = useCallback(() => {
    if (sigmaStatusPollRef.current) {
      clearInterval(sigmaStatusPollRef.current)
      sigmaStatusPollRef.current = null
    }
  }, [])

  const startSigmaStatusPoll = useCallback((operationInstanceId: string) => {
    stopSigmaStatusPoll()
    sigmaOperationIdRef.current = operationInstanceId
    const startMs = Date.now()

    sigmaStatusPollRef.current = setInterval(async () => {
      if (Date.now() - startMs > SIGMA_STATUS_POLL_MAX_MS) {
        stopSigmaStatusPoll()
        setSigmaCardState('failed')
        setSigmaError(t('marketplace.sigma.installTimeout'))
        return
      }

      try {
        const op = await callTool('get_sigma_install_status', {
          operation_instance_id: operationInstanceId,
        }) as SigmaInstallOperation | null

        if (!op) return

        setSigmaOperation(op)

        if (isSigmaTerminalState(op.terminalState)) {
          stopSigmaStatusPoll()
          if (op.terminalState === 'ready') {
            setSigmaCardState('ready')
            await loadData()
          } else if (op.terminalState === 'restart_required') {
            setSigmaCardState('restart_required')
          } else {
            setSigmaCardState('failed')
            setSigmaError(op.errorMessage ?? t('marketplace.sigma.installFailed'))
          }
        }
      } catch {
        stopSigmaStatusPoll()
        setSigmaCardState('failed')
        setSigmaError(t('marketplace.sigma.statusPollFailed'))
      }
    }, SIGMA_STATUS_POLL_INTERVAL_MS)
  }, [stopSigmaStatusPoll, loadData, t])

  const handleSigmaInstall = useCallback(async () => {
    if (!isAuthenticated()) {
      onLogin()
      return
    }
    if (!sigmaEligibility || (sigmaEligibility.verdict !== 'installable' && sigmaEligibility.verdict !== 'update_available')) {
      return
    }

    setSigmaCardState('installing')
    setSigmaError(null)

    try {
      const result = await callTool('install_sigma_plugin', {
        eligibility_decision_id: sigmaEligibility.decisionId,
      }) as { operationInstanceId?: string } | null

      if (!result?.operationInstanceId) {
        setSigmaCardState('failed')
        setSigmaError(t('marketplace.sigma.installNoOperation'))
        return
      }

      startSigmaStatusPoll(result.operationInstanceId)
    } catch (err) {
      setSigmaCardState('failed')
      setSigmaError(err instanceof Error ? err.message : t('marketplace.sigma.installFailed'))
    }
  }, [sigmaEligibility, onLogin, startSigmaStatusPoll, t])

  const handleSigmaRetry = useCallback(async () => {
    await loadSigmaEligibility()
  }, [loadSigmaEligibility])

  // ── Detail panel ──

  const loadPluginConfig = useCallback(async (pluginId: string) => {
    try {
      const config = await callTool('get_plugin_config', { plugin_id: pluginId })
      setDetailConfig(config as PluginConfig)
    } catch {
      setDetailConfig(null)
    }
  }, [])

  const handleSelectPlugin = useCallback((pluginId: string) => {
    if (selectedPluginId === pluginId) {
      setSelectedPluginId(null)
      setDetailConfig(null)
      return
    }
    setSelectedPluginId(pluginId)
    loadPluginConfig(pluginId)
  }, [selectedPluginId, loadPluginConfig])

  // ── Auth-gated actions ──

  const requireAuth = useCallback((): boolean => {
    if (!isAuthenticated()) {
      onLogin()
      return false
    }
    return true
  }, [onLogin])

  const handleActivate = useCallback(async (pluginId: string) => {
    if (!requireAuth()) return
    setActionPending(pluginId)
    try {
      await callTool('activate_plugin', { plugin_id: pluginId })
      await loadData()
    } finally {
      setActionPending(null)
    }
  }, [requireAuth, loadData])

  const handleDeactivate = useCallback(async (pluginId: string) => {
    if (!requireAuth()) return
    setActionPending(pluginId)
    try {
      await callTool('deactivate_plugin', { plugin_id: pluginId })
      await loadData()
    } finally {
      setActionPending(null)
    }
  }, [requireAuth, loadData])

  const handleInstall = useCallback(async (pluginId: string) => {
    if (!requireAuth()) return
    setActionPending(pluginId)
    setInstallPolling(pluginId)
    try {
      await callTool('install_plugin', { plugin_id: pluginId })
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts++
        try {
          const pluginData = await callTool('get_plugin', { plugin_id: pluginId }) as PluginEntry | null
          if (pluginData && isPluginInstalled(pluginData as PluginEntry)) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setInstallPolling(null)
            setActionPending(null)
            await loadData()
          } else if (attempts >= INSTALL_POLL_MAX_ATTEMPTS) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setInstallPolling(null)
            setActionPending(null)
            await loadData()
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setInstallPolling(null)
          setActionPending(null)
        }
      }, INSTALL_POLL_INTERVAL_MS)
    } catch {
      setInstallPolling(null)
      setActionPending(null)
    }
  }, [requireAuth, loadData])

  const handleUninstallConfirm = useCallback(async () => {
    if (!confirmUninstall) return
    setActionPending(confirmUninstall.pluginId)
    setConfirmUninstall(null)
    try {
      await callTool('uninstall_plugin', { plugin_id: confirmUninstall.pluginId, confirm: true })
      if (selectedPluginId === confirmUninstall.pluginId) {
        setSelectedPluginId(null)
        setDetailConfig(null)
      }
      await loadData()
    } finally {
      setActionPending(null)
    }
  }, [confirmUninstall, selectedPluginId, loadData])

  const handleUninstall = useCallback((pluginId: string, pluginName: string) => {
    if (!requireAuth()) return
    setConfirmUninstall({ pluginId, pluginName })
  }, [requireAuth])

  const handleSetConfig = useCallback(async (pluginId: string) => {
    if (!requireAuth()) return
    if (!configEditKey.trim()) return
    setActionPending(pluginId)
    try {
      let parsedValue: unknown = configEditValue
      try { parsedValue = JSON.parse(configEditValue) } catch { /* use as string */ }
      await callTool('set_plugin_config', { plugin_id: pluginId, key: configEditKey.trim(), value: parsedValue })
      setConfigEditKey('')
      setConfigEditValue('')
      await loadPluginConfig(pluginId)
    } finally {
      setActionPending(null)
    }
  }, [requireAuth, configEditKey, configEditValue, loadPluginConfig])

  const handleToggleEntitlementService = useCallback(async (pluginId: string, serviceId: string, enabled: boolean) => {
    if (!requireAuth()) return
    setActionPending(pluginId)
    try {
      await callTool('toggle_entitlement_service', { plugin_id: pluginId, service_id: serviceId, enabled })
      await loadData()
    } finally {
      setActionPending(null)
    }
  }, [requireAuth, loadData])

  // ── Derived data ──

  const entitlementMap = useMemo(() => buildEntitlementMap(entitlements), [entitlements])

  const filteredPlugins = useMemo(
    () => plugins.filter((p) => matchesFilter(p, tierFilter, statusFilter, searchQuery)),
    [plugins, tierFilter, statusFilter, searchQuery],
  )

  const selectedPlugin = useMemo(
    () => selectedPluginId ? plugins.find((p) => p.id === selectedPluginId) ?? null : null,
    [selectedPluginId, plugins],
  )

  // ── Loading state ──

  if (state === 'loading') {
    return (
      <div className="empty">
        <div className="glyph spin">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <h3>{t('marketplace.loading')}</h3>
      </div>
    )
  }

  // ── Offline state ──

  if (state === 'offline') {
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
        <h3>{t('marketplace.offlineTitle')}</h3>
        <p>{errorMsg ?? t('marketplace.offlineDescription')}</p>
      </div>
    )
  }

  // ── Error state ──

  if (state === 'error') {
    return (
      <div className="empty">
        <div className="glyph">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3>{t('marketplace.errorTitle')}</h3>
        <p>{errorMsg}</p>
        <button className="btn" onClick={loadData}>{t('marketplace.retry')}</button>
      </div>
    )
  }

  // ── Ready state ──

  return (
    <div className="view-pad">
      <div className="view-head">
        <h1>{t('marketplace.title')}</h1>
        <span className="sb-count">
          {t('marketplace.pluginCount', { count: filteredPlugins.length, total: plugins.length })}
        </span>
      </div>

      {/* ── Filter bar ── */}
      <SectionCard filled>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('marketplace.searchPlaceholder')}
            style={searchInputStyle}
            data-testid="marketplace-search"
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as TierFilter)}
            style={selectStyle}
            data-testid="marketplace-tier-filter"
          >
            <option value="all">{t('marketplace.filterTierAll')}</option>
            <option value="tier0">{t('marketplace.filterTier0')}</option>
            <option value="tier1">{t('marketplace.filterTier1')}</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={selectStyle}
            data-testid="marketplace-status-filter"
          >
            <option value="all">{t('marketplace.filterStatusAll')}</option>
            <option value="installed">{t('marketplace.filterInstalled')}</option>
            <option value="notInstalled">{t('marketplace.filterNotInstalled')}</option>
            <option value="enabled">{t('marketplace.filterEnabled')}</option>
            <option value="disabled">{t('marketplace.filterDisabled')}</option>
          </select>
        </div>
      </SectionCard>

      {/* ── Sigma product card ── */}
      <SigmaProductCard
        cardState={sigmaCardState}
        eligibility={sigmaEligibility}
        operation={sigmaOperation}
        error={sigmaError}
        onInstall={handleSigmaInstall}
        onLogin={onLogin}
        onRetry={handleSigmaRetry}
      />

      {/* ── Main layout: list + detail panel ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* ── Plugin list ── */}
        <SectionCard filled={false}>
          <SectionHeader>{t('marketplace.pluginsSection')}</SectionHeader>
          {filteredPlugins.length === 0 ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <p>{t('marketplace.noPlugins')}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredPlugins.map((plugin) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  selected={selectedPluginId === plugin.id}
                  entitlement={entitlementMap.get(plugin.id)}
                  actionPending={actionPending === plugin.id}
                  installPolling={installPolling === plugin.id}
                  onSelect={handleSelectPlugin}
                  onActivate={handleActivate}
                  onDeactivate={handleDeactivate}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                />
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── Detail panel (inline) ── */}
        {selectedPlugin && (
          <DetailPanel
            plugin={selectedPlugin}
            config={detailConfig}
            entitlement={entitlementMap.get(selectedPlugin.id)}
            actionPending={actionPending === selectedPlugin.id}
            installPolling={installPolling === selectedPlugin.id}
            configEditKey={configEditKey}
            configEditValue={configEditValue}
            onConfigEditKey={setConfigEditKey}
            onConfigEditValue={setConfigEditValue}
            onSetConfig={handleSetConfig}
            onActivate={handleActivate}
            onDeactivate={handleDeactivate}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onToggleEntitlementService={handleToggleEntitlementService}
          />
        )}
      </div>

      {/* ── Confirm uninstall dialog ── */}
      {confirmUninstall && (
        <ConfirmDialog
          title={t('marketplace.confirmUninstallTitle')}
          message={t('marketplace.confirmUninstallMsg', { name: confirmUninstall.pluginName })}
          confirmLabel={t('marketplace.uninstall')}
          onConfirm={handleUninstallConfirm}
          onCancel={() => setConfirmUninstall(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function SectionCard({ filled, children }: { filled: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${filled ? 'var(--section-filled-border)' : 'var(--section-outline-border)'}`,
        background: filled ? 'var(--section-filled-bg)' : 'var(--section-outline-bg)',
        borderRadius: 'var(--radius)',
        padding: 16,
        marginBottom: 16,
        flex: filled ? undefined : 1,
        minWidth: filled ? undefined : 0,
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

// ── Plugin row ────────────────────────────────────────────────────────────

interface PluginRowProps {
  plugin: PluginEntry
  selected: boolean
  entitlement?: EntitlementEntry
  actionPending: boolean
  installPolling: boolean
  onSelect: (id: string) => void
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
  onInstall: (id: string) => void
  onUninstall: (id: string, name: string) => void
}

function PluginRow({ plugin, selected, entitlement, actionPending, installPolling, onSelect, onActivate, onDeactivate, onInstall, onUninstall }: PluginRowProps) {
  const { t } = useTranslation('dashboard')
  const active = isPluginActive(plugin)
  const installed = isPluginInstalled(plugin)
  const label = plugin.manifest.displayName || plugin.manifest.name

  return (
    <div
      onClick={() => onSelect(plugin.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(plugin.id) } }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 56,
        padding: '0 12px',
        borderRadius: 'var(--radius)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'var(--panel-2)' : 'var(--panel)',
        cursor: 'pointer',
        transition: 'border-color .15s',
      }}
      data-testid={`marketplace-plugin-${plugin.id}`}
      data-plugin-id={plugin.id}
      data-active={active}
      data-installed={installed}
    >
      <PluginIcon />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>v{plugin.manifest.version}</span>
          <TierBadge tier={getPluginTier(plugin)} />
          <SourceBadge source={plugin.source} />
        </div>
      </div>
      {entitlement?.entitled && <EntitlementBadge />}
      {installPolling && (
        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--amber)' }}>
          {t('marketplace.installing')}
        </span>
      )}
      <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
        {installed && active && (
          <button className="btn ghost" disabled={actionPending} onClick={() => onDeactivate(plugin.id)} style={actionBtnStyle}>
            {t('marketplace.deactivate')}
          </button>
        )}
        {installed && !active && (
          <button className="btn ghost" disabled={actionPending} onClick={() => onActivate(plugin.id)} style={actionBtnStyle}>
            {t('marketplace.activate')}
          </button>
        )}
        {!installed && (
          <button className="btn solid" disabled={actionPending} onClick={() => onInstall(plugin.id)} style={actionBtnStyle}>
            {t('marketplace.install')}
          </button>
        )}
        {installed && (
          <button className="btn ghost" disabled={actionPending} onClick={() => onUninstall(plugin.id, label)} style={actionBtnStyle}>
            {t('marketplace.uninstall')}
          </button>
        )}
      </div>
      <StatusDot active={active} />
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────

interface DetailPanelProps {
  plugin: PluginEntry
  config: PluginConfig | null
  entitlement?: EntitlementEntry
  actionPending: boolean
  installPolling: boolean
  configEditKey: string
  configEditValue: string
  onConfigEditKey: (v: string) => void
  onConfigEditValue: (v: string) => void
  onSetConfig: (pluginId: string) => void
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
  onInstall: (id: string) => void
  onUninstall: (id: string, name: string) => void
  onToggleEntitlementService: (pluginId: string, serviceId: string, enabled: boolean) => void
}

function DetailPanel({
  plugin, config, entitlement, actionPending, installPolling,
  configEditKey, configEditValue, onConfigEditKey, onConfigEditValue, onSetConfig,
  onActivate, onDeactivate, onInstall, onUninstall, onToggleEntitlementService,
}: DetailPanelProps) {
  const { t } = useTranslation('dashboard')
  const active = isPluginActive(plugin)
  const installed = isPluginInstalled(plugin)
  const label = plugin.manifest.displayName || plugin.manifest.name

  return (
    <div
      style={{
        width: 340,
        flexShrink: 0,
        border: '1px solid var(--section-outline-border)',
        background: 'var(--section-outline-bg)',
        borderRadius: 'var(--radius)',
        padding: 16,
      }}
      data-testid="marketplace-detail-panel"
    >
      <SectionHeader>{t('marketplace.detailSection')}</SectionHeader>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
        {plugin.manifest.description && (
          <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 8 }}>{plugin.manifest.description}</p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>{t('marketplace.detailId')}: <code style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{plugin.id}</code></span>
          <span>v{plugin.manifest.version}</span>
          <TierBadge tier={getPluginTier(plugin)} />
          <SourceBadge source={plugin.source} />
        </div>
      </div>

      {/* Status */}
      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>{t('marketplace.detailStatus')}:</span>
        <StatusDot active={active} />
        <span>{active ? t('marketplace.statusActive') : t('marketplace.statusInactive')}</span>
        {installPolling && <span style={{ color: 'var(--amber)', fontFamily: 'var(--mono)' }}>{t('marketplace.installing')}</span>}
      </div>

      {/* Entitlement */}
      {entitlement && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 6 }}>
            {t('marketplace.entitlementSection')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
            {entitlement.entitled ? t('marketplace.entitled') : t('marketplace.notEntitled')}
          </div>
          {entitlement.services && entitlement.services.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {entitlement.services.map((svc) => (
                <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-2)' }}>
                    <input
                      type="checkbox"
                      checked={!!svc.enabled}
                      disabled={actionPending}
                      onChange={() => onToggleEntitlementService(plugin.id, svc.id, !svc.enabled)}
                      data-testid={`entitlement-service-${svc.id}`}
                    />
                    {svc.name || svc.id}
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {installed && active && (
          <button className="btn ghost" disabled={actionPending} onClick={() => onDeactivate(plugin.id)}>{t('marketplace.deactivate')}</button>
        )}
        {installed && !active && (
          <button className="btn ghost" disabled={actionPending} onClick={() => onActivate(plugin.id)}>{t('marketplace.activate')}</button>
        )}
        {!installed && (
          <button className="btn solid" disabled={actionPending} onClick={() => onInstall(plugin.id)}>{t('marketplace.install')}</button>
        )}
        {installed && (
          <button className="btn danger" disabled={actionPending} onClick={() => onUninstall(plugin.id, label)}>{t('marketplace.uninstall')}</button>
        )}
      </div>

      {/* Config */}
      {config && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 6 }}>
            {t('marketplace.configSection')}
          </div>
          {Object.keys(config).length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('marketplace.noConfig')}</p>
          ) : (
            <div style={{ padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 8 }}>
              {Object.entries(config).map(([key, value]) => (
                <div key={key} style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)', padding: '2px 0' }}>
                  <span style={{ color: 'var(--accent)' }}>{key}</span>: {JSON.stringify(value)}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={configEditKey}
              onChange={(e) => onConfigEditKey(e.target.value)}
              placeholder={t('marketplace.configKeyPlaceholder')}
              style={{ ...searchInputStyle, flex: 1 }}
              data-testid="config-edit-key"
            />
            <input
              type="text"
              value={configEditValue}
              onChange={(e) => onConfigEditValue(e.target.value)}
              placeholder={t('marketplace.configValuePlaceholder')}
              style={{ ...searchInputStyle, flex: 1 }}
              data-testid="config-edit-value"
            />
            <button className="btn ghost" disabled={actionPending || !configEditKey.trim()} onClick={() => onSetConfig(plugin.id)} data-testid="config-save-btn">
              {t('marketplace.configSave')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Micro-components ──────────────────────────────────────────────────────

function PluginIcon() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6v6H9z" />
      </svg>
    </div>
  )
}

function TierBadge({ tier }: { tier: number }) {
  const { t } = useTranslation('dashboard')
  return (
    <span
      className="tag-mono"
      style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text-muted)' }}
      data-testid={`tier-badge-${tier}`}
    >
      {tier === 0 ? t('marketplace.tierFoundation') : t('marketplace.tierBusiness')}
    </span>
  )
}

function SourceBadge({ source }: { source: 'bundled' | 'user' }) {
  const { t } = useTranslation('dashboard')
  return (
    <span className="tag-mono" style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
      {source === 'bundled' ? t('marketplace.sourceBundled') : t('marketplace.sourceUser')}
    </span>
  )
}

function EntitlementBadge() {
  const { t } = useTranslation('dashboard')
  return (
    <span className="badge sig" style={{ fontSize: 9 }} data-testid="entitlement-badge">
      {t('marketplace.entitled')}
    </span>
  )
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: active ? 'var(--green)' : 'var(--text-muted)',
        boxShadow: active ? '0 0 6px var(--green)' : 'none',
        flexShrink: 0,
      }}
      data-testid="status-dot"
    />
  )
}

// ── Confirm dialog (reusable, same pattern as DataManagementPage) ─────────

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
    <div className="modal-scrim" onClick={onCancel} data-testid="confirm-dialog">
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
          <button className="btn ghost" onClick={onCancel}>{t('marketplace.cancel')}</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── Sigma product card ───────────────────────────────────────────────────

interface SigmaProductCardProps {
  cardState: SigmaCardState
  eligibility: SigmaEligibilityResult | null
  operation: SigmaInstallOperation | null
  error: string | null
  onInstall: () => void
  onLogin: () => void
  onRetry: () => void
}

export function SigmaProductCard({
  cardState, eligibility, operation, error,
  onInstall, onLogin, onRetry,
}: SigmaProductCardProps) {
  const { t } = useTranslation('dashboard')

  if (cardState === 'loading') {
    return (
      <SectionCard filled>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }} data-testid="sigma-card">
          <SigmaIcon />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{SIGMA_DISPLAY_NAME}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('marketplace.sigma.checking')}</div>
          </div>
        </div>
      </SectionCard>
    )
  }

  const actionButton = (() => {
    switch (cardState) {
      case 'signed_out':
        return (
          <button className="btn solid" onClick={onLogin} style={sigmaActionBtnStyle} data-testid="sigma-action-login">
            {t('marketplace.sigma.signIn')}
          </button>
        )
      case 'purchase_required':
        return (
          <button className="btn solid" disabled style={sigmaActionBtnStyle} data-testid="sigma-action-purchase">
            {t('marketplace.sigma.purchase')}
          </button>
        )
      case 'upgrade_required':
        return (
          <button className="btn solid" disabled style={sigmaActionBtnStyle} data-testid="sigma-action-upgrade">
            {t('marketplace.sigma.upgrade')}
          </button>
        )
      case 'installable':
        return (
          <button className="btn solid" onClick={onInstall} style={sigmaActionBtnStyle} data-testid="sigma-action-install">
            {t('marketplace.install')}
          </button>
        )
      case 'update_available':
        return (
          <button className="btn solid" onClick={onInstall} style={sigmaActionBtnStyle} data-testid="sigma-action-update">
            {t('marketplace.sigma.update')}
          </button>
        )
      case 'installing':
        return null
      case 'installed':
      case 'ready':
        return (
          <button className="btn solid" style={sigmaActionBtnStyle} data-testid="sigma-action-launch">
            {t('marketplace.sigma.launch')}
          </button>
        )
      case 'restart_required':
        return (
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--amber)' }} data-testid="sigma-restart-notice">
            {t('marketplace.sigma.restartRequired')}
          </span>
        )
      case 'failed':
      case 'error':
        return (
          <button className="btn ghost" onClick={onRetry} style={sigmaActionBtnStyle} data-testid="sigma-action-retry">
            {t('marketplace.retry')}
          </button>
        )
      case 'unavailable':
        return (
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }} data-testid="sigma-unavailable-notice">
            {t('marketplace.sigma.unavailable')}
          </span>
        )
      default:
        return null
    }
  })()

  const statusLine = (() => {
    switch (cardState) {
      case 'signed_out':
        return t('marketplace.sigma.signInRequired')
      case 'purchase_required':
        return t('marketplace.sigma.purchaseRequired', { tier: eligibility?.requiredTier ?? 'Gold' })
      case 'upgrade_required':
        return t('marketplace.sigma.upgradeRequired', {
          current: eligibility?.currentTier ?? 'Free',
          required: eligibility?.requiredTier ?? 'Gold',
        })
      case 'installable':
        return eligibility?.resolvedVersion
          ? t('marketplace.sigma.availableVersion', { version: eligibility.resolvedVersion })
          : t('marketplace.sigma.available')
      case 'installing':
        if (operation) {
          const pct = Math.round(operation.progressFraction * 100)
          return `${sigmaStageLabel(operation.currentStage)} (${pct}%)`
        }
        return t('marketplace.installing')
      case 'installed':
      case 'ready':
        return eligibility?.installedVersion
          ? t('marketplace.sigma.installedVersion', { version: eligibility.installedVersion })
          : t('marketplace.sigma.installed')
      case 'update_available':
        return t('marketplace.sigma.updateAvailable', {
          installed: eligibility?.installedVersion ?? '?',
          available: eligibility?.resolvedVersion ?? '?',
        })
      case 'restart_required':
        return t('marketplace.sigma.restartHint')
      case 'failed':
      case 'error':
        return error ?? t('marketplace.sigma.installFailed')
      case 'unavailable':
        return t('marketplace.sigma.unavailableHint')
      default:
        return ''
    }
  })()

  return (
    <SectionCard filled>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}
        data-testid="sigma-card"
        data-sigma-state={cardState}
      >
        <SigmaIcon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{SIGMA_DISPLAY_NAME}</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4, marginTop: 2 }}>
            {SIGMA_DESCRIPTION}
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'var(--mono)',
              color: cardState === 'failed' || cardState === 'error' ? 'var(--red)' : 'var(--text-muted)',
              marginTop: 4,
            }}
            data-testid="sigma-status"
          >
            {statusLine}
          </div>
          {cardState === 'installing' && operation && (
            <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }} data-testid="sigma-progress-bar">
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(operation.progressFraction * 100)}%`,
                  background: 'var(--accent)',
                  borderRadius: 2,
                  transition: 'width .3s',
                }}
              />
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {actionButton}
        </div>
      </div>
    </SectionCard>
  )
}

function SigmaIcon() {
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: 'var(--radius)',
        border: '1px solid var(--accent)',
        background: 'var(--panel-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
        <path d="M18 6L6 12l12 6" />
        <path d="M6 6h12M6 18h12" />
      </svg>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const searchInputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  fontSize: 12,
  fontFamily: 'var(--mono)',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  height: 32,
  padding: '0 8px',
  fontSize: 12,
  fontFamily: 'var(--mono)',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  outline: 'none',
}

const actionBtnStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '3px 8px',
}

const sigmaActionBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '5px 14px',
}
