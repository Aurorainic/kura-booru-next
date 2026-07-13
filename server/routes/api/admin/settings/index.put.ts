export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  // TRUSTED-ADMIN: updateSettings writes any key the body provides. The gate
  // here is the admin session — there is no allowlist. If you ever need to
  // gate this from a public endpoint, add a SAFE_KEYS check before
  // updateSettings; do not relax the admin-only contract.
  const body = await readBody(event)
  await updateSettings(body.settings)
  return { ok: true }
})
