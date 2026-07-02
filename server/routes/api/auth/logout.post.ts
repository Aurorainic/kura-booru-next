export default defineEventHandler(async (event) => {
  deleteCookie(event, 'kura_admin_session', { path: '/' })
  return { ok: true }
})
