export type SourceSite = 'pixiv' | 'twitter' | 'danbooru' | 'other'
export type TagCategory = 'artist' | 'character' | 'copyright' | 'general' | 'meta'
export type Rating = 'safe' | 'questionable' | 'explicit'

export interface Post {
  id: string
  s3_key: string
  thumb_key: string
  preview_key: string
  source_url: string
  source_site: SourceSite
  source_id: string
  width: number
  height: number
  file_size: number
  mime_type: string
  title: string | null
  description: string | null
  rating: Rating
  created_at: string
  lqip?: string | null
  tags?: Tag[]
  // v0.7.8 PR-C: present only on multi-image posts. Mirrors the
  // server-side series shape from server/utils/queries.ts → getPost().
  series?: PostSeries
}

export interface PostSeriesPage {
  id: string
  page_index: number
  thumb_key: string
  width: number
  height: number
}

export interface PostSeries {
  id: string
  page_count: number
  pages: PostSeriesPage[]
}

export interface Tag {
  id: string
  name: string
  category: TagCategory
  post_count: number
  danbooru_name?: string | null
  translation?: string | null
  matched_field?: string | null
  ai_processed_at?: string | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
  resolved_tags?: string[]
  unresolved_tags?: string[]
}

export type PostsResponse = PaginatedResponse<Post>

export interface AuthStatus {
  is_admin: boolean
}

export interface AutoRatingRule {
  id: string
  tag_name: string
  target_rating: Rating
  created_at: string
}

export interface SiteSettings {
  site_title: string
  site_description: string
  announcement: string
  head_inject: string
  maintenance_mode: string
}

export interface DashboardOverview {
  total_posts: number
  total_tags: number
  total_post_tags: number
  total_file_size_bytes: number
}

export interface DashboardStats {
  overview: DashboardOverview
  source_breakdown: { source_site: SourceSite; count: number }[]
  rating_breakdown: { rating: Rating; count: number }[]
  top_tags: { id: string; name: string; category: TagCategory; post_count: number }[]
  recent_posts: { id: string; thumb_key: string; title: string | null; rating: Rating; source_site: SourceSite; created_at: string }[]
}

// ── AI types ──

export interface AiStatus {
  enabled: boolean
  endpoint: string | null
  model: string | null
}

export interface TagClassificationSuggestion {
  tag_name: string
  category: TagCategory
  translation: string
  danbooru_name: string
  confidence: number
}

export interface MergeSuggestion {
  canonical_name: string
  aliases: string[]
  reason: string
  confidence: number
}

export interface RatingSuggestionItem {
  post_id: string
  current_rating: Rating
  rating: Rating
  confidence: number
  reason: string
}

export interface AssistantSuggestion {
  label: string
  callback_data: string
  action?: { type: string; payload: any }
}

export interface AssistantReply {
  text: string
  suggestions?: AssistantSuggestion[]
}
