/** TICKET_1355_2B: browser adapter for host-owned durable job observation. */
import {
  parseResearchEnvironmentJob,
  type ResearchEnvironmentJob,
} from '@StratCraft/types'
import { callTool } from './mcp-client.ts'
import { SSE_FALLBACK_POLL_INTERVAL_MS } from './constants.ts'
import { onStateChange, subscribe } from './event-stream.ts'

export interface ResearchEnvironmentJobEvent {
  jobId: string
  revision: number
  job: ResearchEnvironmentJob
}

const revisions = new Map<string, number>()

export function parseResearchEnvironmentJobEvent(value: unknown): ResearchEnvironmentJobEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.jobId !== 'string'
    || !Number.isSafeInteger(record.revision)
    || Number(record.revision) < 1) return null
  try {
    return {
      jobId: record.jobId,
      revision: Number(record.revision),
      job: parseResearchEnvironmentJob(record.job),
    }
  } catch {
    return null
  }
}

export function subscribeResearchEnvironmentJobs(
  handler: (event: ResearchEnvironmentJobEvent) => void,
): () => void {
  const tracked = new Map<string, ResearchEnvironmentJobEvent>()
  const snapshots = new Map<string, string>()
  const inFlight = new Set<string>()
  let fallbackTimer: ReturnType<typeof setInterval> | null = null

  const poll = async (current: ResearchEnvironmentJobEvent) => {
    if (inFlight.has(current.jobId)) return
    inFlight.add(current.jobId)
    try {
      const job = parseResearchEnvironmentJob(await callTool(
        'get_research_environment_job',
        { job_id: current.jobId },
      ))
      const snapshot = JSON.stringify(job)
      if (snapshots.get(current.jobId) === snapshot) return
      snapshots.set(current.jobId, snapshot)
      const fallback = { ...current, job }
      tracked.set(current.jobId, fallback)
      handler(fallback)
      if (job.state === 'succeeded' || job.state === 'failed') {
        tracked.delete(current.jobId)
      }
    } catch {
      // The shared stream reconnect loop remains authoritative; retry one
      // bounded read on the next cadence without resubmitting the mutation.
    } finally {
      inFlight.delete(current.jobId)
    }
  }

  const unsubscribeStream = subscribe('research-environment-job', raw => {
    const event = parseResearchEnvironmentJobEvent(raw)
    if (!event) return
    const seen = revisions.get(event.jobId) ?? 0
    if (event.revision <= seen) return
    revisions.set(event.jobId, event.revision)
    snapshots.set(event.jobId, JSON.stringify(event.job))
    if (event.job.state === 'succeeded' || event.job.state === 'failed') {
      tracked.delete(event.jobId)
    } else {
      tracked.set(event.jobId, event)
    }
    handler(event)
  })
  const unsubscribeState = onStateChange(state => {
    if (!state.degraded) {
      if (fallbackTimer) clearInterval(fallbackTimer)
      fallbackTimer = null
      return
    }
    if (fallbackTimer) return
    const pollAll = () => {
      for (const current of tracked.values()) void poll(current)
    }
    pollAll()
    fallbackTimer = setInterval(pollAll, SSE_FALLBACK_POLL_INTERVAL_MS)
  })
  return () => {
    unsubscribeStream()
    unsubscribeState()
    if (fallbackTimer) clearInterval(fallbackTimer)
    fallbackTimer = null
    tracked.clear()
  }
}

export function projectResearchEnvironmentJobMessage(event: ResearchEnvironmentJobEvent): string {
  const { job } = event
  if (job.transition?.outcome === 'post_publication_cleanup_pending') {
    return `GPQuant is ${job.transition.activeProjection === 'default' ? 'restored' : 'removed'} and active. `
      + `Cleanup of the inactive ${job.transition.pendingCleanupProjection} projection failed or remains pending. `
      + 'Approve and retry the lifecycle mutation to recover that exact cleanup target.'
  }
  if (job.transition?.outcome === 'pre_publication_failure') {
    const failure = job.status.failure
    return `The requested projection was not published; ${job.transition.activeProjection} remains active. `
      + (failure ? `${failure.message} ${failure.remediation}` : 'Retry after reviewing the lifecycle failure.')
  }
  if (job.state === 'succeeded') {
    if (job.status.projection === 'default'
      && (job.operation === 'install' || job.operation === 'restore_capability')) {
      return 'GPQuant is restored and active. The repository-locked research environment is ready.'
    }
    return `Research environment ${job.operation} completed successfully. Active projection: ${job.status.projection}.`
  }
  if (job.state === 'failed') {
    const failure = job.status.failure
    return failure
      ? `${failure.message} ${failure.remediation}`
      : `Research environment ${job.operation} failed.`
  }
  const stage = job.currentStage ? ` (${job.currentStage})` : ''
  return `Research environment ${job.operation} is ${job.state}${stage}.`
}

export function _resetResearchEnvironmentJobObserverForTest(): void {
  revisions.clear()
}
