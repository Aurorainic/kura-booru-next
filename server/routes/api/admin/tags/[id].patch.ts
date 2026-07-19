import { eq } from 'drizzle-orm'
import { serializeTag } from '../../../../modules/posts/serialize'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Tag ID required' })

  // Check tag exists
  const existing = await db.select().from(tags).where(eq(tags.id, id)).limit(1)
  if (!existing[0]) throw createError({ statusCode: 404, statusMessage: 'Tag not found' })

  const body = await readBody<{ category?: string; danbooru_name?: string; translation?: string }>(event)
  if (!body || (body.category === undefined && body.danbooru_name === undefined && body.translation === undefined)) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update' })
  }

  // Validate category against the PG enum — bad values would 500 from the DB layer.
  // ponytail: hardcoded list mirrors the enum in app/types; if it grows, derive
  // from the drizzle schema's text('category') annotation or a shared constant.
  const VALID_CATEGORIES = new Set(['artist', 'character', 'copyright', 'general', 'meta'])
  if (body.category !== undefined && !VALID_CATEGORIES.has(body.category)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid category: ${body.category}` })
  }

  // Build update payload
  const updateData: Record<string, any> = {}
  if (body.category !== undefined) updateData.category = body.category
  if (body.danbooru_name !== undefined) updateData.danbooruName = body.danbooru_name
  if (body.translation !== undefined) updateData.translation = body.translation

  const [updated] = await db.update(tags).set(updateData).where(eq(tags.id, id)).returning()
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Tag update failed' })

  // Sync to tag_knowledge (source: 'manual')
  await db.insert(tagKnowledge).values({
    name: updated.name,
    danbooruName: updated.danbooruName,
    type: updated.category,
    translation: updated.translation,
    source: 'manual',
  }).onConflictDoUpdate({
    target: tagKnowledge.name,
    set: {
      danbooruName: updated.danbooruName,
      type: updated.category,
      translation: updated.translation,
      source: 'manual',
      updatedAt: new Date(),
    },
  })

  return serializeTag(updated)
})
