import { inArray, isNull, and, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ mode: 'unprocessed' | 'all' | 'specific'; tag_ids?: string[] }>(event)
  const mode = body?.mode || 'unprocessed'

  if (mode === 'specific' && body?.tag_ids?.length) {
    // Fetch specific tags (exclude artist — categorized at ingest, not AI's job)
    const tagRows = await db.select().from(tags)
      .where(and(inArray(tags.id, body.tag_ids!), sql`${tags.category} != 'artist'`))
    if (!tagRows.length) return { suggestions: [] }
    const classifications = await classifyTags(tagRows.map(t => t.name))
    return {
      suggestions: classifications.map(c => ({
        tag_name: c.name,
        category: c.category,
        translation: c.translation,
        danbooru_name: c.danbooru_name,
        confidence: 0.8,
      })),
    }
  }

  // For unprocessed / all — delegate to reprocessTags core but return suggestions instead of applying
  // ponytail: exclude artist tags — they're categorized at ingest, AI shouldn't second-guess
  const conditions = []
  if (mode === 'unprocessed') conditions.push(isNull(tags.aiProcessedAt))
  conditions.push(sql`${tags.category} != 'artist'`)
  const where = conditions.length ? and(...conditions) : undefined
  const tagRows = await db.select().from(tags).where(where).limit(100)

  if (!tagRows.length) return { suggestions: [] }

  const classifications = await classifyTags(tagRows.map(t => t.name))

  return {
    suggestions: classifications.map(c => ({
      tag_name: c.name,
      category: c.category,
      translation: c.translation,
      danbooru_name: c.danbooru_name,
      confidence: 0.8,
    })),
  }
})
