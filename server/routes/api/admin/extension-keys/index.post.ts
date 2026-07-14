import { extensionKeys } from '../../../../schema'
import { generateExtensionKey } from '../../../../utils/extension-auth'
import { getAdminUsernameFromCookie } from '../../../../utils/admin-identity'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ name?: string; can_force_rating?: boolean }>(event)
  const name = String(body?.name || '').trim()
  if (!name || name.length > 64) {
    throw createError({ statusCode: 400, statusMessage: 'name required (1-64 chars)' })
  }
  // ponytail: default false. Admin must explicitly opt in to granting a key
  // the power to bypass auto-rating. Stops accidental policy-bypass.
  const canForceRating = body?.can_force_rating === true

  const createdBy = await getAdminUsernameFromCookie(cookie) || 'admin'

  const { raw, prefix, hash } = generateExtensionKey()

  const [row] = await db.insert(extensionKeys).values({
    name,
    keyHash: hash,
    keyPrefix: prefix,
    createdBy,
    canForceRating,
  }).returning({
    id: extensionKeys.id,
    name: extensionKeys.name,
    keyPrefix: extensionKeys.keyPrefix,
    canForceRating: extensionKeys.canForceRating,
    createdAt: extensionKeys.createdAt,
  })

  if (!row) throw createError({ statusCode: 500, statusMessage: 'Insert failed' })

  // ponytail: raw value returned ONCE. After this response, only the hash
  // exists in the DB. UI must show it once and ask admin to save.
  return { ...row, raw_key: raw }
})