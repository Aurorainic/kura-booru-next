/**
 * Server-side logout endpoint.
 *
 * Why not client-side fetch? The previous approach used `fetch('/api/auth/logout')`
 * from the browser, which has a race condition: the browser may navigate to "/"
 * before the Set-Cookie header from the logout response is applied to the cookie jar.
 * This leaves the old session cookie alive, so the user appears still logged in.
 *
 * This SSR endpoint solves the problem by:
 * 1. Receiving a POST request from the browser (native form navigation)
 * 2. Forwarding the admin session cookie to the backend's /api/auth/logout
 * 3. The backend responds with Set-Cookie to clear the session
 * 4. We inject that same Set-Cookie into our 302 redirect response
 * 5. The browser processes the 302 as a native navigation — cookie is guaranteed
 *    to be updated before the next page request
 */
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, redirect }) => {
  const cookieHeader = request.headers.get("cookie") || "";
  const backendUrl =
    import.meta.env.INTERNAL_API_URL || "http://backend:8000/api";

  try {
    const resp = await fetch(`${backendUrl}/auth/logout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    // Create a redirect response
    const response = redirect("/", 302);

    // Forward any Set-Cookie headers from the backend (the logout cookie deletion)
    const setCookieHeaders = resp.headers.getSetCookie?.() || [];
    for (const cookie of setCookieHeaders) {
      response.headers.append("Set-Cookie", cookie);
    }

    return response;
  } catch {
    // Backend unreachable — still redirect, but cookie won't be cleared
    return redirect("/", 302);
  }
};
