import { sanitizeDescriptionHtml } from '../../utils/sanitize'

// ── Serialization (camelCase rows → snake_case API); strips phash (security: never expose) ──

export function serializePost(p: any): any {
  if (!p) return null
  return {
    id: p.id,
    s3_key: p.s3Key,
    thumb_key: p.thumbKey,
    preview_key: p.previewKey,
    source_url: p.sourceUrl,
    source_site: p.sourceSite,
    source_id: p.sourceId,
    width: p.width,
    height: p.height,
    file_size: p.fileSize,
    mime_type: p.mimeType,
    title: p.title,
    description: p.description ? sanitizeDescriptionHtml(p.description) : null,
    rating: p.rating,
    created_at: p.createdAt,
    lqip: p.lqip ?? null,
    tags: p.tags?.map((t: any) => serializeTag(t)),
    // Only present for multi-image series; single-image posts omit the key entirely.
    ...(p.series ? { series: p.series } : {}),
  }
}

export function serializeTag(t: any): any {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    post_count: t.postCount,
    danbooru_name: t.danbooruName ?? null,
    translation: t.translation ?? null,
    ai_processed_at: t.aiProcessedAt ?? null,
  }
}

export function serializeAutoRatingRule(r: any): any {
  return {
    id: r.id,
    tag_name: r.tagName,
    target_rating: r.targetRating,
    created_at: r.createdAt,
  }
}
