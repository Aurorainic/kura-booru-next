import type { MiddlewareResponseHandler } from "astro";

/**
 * Astro middleware — runs on every request (SSR only).
 *
 * 1. Forwards the browser's Cookie header to the backend when the Astro server
 *    makes SSR API calls. This is necessary because the admin session cookie
 *    (`kura_admin_session`) is HttpOnly and only ever sent by the browser; the
 *    Astro Node server's fetch() does NOT automatically forward incoming cookies
 *    to the backend.
 *
 * 2. Calls GET /api/auth/status to determine whether the current visitor is an
 *    admin, then stores the result in Astro.locals.isAdmin so that every page can
 *    read it without an extra API call.
 */

const ADMIN_SESSION_COOKIE = "kura_admin_session";

export const onRequest: MiddlewareResponseHandler = async (context, next) => {
  const request = context.request;

  // ── 1. Forward browser Cookie header to the backend via SSR fetch ────────
  // Astro pages call fetchApi() which uses the global fetch(). In SSR context,
  // we inject the original request's cookie header so the backend can read the
  // admin session cookie.
  const cookieHeader = request.headers.get("cookie") || "";
  if (cookieHeader) {
    // Store in locals so that api.ts fetchApi can include it in SSR calls.
    context.locals.ssrCookie = cookieHeader;
  }

  // ── 2. Resolve admin status ─────────────────────────────────────────────
  // We call the backend's /api/auth/status with the forwarded cookie to check
  // whether this visitor has a valid admin session.
  let isAdmin = false;
  try {
    const backendUrl =
      import.meta.env.INTERNAL_API_URL || "http://backend:8000/api";
    const resp = await fetch(`${backendUrl}/auth/status`, {
      headers: {
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    if (resp.ok) {
      const data = await resp.json();
      isAdmin = Boolean(data.is_admin);
    }
  } catch {
    // Backend unreachable — default to non-admin (safe)
  }

  context.locals.isAdmin = isAdmin;

  return next();
};