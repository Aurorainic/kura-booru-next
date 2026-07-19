import { eq } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/tags/aliases', summary: 'Create tag alias' },
  handler: async ({ event }) => {
    const body = await readBody<{ alias_name: string; tag_id: string }>(event)
    if (!body?.alias_name || !body?.tag_id) {
      throw new AppError('VALIDATION_FAILED', 400, 'alias_name and tag_id required')
    }

    // Check target tag exists
    const target = await db.select().from(tags).where(eq(tags.id, body.tag_id)).limit(1)
    if (!target[0]) throw new AppError('NOT_FOUND', 404, 'Target tag not found')

    const cleanAlias = body.alias_name.trim().toLowerCase()

    // Pre-check uniqueness — the schema has a unique index on alias_name, but
    // relying on it would surface a 500 from a DB error; the caller can act on 409.
    const existing = await db.select({ id: tagAliases.id }).from(tagAliases)
      .where(eq(tagAliases.aliasName, cleanAlias)).limit(1)
    if (existing[0]) {
      throw new AppError('CONFLICT', 409, 'Alias already exists')
    }

    const [created] = await db.insert(tagAliases).values({
      aliasName: cleanAlias,
      tagId: body.tag_id,
    }).returning()

    if (!created) throw new AppError('INTERNAL', 500, 'Alias creation failed')

    return {
      id: created.id,
      alias_name: created.aliasName,
      tag_id: created.tagId,
    }
  },
})
