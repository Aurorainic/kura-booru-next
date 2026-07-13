/**
 * Initial sync + write-through for the redis-search tag index.
 *
 * Boot: bulk-load every tag from Postgres into the FT index. Cheap at 1.5k
 * rows; even at 100k rows it's a single batch.
 *
 * Admin writes — to be called from tag PATCH/POST routes — push updates
 * into redis via upsertTagIndex / deleteTagIndex (from suggest.ts).
 *
 * When MEILI_ENABLED is off, this plugin no-ops.
 */
import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import { tags } from '../schema/tags'
import { rebuildTagIndex } from '../utils/search/suggest'

export async function syncAllTagsToSearchIndex() {
  if (process.env.MEILI_ENABLED !== 'true') return
  try {
    const rows = await db.select({
      id: tags.id,
      name: tags.name,
      postCount: tags.postCount,
      category: tags.category,
    }).from(sql`tags`)
    await rebuildTagIndex(rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      postCount: Number(r.postCount ?? 0),
      category: r.category,
    })))
    console.log(`[search] indexed ${rows.length} tags`)
  } catch (err) {
    console.warn('[search] initial sync failed:', (err as Error).message)
  }
}

export default defineNitroPlugin(() => {
  // Fire-and-forget: warm the cache in the background while serving traffic.
  // Small datasets (1.5k rows) finish in <100ms; even 100k tags complete
  // before the first user notices.
  void syncAllTagsToSearchIndex()
})
