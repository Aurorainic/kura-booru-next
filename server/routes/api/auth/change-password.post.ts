export default defineEventHandler(async (event) => {
  const body = await readBody<{ current_password: string; new_password: string }>(event)
  if (!body?.current_password || !body?.new_password) {
    throw createError({ statusCode: 400, statusMessage: 'Both passwords required' })
  }

  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const cookies = Object.fromEntries(cookie.split(';').map(p => { const [k, ...v] = p.trim().split('='); return [k, v.join('=')] }))
  const token = cookies['kura_admin_session']
  if (!token) throw createError({ statusCode: 401, statusMessage: 'No session' })

  // Use the shared session parser — includes MAX_AGE check that the previous
  // inline crypto duplicated and silently dropped.
  const parsed = parseSession(token)
  if (!parsed) throw createError({ statusCode: 401, statusMessage: 'Invalid or expired session' })
  const adminId = parsed.value

  const adminRows = await db.select().from(admins).where(eq(admins.id, adminId)).limit(1)
  if (!adminRows[0]) throw createError({ statusCode: 401, statusMessage: 'Admin not found' })

  const match = await verifyAdminPassword(adminRows[0], body.current_password)
  if (!match) throw createError({ statusCode: 401, statusMessage: 'Current password incorrect' })

  await changeAdminPassword(adminRows[0].id, body.new_password)
  clearSessionCookie(event)
  return { ok: true }
})
