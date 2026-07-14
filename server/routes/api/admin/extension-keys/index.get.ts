import { and, isNull, desc } from 'drizzle-orm'
import { extensionKeys } from '../../../../schema'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  // ponytail: don't return hashes — they're the auth credential. UI only
  // needs id, name, prefix (for visual ID), created_by, last_used_at, revoked_at.
  const rows = await db.select({
    id: extensionKeys.id,
    name: extensionKeys.name,
    keyPrefix: extensionKeys.keyPrefix,
    createdBy: extensionKeys.createdBy,
    createdAt: extensionKeys.createdAt,
    lastUsedAt: extensionKeys.lastUsedAt,
    revokedAt: extensionKeys.revokedAt,
  })
    .from(extensionKeys)
    .orderBy(desc(extensionKeys.createdAt))
    .limit(100)

  return rows.map(r => ({
    ...r,
    active: !r.revokedAt,
  }))
})