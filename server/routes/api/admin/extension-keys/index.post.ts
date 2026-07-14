import { extensionKeys } from '../../../../schema'
import { generateExtensionKey } from '../../../../utils/extension-auth'
import { getAdminUsernameFromCookie } from '../../../../utils/admin-identity'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ name?: string }>(event)
  const name = String(body?.name || '').trim()
  if (!name || name.length > 64) {
    throw createError({ statusCode: 400, statusMessage: 'name required (1-64 chars)' })
  }

  // Ponytail: identity is best-effort from session. The extension key auth
  // path doesn't have a "current admin" concept; for audit purposes the key
  // records who created it (the admin session at the time of generation).
  // We pass through the username from the session if extractable, else 'admin'.
  const createdBy = await getAdminUsernameFromCookie(cookie) || 'admin'

  const { raw, prefix, hash } = generateExtensionKey()

  const [row] = await db.insert(extensionKeys).values({
    name,
    keyHash: hash,
    keyPrefix: prefix,
    createdBy,
  }).returning({
    id: extensionKeys.id,
    name: extensionKeys.name,
    keyPrefix: extensionKeys.keyPrefix,
    createdAt: extensionKeys.createdAt,
  })

  if (!row) throw createError({ statusCode: 500, statusMessage: 'Insert failed' })

  // ponytail: raw value returned ONCE. After this response, only the hash
  // exists in the DB. UI must show it once and ask admin to save.
  return { ...row, raw_key: raw }
})