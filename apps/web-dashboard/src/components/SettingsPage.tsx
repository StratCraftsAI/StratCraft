/**
 * TICKET_1236_4: Webui Settings Page
 *
 * Thin view over the 1235_8 MCP settings + conversations tools.
 * Renders a unified scroll layout with BreadcrumbBar-style header
 * and "SYSTEM" nameplate, matching desktop SettingsPage.tsx.
 *
 * Data: atomic Guide toolbar context, get_settings, list_conversations,
 *       get_conversation (no auth), set_market_routing (requireAuth),
 *       delete_conversation (requireAuth + confirm).
 *
 * Five sections with TICKET_910 alternation:
 *   1. General (filled)      -- locale readout + selector
 *   2. Market Routing (outline) -- routing table + editor
 *   3. LLM Settings (filled) -- Plan, credentials, validation, models
 *   4. Conversations (outline) -- list + transcript panel + delete
 *   5. System Info (filled)  -- remaining read-only fields
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GuideLlmSettingsConfig,
  GuideLlmSettingsProvider,
  GuideToolbarProvider,
} from '@StratCraft/types'
import { callTool, McpToolError } from '../mcp-client.ts'
import { isAuthenticated } from '../auth-session.ts'
import { useGuideToolbar } from '../guide-toolbar-context.tsx'
import { DecisionTrustPolicySettings } from './DecisionTrustPolicySettings.tsx'
import { credentialHealthI18nKey } from '../credential-health-i18n.ts'
import { CredentialStoreLifecycle } from './CredentialStoreLifecycle.tsx'

// ── Data types mirroring MCP tool response shapes ──────────────────────────

interface LocaleInfo {
  code: string
  label?: string
  nativeLabel?: string
}

interface SettingsLocale {
  current: string
  system: string
  supported: LocaleInfo[]
}

interface RoutingEntry {
  market: string
  candidates: string[]
  preference: string[]
}

export interface SettingsData {
  locale: SettingsLocale
  providerDefaults: Record<string, unknown>
  routing: RoutingEntry[]
}

export interface ConversationSummary {
  id: number
  title: string
  updatedAt?: string
  createdAt?: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    id: number
    role: string
    content: string
    createdAt?: string
  }>
}

// ── State machine ──────────────────────────────────────────────────────────

export type SettingsState = 'loading' | 'ready' | 'offline' | 'error'

// ── Component ──────────────────────────────────────────────────────────────

interface SettingsPageProps {
  onLogin: () => void
  focusProviderId?: string | null
  /**
   * TICKET_1328 AC6: return path to the page the user came from. Reached from
   * the toolbar, this page was previously a terminal leaf with no edge back.
   */
  onBack?: () => void
}

export function SettingsPage({ onLogin, focusProviderId = null, onBack }: SettingsPageProps) {
  const { t } = useTranslation('dashboard')
  const { config: toolbarConfig, localeSaving, localeError, setLocale } = useGuideToolbar()
  const [state, setState] = useState<SettingsState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null)
  const [editingMarket, setEditingMarket] = useState<string | null>(null)
  const [editingPreference, setEditingPreference] = useState<string[]>([])
  const [savingMarket, setSavingMarket] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  // ── Data loading ──

  const loadSettings = useCallback(async () => {
    try {
      const data = (await callTool('get_settings')) as SettingsData
      if (!data || typeof data !== 'object') {
        const obj = data as { error?: string }
        if (obj?.error && typeof obj.error === 'string' && obj.error.includes('not running')) {
          setState('offline')
          setErrorMsg(obj.error)
          return
        }
        throw new Error(t('settings.unexpectedResponse'))
      }
      setSettings(data)
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

  const loadConversations = useCallback(async () => {
    try {
      const data = (await callTool('list_conversations')) as ConversationSummary[]
      if (Array.isArray(data)) {
        setConversations(data)
      }
    } catch {
      // conversations section degrades silently; settings is the primary
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadConversations()
  }, [loadSettings, loadConversations])

  // ── Locale change ──

  // ── Market routing edit ──

  const handleStartEditRouting = useCallback((entry: RoutingEntry) => {
    setEditingMarket(entry.market)
    setEditingPreference([...entry.preference])
  }, [])

  const handleCancelEditRouting = useCallback(() => {
    setEditingMarket(null)
    setEditingPreference([])
  }, [])

  const handleMoveProvider = useCallback((index: number, direction: -1 | 1) => {
    setEditingPreference(prev => {
      const next = [...prev]
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= next.length) return prev
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }, [])

  const handleSaveRouting = useCallback(async () => {
    if (!isAuthenticated()) {
      onLogin()
      return
    }
    if (!editingMarket) return
    setSavingMarket(true)
    try {
      await callTool('set_market_routing', {
        market: editingMarket,
        preference: editingPreference,
      })
      setEditingMarket(null)
      setEditingPreference([])
      await loadSettings()
    } catch {
      // error surfaced on next loadSettings
    } finally {
      setSavingMarket(false)
    }
  }, [editingMarket, editingPreference, loadSettings, onLogin])

  // ── Conversation view ──

  const handleViewConversation = useCallback(async (id: number) => {
    try {
      const data = (await callTool('get_conversation', { id })) as ConversationDetail
      setSelectedConversation(data)
    } catch {
      // silently degrade
    }
  }, [])

  // ── Conversation delete ──

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteConfirmId === null) return
    if (!isAuthenticated()) {
      onLogin()
      setDeleteConfirmId(null)
      return
    }
    setDeletePending(true)
    try {
      await callTool('delete_conversation', { id: deleteConfirmId, confirm: true })
      if (selectedConversation?.id === deleteConfirmId) {
        setSelectedConversation(null)
      }
      await loadConversations()
    } catch {
      // error surfaced on reload
    } finally {
      setDeletePending(false)
      setDeleteConfirmId(null)
    }
  }, [deleteConfirmId, selectedConversation, loadConversations, onLogin])

  return (
    <div className="view-pad">
      {/* BreadcrumbBar-style header with SYSTEM nameplate */}
      <div className="view-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* TICKET_1328 AC6: in-page return path. */}
          {onBack && (
            <button
              className="btn ghost"
              onClick={onBack}
              aria-label={t('settings.back')}
              title={t('settings.back')}
              data-testid="settings-back"
            >
              &larr;
            </button>
          )}
          <h1>{t('settings.title')}</h1>
          <span style={nameplateStyle}>{t('settings.nameplate')}</span>
        </div>
      </div>

      {/* ── Section 1: General (filled) ── */}
      <SectionCard filled>
        <SectionHeader>{t('settings.generalSection')}</SectionHeader>
        {toolbarConfig?.locale ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SettingsRow label={t('settings.currentLocale')} value={toolbarConfig.locale.current} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={labelStyle}>{t('settings.changeLocale')}</span>
              <select
                value={toolbarConfig.locale.current}
                onChange={(e) => void setLocale(e.target.value)}
                disabled={localeSaving}
                style={selectStyle}
                data-testid="locale-selector"
              >
                {toolbarConfig.locale.supported.map((loc) => (
                  <option key={loc.code} value={loc.code}>
                    {loc.nativeLabel}
                  </option>
                ))}
              </select>
              {localeSaving && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('settings.saving')}</span>}
              {localeError && <span role="alert" style={{ fontSize: 11, color: 'var(--red)' }}>{t('lang.saveFailed')}</span>}
            </div>
          </div>
        ) : (
          <p role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{t('lang.loadFailed')}</p>
        )}
      </SectionCard>

      {/* ── Section 2: Market Routing (outline) ── */}
      <SectionCard filled={false}>
        <SectionHeader>{t('settings.routingSection')}</SectionHeader>
        {state !== 'ready' && (
          <div className="settings-inline-error" role="alert">
            <strong>{state === 'loading' ? t('settings.loading') : t(state === 'offline' ? 'settings.offlineTitle' : 'settings.errorTitle')}</strong>
            {errorMsg && <span>{errorMsg}</span>}
            {state !== 'loading' && <button className="btn sm ghost" onClick={() => void loadSettings()}>{t('settings.retry')}</button>}
          </div>
        )}
        {settings?.routing && settings.routing.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {settings.routing.map((entry) => (
              <div
                key={entry.market}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 12,
                  background: 'var(--panel)',
                }}
                data-testid={`routing-${entry.market}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{entry.market}</span>
                  {editingMarket !== entry.market && (
                    <button className="btn sm ghost" onClick={() => handleStartEditRouting(entry)}>
                      {t('settings.edit')}
                    </button>
                  )}
                </div>

                {editingMarket === entry.market ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {editingPreference.map((provider, index) => (
                      <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-2)', width: 16, textAlign: 'right' as const }}>{index + 1}</span>
                        <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{provider}</span>
                        <button
                          className="btn sm ghost"
                          disabled={index === 0}
                          onClick={() => handleMoveProvider(index, -1)}
                          style={{ padding: '0 6px', minWidth: 24 }}
                        >
                          <UpArrowIcon />
                        </button>
                        <button
                          className="btn sm ghost"
                          disabled={index === editingPreference.length - 1}
                          onClick={() => handleMoveProvider(index, 1)}
                          style={{ padding: '0 6px', minWidth: 24 }}
                        >
                          <DownArrowIcon />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn sm solid" onClick={handleSaveRouting} disabled={savingMarket}>
                        {savingMarket ? t('settings.saving') : t('settings.save')}
                      </button>
                      <button className="btn sm ghost" onClick={handleCancelEditRouting}>{t('settings.cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                    {entry.preference.map((provider, index) => (
                      <span key={provider} className="tag-mono">
                        {index + 1}. {provider}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.noRouting')}</p>
        )}
      </SectionCard>

      {/* ── Section 3: LLM Credentials (filled) ── TICKET_1265_7 D3 ── */}
      <SectionCard filled>
        <SectionHeader>{t('settings.llmCredentialsSection')}</SectionHeader>
        <CredentialStoreLifecycle />
        <LlmCredentialsSection focusProviderId={focusProviderId} />
      </SectionCard>

      {/* TICKET_1303_1_10_1: shared trust-policy settings (outline). */}
      <SectionCard filled={false}>
        <SectionHeader>
          {t('settings.trustPolicySection', { defaultValue: 'Decision Trust Policy' })}
        </SectionHeader>
        <DecisionTrustPolicySettings />
      </SectionCard>

      {/* ── Conversations (filled) ── */}
      <SectionCard filled>
        <SectionHeader>{t('settings.conversationsSection')}</SectionHeader>
        {conversations.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.noConversations')}</p>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <table className="dt" data-testid="conversations-table">
                <thead>
                  <tr>
                    <th>{t('settings.colId')}</th>
                    <th>{t('settings.colTitle')}</th>
                    <th>{t('settings.colUpdated')}</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conv) => (
                    <tr
                      key={conv.id}
                      onClick={() => handleViewConversation(conv.id)}
                      style={{
                        cursor: 'pointer',
                        background: selectedConversation?.id === conv.id ? 'rgba(var(--accent-rgb), 0.06)' : undefined,
                      }}
                      data-testid={`conversation-row-${conv.id}`}
                    >
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{conv.id}</td>
                      <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {conv.title || t('settings.untitled')}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {conv.updatedAt || conv.createdAt || '-'}
                      </td>
                      <td>
                        <button
                          className="btn sm danger"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(conv.id) }}
                          data-testid={`delete-conv-${conv.id}`}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Transcript panel */}
            {selectedConversation && (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 12,
                  background: 'var(--panel)',
                  maxHeight: 320,
                  overflow: 'auto',
                }}
                data-testid="transcript-panel"
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    {selectedConversation.title || t('settings.untitled')}
                  </span>
                  <button
                    className="btn sm ghost"
                    onClick={() => setSelectedConversation(null)}
                    style={{ padding: '0 6px' }}
                  >
                    <CloseIcon />
                  </button>
                </div>
                {selectedConversation.messages.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.noMessages')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedConversation.messages.map((msg) => (
                      <div key={msg.id} style={{ fontSize: 12, lineHeight: 1.5 }}>
                        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, color: msg.role === 'user' ? 'var(--accent)' : 'var(--gold)', textTransform: 'uppercase' as const, marginRight: 8 }}>
                          {msg.role}
                        </span>
                        <span style={{ color: 'var(--text-2)' }}>{msg.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── System Info (outline) ── */}
      <SectionCard filled={false}>
        <SectionHeader>{t('settings.systemInfoSection')}</SectionHeader>
        {settings?.providerDefaults && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(settings.providerDefaults).map(([key, value]) => (
              <SettingsRow key={key} label={key} value={String(value)} />
            ))}
          </div>
        )}
        {(!settings?.providerDefaults || Object.keys(settings.providerDefaults).length === 0) && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.noSystemInfo')}</p>
        )}
      </SectionCard>

      {/* ── Delete confirmation dialog ── */}
      {deleteConfirmId !== null && (
        <div className="modal-scrim" onClick={() => setDeleteConfirmId(null)} data-testid="delete-confirm-dialog">
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--red)',
              borderLeft: '3px solid var(--red)',
              borderRadius: 'var(--radius)',
              padding: 20,
              minWidth: 340,
              maxWidth: 440,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,77,77,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TrashIcon color="var(--red)" />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('settings.deleteTitle')}</span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.55 }}>
              {t('settings.deleteMessage', { id: deleteConfirmId })}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn sm ghost" onClick={() => setDeleteConfirmId(null)} disabled={deletePending}>
                {t('settings.cancel')}
              </button>
              <button className="btn sm danger" onClick={handleDeleteConfirm} disabled={deletePending} data-testid="confirm-delete-btn">
                {deletePending ? t('settings.deleting') : t('settings.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── LLM Credentials section (TICKET_1265_7 D3) ─────────────────────────────

const PRIMARY_CREDENTIAL_FIELD = 'primary'

function fieldStateKey(providerId: string, fieldKey: string): string {
  return `${providerId}:${fieldKey}`
}

function validateCredentialField(
  value: string,
  required: boolean,
  pattern: string | undefined,
): 'empty' | 'patternMismatch' | null {
  const trimmed = value.trim()
  if (!trimmed) return required ? 'empty' : null
  if (pattern && !new RegExp(pattern).test(trimmed)) return 'patternMismatch'
  return null
}

/**
 * TICKET_1265_7 D3: the FULL provider catalog, one row per provider, rendered
 * from the shared credential metadata delivered over the wire. API-key providers
 * get a password input + pattern validation; Ollama gets an optional base-URL
 * input validated `^https?://` -- an `sk-...` value is rejected client-side AND
 * server-side, so the `llm.ollama.baseUrl` slot can never take a non-URL value.
 */
function LlmCredentialsSection({ focusProviderId }: { focusProviderId: string | null }) {
  const { t } = useTranslation('dashboard')
  const { refresh: refreshToolbar } = useGuideToolbar()
  const [catalog, setCatalog] = useState<GuideLlmSettingsProvider[]>([])
  const [planProviders, setPlanProviders] = useState<GuideToolbarProvider[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set())
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [deleteConfirmProviderId, setDeleteConfirmProviderId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({})
  const [enabledModels, setEnabledModels] = useState<Record<string, string[]>>({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = (await callTool('get_guide_llm_settings')) as GuideLlmSettingsConfig
      if (!result || !Array.isArray(result.providers) || !Array.isArray(result.planProviders)) {
        throw new Error(t('settings.unexpectedResponse'))
      }
      const rows = result.providers
      setCatalog(rows)
      setPlanProviders(result.planProviders)
      setEnabledModels(Object.fromEntries(rows.map(provider => [
        provider.id,
        provider.enabledModelIds,
      ])))
      setLoadError(null)
    } catch (err) {
      // TICKET_858 / TICKET_1265_4: an unreachable bridge or tool error must
      // reach the UI, not masquerade as "No LLM providers available" (empty
      // catalog). Surface the failure so the user can distinguish "offline"
      // from "no providers configured".
      setLoadError(err instanceof McpToolError && err.errorCode
        ? t(`toolbar.errors.${err.errorCode}`, { defaultValue: err.message })
        : err instanceof Error ? err.message : String(err))
    } finally {
      setLoaded(true)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!focusProviderId || !loaded) return
    const row = document.getElementById(`llm-provider-${focusProviderId}`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    row?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [focusProviderId, loaded])

  const localizedMutationError = useCallback((reason: unknown): string => (
    reason instanceof McpToolError && reason.errorCode
      ? t(`settings.llmErrors.${reason.errorCode}`, { defaultValue: reason.message })
      : reason instanceof Error ? reason.message : String(reason)
  ), [t])

  const handleSave = useCallback(async (prov: GuideLlmSettingsProvider) => {
    const primaryKey = fieldStateKey(prov.id, PRIMARY_CREDENTIAL_FIELD)
    const primaryValue = values[primaryKey] ?? ''
    const primaryError = validateCredentialField(
      primaryValue,
      prov.credential.required,
      prov.credential.pattern,
    )
    const extraCredentials: Record<string, string> = {}
    let fieldError = primaryError
    for (const field of prov.credential.extraFields ?? []) {
      const value = values[fieldStateKey(prov.id, field.key)] ?? ''
      fieldError ??= validateCredentialField(value, field.required, field.pattern)
      extraCredentials[field.key] = value.trim()
    }
    if (fieldError) {
      setErrors(previous => ({
        ...previous,
        [prov.id]: t(fieldError === 'empty' ? 'settings.llmCredEmpty' : 'settings.llmCredPatternMismatch'),
      }))
      return
    }
    setErrors(previous => ({ ...previous, [prov.id]: '' }))
    setPendingAction(`${prov.id}:save`)
    try {
      await callTool('set_llm_credential', {
        provider: prov.id,
        api_key: primaryValue.trim(),
        extra_credentials: extraCredentials,
      })
      setValues(previous => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${prov.id}:`)),
      ))
      await load()
      await refreshToolbar()
    } catch (err) {
      setErrors(previous => ({ ...previous, [prov.id]: localizedMutationError(err) }))
    } finally {
      setPendingAction(null)
    }
  }, [load, localizedMutationError, refreshToolbar, t, values])

  const handleDelete = useCallback(async (provider: GuideLlmSettingsProvider) => {
    setPendingAction(`${provider.id}:delete`)
    setErrors(previous => ({ ...previous, [provider.id]: '' }))
    try {
      await callTool('delete_llm_credential', { provider: provider.id, confirm: true })
      setDeleteConfirmProviderId(null)
      await load()
      await refreshToolbar()
    } catch (reason) {
      setErrors(previous => ({ ...previous, [provider.id]: localizedMutationError(reason) }))
    } finally {
      setPendingAction(null)
    }
  }, [load, localizedMutationError, refreshToolbar])

  const handleRefreshModels = useCallback(async (provider: GuideLlmSettingsProvider) => {
    setPendingAction(`${provider.id}:refresh`)
    setErrors(previous => ({ ...previous, [provider.id]: '' }))
    try {
      await callTool('refresh_llm_models', { provider: provider.id })
      await load()
      await refreshToolbar()
    } catch (reason) {
      setErrors(previous => ({ ...previous, [provider.id]: localizedMutationError(reason) }))
    } finally {
      setPendingAction(null)
    }
  }, [load, localizedMutationError, refreshToolbar])

  const handleSaveModels = useCallback(async (provider: GuideLlmSettingsProvider) => {
    setPendingAction(`${provider.id}:models`)
    setErrors(previous => ({ ...previous, [provider.id]: '' }))
    try {
      await callTool('set_llm_provider_models', {
        provider: provider.id,
        model_ids: enabledModels[provider.id] ?? [],
      })
      await load()
      await refreshToolbar()
    } catch (reason) {
      setErrors(previous => ({ ...previous, [provider.id]: localizedMutationError(reason) }))
    } finally {
      setPendingAction(null)
    }
  }, [enabledModels, load, localizedMutationError, refreshToolbar])

  const toggleReveal = (key: string) => {
    setRevealedFields(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const planRows = planProviders.map(provider => (
    <div key={provider.id} className="llm-settings-provider" data-testid={`llm-plan-row-${provider.id}`}>
      <div className="llm-settings-provider-head">
        <strong>{provider.name}</strong>
        <span className="tag-mono">{t('settings.llmPlanManaged')}</span>
      </div>
      <p>{provider.availability === 'selectable' ? t('settings.llmPlanAvailable') : provider.unavailableReason ?? t('llm.notEntitled')}</p>
      <div className="llm-settings-model-list">
        {provider.models.map(model => <span key={model.id} className="tag-mono">{model.name}</span>)}
      </div>
    </div>
  ))

  if (!loaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="llm-credentials-section">
        {planRows}
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.loading')}</p>
      </div>
    )
  }
  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="llm-credentials-section">
        {planRows}
        <p style={{ fontSize: 12, color: 'var(--red)' }} data-testid="llm-cred-load-error">
          {t('settings.llmCredLoadError', { error: loadError })}
        </p>
      </div>
    )
  }
  if (catalog.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="llm-credentials-section">
        {planRows}
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.llmCredNone')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="llm-credentials-section">
      {planRows}
      {catalog.map((prov) => {
        const fields = [
          { key: PRIMARY_CREDENTIAL_FIELD, ...prov.credential },
          ...(prov.credential.extraFields ?? []),
        ]
        const discoveredModels = prov.discoveredModels
        const search = (modelSearch[prov.id] ?? '').trim().toLowerCase()
        const filteredModels = discoveredModels.filter(model => (
          !search || model.id.toLowerCase().includes(search) || model.name.toLowerCase().includes(search)
        ))
        const selectedModels = new Set(enabledModels[prov.id] ?? [])
        return (
        <div
          key={prov.id}
          id={`llm-provider-${prov.id}`}
          className={`llm-settings-provider${focusProviderId === prov.id ? ' focused' : ''}`}
          data-testid={`llm-cred-row-${prov.id}`}
        >
          <div className="llm-settings-provider-head">
            <strong>{prov.name}</strong>
            {!prov.credential.required ? (
              <span className="tag-mono" data-testid={`llm-cred-nokey-${prov.id}`}>
                {t('settings.llmCredNoKeyNeeded')}
              </span>
            ) : prov.configured ? (
              <span className="tag-mono" style={{ color: 'var(--green)' }} data-testid={`llm-cred-configured-${prov.id}`}>
                {t('settings.llmCredConfigured')}
              </span>
            ) : (
              <span className="tag-mono" style={{ color: 'var(--text-muted)' }}>
                {t('settings.llmCredNotConfigured')}
              </span>
            )}
            {prov.credential.signupUrl && (
              <a
                href={prov.credential.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="llm-settings-doc-link"
              >
                {t('settings.llmCredGetKey')}
              </a>
            )}
          </div>
          {prov.validationStatus && (
            <p className={`llm-validation-status ${prov.validationStatus}`} data-testid={`llm-validation-${prov.id}`}>
              {prov.validationMessage ?? t(`settings.llmValidation.${prov.validationStatus}`)}
            </p>
          )}
          {prov.availability === 'credential_error' ? (
            <p className="llm-validation-status invalid">
              {t(credentialHealthI18nKey(prov.credentialHealth?.state))}
            </p>
          ) : prov.unavailableReason ? (
            <p className="llm-validation-status invalid">{prov.unavailableReason}</p>
          ) : null}
          {fields.map(field => {
            const key = fieldStateKey(prov.id, field.key)
            const isSecret = field.inputType === 'password'
            return (
              <label key={field.key} className="llm-settings-field">
                <span>{t(field.key === PRIMARY_CREDENTIAL_FIELD ? `settings.llmField.${field.kind}` : 'settings.llmField.baseUrl')}</span>
                <span className="llm-settings-field-control">
                  <input
                    type={isSecret && !revealedFields.has(key) ? 'password' : field.inputType}
                    value={values[key] ?? ''}
                    onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    data-testid={field.key === PRIMARY_CREDENTIAL_FIELD ? `llm-cred-input-${prov.id}` : `llm-cred-input-${prov.id}-${field.key}`}
                  />
                  {isSecret && (
                    <button type="button" className="btn sm ghost" onClick={() => toggleReveal(key)} aria-label={t(revealedFields.has(key) ? 'settings.llmHideValue' : 'settings.llmShowValue')}>
                      {t(revealedFields.has(key) ? 'settings.llmHide' : 'settings.llmShow')}
                    </button>
                  )}
                </span>
              </label>
            )
          })}
          <div className="llm-settings-actions">
            <button
              className="btn sm solid"
              onClick={() => void handleSave(prov)}
              disabled={pendingAction !== null || fields.every(field => !(values[fieldStateKey(prov.id, field.key)] ?? '').trim())}
              data-testid={`llm-cred-save-${prov.id}`}
            >
              {pendingAction === `${prov.id}:save` ? t('settings.saving') : t(prov.configured ? 'settings.llmReplace' : 'settings.llmValidateSave')}
            </button>
            {prov.configured && prov.credential.required && (
              deleteConfirmProviderId === prov.id ? (
                <span className="llm-delete-confirm" role="group" aria-label={t('settings.llmDeleteConfirm')}>
                  <span>{t('settings.llmDeleteConfirm')}</span>
                  <button className="btn sm danger" onClick={() => void handleDelete(prov)} disabled={pendingAction !== null} data-testid={`llm-cred-delete-confirm-${prov.id}`}>
                    {pendingAction === `${prov.id}:delete` ? t('settings.deleting') : t('settings.confirmDelete')}
                  </button>
                  <button className="btn sm ghost" onClick={() => setDeleteConfirmProviderId(null)} disabled={pendingAction !== null}>{t('settings.cancel')}</button>
                </span>
              ) : (
                <button className="btn sm danger" onClick={() => setDeleteConfirmProviderId(prov.id)} disabled={pendingAction !== null} data-testid={`llm-cred-delete-${prov.id}`}>
                  {t('settings.llmDelete')}
                </button>
              )
            )}
            <button
              className="btn sm ghost"
              onClick={() => void handleRefreshModels(prov)}
              disabled={pendingAction !== null || (prov.credential.required && !prov.configured)}
              data-testid={`llm-model-refresh-${prov.id}`}
            >
              {pendingAction === `${prov.id}:refresh` ? t('settings.llmRefreshingModels') : t('settings.llmRefreshModels')}
            </button>
          </div>
          <div className="llm-settings-models" data-testid={`llm-models-${prov.id}`}>
            <div className="llm-settings-models-head">
              <strong>{t('settings.llmModels')}</strong>
              {prov.recommendedModelId && <span>{t('settings.llmRecommended', { model: prov.recommendedModelId })}</span>}
            </div>
            <input
              type="search"
              value={modelSearch[prov.id] ?? ''}
              onChange={event => setModelSearch(previous => ({ ...previous, [prov.id]: event.target.value }))}
              placeholder={t('settings.llmSearchModels')}
              aria-label={t('settings.llmSearchModels')}
            />
            {discoveredModels.length === 0 ? (
              <p>{prov.configured ? t('settings.llmModelsEmpty') : t('settings.llmModelsConfigureFirst')}</p>
            ) : (
              <div className="llm-settings-model-options">
                {prov.modelSelectionSupported ? filteredModels.map(model => (
                  <label key={model.id}>
                    <input
                      type="checkbox"
                      checked={selectedModels.has(model.id)}
                      onChange={event => setEnabledModels(previous => {
                        const next = new Set(previous[prov.id] ?? [])
                        if (event.target.checked) next.add(model.id)
                        else next.delete(model.id)
                        return { ...previous, [prov.id]: [...next] }
                      })}
                    />
                    <span>{model.name}</span>
                    <code>{model.id}</code>
                  </label>
                )) : filteredModels.map(model => (
                  <span key={model.id} className="tag-mono" title={model.id}>{model.name}</span>
                ))}
              </div>
            )}
            {prov.modelSelectionSupported && (
              <button
                className="btn sm solid"
                onClick={() => void handleSaveModels(prov)}
                disabled={pendingAction !== null || discoveredModels.length === 0 || (prov.credential.required && !prov.configured)}
                data-testid={`llm-model-save-${prov.id}`}
              >
                {pendingAction === `${prov.id}:models` ? t('settings.saving') : t('settings.llmSaveModels')}
              </button>
            )}
          </div>
          {errors[prov.id] && (
            <span className="llm-settings-error" role="alert" data-testid={`llm-cred-error-${prov.id}`}>
              {errors[prov.id]}
            </span>
          )}
        </div>
        )
      })}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{value}</span>
    </div>
  )
}

function TrashIcon({ color }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}

function UpArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function DownArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const nameplateStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: 'var(--mono)',
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid rgba(var(--accent-rgb), 0.3)',
  background: 'rgba(var(--accent-rgb), 0.06)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-2)',
  minWidth: 120,
}

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--mono)',
  padding: '4px 8px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--panel)',
  color: 'var(--text)',
  cursor: 'pointer',
}
