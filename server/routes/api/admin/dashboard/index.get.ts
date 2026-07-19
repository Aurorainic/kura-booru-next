import { sql } from 'drizzle-orm'
import { defineApiKeyHandler } from '../../../../platform/http/auth'
import { db } from '../../../../utils/db'
import { posts } from '../../../../schema/posts'
import { tags } from '../../../../schema/tags'

export default defineApiKeyHandler({
  auditAction: 'dashboard read',
  doc: { method: 'get', path: '/api/admin/dashboard', summary: 'Dashboard overview (MV + live breakdowns)' },
  handler: async () => {
    // ponytail: counts read from mv_dashboard_stats (refreshed every 5 min by
    // server/plugins/06-dashboard-refresh.ts). Grouped breakdowns stay live
    // because they're bounded (TOP 10 tags, by rating/source, last 6 posts).
    //
    // db.select().from(sql`mv_dashboard_stats`) returned rows but Drizzle
    // couldn't map column names from a raw SQL table fragment — every column
    // access came back undefined, so the dashboard showed all zeros. Use
    // db.execute() which returns rows as plain key→value objects.
    const [mvResult, sourceBreakdown, ratingBreakdown, topTags, recentPosts] = await Promise.all([
      db.execute(sql`SELECT * FROM mv_dashboard_stats LIMIT 1`),
      db.select({ sourceSite: posts.sourceSite, count: sql<number>`count(*)` }).from(posts).groupBy(posts.sourceSite),
      db.select({ rating: posts.rating, count: sql<number>`count(*)` }).from(posts).groupBy(posts.rating),
      db.select({ id: tags.id, name: tags.name, category: tags.category, postCount: tags.postCount }).from(tags).orderBy(sql`post_count desc`).limit(10),
      db.select({ id: posts.id, thumbKey: posts.thumbKey, title: posts.title, rating: posts.rating, sourceSite: posts.sourceSite, createdAt: posts.createdAt }).from(posts).orderBy(sql`created_at desc`).limit(6),
    ])

    const overview = (mvResult.rows?.[0] ?? mvResult[0]) as any
    return {
      overview: {
        total_posts: Number(overview?.total_posts || 0),
        total_tags: Number(overview?.total_tags || 0),
        total_post_tags: Number(overview?.total_post_tags || 0),
        total_file_size_bytes: Number(overview?.total_file_size_bytes || 0),
        refreshed_at: overview?.refreshed_at || null,
      },
      source_breakdown: sourceBreakdown.map((s: any) => ({ source_site: s.sourceSite, count: s.count })),
      rating_breakdown: ratingBreakdown,
      top_tags: topTags.map((t: any) => ({ id: t.id, name: t.name, category: t.category, post_count: t.postCount })),
      recent_posts: recentPosts.map((p: any) => ({ id: p.id, thumb_key: p.thumbKey, title: p.title, rating: p.rating, source_site: p.sourceSite, created_at: p.createdAt })),
    }
  },
})
