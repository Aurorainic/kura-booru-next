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
 *
 * 3. Calls GET /api/settings/public to fetch non-sensitive site settings
 *    (title, description, announcement, head_inject) with a 30s in-process
 *    cache to avoid hitting the backend on every request.
 */

const ADMIN_SESSION_COOKIE = "kura_admin_session";

// In-process cache for public settings — 30s TTL
// Redis is fast but there's no need to make a network round-trip on every SSR request
let _settingsCache: { data: { site_title: string; site_description: string; announcement: string; head_inject: string; maintenance_mode: string } | null; at: number } = { data: null, at: 0 };
const SETTINGS_CACHE_TTL = 30000;

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

  // ── 3. Fetch public site settings (with in-process cache) ───────────────
  // On fetch failure we still update `at` so we back off for the full TTL
  // instead of re-trying on every single request (which would hammer a dead
  // backend). Stale data is kept so maintenance_mode stays engaged if it was
  // on before the backend went down.
  const now = Date.now();
  if (now - _settingsCache.at > SETTINGS_CACHE_TTL) {
    try {
      const backendUrl =
        import.meta.env.INTERNAL_API_URL || "http://backend:8000/api";
      const resp = await fetch(`${backendUrl}/settings/public`, {
        headers: { Accept: "application/json" },
      });
      if (resp.ok) {
        _settingsCache = { data: await resp.json(), at: now };
      } else {
        // Non-OK response — back off, keep stale data (or null on first load)
        _settingsCache = { data: _settingsCache.data, at: now };
      }
    } catch {
      // Network error — back off, keep stale data (or null on first load)
      _settingsCache = { data: _settingsCache.data, at: now };
    }
  }
  context.locals.siteSettings = _settingsCache.data || undefined;

  // ── 4. Maintenance mode ─────────────────────────────────────────────────
  // When enabled, non-admin visitors are redirected to /maintenance.
  // Admins bypass via the isAdmin check (resolved above from /api/auth/status).
  // Exempt paths: /maintenance itself, /login (so admin can log in to turn it
  // off), /logout, and static assets. /api/* is routed by Caddy directly to the
  // backend and never reaches this middleware, but we exempt it defensively.
  const settings = context.locals.siteSettings;
  const maintenanceMode =
    (settings?.maintenance_mode || "false").toLowerCase() === "true";
  if (maintenanceMode && !isAdmin) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isExempt =
      path === "/maintenance" ||
      path === "/login" ||
      path === "/logout" ||
      path.startsWith("/api/") ||
      path.startsWith("/_astro/") ||
      path.startsWith("/favicon") ||
      path.startsWith("/logo") ||
      path.startsWith("/placeholder");
    if (!isExempt) {
      // Build the redirect response manually so we can attach Cache-Control.
      // context.redirect() returns a bare 302 with no cache headers, which a
      // CDN/proxy could cache — leaving users stuck on /maintenance even after
      // the mode is turned off.
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/maintenance",
          "Cache-Control": "private, no-store",
        },
      });
    }
  }

  const response = await next();

  // Never cache SSR HTML at CDN/proxy level — admin content must not leak
  response.headers.set("Cache-Control", "private, no-store");

  return response;
};