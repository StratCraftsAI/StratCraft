import { create } from 'zustand'
import type {
  AgentAdmissionFieldDelta,
  GuideAgentRuntimeSnapshot,
  GuideToolbarConfig,
  ResearchTaskDraftV1,
  SetLlmSelectionResult,
} from '@StratCraft/types'
import { callTool } from '../mcp-client.ts'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const FORBIDDEN_SNAPSHOT_FIELD_PATTERN =
  /^(?:executablePath|binaryPath|workspaceRoot|credentials?|authorization|apiKey|accessToken|refreshToken|stderr|nativeEvent|providerNative)$/i
const POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'=(])\/(?:[^/\s]+\/)+[^/\s]*/
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'=(])[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/

export type ResearchTaskDraftSlice = ResearchTaskDraftV1

export const EMPTY_RESEARCH_TASK_DRAFT: ResearchTaskDraftSlice = Object.freeze({
  objective: '',
  hypothesis: '',
  locale: '',
  artifactKind: 'strategy',
  projectId: '',
  workspaceId: '',
  dataCapabilityId: '',
  toolCapabilityProfileId: '',
  commandPolicyId: '',
  resourceBudgetPolicyId: '',
  researchPolicyBundleId: '',
  acceptanceProfileId: '',
  inputArtifactRefs: [],
})

interface CanonicalTaskCreationResult {
  success: true
  task: {
    taskId: string
    taskSpecVersion: string
    taskSpecContentHash: string
    title?: string
  }
  snapshot: GuideToolbarConfig
}

interface GuideAgentConfigStore {
  snapshot: GuideToolbarConfig | null
  mutationPending: boolean
  invalidated: boolean
  resubmissionRequired: boolean
  capabilityDelta: readonly AgentAdmissionFieldDelta[]
  submittedSnapshotRevision: number | null
  taskDraft: ResearchTaskDraftSlice
  taskCreationError: string | null
  hydrate: (snapshot: unknown) => boolean
  setTaskDraftField: <K extends keyof ResearchTaskDraftSlice>(
    field: K,
    value: ResearchTaskDraftSlice[K],
  ) => void
  replaceTaskDraft: (draft: ResearchTaskDraftSlice) => void
  selectLlm: (
    providerId: string,
    modelId: string,
    catalogProviderId?: string,
  ) => Promise<SetLlmSelectionResult>
  selectCanonicalAgentChoice: (
    axis: 'runtime' | 'entitlement' | 'workspace' | 'permission-policy' | 'task' | 'research-policy',
    choiceId: string,
  ) => Promise<GuideToolbarConfig>
  createResearchTask: (locale: string) => Promise<CanonicalTaskCreationResult>
  invalidate: (delta: readonly AgentAdmissionFieldDelta[]) => void
  markSubmitted: () => void
  resetForTest: () => void
}

function hasForbiddenSnapshotValue(value: unknown, depth = 0): boolean {
  if (depth > 10) return true
  if (typeof value === 'string') {
    return POSIX_ABSOLUTE_PATH_PATTERN.test(value) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
  }
  if (Array.isArray(value)) return value.some(item => hasForbiddenSnapshotValue(item, depth + 1))
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, entry]) =>
    FORBIDDEN_SNAPSHOT_FIELD_PATTERN.test(key) || hasForbiddenSnapshotValue(entry, depth + 1))
}

function isRuntimeSnapshot(value: unknown): value is GuideAgentRuntimeSnapshot {
  if (!value || typeof value !== 'object') return false
  const agent = value as Partial<GuideAgentRuntimeSnapshot>
  return typeof agent.selectionFingerprint === 'string'
    && SHA256_PATTERN.test(agent.selectionFingerprint)
    && typeof agent.runtimeCapabilityHash === 'string'
    && SHA256_PATTERN.test(agent.runtimeCapabilityHash)
    && Number.isSafeInteger(agent.snapshotRevision)
    && typeof agent.selection?.runtimeId === 'string'
    && typeof agent.selection.task?.taskId === 'string'
    && typeof agent.selection.workspace?.workspaceId === 'string'
    && Array.isArray(agent.choices?.runtimes)
    && Array.isArray(agent.choices.entitlements)
    && Array.isArray(agent.choices.workspaces)
    && Array.isArray(agent.choices.permissionPolicies)
    && Array.isArray(agent.choices.tasks)
    && Array.isArray(agent.choices.researchPolicies)
    && Array.isArray(agent.choices.capabilityProfiles)
    && Array.isArray(agent.choices.projects)
    && Array.isArray(agent.choices.dataCapabilities)
    && Array.isArray(agent.choices.commandPolicies)
    && Array.isArray(agent.choices.resourcePolicies)
    && Array.isArray(agent.choices.acceptanceProfiles)
    && Array.isArray(agent.choices.inputArtifacts)
    && agent.choices.runtimes.some(choice =>
      choice.descriptor.runtimeId === agent.selection?.runtimeId)
    && agent.choices.entitlements.some(choice =>
      choice.value === agent.selection?.entitlementSource)
    && agent.choices.workspaces.some(choice =>
      choice.value.workspaceId === agent.selection?.workspace.workspaceId)
    && agent.choices.permissionPolicies.some(choice =>
      choice.value.id === agent.selection?.permissionPolicy.id)
}

export function isCanonicalGuideToolbarSnapshot(value: unknown): value is GuideToolbarConfig {
  if (!value || typeof value !== 'object' || hasForbiddenSnapshotValue(value)) return false
  const snapshot = value as Partial<GuideToolbarConfig>
  if (!Number.isSafeInteger(snapshot.snapshotRevision)) return false
  if (typeof snapshot.locale?.current !== 'string' || !Array.isArray(snapshot.locale.supported)) return false
  if (!Array.isArray(snapshot.llm?.groups)) return false
  if (snapshot.llm.selectionFingerprint !== null
    && (typeof snapshot.llm.selectionFingerprint !== 'string'
      || !SHA256_PATTERN.test(snapshot.llm.selectionFingerprint))) return false
  if (snapshot.agent === null) return snapshot.llm.selectionFingerprint === null
  return isRuntimeSnapshot(snapshot.agent)
    && snapshot.agent.snapshotRevision === snapshot.snapshotRevision
    && snapshot.agent.selectionFingerprint === snapshot.llm.selectionFingerprint
}

function requireCanonicalSnapshot(value: unknown): GuideToolbarConfig {
  if (!isCanonicalGuideToolbarSnapshot(value)) {
    throw new Error('The MCP server returned an invalid canonical Guide snapshot.')
  }
  return value
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function selectableChoiceId<T>(
  choices: readonly { id: string; availability: string; value: T }[],
  current: string,
): string {
  return choices.some(choice =>
    choice.id === current && choice.availability === 'selectable')
    ? current
    : choices.find(choice => choice.availability === 'selectable')?.id ?? ''
}

function canonicalTaskDraft(
  current: ResearchTaskDraftSlice,
  snapshot: GuideToolbarConfig,
): ResearchTaskDraftSlice {
  const choices = snapshot.agent?.choices
  if (!choices) {
    return {
      ...current,
      locale: snapshot.locale.current,
      projectId: '',
      workspaceId: '',
      dataCapabilityId: '',
      toolCapabilityProfileId: '',
      commandPolicyId: '',
      resourceBudgetPolicyId: '',
      researchPolicyBundleId: '',
      acceptanceProfileId: '',
      inputArtifactRefs: [],
    }
  }
  const inputArtifactRefs = current.inputArtifactRefs.filter(reference =>
    choices.inputArtifacts.some(choice =>
      choice.availability === 'selectable'
      && choice.value.artifactId === reference.artifactId
      && choice.value.artifactKind === reference.artifactKind
      && choice.value.rootContentHash === reference.rootContentHash))
  return {
    ...current,
    locale: snapshot.locale.current,
    projectId: selectableChoiceId(choices.projects, current.projectId),
    workspaceId: selectableChoiceId(choices.workspaces, current.workspaceId),
    dataCapabilityId: selectableChoiceId(
      choices.dataCapabilities,
      current.dataCapabilityId,
    ),
    toolCapabilityProfileId: selectableChoiceId(
      choices.capabilityProfiles,
      current.toolCapabilityProfileId,
    ),
    commandPolicyId: selectableChoiceId(
      choices.commandPolicies,
      current.commandPolicyId,
    ),
    resourceBudgetPolicyId: selectableChoiceId(
      choices.resourcePolicies,
      current.resourceBudgetPolicyId,
    ),
    researchPolicyBundleId: selectableChoiceId(
      choices.researchPolicies,
      current.researchPolicyBundleId,
    ),
    acceptanceProfileId: selectableChoiceId(
      choices.acceptanceProfiles,
      current.acceptanceProfileId,
    ),
    inputArtifactRefs,
  }
}

export const useGuideAgentConfigStore = create<GuideAgentConfigStore>((set, get) => ({
  snapshot: null,
  mutationPending: false,
  invalidated: false,
  resubmissionRequired: false,
  capabilityDelta: [],
  submittedSnapshotRevision: null,
  taskDraft: { ...EMPTY_RESEARCH_TASK_DRAFT },
  taskCreationError: null,

  hydrate: (value) => {
    if (!isCanonicalGuideToolbarSnapshot(value)) return false
    const previous = get().snapshot?.agent
    const next = value.agent
    const capabilityChanged = Boolean(
      previous
      && next
      && previous.runtimeCapabilityHash !== next.runtimeCapabilityHash,
    )
    set({
      snapshot: value,
      taskDraft: canonicalTaskDraft(get().taskDraft, value),
      invalidated: capabilityChanged || Boolean(next?.selectionInvalidated),
      resubmissionRequired: capabilityChanged || Boolean(next?.resubmissionRequired),
      capabilityDelta: capabilityChanged
        ? [{
            path: 'runtime.capabilities',
            oldPublicHash: previous!.runtimeCapabilityHash,
            newPublicHash: next!.runtimeCapabilityHash,
          }]
        : next?.capabilityDelta ?? [],
    })
    return true
  },

  setTaskDraftField: (field, value) => set(state => ({
    taskDraft: { ...state.taskDraft, [field]: value },
    taskCreationError: null,
  })),
  replaceTaskDraft: taskDraft => set({ taskDraft: { ...taskDraft }, taskCreationError: null }),

  selectLlm: async (providerId, modelId, catalogProviderId) => {
    set({ mutationPending: true })
    try {
      const result = await callTool('set_llm_selection', {
        provider: providerId,
        model: modelId,
        ...(catalogProviderId ? { catalog_provider: catalogProviderId } : {}),
      }) as SetLlmSelectionResult
      const snapshot = requireCanonicalSnapshot(result?.snapshot)
      if (
        !result?.success
        || result.selectionFingerprint !== snapshot.agent?.selectionFingerprint
        || result.agent.selectionFingerprint !== snapshot.agent?.selectionFingerprint
      ) {
        throw new Error('The LLM mutation did not return one canonical snapshot.')
      }
      get().hydrate(snapshot)
      return result
    } finally {
      set({ mutationPending: false })
    }
  },

  selectCanonicalAgentChoice: async (axis, choiceId) => {
    set({ mutationPending: true })
    try {
      const result = await callTool('set_guide_agent_selection', {
        axis,
        canonical_choice_id: choiceId,
        snapshot_revision: get().snapshot?.snapshotRevision,
      }) as { snapshot?: unknown }
      const snapshot = requireCanonicalSnapshot(result?.snapshot)
      get().hydrate(snapshot)
      return snapshot
    } finally {
      set({ mutationPending: false })
    }
  },

  createResearchTask: async (locale) => {
    set({ mutationPending: true, taskCreationError: null })
    try {
      const draft = get().taskDraft
      const result = await callTool('create_research_task', {
        locale,
        projectId: draft.projectId,
        artifactKind: draft.artifactKind,
        objective: draft.objective,
        ...(draft.hypothesis ? { hypothesis: draft.hypothesis } : {}),
        workspaceId: draft.workspaceId,
        dataCapabilityId: draft.dataCapabilityId,
        toolCapabilityProfileId: draft.toolCapabilityProfileId,
        commandPolicyId: draft.commandPolicyId,
        resourceBudgetPolicyId: draft.resourceBudgetPolicyId,
        researchPolicyBundleId: draft.researchPolicyBundleId,
        acceptanceProfileId: draft.acceptanceProfileId,
        inputArtifactRefs: draft.inputArtifactRefs,
      }) as CanonicalTaskCreationResult
      const snapshot = requireCanonicalSnapshot(result?.snapshot)
      if (
        !result?.success
        || !result.task
        || snapshot.agent?.selection.task.taskSpecContentHash !== result.task.taskSpecContentHash
      ) {
        throw new Error('Task creation did not select the returned canonical task hash.')
      }
      get().hydrate(snapshot)
      return result
    } catch (reason) {
      set({ taskCreationError: errorText(reason) })
      throw reason
    } finally {
      set({ mutationPending: false })
    }
  },

  invalidate: capabilityDelta => set({
    invalidated: true,
    resubmissionRequired: true,
    capabilityDelta: [...capabilityDelta],
  }),
  markSubmitted: () => set(state => ({
    invalidated: false,
    resubmissionRequired: false,
    submittedSnapshotRevision: state.snapshot?.snapshotRevision ?? null,
  })),
  resetForTest: () => set({
    snapshot: null,
    mutationPending: false,
    invalidated: false,
    resubmissionRequired: false,
    capabilityDelta: [],
    submittedSnapshotRevision: null,
    taskDraft: { ...EMPTY_RESEARCH_TASK_DRAFT },
    taskCreationError: null,
  }),
}))
