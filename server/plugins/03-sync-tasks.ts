import { sql } from 'drizzle-orm'

/**
 * Background sync tasks: tag post_count reconciliation.
 * ponytail: setInterval in Nitro plugin — no ARQ/cron needed for personal site.
 * B-P2-5: tag post_count auto-sync.
 */

export default defineNitroPlugin(() => {
  // Run initial sync after startup
  setTimeout(syncTagPostCounts, 10_000)

  // Then every hour
  setInterval(syncTagPostCounts, 3600_000)
})

async function syncTagPostCounts() {
  try {
    const result = await db.execute(sql`
      UPDATE tags SET post_count = (
        SELECT COUNT(*) FROM post_tags WHERE post_tags.tag_id = tags.id
      )
    `)
    console.log('[sync] tag post_count reconciled')
  } catch (err) {
    console.error('[sync] tag post_count failed:', err)
  }
}
