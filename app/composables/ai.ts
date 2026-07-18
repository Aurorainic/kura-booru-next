import type { AiStatus, AiJobStatus, TagClassificationSuggestion, MergeSuggestion, RatingSuggestionItem, AssistantReply } from '~/types'

// ponytail: use $fetch directly — fetchApi auto-import breaks in code-split client chunks
// (Nuxt resolves the symbol at build time but the reference is unbound in the async chunk)

async function aiFetch<T>(path: string, opts?: { method?: string; body?: string; ssrCookie?: string }): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts?.body) headers['Content-Type'] = 'application/json'
  if (opts?.ssrCookie) headers['Cookie'] = opts.ssrCookie

  const res = await $fetch<T>(`/api${path}`, {
    method: (opts?.method || 'GET') as any,
    headers,
    body: opts?.body,
    credentials: 'include',
  })
  return res
}

// ── AI Status ──

export async function getAiStatus(ssrCookie?: string): Promise<AiStatus> {
  return aiFetch<AiStatus>('/admin/ai/status', { ssrCookie })
}

// ── Tag Classification ──

export async function classifyTagsAI(
  params: { mode: 'unprocessed' | 'all' | 'specific'; tag_ids?: string[] },
  ssrCookie?: string,
): Promise<{ suggestions: TagClassificationSuggestion[]; job_id?: string | null }> {
  return aiFetch('/admin/ai/classify-tags', {
    method: 'POST',
    body: JSON.stringify(params),
    ssrCookie,
  })
}

// ── Merge Suggestions ──

export async function suggestMergesAI(
  params: { scope: 'all' | { category: string } },
  ssrCookie?: string,
): Promise<{ suggestions: MergeSuggestion[]; job_id?: string | null }> {
  return aiFetch('/admin/ai/suggest-merges', {
    method: 'POST',
    body: JSON.stringify(params),
    ssrCookie,
  })
}

// ── Rating Suggestions ──

export async function suggestRatingsAI(
  params: { scope: 'unrated' | 'all' | { rating: string }; limit?: number },
  ssrCookie?: string,
): Promise<{ suggestions: RatingSuggestionItem[]; job_id?: string | null }> {
  return aiFetch('/admin/ai/suggest-ratings', {
    method: 'POST',
    body: JSON.stringify(params),
    ssrCookie,
  })
}

// ── AI Job polling ──

export async function getAiJobStatus(jobId: string, ssrCookie?: string): Promise<AiJobStatus> {
  return aiFetch<AiJobStatus>(`/admin/ai/jobs/${jobId}`, { ssrCookie })
}

// ── Admin Assistant Chat ──

export async function adminChat(
  params: { query: string; history?: { role: string; content: string }[]; lang?: string },
  ssrCookie?: string,
): Promise<AssistantReply> {
  return aiFetch('/admin/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ ...params, source: 'web' }),
    ssrCookie,
  })
}
