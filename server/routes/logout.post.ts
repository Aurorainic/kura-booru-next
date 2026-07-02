export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const config = useRuntimeConfig()
    const backendUrl = config.internalApiUrl
    const cookieHeader = getHeader(event, 'cookie') || ''
    await $fetch(`${backendUrl}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    })
  } catch {
    // proceed to redirect anyway
  }

  // Clear session cookie — match all attributes used when setting
  setCookie(event, 'kura_admin_session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return sendRedirect(event, '/', 302)
})
