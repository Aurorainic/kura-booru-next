import type { Post, PostsResponse, Tag, PaginatedResponse, AuthStatus, Rating, TagCategory, AutoRatingRule, SiteSettings, DashboardStats } from '~/types'

function getBaseUrl(): string {
  if (import.meta.server) {
    const config = useRuntimeConfig()
    return config.internalApiUrl
  }
  return '/api'
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function fetchApi<T>(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
  options?: RequestInit & { ssrCookie?: string },
): Promise<T> {
  // ponytail: string concat + URLSearchParams — new URL() throws on relative paths in browser
  let url = `${getBaseUrl()}${endpoint}`
  if (params) {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        sp.set(key, String(value))
      }
    })
    const qs = sp.toString()
    if (qs) url += `?${qs}`
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  }

  const ssrCookie = options?.ssrCookie
  if (ssrCookie) {
    headers['Cookie'] = ssrCookie
  }

  const { ssrCookie: _sc, ...fetchOptions } = options || {}
  const isBrowser = typeof window !== 'undefined'

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    ...(isBrowser ? { credentials: 'include' as RequestCredentials } : {}),
  })

  if (!response.ok) {
    throw new ApiError(response.status, `API error: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

// ── Post APIs ──

export async function fetchPosts(page = 1, perPage = 40, rating?: Rating, ssrCookie?: string): Promise<PostsResponse> {
  const params: Record<string, string | number | undefined> = { page, per_page: perPage }
  if (rating) params.rating = rating
  return fetchApi<PostsResponse>('/posts/', params, { ssrCookie })
}

export async function fetchPost(id: string, ssrCookie?: string): Promise<Post> {
  return fetchApi<Post>(`/posts/${id}`, undefined, { ssrCookie })
}

export async function fetchRandomPost(ssrCookie?: string): Promise<Post> {
  return fetchApi<Post>('/posts/random', undefined, { ssrCookie })
}

export async function updatePostRating(id: string, rating: Rating): Promise<Post> {
  return fetchApi<Post>(`/posts/${id}`, undefined, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  })
}

export async function deletePost(id: string): Promise<void> {
  await fetchApi<void>(`/posts/${id}`, undefined, { method: 'DELETE' })
}

// ── Tag APIs ──

export async function fetchTags(
  category?: TagCategory, sort = 'count', page = 1, perPage = 100, ssrCookie?: string,
): Promise<PaginatedResponse<Tag>> {
  return fetchApi<PaginatedResponse<Tag>>('/tags/', { category, sort, page, per_page: perPage }, { ssrCookie })
}

export async function fetchAutocomplete(prefix: string): Promise<Tag[]> {
  return fetchApi<Tag[]>('/tags/autocomplete', { q: prefix, per_page: 10 })
}

export async function fetchTag(name: string, ssrCookie?: string): Promise<Tag> {
  return fetchApi<Tag>(`/tags/${encodeURIComponent(name)}`, undefined, { ssrCookie })
}

// ── Search API ──

export async function fetchSearch(
  query: string, page = 1, perPage = 40, ssrCookie?: string, source?: string,
): Promise<PostsResponse> {
  const params: Record<string, string | number> = { q: query, page, per_page: perPage }
  if (source) params.source = source
  return fetchApi<PostsResponse>('/search/', params, { ssrCookie })
}

// ── Auth APIs ──

export async function fetchAuthStatus(ssrCookie?: string): Promise<AuthStatus> {
  return fetchApi<AuthStatus>('/auth/status', undefined, { ssrCookie })
}

export async function login(username: string, password: string): Promise<{ ok: boolean; is_admin: boolean }> {
  return fetchApi('/auth/login', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function logout(): Promise<{ ok: boolean }> {
  return fetchApi('/auth/logout', undefined, { method: 'POST' })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return fetchApi('/auth/change-password', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

// ── Settings ──

export async function fetchPublicSettings(ssrCookie?: string): Promise<SiteSettings> {
  return fetchApi<SiteSettings>('/settings/public', undefined, { ssrCookie })
}

// ── Auto-Rating Rules ──

export async function fetchAutoRatingRules(ssrCookie?: string): Promise<AutoRatingRule[]> {
  return fetchApi<AutoRatingRule[]>('/auto-rating-rules/', undefined, { ssrCookie })
}

export async function createAutoRatingRule(tagName: string, targetRating: Rating, ssrCookie?: string): Promise<AutoRatingRule> {
  return fetchApi('/auto-rating-rules/', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tagName, target_rating: targetRating }),
    ssrCookie,
  })
}

export async function deleteAutoRatingRule(ruleId: string, ssrCookie?: string): Promise<void> {
  await fetchApi<void>(`/auto-rating-rules/${ruleId}`, undefined, { method: 'DELETE', ssrCookie })
}

// ── Admin Tag APIs ──

export async function fetchAdminTags(params?: {
  category?: TagCategory; ai_status?: string; q?: string; sort?: string; page?: number; per_page?: number
}, ssrCookie?: string): Promise<PaginatedResponse<Tag>> {
  return fetchApi<PaginatedResponse<Tag>>('/admin/tags/', params as Record<string, string | number | undefined>, { ssrCookie })
}

export async function updatePostTags(postId: string, data: { add_tags?: string[]; remove_tag_ids?: string[] }): Promise<Post> {
  return fetchApi<Post>(`/posts/${postId}/tags`, undefined, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export interface MergeResult {
  merged: boolean
  source_tag_id: string
  source_tag_name: string
  target_tag_id: string
  target_tag_name: string
  posts_moved: number
  posts_skipped: number
  target_old_post_count: number
  target_new_post_count: number
}

export async function mergeTags(sourceTagId: string, targetTagId: string, ssrCookie?: string): Promise<MergeResult> {
  return fetchApi<MergeResult>('/admin/tags/merge', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_tag_id: sourceTagId, target_tag_id: targetTagId }),
    ssrCookie,
  })
}

// ── Dashboard ──

export async function fetchDashboardStats(ssrCookie?: string): Promise<DashboardStats> {
  return fetchApi<DashboardStats>('/admin/dashboard/', undefined, { ssrCookie })
}

// ── Admin Post Management ──

export async function fetchAdminPosts(opts: {
  page?: number; per_page?: number; rating?: string
}, ssrCookie?: string): Promise<PaginatedResponse<Post>> {
  return fetchApi<PaginatedResponse<Post>>('/posts/', {
    page: opts.page, per_page: opts.per_page, rating: opts.rating,
  } as Record<string, string | number | undefined>, { ssrCookie })
}

export async function removeTagFromPost(postId: string, tagName: string): Promise<Post> {
  return fetchApi<Post>(`/posts/${postId}/tags`, undefined, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove_tag_names: [tagName] }),
  })
}

// ── Admin Tag Management ──

export async function updateAdminTag(id: string, data: {
  category?: string; danbooru_name?: string; translation?: string
}, ssrCookie?: string): Promise<Tag> {
  return fetchApi<Tag>(`/admin/tags/${id}`, undefined, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    ssrCookie,
  })
}

export async function reprocessTagsAPI(mode: 'unprocessed' | 'all', ssrCookie?: string): Promise<{ processed: number; failed: number }> {
  return fetchApi('/admin/tags/reprocess', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    ssrCookie,
  })
}

export async function fetchTagKnowledge(page = 1, perPage = 50): Promise<PaginatedResponse<any>> {
  return fetchApi<PaginatedResponse<any>>('/admin/tags/knowledge', { page, per_page: perPage })
}

// ── Admin Settings ──

export async function fetchAdminSettings(ssrCookie?: string): Promise<Record<string, string>> {
  return fetchApi<Record<string, string>>('/admin/settings/', undefined, { ssrCookie })
}

export async function updateAdminSettings(updates: Record<string, string>): Promise<{ ok: boolean }> {
  return fetchApi('/admin/settings/', undefined, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export async function testPgConnection(url: string): Promise<{ ok: boolean; error?: string }> {
  return fetchApi('/settings/test-pg', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

export async function testRedisConnection(url: string): Promise<{ ok: boolean; error?: string }> {
  return fetchApi('/settings/test-redis', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

// ── System Status ──

export async function fetchSystemStatus(): Promise<{ queue_depth: number }> {
  return fetchApi('/admin/dashboard/system-status')
}

// ── Import ──

export async function webImport(urls: string[]): Promise<{ results: { task_id: string; status: string }[] }> {
  return fetchApi('/tasks/web-import', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  })
}
