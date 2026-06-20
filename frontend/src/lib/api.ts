// === Type Definitions ===

export type SourceSite = "pixiv" | "twitter" | "danbooru" | "other";

export type TagCategory = "artist" | "character" | "copyright" | "general" | "meta";

export type Rating = "safe" | "questionable" | "explicit";

export interface Post {
  id: string;
  s3_key: string;
  thumb_key: string;
  preview_key: string;
  source_url: string;
  source_site: SourceSite;
  source_id: string;
  width: number;
  height: number;
  file_size: number;
  mime_type: string;
  title: string | null;
  description: string | null;
  rating: Rating;
  created_at: string;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  category: TagCategory;
  post_count: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export type PostsResponse = PaginatedResponse<Post>;

// === Pagination Helpers ===

export const ALLOWED_PER_PAGE = new Set([20, 40, 100]);
export const DEFAULT_PER_PAGE = 40;
export const MAX_PER_PAGE = 100;

export function clampPerPage(value: number): number {
  if (ALLOWED_PER_PAGE.has(value)) return value;
  if (value < 20) return 20;
  if (value > 100) return 100;
  // Find nearest allowed value
  return [...ALLOWED_PER_PAGE].reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );
}

export function emptyPostsResponse(): PostsResponse {
  return { items: [], total: 0, page: 1, per_page: DEFAULT_PER_PAGE, total_pages: 0 };
}

// === API Client ===

const BASE_URL =
  typeof import.meta.env.SSR !== "undefined" && import.meta.env.SSR
    ? (import.meta.env.INTERNAL_API_URL || "http://backend:8000/api")
    : (import.meta.env.PUBLIC_API_URL || "http://localhost:8000/api");

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Core fetch wrapper. On the server (SSR) the request's cookie header is
 * forwarded so the backend can read the admin session cookie; on the client
 * the browser sends cookies automatically.
 *
 * @param ssrCookie - On SSR, pass Astro.locals.ssrCookie (the browser's Cookie
 *                    header forwarded by middleware). On the client this is
 *                    unnecessary because the browser sends cookies automatically.
 */
async function fetchApi<T>(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
  options?: RequestInit & { ssrCookie?: string },
): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  // Forward the browser's Cookie header on SSR so the backend can read the
  // admin session cookie. On the client the browser does this automatically.
  const ssrCookie = options?.ssrCookie;
  if (ssrCookie) {
    headers["Cookie"] = ssrCookie;
  }

  const { ssrCookie: _sc, ...fetchOptions } = options || {};
  const response = await fetch(url.toString(), {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    throw new ApiError(response.status, `API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// === Post APIs ===

export async function fetchPosts(page: number = 1, perPage: number = 40, rating?: Rating, ssrCookie?: string): Promise<PostsResponse> {
  const params: Record<string, string | number | undefined> = { page, per_page: perPage };
  if (rating) params.rating = rating;
  return fetchApi<PostsResponse>("/posts", params, { ssrCookie });
}

export async function fetchPost(id: string, ssrCookie?: string): Promise<Post> {
  return fetchApi<Post>(`/posts/${id}`, undefined, { ssrCookie });
}

export async function updatePostRating(id: string, rating: Rating): Promise<Post> {
  return fetchApi<Post>(`/posts/${id}`, undefined, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
}

// === Tag APIs ===

export async function fetchTags(
  category?: TagCategory,
  sort: string = "count",
  page: number = 1,
  perPage: number = 100,
  ssrCookie?: string,
): Promise<PaginatedResponse<Tag>> {
  return fetchApi<PaginatedResponse<Tag>>("/tags", {
    category,
    sort,
    page,
    per_page: perPage,
  }, { ssrCookie });
}

// === Search API ===

export async function fetchSearch(
  query: string,
  page: number = 1,
  perPage: number = 40,
  ssrCookie?: string,
): Promise<PostsResponse> {
  return fetchApi<PostsResponse>("/search", { q: query, page, per_page: perPage }, { ssrCookie });
}

// === Autocomplete API ===

export async function fetchAutocomplete(prefix: string): Promise<Tag[]> {
  return fetchApi<Tag[]>("/tags/autocomplete", { q: prefix, per_page: 10 });
}

// === Auth APIs ===

export interface AuthStatus {
  is_admin: boolean;
}

export async function fetchAuthStatus(ssrCookie?: string): Promise<AuthStatus> {
  return fetchApi<AuthStatus>("/auth/status", undefined, { ssrCookie });
}

export async function login(username: string, password: string): Promise<{ ok: boolean; is_admin: boolean }> {
  return fetchApi<{ ok: boolean; is_admin: boolean }>("/auth/login", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>("/auth/logout", undefined, {
    method: "POST",
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>("/auth/change-password", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// === Image URL Helpers ===

export function getImageUrl(key: string): string {
  // Images are served directly from S3/CDN (not via Caddy proxy)
  const baseUrl = import.meta.env.PUBLIC_S3_EXTERNAL_URL || "/i";
  return `${baseUrl}/${key}`;
}

export function getThumbUrl(post: Post): string {
  return getImageUrl(post.thumb_key);
}

export function getPreviewUrl(post: Post): string {
  return getImageUrl(post.preview_key);
}

export function getOriginalUrl(post: Post): string {
  return getImageUrl(post.s3_key);
}

// === Formatting Helpers ===

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  // Use browser default locale/timezone so the display matches the user's system
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// === Rating Helpers ===

export function getRatingLabel(rating: Rating): string {
  const labels: Record<Rating, string> = {
    safe: "Safe",
    questionable: "Questionable",
    explicit: "Explicit",
  };
  return labels[rating] || rating;
}

export function getRatingColorClass(rating: Rating): string {
  const classes: Record<Rating, string> = {
    safe: "rating-safe",
    questionable: "rating-questionable",
    explicit: "rating-explicit",
  };
  return classes[rating] || "rating-safe";
}

export function getTagCategoryColor(category: TagCategory): string {
  const colors: Record<TagCategory, string> = {
    artist: "tag-artist",
    character: "tag-character",
    copyright: "tag-copyright",
    general: "tag-general",
    meta: "tag-meta",
  };
  return colors[category] || "tag-general";
}

export function getTagCategoryLabel(category: TagCategory): string {
  const labels: Record<TagCategory, string> = {
    artist: "画师",
    character: "角色",
    copyright: "作品",
    general: "通用",
    meta: "元信息",
  };
  return labels[category] || category;
}

export function getSourceSiteLabel(site: SourceSite): string {
  const labels: Record<SourceSite, string> = {
    pixiv: "Pixiv",
    twitter: "Twitter/X",
    danbooru: "Danbooru",
    other: "其他",
  };
  return labels[site] || site;
}