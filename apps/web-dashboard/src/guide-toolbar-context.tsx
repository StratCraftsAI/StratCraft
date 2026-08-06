import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { GuideToolbarConfig, SetLlmSelectionResult } from '@StratCraft/types'
import i18n from './i18n/index.ts'
import { callTool, McpToolError } from './mcp-client.ts'
import { registerFallback, subscribe, onStateChange } from './event-stream.ts'
import {
  isCanonicalGuideToolbarSnapshot,
  useGuideAgentConfigStore,
} from './stores/useGuideAgentConfigStore.ts'

export const GUIDE_TOOLBAR_REVISION_EVENT = 'guide-toolbar-config-revision'

interface SetLocaleResult {
  locale: string
}

interface GuideToolbarState {
  config: GuideToolbarConfig | null
  loading: boolean
  refreshing: boolean
  selectionSaving: boolean
  localeSaving: boolean
  loadError: string | null
  selectionError: string | null
  localeError: string | null
  refresh: () => Promise<void>
  selectLlm: (providerId: string, modelId: string, catalogProviderId?: string) => Promise<boolean>
  setLocale: (locale: string) => Promise<boolean>
}

const GuideToolbarContext = createContext<GuideToolbarState | null>(null)

function errorMessage(reason: unknown): string {
  if (reason instanceof McpToolError && reason.errorCode) {
    return i18n.t(`dashboard:toolbar.errors.${reason.errorCode}`, {
      defaultValue: reason.message,
    })
  }
  return reason instanceof Error ? reason.message : String(reason)
}

export function isGuideToolbarConfig(value: unknown): value is GuideToolbarConfig {
  return isCanonicalGuideToolbarSnapshot(value)
}

export function isCanonicalLlmSelectionResult(
  value: unknown,
): value is SetLlmSelectionResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<SetLlmSelectionResult>
  return Boolean(
    result.selected?.providerId
    && result.selected.modelId
    && result.selectionFingerprint
    && result.agent
    && isGuideToolbarConfig(result.snapshot)
    && result.selectionFingerprint === result.agent.selectionFingerprint
    && result.agent.selectionFingerprint === result.snapshot.agent?.selectionFingerprint
    && result.selected.providerId === result.snapshot.agent.selection.inferenceRoute.runtimeProviderId
    && result.selected.modelId === result.snapshot.agent.selection.inferenceRoute.modelId
    && result.selected.catalogProviderId
      === result.snapshot.agent.selection.inferenceRoute.catalogProviderId
  )
}

export function GuideToolbarProvider({ children }: { children: ReactNode }) {
  const config = useGuideAgentConfigStore(state => state.snapshot)
  const selectionSaving = useGuideAgentConfigStore(state => state.mutationPending)
  const hydrate = useGuideAgentConfigStore(state => state.hydrate)
  const selectCanonicalLlm = useGuideAgentConfigStore(state => state.selectLlm)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [localeSaving, setLocaleSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [localeError, setLocaleError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  const applySnapshot = useCallback(async (snapshot: GuideToolbarConfig) => {
    if (!hydrate(snapshot)) throw new Error(i18n.t('dashboard:toolbar.invalidResponse'))
    setLoadError(null)
    await i18n.changeLanguage(snapshot.locale.current)
  }, [hydrate])

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    setRefreshing(true)
    try {
      const result = await callTool('get_guide_toolbar_config')
      if (!isGuideToolbarConfig(result)) {
        throw new Error(i18n.t('dashboard:toolbar.invalidResponse'))
      }
      if (generation !== requestGeneration.current) return
      await applySnapshot(result)
    } catch (reason) {
      if (generation === requestGeneration.current) setLoadError(errorMessage(reason))
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [applySnapshot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return onStateChange((state) => {
      if (state.connected && loadError) void refresh()
    })
  }, [loadError, refresh])

  useEffect(() => {
    const handleRevision = (payload: unknown) => {
      if (isGuideToolbarConfig(payload)) {
        void applySnapshot(payload).catch(reason => setLoadError(errorMessage(reason)))
        return
      }
      void refresh()
    }
    const unsubscribe = subscribe(GUIDE_TOOLBAR_REVISION_EVENT, handleRevision)
    const unregisterFallback = registerFallback(GUIDE_TOOLBAR_REVISION_EVENT, {
      toolName: 'get_guide_toolbar_config',
    })
    return () => {
      unregisterFallback()
      unsubscribe()
    }
  }, [applySnapshot, refresh])

  const selectLlm = useCallback(async (providerId: string, modelId: string, catalogProviderId?: string) => {
    setSelectionError(null)
    try {
      const result = await selectCanonicalLlm(providerId, modelId, catalogProviderId)
      if (!isCanonicalLlmSelectionResult(result)) {
        throw new Error(i18n.t('dashboard:toolbar.invalidResponse'))
      }
      return true
    } catch (reason) {
      setSelectionError(errorMessage(reason))
      return false
    }
  }, [selectCanonicalLlm])

  const setLocale = useCallback(async (locale: string) => {
    setLocaleSaving(true)
    setLocaleError(null)
    try {
      const result = await callTool('set_locale', { locale }) as SetLocaleResult
      if (!result?.locale) throw new Error(i18n.t('dashboard:toolbar.invalidResponse'))
      await refresh()
      await i18n.changeLanguage(result.locale)
      return true
    } catch (reason) {
      setLocaleError(errorMessage(reason))
      return false
    } finally {
      setLocaleSaving(false)
    }
  }, [refresh])

  const value = useMemo<GuideToolbarState>(() => ({
    config,
    loading,
    refreshing,
    selectionSaving,
    localeSaving,
    loadError,
    selectionError,
    localeError,
    refresh,
    selectLlm,
    setLocale,
  }), [
    config,
    loading,
    refreshing,
    selectionSaving,
    localeSaving,
    loadError,
    selectionError,
    localeError,
    refresh,
    selectLlm,
    setLocale,
  ])

  return <GuideToolbarContext.Provider value={value}>{children}</GuideToolbarContext.Provider>
}

export function useGuideToolbar(): GuideToolbarState {
  const context = useContext(GuideToolbarContext)
  if (!context) throw new Error('useGuideToolbar must be used inside GuideToolbarProvider')
  return context
}
