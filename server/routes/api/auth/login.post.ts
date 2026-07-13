export default defineEventHandler(async (event) => {
  const body = await readBody<{ username: string; password: string }>(event)
  if (!body?.username || !body?.password) {
    throw createError({ statusCode: 400, statusMessage: 'username and password required' })
  }

  // verifyAdminLogin, createSession auto-imported by Nitro
  const admin = await verifyAdminLogin(body.username, body.password)
  if (!admin) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  const token = await createSession(admin.id)
  setSessionCookie(event, token)

  return { ok: true, is_admin: true }
})
