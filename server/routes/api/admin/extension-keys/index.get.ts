import { and, isNull, desc } from 'drizzle-orm'
import { extensionKeys } from '../../../../schema'
import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/admin/extension-keys', summary: 'List extension keys' },
  handler: async () => {
    const rows = await db.select({
      id: extensionKeys.id,
      name: extensionKeys.name,
      keyPrefix: extensionKeys.keyPrefix,
      createdBy: extensionKeys.createdBy,
      canForceRating: extensionKeys.canForceRating,
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
  },
})
