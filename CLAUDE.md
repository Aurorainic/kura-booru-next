# Kura Booru Next — AI Coding Guide

>
>
> 文档与代码注释双语（中/英）；新增代码注释沿用所在文件风格。

Current version: v0.10.0 (released 2026-08-08).

**Authoritative docs** (for depth; this file is the map):
- `docs/architecture/{overview,data-model,extension,decisions}.md` — architecture, data model, extension, ADRs
- `docs/deployment.md` — deployment and environment variables
- `docs/development.md` — local dev guide and manual verification checklist
- `docs/operations.md` — build, migration, backup procedures
- `docs/versioning.md` — release versioning and rollback flows

---

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| SSR + REST API + Bot | Nuxt 4 / Nitro, Vue 3, h3 | Single Node process |
| Styling | Tailwind CSS v4 | Via `@tailwindcss/vite`; design tokens in `assets/css/main.css` (`@theme {}`) |
| ORM / Migrations | Drizzle ORM 0.45+ / drizzle-kit | Schema in `server/schema/`, migrations in `drizzle/` |
| Database | PostgreSQL 18 | pg_trgm for fuzzy search (ADR-0002, RediSearch removed) |
| Cache / queue bridge | Redis 8 | Bare `LPUSH`/`BRPOP` queue to the Python sidecar + cache + rate limit + session |
| Node-side job queue | pg-boss 12 (ADR-0001) | AI jobs + scheduled cron tasks, lives in the existing PG; registered in `server/platform/jobs.ts` |
| Object storage | @aws-sdk/client-s3 | Provider-agnostic (R2/MinIO/AWS S3), switched by env/settings only |
| Telegram Bot | grammy 1.44+ | Webhook mode, in-process (`server/lib/bot/`, route `server/routes/bot/webhook.post.ts`) |
| Downloader / phash | Python sidecar (gallery-dl, imagehash, Pillow) | `sidecar/sidecar.py` |
| AI tagging | OpenAI-compatible API | 5-category classification + Chinese translation + danbooru_name (`server/lib/ai/`) |
| Browser extension | Manifest V3 (Chromium) | `extension/`, Pixiv artwork pages only |
| Package manager | **pnpm 11.3.0** (`packageManager` field) | Workspace includes `extension/` |

Prerequisites: Node.js 22+, Python 3.12+ (sidecar), Docker + Docker Compose.

---

## Repository Layout

```
app/                      # Nuxt frontend
  components/             # UI components; admin/ panels; ui/ primitives (Toast, Confirm...)
  composables/            # api.ts (fetchApi), useToast, useConfirm, useAccent, ...
  pages/                  # index, posts/[id], tags/, search, random, login, admin/
  layouts/default.vue     # mounts global ToastContainer + ConfirmDialog
server/                   # Nitro server
  routes/                 # REST API + /bot/webhook + /i/[...] (S3 proxy) + /health
  lib/                    # Domain logic (v0.9.0): posts/, tags/, search/, import/, ai/, bot/
  platform/               # Cross-cutting (v0.9.0): http/ wrappers, schemas/ (zod),
                          #   contract/, openapi/, queue.ts, jobs.ts (pg-boss), errors.ts (AppError)
  middleware/             # 00-security-headers, 01-ssr-context, 02-cache-control, 03-cors, 04-extension-auth
  plugins/                # Startup: pipeline worker, bot setup, pg-boss, settings hot-reload, seed
  utils/                  # Auto-imported by Nitro; mostly re-export shims (backward compat)
  schema/                 # Drizzle tables (posts, tags, post_tags, tag_knowledge, tag_aliases,
                          #   auto_rating_rules, settings, admins, ai_providers, extension_keys)
sidecar/                  # Python worker: BRPOP kura:jobs → gallery-dl + phash → LPUSH kura:results:{id}
extension/                # Manifest V3 browser extension (background/, content/, popup/, tests/)
infra/                    # docker-compose.yml, .env.example, Caddy/Nginx samples, scripts/
drizzle/                  # SQL migrations (drizzle-kit generate output)
docs/                     # Architecture, deployment, development, operations, ADRs
```

Core import pipeline: Bot/extension/web → `enqueueJob` → Redis `kura:jobs` → sidecar (gallery-dl download + phash) → `kura:results:{id}` → Nitro pipeline worker (`server/lib/import/pipeline.ts` + `steps/{dedup,thumbnails,upload,rating,tags}.ts`) → sharp thumbnails (4-width srcset 300w/640w/1280w/2000w + LQIP, ADR-0003) → S3 upload → Drizzle writes → auto-rating rules → optional AI classification.

---

## Build, Test, and Dev Commands

Run from the project root unless noted:

```bash
pnpm install                # postinstall runs `nuxt prepare` (required for typecheck)
pnpm run dev                # Nuxt dev server at http://localhost:3000
pnpm run build              # production build → .output/
pnpm run test               # contract test (see below)
pnpm exec nuxt typecheck    # typecheck (requires `nuxt prepare` from install)

# Database (requires DATABASE_URL)
pnpm run db:generate        # generate migration from schema changes
pnpm run db:migrate         # apply migrations
pnpm run db:push            # push schema directly (dev only, no migration files)
pnpm run db:studio          # Drizzle Studio

# Contract freeze — REQUIRED after any route file change
node server/platform/contract/check.mjs   # or: pnpm run test:contract

# Browser extension (from extension/ or via workspace filter)
pnpm --filter kura-booru-next-extension test   # vitest run
pnpm --filter kura-booru-next-extension lint   # eslint

# Python sidecar
cd sidecar && pip install -r requirements.txt pytest && python -m pytest tests/ -v
cd sidecar && python sidecar.py                # run worker locally

# Full stack via Docker (from infra/, .env lives at PROJECT ROOT)
docker compose --env-file ../.env -f docker-compose.yml up

# Env validation
cd infra && ./scripts/validate-env.sh dev    # or: prod (strict)
```

CI (`.github/workflows/ci.yml`) gates four jobs: `nuxt typecheck`, extension vitest, sidecar pytest, and the contract check. `docker-publish.yml` builds/pushes GHCR images on `v*` tags.

---

## Coding Conventions and Rules

These are hard-won project rules — violating them has broken production before.

### Server (Nitro)

- **Imports**: `server/utils/` is Nitro auto-imported, but **new code must use explicit imports** everywhere, including utils (v0.9.0 convention). `server/lib/` and `server/platform/` are NOT auto-imported — always explicit (`import { db } from '../../utils/db'`, `import { eq, sql } from 'drizzle-orm'`, mind the relative depth). Never write `import ... from '~/server/...'`.
- **Never create `server/modules/`** — Nitro reserves that name: every file there is auto-registered as a Nitro module and executed via jiti at build time (this broke a release build). Domain logic lives in `server/lib/`.
- **Route handlers**: always use the wrappers from `server/platform/http/auth.ts` — `defineAdminHandler` / `defineApiKeyHandler` / `defineExtHandler` / `definePublicHandler` / `defineTelegramHandler`. Never raw `defineEventHandler` + manual `getIsAdmin` checks in new routes.
- **Errors**: throw `AppError` from `server/platform/errors.ts` (shape `{ code, message, details? }`), not `createError`.
- **Validation**: zod v4 schemas; shared enums in `server/platform/schemas/enums.ts` (`zRating`, `zSourceSite`, `zTagCategory`).
- **Route files**: one HTTP method per file (`index.get.ts`, `[id].patch.ts`). Combined-method files are unsupported and 404.
- **Contract freeze**: all endpoints are frozen in `server/platform/contract/endpoints.ts` (currently **61 route files / 62 endpoint entries**). After any route change run `node server/platform/contract/check.mjs` and update the contract list — CI gates this.
- **Jobs**: Node-side background/scheduled work goes through pg-boss, registered in `server/platform/jobs.ts`. Never `setInterval` or fire-and-forget `event.waitUntil` for persistent work. The Redis queue (`kura:jobs` / `kura:results:` / `kura:job_status:`) is only the sidecar bridge and is unchanged.
- **Redis**: no top-level await (Nitro targets es2019) — use the lazy `getRedis()` singleton.
- **pg-boss + drizzle**: `DATABASE_URL` uses `postgres://` (postgres-js driver).

### Frontend (Vue 3)

- Composition API + SFC templates; Tailwind v4 utility classes + component classes defined in `assets/css/main.css`.
- `fetchApi()` in `app/composables/api.ts` builds URLs with string concat + `URLSearchParams`. Never `new URL()` with relative paths (throws in browsers).
- `useAsyncData` keys must include route params (page, query, perPage) to avoid stale cache on client navigation.
- **No `alert()`/`confirm()`** — use `useToast().success/error/info` and `await useConfirm().ask({...})` (callers must be `async`). Global containers are mounted in `layouts/default.vue`.
- Admin UI is a single page `app/pages/admin/index.vue` with sub-tabs (`?tab=dashboard|posts|tags|auto-rating|ai|extension|settings|password|import`), all panels `<KeepAlive>`-wrapped; the shared `AdminStatusBar` owns polling — panels read from it, don't add per-panel pollers.
- **Components auto-import uses `pathPrefix: false`** (`nuxt.config.ts`) — without it `ui/ConfirmDialog.vue` registers as `UiConfirmDialog` and shared UI primitives silently fail to resolve.
- CSS pitfall: minifiers can strip `0` from `blur(0)` producing invalid `blur()` — use `filter: none`.

### Extension (`extension/`)

- **Content scripts must be plain ES5**: no TypeScript, no arrow functions, no template literals, no `const`/`let`. Tests (vitest + jsdom) live in `extension/tests/`; service worker is `background/service-worker.js`.
- CSS animations only replay when the class is removed and re-added.

### Sidecar (`sidecar/`)

- Use gallery-dl as a **Python library** (`DownloadJob` in `ThreadPoolExecutor`), never as a subprocess. Its config is a global singleton set once at startup.
- SSRF protection is mandatory: allowed schemes http/https only, private/loopback/CGNAT/multicast networks blocked, IP re-validated at the socket layer (DNS-rebinding TOCTOU guard). Tests: `sidecar/tests/test_ssrf.py`.
- The sidecar owns download + phash + dims/mime only (phash needs imagehash's exact DCT); all raster resizing happens in the Node pipeline via sharp.

### Database

- Schema in `server/schema/*.ts`; DB columns snake_case, Drizzle properties camelCase; API responses serialize to snake_case via `serializePost()`/`serializeTag()`.
- Change schema → `pnpm run db:generate` → commit the SQL under `drizzle/` → `db:migrate` to apply. `db:push` is dev-only.
- PG 18+ volume mount: `/var/lib/postgresql` (not `/var/lib/postgresql/data`).

---

## Hard-Won Rules (production incidents behind each)

This section is the **diff** vs. the rest of this document — the gotchas that bit us in production and aren't obvious from reading code.

### 1. `NODE_ENV=production` in the Dockerfile build stage is load-bearing
Nuxt keys the client bundle on `process.env.NODE_ENV` at build time (devtools, dev badge, debug chunks). Forgetting `ENV NODE_ENV=production` in the build stage silently ships a dev bundle — page shows "nuxt dev" text and a dev badge bottom-left.

**Fix**: one line in `Dockerfile` build stage. Do NOT iterate deploys.

**Two guards prevent regression**:
- CI step `Assert production build guard` greps the Dockerfile before `docker/build-push-action`.
- `RUN test "${NODE_ENV:-}" = "production"` inside the build stage (fails build if ENV missing).

**Bumping `KURA_VERSION` does NOT require touching this** — only edit if both guards fire.

### 2. SSR caching: never enable Nitro route-level SWR for SSR pages
Anonymous SSR is `public, s-maxage=300`; admin/Redis-down is `private, no-store`. API responses mirror this in `server/middleware/02-cache-control.ts`; SSE endpoints set their own `no-cache`. `/admin/**`, `/login`, `/logout` are hard `no-store` in `nuxt.config.ts` routeRules.

**Why**: v0.7.7 once enabled `swr: 300` on `/`, `/posts/**`, `/tags/**`, `/search` without cookie in cache key. Anon SSR HTML got cached → admin login → full reload served the cached anon HTML → admin appeared logged out. Removed route-level SWR; cache-control is cookie-aware at the middleware.

### 3. `password_epoch` cache check is fail-open
`getIsAdmin` checks Redis-cached `password_epoch` on every request to invalidate sessions on password change. **If Redis is down, it fail-opens** (allows session). Never bypass this check in new auth code.

### 4. AI workers + Bot on-demand registration
When AI workers (`ai-classify` / `ai-merges` / `ai-ratings`) or Bot are disabled, workers are **unregistered** to avoid holding DB connections (`refreshAiConfig` + `onAiConfigChanged` hooks). The three AI enqueue endpoints return 409 `FEATURE_DISABLED` instead of accumulating jobs that no one will process.

### 5. Bot rebuild race condition invariants
`rebuildBot()` builds the new instance first, then atomically swaps (does not null the old one). `getBot()` has an in-flight promise guard to prevent concurrent builds from leaking orphan instances. `chatSemaphores` are module-level so rebuild doesn't drop them. **Don't refactor without keeping all three invariants.**

### 6. AI reprocess robustness knobs
- `AbortController` timeout 60s (was 30s — DeepSeek 25-tag JSON batches exceed 30s).
- Reprocess `VALUES` updates need explicit `tag_category_enum` cast; the implicit `text → enum` fails and silently drops tag table writes.
- Result sync is per-batch, not one bulk update at the end — mid-batch failure no longer leaves `knowledge ↔ tags` forked.

### 7. `run_mode` default is `public`
v0.10.0 changed default from `intranet` to `public` for security — fresh public deployments are no longer hijacked by the previous intranet default. **`KURA_INTERNET_MODE` env var was removed** — `run_mode` (default `public`) is a DB setting with 10s hot reload. intranet mode treats all visitors as admin and hides login/logout entry points.

### 8. `safe_mode_enabled` + `safe_mode_in_intranet`
When enabled, list/random endpoints filter to `safe` only; search and detail still return all ratings but append `is_blurred: true`, and the frontend wraps with `PostBlurOverlay` (click to reveal). Detail page must only blur when `is_blurred === true` — unconditional blur broke detail pages (regression in v0.10.0, fixed by keying the expanded state on post id).

### 9. Settings hot reload plumbing
`server/utils/settings-defs.ts` (registry) + `server/plugins/07-settings-hot-reload.ts` (hook):
- S3 client auto-rebuilds via `resetS3Client`.
- Telegram Bot rebuilds via `rebuildBot()` on token/admin/proxy change.
- Pixiv credentials + `MAX_IMAGE_SIZE` sync to sidecar via Redis (`kura:pixiv:*`, `kura:max_image_size`).

The `__CLEAR__` sentinel revokes secrets; empty string preserves current value. Pixiv Redis sync uses a non-empty check (not `in` check) so empty strings don't overwrite sidecar's env fallback. AI settings (`ai_tag_processing_enabled` etc.) MUST be in `SETTING_DEFS` — direct DB writes are silently dropped by `updateSettings()`'s whitelist filter.

### 10. Web-import URL validation is layered
URL must be http/https (rejected at enqueue, **before** sidecar) **and** fail the private-network check. `ftp://` and friends are blocked at the entry point — don't move this check into the sidecar only.

### 11. `undici` must stay 7.x
8.x is incompatible with Node 24's built-in undici — dispatcher throws `invalid onRequestStart method`. Pinned via lockfile.

### 12. `artist:` prefix tags are stripped
v0.10.0: gallery-dl's `artist:xxx` prefix tags fold into the clean artist-tag counterpart at import; do not reintroduce them. The merge is idempotent (see `fix-artist-categories` migration).

### 13. S3 proxy path traversal — keys are validated
`server/routes/i/[...].ts` rejects `..` / `.` components, percent-encoded variants, backslashes, absolute paths, and control characters. Don't loosen without a regression test.

### 14. External artwork descriptions are plain text
Pixiv/Twitter descriptions arrive with raw HTML (`<br>` / `<a>`). `serializePost()` strips to plain text (preserving line breaks) and the panel renders with `whitespace-pre-line`. **Never** switch to `v-html` here — XSS surface.

### 15. Cookies: deletion must match every attribute
Delete with the same `Secure`, `HttpOnly`, `SameSite`, `Path` used at set time, otherwise the browser keeps a phantom cookie. Logout is `POST /logout` (server-side redirect), not client `fetch()` + `window.location.href` — race-condition safe.

### 16. AI Provider toggle race
Single-active semantics must be enforced inside a transaction; concurrent writes otherwise produce two active providers.

### 17. Webhook secret uses constant-time comparison
From `!==` to `crypto.timingSafeEqual` (matches `checkApiKey`). Enforced in production via `NODE_ENV=production` check.

### 18. Task status response must strip deeply
`/api/tasks/:id` must recursively strip `image_bytes_b64` / `phash` across all `metadata.pages[]` of multi-image results — top-level stripping leaks via per-page metadata.

### 19. Admin API GET returns structured metadata
`/api/admin/settings` GET returns `{ categories, items }` (with type/label/description/options/masked metadata), not a flat `{ key: value }` map. PUT accepts `{ settings }` and validates against the registry.

### 20. `getSettings()` (projected whitelist), not raw select
Sensitive columns stay out of management responses by reading through `getSettings()`, not direct SELECT — preserves the security boundary as the registry grows.

---

## Testing Strategy

There is no unit-test suite for the Nuxt app itself. Verification is layered:

1. **Contract test** (required, CI-gated): `node server/platform/contract/check.mjs` — bidirectional drift guard between route files and the frozen endpoint list. Run it after any `server/routes/` change.
2. **Typecheck** (CI): `pnpm exec nuxt typecheck` (needs `nuxt prepare` from `pnpm install`).
3. **Extension tests**: vitest in `extension/tests/` (`pnpm --filter kura-booru-next-extension test`).
4. **Sidecar tests**: pytest in `sidecar/tests/` (SSRF coverage; CI treats "no tests collected" as failure).
5. **Manual end-to-end checklist**: `docs/development.md` § Testing & Verification lists 17 flows (bot import, web import SSE, delete, auto-rating, AI tags, rating visibility, pagination, dedup, theme, admin login, dashboard, tag merge, settings hot reload, mobile...). Walk the relevant ones for user-facing changes.

---

## Security Considerations

- **Content rating**: anonymous visitors see only `safe` posts; non-safe posts return 404 (existence hidden) and are filtered from lists/searches/tag visibility. Admin session unlocks all. An "intranet" run mode (DB setting `run_mode`) treats all visitors as admin — default is `public`.
- **Auth**: single admin, bcrypt hash, HMAC-signed cookie `kura_admin_session`; bot webhook + extension use `X-Api-Key` (timing-safe comparison; webhook also validates `x-telegram-bot-api-secret-token`, enforced in production).
- **Password epoch**: `getIsAdmin` checks the Redis-cached `password_epoch` on every request (invalidates sessions on password change). If Redis is down it **fail-opens** (allows session). Never bypass this in new auth code.
- **SSR caching**: never enable Nitro route-level SWR/HTTP cache for SSR pages (no cookie in cache key → admin HTML leak). Cache-Control is set by `server/middleware/02-cache-control.ts`: anon SSR `public, s-maxage=300`, admin/Redis-down `private, no-store`; API responses similar via middleware; SSE endpoints set their own `no-cache`. `/admin/**`, `/login`, `/logout` are hard `no-store` in `nuxt.config.ts` routeRules.
- **phash**: never expose perceptual hash values in API responses.
- **Settings**: `GET /api/settings/public` must only return whitelisted keys (`site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode`) — never `database_url`/`redis_url`/secrets. Sensitive settings are masked in admin GETs; `__CLEAR__` sentinel revokes secrets.
- **S3 proxy** (`server/routes/i/[...].ts`): validates keys against `..`/`.` path traversal.
- **External artwork descriptions** (Pixiv/Twitter) are rendered as plain text, never `v-html`.
- **Login errors** use a unified message (no user-enumeration).
- **Cookies**: deletion must match every attribute (`Secure`, `HttpOnly`, `SameSite`, `Path`) used at set time. Logout uses a server-side redirect (`POST /logout`), not client `fetch` + `location.href`.
- **Containers** run as non-root users (both Dockerfiles).
- Secrets live in `.env` at the project root (git-ignored); `infra/.env.example` is the template. Never commit real values.

---

## Deployment

- 4 containers via `infra/docker-compose.yml`: **web** (Nuxt/Nitro :3000), **worker** (Python sidecar), **postgres** (18), **redis** (8). Reverse proxy (Caddy/nginx/Traefik/any) runs on the host, optional since v0.7.0.
- **`.env` lives at the project root**, and compose must be invoked from `infra/` with `--env-file ../.env` — `env_file:` injects vars into containers but does NOT feed `${VAR}` interpolation (e.g. `KURA_IMAGE_TAG` silently falls back to `:latest` without it):

  ```bash
  docker compose --env-file ../.env -f docker-compose.yml pull && \
  docker compose --env-file ../.env -f docker-compose.yml up -d
  ```

- **Versioning**: releases are git tags `v*` → `docker-publish.yml` builds and pushes `:<tag>` + `:latest` to GHCR. Deploys pin `KURA_IMAGE_TAG` in `.env` (empty = track `:latest`, dev/rolling). Rollback = set `KURA_IMAGE_TAG` to a prior tag + `pull` + `up -d`. Footer version label comes from `KURA_VERSION`.
- **Configuration layering**: only bootstrap vars (`DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `SESSION_SECRET`, `POSTGRES_*`, `PORT`) are runtime env; business config (S3, Bot, Pixiv, site title, announcement, maintenance mode, run mode, download proxy...) lives in the DB `settings` table, editable in the admin panel with ≤10s hot reload (`server/utils/settings-defs.ts` registry + `server/plugins/07-settings-hot-reload.ts`). Env values seed the table on first boot only.
- **Dockerfile build stage must set `ENV NODE_ENV=production`** — Nuxt keys the client bundle on it; omitting it silently ships a dev bundle ("nuxt dev" badge in prod). Two guards enforce this: `RUN test "${NODE_ENV:-}" = "production"` in the build stage and a CI step that greps the Dockerfile. If prod shows the dev badge, fix that line — do not redeploy blindly.
- **PG 18+ volume**: mount `/var/lib/postgresql` (not `/var/lib/postgresql/data`).
- Dependencies pinned by lockfile (`pnpm install --frozen-lockfile` in Dockerfile/CI). Note: `undici` must stay 7.x — 8.x is incompatible with Node 24's built-in undici.

---

## AI Behavior Guardrails

- When changing a route file, the next step is `pnpm run test:contract`. If it fails, the diff is wrong.
- When adding a new admin tab, route its polling through `AdminStatusBar` — don't add per-panel pollers.
- When tempted to use `~/server/...` import path, use explicit relative paths instead.
- When tempted to use `alert()` / `confirm()`, use `useToast().success/error/info` and `await useConfirm().ask({...})` (callers must be `async`).
- When tempted to add `setInterval` / `setTimeout` for persistent work, route through pg-boss.
- When tempted to enable Nitro SWR/HTTP cache on SSR pages, stop — see Hard-Won Rule #2.
- When tempted to use `createError`, use `AppError`.
- When adding a sensitive setting, update `GET /api/settings/public` whitelist AND the registry in `settings-defs.ts`.
- When adding an AI setting, register it in `SETTING_DEFS` — direct writes are silently dropped.
- When tempted to refactor `rebuildBot()`, preserve the three invariants in Hard-Won Rule #5.
- When tempted to add `new S3Client()` directly, route through the lazy `getS3Client()` singleton so hot reload works.
- When tempted to `mkdir server/modules/...`, stop — Nitro reserves that name; use `server/lib/`.

---

## Quick Reference

- API surface: `server/routes/api/` (posts, tags, search, tasks/import, settings, auth, auto-rating-rules, admin/*) — frozen by contract; OpenAPI registry in `server/platform/openapi/`.
- ADRs: `docs/adr/` — 0001 queue (pg-boss + DLQ), 0002 search (PG trgm), 0003 thumbnails (srcset), 0004 API contract.
- Tag model: 5 categories (artist/character/copyright/general/meta), aliases, `post_count` denormalized (recomputed via `COUNT(*)` on merge), danbooru_name + Chinese translation from AI.
- Search syntax: `tag1+tag2` AND, `-tag` exclude, `rating:safe` filter; traditional pagination with 20/40/100 per-page selector (never infinite scroll).
- Version history: `CHANGELOG.md` (Keep a Changelog, zh-CN).
