import type { Post, PostsResponse, Tag, PaginatedResponse, AuthStatus, Rating, TagCategory, AutoRatingRule, SiteSettings, DashboardStats } from '~/types'

export const ALLOWED_PER_PAGE = new Set([20, 40, 100])
export const DEFAULT_PER_PAGE = 40
export const MAX_PER_PAGE = 100

export function clampPerPage(value: number): number {
  if (ALLOWED_PER_PAGE.has(value)) return value
  if (value < 20) return 20
  if (value > 100) return 100
  return [...ALLOWED_PER_PAGE].reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  )
}

export function emptyPostsResponse(): PostsResponse {
  return { items: [], total: 0, page: 1, per_page: DEFAULT_PER_PAGE, total_pages: 0 }
}

export function getImageUrl(key: string): string {
  return `/i/${key}`
}

export function getThumbUrl(post: Post): string {
  return getImageUrl(post.thumb_key)
}

export function getPreviewUrl(post: Post): string {
  return getImageUrl(post.preview_key)
}

/**
 * Derive srcset from the ADR-0003 multi-width key naming convention:
 *   <base>-300w.webp, <base>-640w.webp, <base>-1280w.webp, <base>-2000w.webp
 * Returns null for old-format keys (no width suffix) — caller falls back to single image.
 * Mid/large keys are derived from thumb/preview by suffix replacement.
 */
export function getSrcset(post: Post): string | null {
  const thumb = post.thumb_key
  const preview = post.preview_key
  if (!thumb.includes('-300w.') || !preview.includes('-1280w.')) return null

  const mid = thumb.replace('-300w.', '-640w.')
  const large = preview.replace('-1280w.', '-2000w.')

  return [
    `/i/${thumb} 300w`,
    `/i/${mid} 640w`,
    `/i/${preview} 1280w`,
    `/i/${large} 2000w`,
  ].join(', ')
}

/** Responsive sizes for gallery grid images (≈6/8/10/12 columns by viewport). */
export const GALLERY_SIZES = '(max-width: 700px) 50vw, (max-width: 900px) 33vw, (max-width: 1400px) 20vw, 16vw'

export function getOriginalUrl(post: Post): string {
  return getImageUrl(post.s3_key)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getRatingLabel(rating: Rating): string {
  const labels: Record<Rating, string> = { safe: '公开', questionable: '敏感', explicit: '限制' }
  return labels[rating] || rating
}

export function getRatingColorClass(rating: Rating): string {
  const classes: Record<Rating, string> = { safe: 'rating-safe', questionable: 'rating-questionable', explicit: 'rating-explicit' }
  return classes[rating] || 'rating-safe'
}

export function getTagCategoryLabel(category: TagCategory): string {
  const labels: Record<TagCategory, string> = {
    artist: '画师', character: '角色', copyright: '作品', general: '通用', meta: '元信息',
  }
  return labels[category] || category
}

export function getTagCategoryVar(category: TagCategory): string {
  const vars: Record<TagCategory, string> = {
    artist: 'var(--color-tag-artist)',
    character: 'var(--color-tag-character)',
    copyright: 'var(--color-tag-copyright)',
    general: 'var(--color-tag-general)',
    meta: 'var(--color-tag-meta)',
  }
  return vars[category] || 'var(--color-tag-general)'
}

export function getSourceSiteLabel(site: string): string {
  const labels: Record<string, string> = { pixiv: 'Pixiv', twitter: 'Twitter/X', danbooru: 'Danbooru', other: '其他' }
  return labels[site] || site
}
