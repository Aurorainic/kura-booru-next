import type { AiStatus, AiJobStatus, TagClassificationSuggestion, MergeSuggestion, RatingSuggestionItem, AssistantReply } from '~/types'
import { fetchApi } from './api'

// 显式 import 规避 auto-import 在异步 chunk 的失效（frontend-audit §8.3-3）

// ── AI Status ──

export async function getAiStatus(ssrCookie?: string): Promise<AiStatus> {
  return fetchApi<AiStatus>('/admin/ai/status', undefined, { ssrCookie })
}

// ── Tag Classification ──

export async function classifyTagsAI(
  params: { mode: 'unprocessed' | 'all' | 'specific'; tag_ids?: string[] },
  ssrCookie?: string,
): Promise<{ suggestions: TagClassificationSuggestion[]; job_id?: string | null }> {
  return fetchApi('/admin/ai/classify-tags', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    ssrCookie,
  })
}

// ── Merge Suggestions ──

export async function suggestMergesAI(
  params: { scope: 'all' | { category: string } },
  ssrCookie?: string,
): Promise<{ suggestions: MergeSuggestion[]; job_id?: string | null }> {
  return fetchApi('/admin/ai/suggest-merges', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    ssrCookie,
  })
}

// ── Rating Suggestions ──

export async function suggestRatingsAI(
  params: { scope: 'unrated' | 'all' | { rating: string }; limit?: number },
  ssrCookie?: string,
): Promise<{ suggestions: RatingSuggestionItem[]; job_id?: string | null }> {
  return fetchApi('/admin/ai/suggest-ratings', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    ssrCookie,
  })
}

// ── AI Job polling ──

export async function getAiJobStatus(jobId: string, ssrCookie?: string): Promise<AiJobStatus> {
  return fetchApi<AiJobStatus>(`/admin/ai/jobs/${jobId}`, undefined, { ssrCookie })
}

// ── Admin Assistant Chat ──

export async function adminChat(
  params: { query: string; history?: { role: string; content: string }[]; lang?: string },
  ssrCookie?: string,
): Promise<AssistantReply> {
  return fetchApi('/admin/ai/chat', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, source: 'web' }),
    ssrCookie,
  })
}
