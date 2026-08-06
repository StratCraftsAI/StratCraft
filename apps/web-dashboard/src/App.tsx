import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { LoginForm } from './components/LoginForm.tsx'
import { AuthIndicator } from './components/AuthIndicator.tsx'
import { DashboardHome } from './components/DashboardHome.tsx'
import { TemplateBrowserPage } from './components/TemplateBrowserPage.tsx'
import { HubPage } from './components/HubPage.tsx'
import { AccountModulesPage } from './components/AccountModulesPage.tsx'
import { DataManagementPage } from './components/DataManagementPage.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { MarketplacePage } from './components/MarketplacePage.tsx'
import { BacktestPage } from './components/BacktestPage.tsx'
import { BacktestResultPage } from './components/BacktestResultPage.tsx'
import { LLMProviderSelector } from './components/LLMProviderSelector.tsx'
import { CredentialModal } from './components/CredentialModal.tsx'
import { LanguageSelector } from './components/LanguageSelector.tsx'
import { optionalPage } from './optional-page.tsx'
import { GuideToolbarProvider, useGuideToolbar } from './guide-toolbar-context.tsx'

const ScoreboardPage = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'ScoreboardPage')
const SignalDetailPage = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'SignalDetailPage')
const SweepControlPage = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'SweepControlPage')
const UniversePage = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'UniversePage')
const QuantLabPage = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'QuantLabPage')
const SignalGeneratorPage = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'SignalGeneratorPage')
const SystemMonitorPanel = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'SystemMonitorPanel')
const WorkloadRefusalModal = optionalPage(() => import(/* @vite-ignore */ './commercial-pages'), 'WorkloadRefusalModal')
import { handleGuidedAction, handleGuidedWizardAction } from './chat-router.ts'
import { checkHealth, listTools, callTool } from './mcp-client.ts'
import { ensureControlSession } from './agent-control-client.ts'
import {
  isAuthenticated,
  isLocalOnly,
  enterLocalMode,
  restoreServerSession,
} from './auth-session.ts'
import {
  projectAgentToolVisualization,
} from '@StratCraft/types'
import type { ChatMessage, GuidedAction, GuidedResponse } from './types.ts'
import { WEB_DASHBOARD_POLL_INTERVAL_MS, SESSION_EXPIRED_EVENT } from './constants.ts'

export type PageId = 'hub' | 'marketplace' | 'chat' | 'scoreboard' | 'signal-detail' | 'templates' | 'sweep' | 'data' | 'universe' | 'quantlab' | 'settings' | 'backtest' | 'backtest-result' | 'signal-generator' | 'account-modules'

export function App() {
  return (
    <GuideToolbarProvider>
      <AppContent />
    </GuideToolbarProvider>
  )
}

function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && [
    'hub', 'marketplace', 'chat', 'scoreboard', 'signal-detail', 'templates',
    'sweep', 'data', 'universe', 'quantlab', 'settings', 'backtest',
    'backtest-result', 'signal-generator', 'account-modules',
  ].includes(value)
}

function AppContent() {
  const { t } = useTranslation('dashboard')
  const { refresh: refreshGuideToolbar } = useGuideToolbar()
  const [activePage, setActivePage] = useState<PageId>('chat')
  const [mcpConnected, setMcpConnected] = useState<boolean | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [authVersion, setAuthVersion] = useState(0)
  const [toolCount, setToolCount] = useState(0)
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [sweepPrefilledTemplate, setSweepPrefilledTemplate] = useState<string | null>(null)
  const [scoreboardFilter, setScoreboardFilter] = useState<string | null>(null)
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null)
  const [settingsFocusProviderId, setSettingsFocusProviderId] = useState<string | null>(null)
  const [credentialModalProviderId, setCredentialModalProviderId] = useState<string | null>(null)
  const initializedRef = useRef(false)

  const navigateToSignalDetail = useCallback((signalId: string) => {
    setSelectedSignalId(signalId)
    setActivePage('signal-detail')
  }, [])

  const navigateToSweepWithTemplate = useCallback((templateId: string) => {
    setSweepPrefilledTemplate(templateId)
    setActivePage('sweep')
  }, [])

  const navigateToBacktestResult = useCallback((taskId: string) => {
    setSelectedBacktestId(taskId)
    setActivePage('backtest-result')
  }, [])

  const navigateToScoreboardWithFilter = useCallback((filterTemplateId?: string) => {
    setScoreboardFilter(filterTemplateId ?? null)
    setSweepPrefilledTemplate(null)
    setActivePage('scoreboard')
  }, [])

  // TICKET_1328 AC1: handleNavigate is the single owner of the history
  // contract. Every navigation seeds the *current* page into the entry the user
  // is leaving (replaceState) and pushes the target (pushState), so the
  // popstate listener below always has a well-formed entry to restore. Without
  // this, toolbar navigation was a one-way trap: nothing to pop, so browser
  // Back left the SPA entirely. No call site may re-implement this.
  const handleNavigate = useCallback((page: PageId) => {
    if (page !== 'signal-detail') setSelectedSignalId(null)
    if (page !== 'sweep') setSweepPrefilledTemplate(null)
    if (page !== 'scoreboard') setScoreboardFilter(null)
    if (page !== 'backtest-result') setSelectedBacktestId(null)
    if (page !== 'settings') setSettingsFocusProviderId(null)
    setActivePage((current) => {
      if (page === current) return current
      window.history.replaceState(
        { ...window.history.state, stratcraftPage: current },
        '',
        window.location.href,
      )
      window.history.pushState({ stratcraftPage: page }, '', window.location.href)
      return page
    })
  }, [])

  // TICKET_1328 AC2: openSettings no longer carries its own copy of the
  // history contract -- it delegates to handleNavigate and retains only its
  // own extra concern (the provider to focus).
  const openSettings = useCallback((providerId?: string) => {
    handleNavigate('settings')
    setSettingsFocusProviderId(providerId ?? null)
  }, [handleNavigate])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    // TICKET_1233 D1: the URL-fragment token handoff consumer was removed
    // (implicit-flow shape, no producer existed). Entry is login or local mode.
    void restoreServerSession().then((restored) => {
      if (!restored && !isAuthenticated() && !isLocalOnly()) setShowLogin(true)
      if (restored) setAuthVersion((version) => version + 1)
    })
  }, [])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const page = (event.state as { stratcraftPage?: unknown } | null)?.stratcraftPage
      setActivePage(isPageId(page) ? page : 'chat')
      if (page !== 'settings') setSettingsFocusProviderId(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // TICKET_1232 F4: when a refresh fails permanently, auth-session clears the
  // session and dispatches this event -- surface the login UI, never a raw 401.
  useEffect(() => {
    const onSessionExpired = () => {
      setAuthVersion((v) => v + 1)
      setShowLogin(true)
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
  }, [])

  useEffect(() => {
    if (authVersion > 0) void refreshGuideToolbar()
  }, [authVersion, refreshGuideToolbar])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const ok = await checkHealth()
      if (!cancelled) setMcpConnected(ok)
      if (!ok) return
      await ensureControlSession()
      const tools = await listTools()
      if (!cancelled) setToolCount(tools.length)
    }
    void poll().catch(() => {})
    const id = setInterval(() => { void poll().catch(() => {}) }, WEB_DASHBOARD_POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const handleGuidedActionDispatch = useCallback(
    async (action: GuidedAction): Promise<ChatMessage> => {
      let response: ChatMessage

      if (action.type === 'guided') {
        response = await handleGuidedAction(action.context)
      } else if (action.type === 'wizard') {
        const parts = action.wizard_id.split(':')
        if (parts.length >= 3) {
          const wizardId = parts[0]
          const stepIndex = parseInt(parts[1], 10)
          const stepData = JSON.parse(parts.slice(2).join(':'))
          response = await handleGuidedWizardAction(wizardId, stepIndex, stepData)
        } else {
          response = await handleGuidedWizardAction(action.wizard_id, 0, {})
        }
      } else if (action.type === 'tool') {
        const result = await callTool(action.tool_name, action.args)
        const toolName = action.tool_name
        // TICKET_1370 R6/AC16: a card-originated tool call must project its
        // result through the SAME authority as an Agent-initiated call. This
        // branch used to hardcode `json`/`table`, which stranded the edited
        // workload review as a JSON blob and left the stale card actionable --
        // the pre-launch review could then never clear its own errors.
        const visual = projectAgentToolVisualization(result, toolName)
        response = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('chat.calledTool', { toolName }),
          timestamp: Date.now(),
          visualization: visual.ok
            ? {
                type: visual.kind,
                guided: visual.payload as unknown as GuidedResponse,
              }
            : {
                type: Array.isArray(result) ? 'table' : 'json',
                data: result,
                title: toolName,
              },
        }
      } else if (isPageId(action.page)) {
        handleNavigate(action.page)
        response = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('chat.navigatedTo', { page: action.page }),
          timestamp: Date.now(),
        }
      } else {
        response = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('chat.navigationNotImplemented', { page: action.page }),
          timestamp: Date.now(),
        }
      }

      return response
    },
    [handleNavigate, t],
  )

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      {showLogin && (
        <LoginForm
          onLogin={() => { setShowLogin(false); setAuthVersion((v) => v + 1) }}
          onSkip={() => { enterLocalMode(); setShowLogin(false); setAuthVersion((v) => v + 1) }}
        />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Suspense fallback={null}>
          <WorkloadRefusalModal />
        </Suspense>
        {credentialModalProviderId && (
          <CredentialModal
            providerId={credentialModalProviderId}
            onClose={() => setCredentialModalProviderId(null)}
          />
        )}
        <header
          style={{
            height: 52,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            gap: 12,
            flexShrink: 0,
            background: 'var(--panel)',
          }}
        >
          {/* TICKET_1328 AC5: the brand is the home control. It used to be an
              inert <span>, so the affordance users instinctively reach for to
              escape a leaf page did nothing. */}
          <button
            type="button"
            onClick={() => handleNavigate('chat')}
            aria-label={t('header.goHome')}
            title={t('header.goHome')}
            data-testid="brand-home-button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
              {t('header.brand')}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('header.title')}</span>
          </button>
          <div style={{ flex: 1 }} />
          <LLMProviderSelector onConfigureProvider={(id) => { if (id) setCredentialModalProviderId(id) }} />
          <LanguageSelector />
          <button
            type="button"
            className="toolbar-settings-button"
            onClick={() => handleNavigate('account-modules')}
            aria-label={t('toolbar.accountModules')}
            title={t('toolbar.accountModules')}
            data-testid="account-modules-toolbar-button"
          >
            <AccountModulesIcon />
          </button>
          <button
            type="button"
            className="toolbar-settings-button"
            onClick={() => openSettings()}
            aria-label={t('toolbar.openSettings')}
            title={t('toolbar.openSettings')}
            data-testid="settings-toolbar-button"
          >
            <SettingsGearIcon />
          </button>
          <AuthIndicator key={authVersion} onLogout={() => { setAuthVersion((v) => v + 1); setShowLogin(true) }} />
          <span
            style={{
              fontSize: 11,
              color: mcpConnected ? 'var(--green)' : mcpConnected === false ? 'var(--red)' : 'var(--text-muted)',
              background: mcpConnected ? 'rgba(74, 222, 128, 0.1)' : mcpConnected === false ? 'rgba(255, 77, 77, 0.1)' : 'rgba(128, 128, 128, 0.1)',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            {mcpConnected ? t('header.mcpConnected') : mcpConnected === false ? t('header.mcpOffline') : t('header.mcpConnecting')}
          </span>
        </header>

        <div className="dh-chat-shell" style={{ flex: 1 }}>
          <Suspense fallback={null}>
          <SystemMonitorPanel />
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {activePage === 'hub' && (
            <HubPage
              onNavigate={handleNavigate}
              onLogin={() => setShowLogin(true)}
            />
          )}
          {activePage === 'marketplace' && (
            <MarketplacePage
              onLogin={() => setShowLogin(true)}
            />
          )}
          {activePage === 'account-modules' && (
            <AccountModulesPage
              onLogin={() => setShowLogin(true)}
              onBack={() => handleNavigate('chat')}
            />
          )}
          {activePage === 'data' && (
            <DataManagementPage
              onLogin={() => setShowLogin(true)}
            />
          )}
          {activePage === 'universe' && (
            <UniversePage
              onLogin={() => setShowLogin(true)}
            />
          )}
          {activePage === 'quantlab' && (
            <QuantLabPage
              onLogin={() => setShowLogin(true)}
              onNavigateSignal={navigateToSignalDetail}
              onNavigateSweep={() => handleNavigate('sweep')}
              onNavigateUniverse={() => handleNavigate('universe')}
            />
          )}
          {activePage === 'scoreboard' && (
            <ScoreboardPage
              initialFilter={scoreboardFilter}
              onNavigateSignal={navigateToSignalDetail}
              onNavigateSweep={() => handleNavigate('sweep')}
            />
          )}
          {activePage === 'signal-detail' && selectedSignalId && (
            <SignalDetailPage
              signalId={selectedSignalId}
              onBack={() => handleNavigate('scoreboard')}
            />
          )}
          {activePage === 'templates' && (
            <TemplateBrowserPage
              onUseInSweep={navigateToSweepWithTemplate}
            />
          )}
          {activePage === 'sweep' && isAuthenticated() && (
            <SweepControlPage
              prefilledTemplateId={sweepPrefilledTemplate}
              onNavigateScoreboard={navigateToScoreboardWithFilter}
            />
          )}
          {activePage === 'sweep' && !isAuthenticated() && (
            <AuthRequiredNotice onLogin={() => setShowLogin(true)} message={t('auth.sweepRequiresLogin')} />
          )}
          {/* TICKET_1237_4 D7: the chat brain is the local BYOK agent loop
              (TICKET_638 no mandatory login) -- local mode is admitted. */}
          {(isAuthenticated() || isLocalOnly()) && (
            <div style={{ display: activePage === 'chat' ? 'contents' : 'none' }} aria-hidden={activePage !== 'chat'}>
              <DashboardHome
                toolCount={toolCount}
                onGuidedAction={handleGuidedActionDispatch}
                onConfigureProvider={setCredentialModalProviderId}
              />
            </div>
          )}
          {activePage === 'chat' && !isAuthenticated() && !isLocalOnly() && (
            <AuthRequiredNotice onLogin={() => setShowLogin(true)} message={t('auth.chatRequiresLogin')} />
          )}
          {activePage === 'settings' && (
            <SettingsPage
              onLogin={() => setShowLogin(true)}
              focusProviderId={settingsFocusProviderId}
              onBack={() => handleNavigate('chat')}
            />
          )}
          {activePage === 'backtest' && (
            <BacktestPage
              onLogin={() => setShowLogin(true)}
              onNavigateResult={navigateToBacktestResult}
            />
          )}
          {activePage === 'backtest-result' && selectedBacktestId && (
            <BacktestResultPage
              taskId={selectedBacktestId}
              onBack={() => handleNavigate('backtest')}
            />
          )}
          {activePage === 'signal-generator' && (
            <SignalGeneratorPage
              onLogin={() => setShowLogin(true)}
              onNavigateSweep={() => handleNavigate('sweep')}
            />
          )}
          </div>
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function SettingsGearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 000 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 00-1.9 0 1.7 1.7 0 00-1 1.6V21h-3v-.2a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9 0l-.1.1-2.1-2.1.1-.1a1.7 1.7 0 000-1.9 1.7 1.7 0 00-1.6-1H4v-3h.2a1.7 1.7 0 001.6-1 1.7 1.7 0 000-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 001.9 0 1.7 1.7 0 001-1.6V4h3v.2a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9 0l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 000 1.9 1.7 1.7 0 001.6 1h.2v3h-.2a1.7 1.7 0 00-1.6 1z" />
    </svg>
  )
}

function AccountModulesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function AuthRequiredNotice({ onLogin, message }: { onLogin: () => void; message: string }) {
  const { t } = useTranslation('dashboard')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'var(--text-muted)' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <p style={{ fontSize: 14, textAlign: 'center', maxWidth: 320 }}>{message}</p>
      <button
        onClick={onLogin}
        style={{ padding: '8px 24px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
      >
        {t('auth.signIn')}
      </button>
    </div>
  )
}
