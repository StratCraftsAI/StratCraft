/**
 * TICKET_1305: Account Modules page (guide webui).
 *
 * A read-focused view of what the signed-in user owns and what is installed,
 * powered by the now tier-aware MCP entitlement tools. Three sections:
 *   - Account Plan: the current plan badge (FREE / PRO / GOLD).
 *   - Module Permissions: per-plugin service table with locked/unlocked/enabled
 *     status; locked services show the tier they require.
 *   - Installed Modules: installed plugins with version, source, active status.
 *
 * Data: list_plugins + list_entitlements (tier-aware after TICKET_1305) +
 * getAuthUser().plan from auth-session. Reuses the MarketplacePage data shapes,
 * callTool, and the SectionCard/SectionHeader pattern -- no domain logic is
 * reconstructed here (CLAUDE.md surface-layer rule / TICKET_1305 no-duplication).
 *
 * Auth-aware: with no login the free-tier baseline renders behind a
 * "sign in to see your full permissions" prompt (TICKET_638 open-core).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { callTool } from '../mcp-client.ts'
import { getAuthUser, isAuthenticated } from '../auth-session.ts'
import {
  isOfflineError,
  isPluginInstalled,
  isPluginActive,
  getPluginTier,
  type PluginEntry,
} from './MarketplacePage.tsx'

// ── Rich entitlement shapes returned by the tier-aware list_entitlements ─────
// (PluginEntitlementState / ServiceEntitlementState from @StratCraft/plugin-store,
// surfaced verbatim through the MCP tool. Only the fields this view reads.)

export interface ModuleServiceState {
  id: string
  name?: string
  tier?: string
  enabled?: boolean
  effectiveEnabled?: boolean
  locked?: boolean
  lockReason?: string
}

export interface ModuleEntitlementEntry {
  pluginId: string
  services?: ModuleServiceState[]
}

export type AccountModulesState = 'loading' | 'ready' | 'offline' | 'error'

// ── Helpers ──────────────────────────────────────────────────────────────────

export function buildModuleEntitlementMap(
  entitlements: ModuleEntitlementEntry[],
): Map<string, ModuleEntitlementEntry> {
  const map = new Map<string, ModuleEntitlementEntry>()
  for (const e of entitlements) map.set(e.pluginId, e)
  return map
}

/** Service is granted and turned on by the user. */
export function serviceStatus(
  svc: ModuleServiceState,
): 'locked' | 'enabled' | 'disabled' {
  if (svc.locked) return 'locked'
  return svc.effectiveEnabled ?? svc.enabled ? 'enabled' : 'disabled'
}

// ── Component ────────────────────────────────────────────────────────────────

interface AccountModulesPageProps {
  onLogin: () => void
  /**
   * TICKET_1328 AC6: return path to the page the user came from. Reached from
   * the toolbar, this page was previously a terminal leaf with no edge back.
   */
  onBack: () => void
}

export function AccountModulesPage({ onLogin, onBack }: AccountModulesPageProps) {
  const { t } = useTranslation('dashboard')
  const [state, setState] = useState<AccountModulesState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<PluginEntry[]>([])
  const [entitlements, setEntitlements] = useState<ModuleEntitlementEntry[]>([])

  const authed = isAuthenticated()
  const plan = getAuthUser()?.plan ?? 'FREE'

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
        throw new Error(t('accountModules.unexpectedResponse'))
      }
      setPlugins(pluginData as PluginEntry[])
      setEntitlements(Array.isArray(entitlementData) ? entitlementData as ModuleEntitlementEntry[] : [])
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

  const entitlementMap = useMemo(() => buildModuleEntitlementMap(entitlements), [entitlements])
  const installedPlugins = useMemo(() => plugins.filter(isPluginInstalled), [plugins])

  // TICKET_1328 AC6: rendered in every state -- a page that fails to load must
  // still be escapable, which is exactly when the trap hurt most.
  const backButton = (
    <button
      className="btn ghost"
      onClick={onBack}
      aria-label={t('accountModules.back')}
      title={t('accountModules.back')}
      data-testid="account-modules-back"
      style={{ marginRight: 8 }}
    >
      &larr;
    </button>
  )

  // ── Non-ready states ──

  if (state === 'loading') {
    return (
      <div className="view-pad" data-testid="account-modules-page">
        <div className="view-head">{backButton}<h1>{t('accountModules.title')}</h1></div>
        <div className="empty">
        <div className="glyph spin">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <h3>{t('accountModules.loading')}</h3>
        </div>
      </div>
    )
  }

  if (state === 'offline') {
    return (
      <div className="view-pad" data-testid="account-modules-page">
        <div className="view-head">{backButton}<h1>{t('accountModules.title')}</h1></div>
        <div className="empty">
        <div className="glyph">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
          </svg>
        </div>
        <h3>{t('accountModules.offlineTitle')}</h3>
        <p>{errorMsg ?? t('accountModules.offlineDescription')}</p>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="view-pad" data-testid="account-modules-page">
        <div className="view-head">{backButton}<h1>{t('accountModules.title')}</h1></div>
        <div className="empty">
        <div className="glyph">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3>{t('accountModules.errorTitle')}</h3>
        <p>{errorMsg}</p>
        <button className="btn" onClick={loadData}>{t('accountModules.retry')}</button>
        </div>
      </div>
    )
  }

  // ── Ready state ──

  return (
    <div className="view-pad" data-testid="account-modules-page">
      <div className="view-head">
        {backButton}
        <h1>{t('accountModules.title')}</h1>
        <span className="sb-count">
          {t('accountModules.moduleCount', { count: installedPlugins.length })}
        </span>
      </div>

      {/* ── Account Plan ── */}
      <SectionCard filled>
        <SectionHeader>{t('accountModules.planSection')}</SectionHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PlanBadge plan={plan} />
          {authed ? (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {getAuthUser()?.email}
            </span>
          ) : (
            <button className="btn solid" onClick={onLogin} data-testid="account-modules-signin">
              {t('accountModules.signInPrompt')}
            </button>
          )}
        </div>
      </SectionCard>

      {/* ── Module Permissions ── */}
      <SectionCard filled={false}>
        <SectionHeader>{t('accountModules.permissionsSection')}</SectionHeader>
        {installedPlugins.length === 0 ? (
          <div className="empty" style={{ padding: '32px 16px' }}>
            <p>{t('accountModules.noModules')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {installedPlugins.map((plugin) => (
              <ModulePermissionCard
                key={plugin.id}
                plugin={plugin}
                entitlement={entitlementMap.get(plugin.id)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Installed Modules ── */}
      <SectionCard filled>
        <SectionHeader>{t('accountModules.installedSection')}</SectionHeader>
        {installedPlugins.length === 0 ? (
          <div className="empty" style={{ padding: '32px 16px' }}>
            <p>{t('accountModules.noModules')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {installedPlugins.map((plugin) => (
              <InstalledModuleRow key={plugin.id} plugin={plugin} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function PlanBadge({ plan }: { plan: string }) {
  const { t } = useTranslation('dashboard')
  const normalized = plan.toUpperCase()
  const color = normalized === 'GOLD' ? 'var(--amber)' : normalized === 'PRO' ? 'var(--accent)' : 'var(--text-muted)'
  return (
    <span
      style={{
        fontSize: 12,
        fontFamily: 'var(--mono)',
        fontWeight: 700,
        letterSpacing: '0.08em',
        padding: '4px 12px',
        borderRadius: 'var(--radius)',
        border: `1px solid ${color}`,
        color,
      }}
      data-testid="account-plan-badge"
    >
      {t(`accountModules.plan.${normalized}`, normalized)}
    </span>
  )
}

function ModulePermissionCard({ plugin, entitlement }: { plugin: PluginEntry; entitlement?: ModuleEntitlementEntry }) {
  const { t } = useTranslation('dashboard')
  const label = plugin.manifest.displayName || plugin.manifest.name
  const services = entitlement?.services ?? []

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--panel)',
        padding: 12,
      }}
      data-testid={`module-permission-${plugin.id}`}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{label}</div>
      {services.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('accountModules.noServices')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {services.map((svc) => (
            <ServiceRow key={svc.id} svc={svc} />
          ))}
        </div>
      )}
    </div>
  )
}

function ServiceRow({ svc }: { svc: ModuleServiceState }) {
  const status = serviceStatus(svc)
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '2px 0' }}
      data-testid={`account-service-${svc.id}`}
      data-status={status}
    >
      <span style={{ flex: 1, minWidth: 0, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {svc.name || svc.id}
      </span>
      {svc.tier && (
        <span className="tag-mono" style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {svc.tier.toUpperCase()}
        </span>
      )}
      <StatusPill status={status} lockReason={svc.lockReason} />
    </div>
  )
}

function StatusPill({ status, lockReason }: { status: 'locked' | 'enabled' | 'disabled'; lockReason?: string }) {
  const { t } = useTranslation('dashboard')
  const map = {
    locked: { color: 'var(--amber)', label: t('accountModules.statusLocked') },
    enabled: { color: 'var(--green)', label: t('accountModules.statusEnabled') },
    disabled: { color: 'var(--text-muted)', label: t('accountModules.statusDisabled') },
  } as const
  const { color, label } = map[status]
  return (
    <span
      title={status === 'locked' ? lockReason : undefined}
      style={{
        fontSize: 9,
        fontFamily: 'var(--mono)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '1px 6px',
        borderRadius: 3,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </span>
  )
}

function InstalledModuleRow({ plugin }: { plugin: PluginEntry }) {
  const { t } = useTranslation('dashboard')
  const active = isPluginActive(plugin)
  const label = plugin.manifest.displayName || plugin.manifest.name
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 48,
        padding: '0 12px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--panel)',
      }}
      data-testid={`installed-module-${plugin.id}`}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>v{plugin.manifest.version}</span>
          <span className="tag-mono" style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)' }}>
            {plugin.source === 'bundled' ? t('accountModules.sourceBundled') : t('accountModules.sourceUser')}
          </span>
          <span className="tag-mono" style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)' }}>
            {getPluginTier(plugin) === 0 ? t('accountModules.tierFoundation') : t('accountModules.tierBusiness')}
          </span>
        </div>
      </div>
      <span style={{ fontSize: 11, color: active ? 'var(--green)' : 'var(--text-muted)' }}>
        {active ? t('accountModules.statusActive') : t('accountModules.statusInactive')}
      </span>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? 'var(--green)' : 'var(--text-muted)',
          boxShadow: active ? '0 0 6px var(--green)' : 'none',
          flexShrink: 0,
        }}
      />
    </div>
  )
}
