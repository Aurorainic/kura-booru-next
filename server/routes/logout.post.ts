export default defineEventHandler((event) => {
  if (event.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  clearSessionCookie(event)
  return sendRedirect(event, '/', 302)
})
