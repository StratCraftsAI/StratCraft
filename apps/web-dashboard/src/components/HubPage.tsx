/**
 * TICKET_1236_2: Webui Hub Page Pilot
 *
 * Thin view over the 1235_7 MCP plugin tools. Renders the desktop nexus hub
 * card grid layout: top section = linked (active) plugins, bottom = all
 * user-facing plugins. No desktop renderer code is imported.
 *
 * Data: list_plugins (no auth), activate/deactivate (requireAuth).
 * Click semantics: PLUGIN_TICKET_003 -- top card = navigate, bottom = toggle.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import { isAuthenticated } from '../auth-session.ts'
import type { PageId } from '../App.tsx'
import { getGuidePluginWebuiPage } from '@StratCraft/types'

// ── Data types mirroring the MCP tool response shape ────────────────────────

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
}

// ── State machine ───────────────────────────────────────────────────────────

export type HubState = 'loading' | 'ready' | 'offline' | 'error'

export function getWebuiPageForPlugin(pluginId: string): PageId | undefined {
  return getGuidePluginWebuiPage(pluginId)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isUserFacing(plugin: PluginEntry): boolean {
  return (plugin.manifest.tier ?? 1) !== 0
}

export function isActive(plugin: PluginEntry): boolean {
  return !!plugin.status?.active
}

export function sortByActivatedAt(a: PluginEntry, b: PluginEntry): number {
  const aTime = a.status?.activatedAt ?? Number.MAX_SAFE_INTEGER
  const bTime = b.status?.activatedAt ?? Number.MAX_SAFE_INTEGER
  return aTime - bTime
}

// ── Component ────────────────────────────────────────────────────────────────

interface HubPageProps {
  onNavigate: (page: PageId) => void
  onLogin: () => void
}

export function HubPage({ onNavigate, onLogin }: HubPageProps) {
  const { t } = useTranslation('dashboard')
  const [plugins, setPlugins] = useState<PluginEntry[]>([])
  const [state, setState] = useState<HubState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [togglePending, setTogglePending] = useState<string | null>(null)

  const loadPlugins = useCallback(async () => {
    try {
      const data = (await callTool('list_plugins')) as PluginEntry[]
      if (!Array.isArray(data)) {
        const obj = data as { error?: string }
        if (obj?.error && typeof obj.error === 'string' && obj.error.includes('not running')) {
          setState('offline')
          setErrorMsg(obj.error)
          return
        }
        throw new Error(t('hub.unexpectedResponse'))
      }
      setPlugins(data)
      setState('ready')
      setErrorMsg(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not running') || msg.includes('Failed to fetch')) {
        setState('offline')
        setErrorMsg(msg)
      } else {
        setState('error')
        setErrorMsg(msg)
      }
    }
  }, [t])

  useEffect(() => { loadPlugins() }, [loadPlugins])

  const handleToggle = useCallback(async (pluginId: string, currentlyActive: boolean) => {
    if (!isAuthenticated()) {
      onLogin()
      return
    }
    setTogglePending(pluginId)
    try {
      const tool = currentlyActive ? 'deactivate_plugin' : 'activate_plugin'
      await callTool(tool, { plugin_id: pluginId })
      await loadPlugins()
    } catch {
      // error surfaced on next loadPlugins
    } finally {
      setTogglePending(null)
    }
  }, [loadPlugins, onLogin])

  const handleCardNavigate = useCallback((plugin: PluginEntry) => {
    const page = getWebuiPageForPlugin(plugin.id)
    if (page) onNavigate(page)
  }, [onNavigate])

  const userFacing = useMemo(() => plugins.filter(isUserFacing), [plugins])
  const linked = useMemo(() => userFacing.filter(isActive).sort(sortByActivatedAt), [userFacing])
  const linkedCount = linked.length

  // ── Loading state ──
  if (state === 'loading') {
    return (
      <div className="empty">
        <div className="glyph spin">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <h3>{t('hub.loading')}</h3>
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
        <h3>{t('hub.offlineTitle')}</h3>
        <p>{errorMsg ?? t('hub.offlineDescription')}</p>
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
        <h3>{t('hub.errorTitle')}</h3>
        <p>{errorMsg}</p>
        <button className="btn" onClick={loadPlugins}>{t('hub.retry')}</button>
      </div>
    )
  }

  // ── Ready state ──
  const MIN_LINKED_SLOTS = 4
  const emptySlots = Math.max(0, MIN_LINKED_SLOTS - linkedCount)

  return (
    <div className="view-pad">
      <div className="view-head">
        <h1>{t('hub.title')}</h1>
        <span className="sb-count">
          {t('hub.linkedCount', { linked: linkedCount, total: userFacing.length })}
        </span>
      </div>

      {/* ── Linked plugins grid (top region = navigate) ── */}
      <SectionCard filled>
        <SectionHeader>{t('hub.linkedSection')}</SectionHeader>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {linked.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              isLinked
              togglePending={togglePending === plugin.id}
              onNavigate={handleCardNavigate}
              onToggle={handleToggle}
            />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div key={`empty-${i}`} style={emptySlotStyle}>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', textTransform: 'uppercase' as const, letterSpacing: '0.15em', color: 'var(--text-muted)', opacity: 0.4 }}>
                {t('hub.emptySlot')}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── All modules list (bottom region = toggle) ── */}
      <SectionCard filled={false}>
        <SectionHeader>{t('hub.modulesSection')}</SectionHeader>
        {userFacing.length === 0 ? (
          <div className="empty" style={{ padding: '32px 16px' }}>
            <p>{t('hub.noModules')}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {userFacing.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                isLinked={false}
                togglePending={togglePending === plugin.id}
                onNavigate={handleCardNavigate}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

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

interface PluginCardProps {
  plugin: PluginEntry
  isLinked: boolean
  togglePending: boolean
  onNavigate: (plugin: PluginEntry) => void
  onToggle: (pluginId: string, currentlyActive: boolean) => void
}

function PluginCard({ plugin, isLinked, togglePending, onNavigate, onToggle }: PluginCardProps) {
  const { t } = useTranslation('dashboard')
  const active = isActive(plugin)
  const hasWebuiPage = !!getWebuiPageForPlugin(plugin.id)
  const navigable = isLinked && hasWebuiPage

  const handleClick = () => {
    if (isLinked && hasWebuiPage) {
      onNavigate(plugin)
    } else if (!isLinked) {
      onToggle(plugin.id, active)
    }
  }

  const label = plugin.manifest.displayName || plugin.manifest.name

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 64,
        padding: '0 12px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--panel)',
        cursor: navigable || !isLinked ? 'pointer' : 'default',
        opacity: !isLinked && active ? 0.5 : 1,
        transition: 'border-color .15s, opacity .15s',
      }}
      data-testid={`plugin-card-${plugin.id}`}
      data-plugin-id={plugin.id}
      data-active={active}
      data-linked={isLinked}
    >
      {/* Icon placeholder */}
      <div style={{ width: 28, height: 28, borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 9h6v6H9z" />
        </svg>
      </div>

      {/* Label + version */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{plugin.manifest.version}</div>
      </div>

      {/* Desktop-only tag for linked cards without webui page */}
      {isLinked && !hasWebuiPage && (
        <span style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
          {t('hub.desktopOnly')}
        </span>
      )}

      {/* Toggle button (linked cards) */}
      {isLinked && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(plugin.id, true) }}
          disabled={togglePending}
          aria-label={t('hub.deactivate')}
          style={{ background: 'none', border: 'none', padding: 4, borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18.36 6.64a9 9 0 11-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </button>
      )}

      {/* Status dot */}
      <StatusDot active={active} />
    </div>
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

const emptySlotStyle: React.CSSProperties = {
  height: 64,
  borderRadius: 'var(--radius)',
  border: '1px dashed var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
