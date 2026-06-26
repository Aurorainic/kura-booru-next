# Kura Booru Next — AI Coding Guide

> For project architecture, API endpoints, data models, and tech stack, see [docs/architecture.md](docs/architecture.md).
> For deployment and environment variables, see [docs/deployment.md](docs/deployment.md).
> For development setup, see [docs/development.md](docs/development.md).
> For operational procedures, see [docs/operations.md](docs/operations.md).

---

## Code Generation Constraints

- **gallery-dl**: Use as Python library (`DownloadJob` API in `ThreadPoolExecutor`), NOT as subprocess. Config is global singleton — set once at startup from env vars, never modify concurrently.
- **S3 storage**: Generic abstraction layer. No provider-specific code. Switch providers via env vars only.
- **SSR cache**: Do NOT enable Souin/HTTP cache for SSR pages without `Vary: Cookie` + cookie-in-cache-key. Otherwise, admin HTML could leak to anonymous users.
- **Cache-Control**: API responses set headers via middleware — anon gets `public, s-maxage=60`, admin gets `private, no-store`. SSR HTML always `private, no-store`. SSE endpoints set their own `no-cache` which middleware preserves.
- **phash**: Never expose perceptual hash values in API responses (security).
- **Pagination**: Use traditional pagination, not infinite scroll. Per-page selector with 20/40/100 options.
- **Image size**: `MAX_IMAGE_SIZE` env var controls limit (0 = unlimited).
- **Content rating**: Anonymous visitors see only `safe` posts; non-safe returns 404 (existence hidden). Admin login unlocks all. See [docs/architecture.md](docs/architecture.md) for full rating/auth design.
- **Pixiv auth**: Requires both `PIXIV_REFRESH_TOKEN` AND `PIXIV_PHPSESSID` cookie.
- **Caddy**: Runs on the HOST machine, not in Docker Compose. Containers expose ports to localhost.
- **schemas/__init__.py**: Must only import classes that actually exist. Stale imports crash uvicorn at startup.
- **URL patterns**: Centralized in `backend/app/services/url_patterns.py`. Bot mirrors with sync comment at top of `bot/app/handlers/url_handler.py`.
- **Password epoch**: `get_is_admin` now checks Redis-cached `password_changed_at` on every request. If Redis is down, it fail-opens (allows session). Never bypass this check in new auth code.
- **Extension content scripts**: Must be plain ES5 JavaScript — no TypeScript, no arrow functions, no template literals, no `const`/`let`. Same constraint as `is:inline` scripts in Astro. The service worker and popup scripts follow the same rule.
- **Settings public endpoint**: `GET /api/settings/public` must never expose `database_url` or `redis_url`. Only `site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode` are safe for public.
- **Head inject**: Rendered with `<Fragment set:html={headInject} />` — admin is trusted, but be cautious if extending to user-controlled input in the future.
- **Maintenance mode**: Enforced in `frontend/src/middleware.ts` — when `maintenance_mode === "true"` in settings, non-admin visitors are 302-redirected to `/maintenance`. The redirect response is built manually (not `context.redirect()`) to attach `Cache-Control: private, no-store` and prevent CDN caching. Admins bypass via `isAdmin`. Exempt paths: `/maintenance`, `/login`, `/logout`, `/api/*`, static assets.
- **Settings cache back-off**: The middleware's in-process settings cache updates `at` on both success and failure. On backend failure, stale data is kept and the cache backs off for the full TTL — never hammer a dead backend on every request.
- **Admin tab routing**: All admin panels live in `/admin/index.astro` as sub-tabs (`?tab=posts|tags|auto-rating|settings|password`). Old paths (`/admin/posts`, `/admin/settings`, etc.) are 301-redirect stubs. Tab switching is client-side with `history.pushState` + `popstate` listener.
- **Accent hue persistence**: Stored in both Cookie (`kura-accent-hue`) and localStorage. SSR reads the Cookie and sets `--accent-hue` / `--accent-hue-end` on `<html>` before paint — no anti-flash script. `AccentPicker.tsx` writes both on change.
- **Per-page preference**: Stored in Cookie (`kura-per-page`), readable by SSR. Pages read URL `per_page` param first, then fall back to Cookie, then default 40. `Pagination.tsx` syncs the Cookie on change.
- **Announcement banner**: Top slim banner (32px), not a toast. Multi-line = vertical rotation every 5s; overflow = slow horizontal scroll at 28px/s. Session-level dismissal via `sessionStorage`. Markdown rendered by inline ES5 `simpleMarkdown()`.

## Common Pitfalls

- **`admin/posts.astro` thumbnails**: Always use `getThumbUrl(post)`, never hardcode `/i/` paths.
- **`is:inline` scripts in Astro**: Cannot use TypeScript syntax (no `as`, no arrow functions, no template literals). Must be pure ES5 JavaScript.
- **Redis `--requirepass` with empty password**: Breaks docker-compose parsing. Remove the line entirely when password is empty.
- **Cookie deletion**: Must match all attributes (`Secure`, `HttpOnly`, `SameSite`, `Path`) used when setting the cookie, otherwise browsers silently ignore the deletion.
- **Logout race condition**: Use server-side redirect (SSR endpoint `POST /logout`) instead of client-side `fetch()` + `window.location.href`, to ensure cookie is cleared before next page request.
- **Extension `btn.className` reset**: `resetButton()` sets `btn.className = ""` which removes all animation classes. If adding new state classes, ensure they are cleared here or animations won't replay on subsequent clicks.
- **Extension CSS animation replay**: CSS animations only fire when the class is added. If the same class is re-applied without being removed first, the animation does not replay. The existing `resetButton()` timeout (3s) handles this by clearing the class.
- **Extension `chrome.storage.sync` limits**: 100 items, 8KB total. Current usage (2 keys: serverUrl + apiKey) is well within limits. Don't add large data here.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.
