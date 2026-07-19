import type { AiJobStatus } from '~/types'
import { getAiJobStatus } from './ai'

interface UseAiJobPollingOptions {
  /** Polling interval in milliseconds. */
  intervalMs: number
  /** SSR cookie forwarded to getAiJobStatus for admin auth. */
  ssrCookie: string
  /** Called when the job reaches `done` with suggestions (empty array still fires). */
  onDone?: (suggestions: any[]) => void
  /** Called when the job reaches `error`. */
  onError?: (errors: string[]) => void
  /** Called once when the job reaches any terminal status (done/error/gone). */
  onTerminal?: () => void
}

/**
 * Shared AI job polling for the 3 admin AI panels (Classify/Merges/Ratings).
 * Each panel POSTs to start a job, gets a job_id back, then polls
 * GET /api/admin/ai/jobs/:id until status is done/error/gone.
 *
 * The composable owns the setInterval timer, the activeJobId/jobProgress refs,
 * and the onUnmounted cleanup. Callers provide per-panel callbacks for the
 * done/error/terminal transitions.
 */
export function useAiJobPolling(options: UseAiJobPollingOptions) {
  const activeJobId = ref<string | null>(null)
  const jobProgress = ref<{ done: number; total: number } | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    activeJobId.value = null
    jobProgress.value = null
  }

  async function poll(jobId: string) {
    try {
      const status = await getAiJobStatus(jobId, options.ssrCookie)
      jobProgress.value = { done: status.done, total: status.total }
      if (status.status === 'done' || status.status === 'error' || status.status === 'gone') {
        stop()
        if (status.status === 'done' && status.result?.suggestions) {
          options.onDone?.(status.result.suggestions)
        } else if (status.status === 'error') {
          options.onError?.(status.errors)
        }
        options.onTerminal?.()
      }
    } catch { /* keep polling — transient network errors shouldn't kill the job */ }
  }

  function start(jobId: string) {
    activeJobId.value = jobId
    jobProgress.value = { done: 0, total: 0 }
    pollTimer = setInterval(() => {
      if (activeJobId.value) poll(activeJobId.value)
    }, options.intervalMs)
  }

  onUnmounted(stop)

  return { activeJobId, jobProgress, start, stop }
}
