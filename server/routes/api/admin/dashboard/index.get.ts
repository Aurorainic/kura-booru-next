import { sql } from 'drizzle-orm'
import { defineApiKeyHandler } from '../../../../platform/http/auth'
import { db } from '../../../../utils/db'
import { posts } from '../../../../schema/posts'
import { tags } from '../../../../schema/tags'

export default defineApiKeyHandler({
  auditAction: 'dashboard read',
  doc: { method: 'get', path: '/api/admin/dashboard', summary: 'Dashboard overview (MV + live breakdowns)' },
  handler: async () => {
    const [mvResult, topTags, recentPosts] = await Promise.all([
      db.execute(sql`SELECT * FROM mv_dashboard_stats LIMIT 1`),
      db.select({ id: tags.id, name: tags.name, category: tags.category, postCount: tags.postCount }).from(tags).orderBy(sql`post_count desc`).limit(10),
      db.select({ id: posts.id, thumbKey: posts.thumbKey, title: posts.title, rating: posts.rating, sourceSite: posts.sourceSite, createdAt: posts.createdAt }).from(posts).orderBy(sql`created_at desc`).limit(6),
    ])

    const result = mvResult as any
    const overview = (result.rows?.[0] ?? result[0]) ?? undefined
    if (!overview) {
      console.warn('[dashboard] mv_dashboard_stats returned no rows — materialized view may not be populated yet')
    }
    return {
      overview: {
        total_posts: Number(overview?.total_posts || 0),
        total_tags: Number(overview?.total_tags || 0),
        total_post_tags: Number(overview?.total_post_tags || 0),
        total_file_size_bytes: Number(overview?.total_file_size_bytes || 0),
        refreshed_at: overview?.refreshed_at || null,
      },
      source_breakdown: Array.isArray(overview?.source_breakdown) ? overview.source_breakdown : [],
      rating_breakdown: Array.isArray(overview?.rating_breakdown) ? overview.rating_breakdown : [],
      top_tags: topTags.map((t: any) => ({ id: t.id, name: t.name, category: t.category, post_count: t.postCount })),
      recent_posts: recentPosts.map((p: any) => ({ id: p.id, thumb_key: p.thumbKey, title: p.title, rating: p.rating, source_site: p.sourceSite, created_at: p.createdAt })),
    }
  },
})
