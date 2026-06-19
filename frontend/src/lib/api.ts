// === Type Definitions ===

export type SourceSite = "pixiv" | "twitter" | "danbooru" | "other";

export type TagCategory = "artist" | "character" | "copyright" | "general" | "meta";

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

async function fetchApi<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, `API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// === Post APIs ===

export async function fetchPosts(page: number = 1, perPage: number = 40): Promise<PostsResponse> {
  return fetchApi<PostsResponse>("/posts", { page, per_page: perPage });
}

export async function fetchPost(id: string): Promise<Post> {
  return fetchApi<Post>(`/posts/${id}`);
}

// === Tag APIs ===

export async function fetchTags(
  category?: TagCategory,
  sort: string = "count",
  page: number = 1,
  perPage: number = 100,
): Promise<PaginatedResponse<Tag>> {
  return fetchApi<PaginatedResponse<Tag>>("/tags", {
    category,
    sort,
    page,
    per_page: perPage,
  });
}

// === Search API ===

export async function fetchSearch(
  query: string,
  page: number = 1,
  perPage: number = 40,
): Promise<PostsResponse> {
  return fetchApi<PostsResponse>("/search", { q: query, page, per_page: perPage });
}

// === Autocomplete API ===

export async function fetchAutocomplete(prefix: string): Promise<Tag[]> {
  return fetchApi<Tag[]>("/tags/autocomplete", { q: prefix, per_page: 10 });
}

// === Image URL Helpers ===

export function getImageUrl(key: string): string {
  // Images are served directly via Caddy reverse proxy to S3
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
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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