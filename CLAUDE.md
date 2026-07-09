# Kura Booru Next — AI Coding Guide

> For project architecture, API endpoints, data models, and tech stack, see [docs/architecture.md](docs/architecture.md).
> For deployment and environment variables, see [docs/deployment.md](docs/deployment.md).
> For development setup, see [docs/development.md](docs/development.md).
> For operational procedures, see [docs/operations.md](docs/operations.md).

---

## Versioning & Deployment

- **Version label**: `KURA_VERSION` in `.env` (e.g. `v0.7.2`). Nuxt footer reads this at runtime.
- **Docker images**: Custom images are published to GHCR with **both** `:<version-tag>` (e.g. `v0.7.2`) **and** `:latest`. Deploys **pin a version tag** via `KURA_IMAGE_TAG` in `.env`; leaving it unset/empty tracks `:latest` (dev/rolling). See `docs/versioning.md`.
- **Deployment command** (run from `infra/`, `.env` at project root): `docker compose --env-file ../.env -f docker-compose.yml pull && docker compose --env-file ../.env -f docker-compose.yml up -d` — `--env-file` is **required**: `env_file:` only injects vars into containers, it does NOT feed `${VAR}` interpolation. Without it `KURA_IMAGE_TAG` silently falls back to `:latest`.
- **Build → deploy flow** (CI): tag pushed → `docker-publish.yml` builds and pushes `:<tag>` + `:latest` to GHCR → deployer bumps `KURA_IMAGE_TAG` → `pull` + `up -d`. Local dev: `docker build -t <name>:latest .` then `up -d`.
- **Rollback**: set `KURA_IMAGE_TAG` to a prior release tag in `.env`, then `docker compose --env-file ../.env -f docker-compose.yml pull && docker compose --env-file ../.env -f docker-compose.yml up -d` (run from `infra/`). No rebuild needed.
- **Container count**: 4 (web, worker, postgres, redis). See `infra/docker-compose.yml`.
- **Data migration**: Existing PG volumes are reused. New stack connects to same PG — no data copy needed.

---

## Code Generation Constraints

- **gallery-dl**: Use as Python library (`DownloadJob` API in `ThreadPoolExecutor`), NOT as subprocess. Config is global singleton — set once at startup from env vars, never modify concurrently. Sidecar runs this in `sidecar/sidecar.py`.
- **S3 storage**: Generic abstraction layer (`server/utils/s3.ts`). No provider-specific code. Switch providers via env vars only.
- **SSR cache**: Do NOT enable HTTP cache for SSR pages without `Vary: Cookie` + cookie-in-cache-key. Otherwise, admin HTML could leak to anonymous users.
- **Cache-Control**: API responses set headers via middleware — anon gets `public, s-maxage=60`, admin gets `private, no-store`. SSR HTML always `private, no-store`. SSE endpoints set their own `no-cache` which middleware preserves.
- **phash**: Never expose perceptual hash values in API responses (security).
- **Pagination**: Use traditional pagination, not infinite scroll. Per-page selector with 20/40/100 options.
- **Image size**: `MAX_IMAGE_SIZE` env var controls limit (0 = unlimited).
- **Content rating**: Anonymous visitors see only `safe` posts; non-safe returns 404 (existence hidden). Admin login unlocks all. See [docs/architecture.md](docs/architecture.md) for full rating/auth design.
- **Pixiv auth**: Requires both `PIXIV_REFRESH_TOKEN` AND `PIXIV_PHPSESSID` cookie.
- **Reverse proxy**: Runs on the HOST machine (optional since v0.7.0), not in Docker Compose. Containers expose ports to localhost. Any reverse proxy works (Caddy/nginx/Traefik).
- **Password epoch**: `getIsAdmin` checks Redis-cached `password_epoch` on every request. If Redis is down, it fail-opens (allows session). Never bypass this check in new auth code.
- **Nitro auto-imports**: Everything under `server/utils/` is auto-imported by Nitro. Do NOT add explicit `import` statements for `db`, `redis`, `getIsAdmin`, `enqueueJob`, etc. Schema tables are auto-imported via `server/utils/schema.ts` re-export.
- **Extension content scripts**: Must be plain ES5 JavaScript — no TypeScript, no arrow functions, no template literals, no `const`/`let`.
- **Settings public endpoint**: `GET /api/settings/public` must never expose `database_url` or `redis_url`. Only `site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode` are safe for public.
- **Head inject**: Rendered with `v-html` equivalent — admin is trusted, but be cautious if extending to user-controlled input.
- **Maintenance mode**: Enforced in `server/middleware/01-ssr-context.ts` — when `maintenance_mode === "true"` in settings, non-admin visitors are 302-redirected to `/maintenance` with `Cache-Control: private, no-store`.
- **Settings cache back-off**: Middleware's in-process settings cache updates `at` on both success and failure. On failure, stale data is kept and cache backs off for full TTL — never hammer a dead backend.
- **Admin tab routing**: All admin panels live in `/admin/index.vue` as sub-tabs (`?tab=dashboard|posts|tags|auto-rating|settings|password`). Tab switching is client-side with `history.pushState` + `popstate` listener.
- **Accent hue persistence**: Stored in both Cookie (`kura-accent-hue`) and localStorage. SSR reads Cookie and sets `--accent-hue` / `--accent-hue-end` on `<html>` before paint.
- **Per-page preference**: Stored in Cookie (`kura-per-page`), readable by SSR. Pages read URL `per_page` param first, then Cookie, then default 40.
- **Announcement banner**: Top slim banner (32px). Multi-line = vertical rotation every 5s; overflow = slow horizontal scroll at 28px/s. Session-level dismissal via `sessionStorage`.

## Common Pitfalls

- **Nitro import paths**: Never use `import { ... } from '~/server/utils/...'` — Nitro auto-imports `server/utils/*`. Schema tables use `server/utils/schema.ts` re-export (auto-imported as `posts`, `tags`, etc).
- **Redis top-level await**: Not available in Nitro's es2019 target. Use lazy singleton via `getRedis()` or the proxy pattern in `server/utils/redis.ts`.
- **Cookie deletion**: Must match all attributes (`Secure`, `HttpOnly`, `SameSite`, `Path`) used when setting the cookie.
- **Logout race condition**: Use server-side redirect (SSR endpoint `POST /logout`) instead of client-side `fetch()` + `window.location.href`.
- **Extension CSS animation replay**: CSS animations only fire when class is added. Re-applying without removing won't replay.
- **PG 18+ volume mount**: Use `/var/lib/postgresql` (not `/var/lib/postgresql/data`) for PG 18+ Docker images — PG 18 changed its data directory layout.
- **`DATABASE_URL` format**: Uses `postgres://...` (postgres-js driver for Drizzle).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.
