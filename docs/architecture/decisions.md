# Architecture Decision Records

## SSR + reverse proxy cache, NOT SSG

| Comparison | SSG (original plan) | SSR + reverse proxy cache (adopted) |
|---|---|---|
| New image visibility | Wait for rebuild (30s–15min) | Immediately visible |
| Cache-hit performance | ~3ms (static file) | ~5–8ms (reverse proxy cache) |
| Ops complexity | Needs build pipeline + deploy | Just another Node process |
| Build time vs content growth | O(n), eventually unacceptable | No build step |
| Dynamic pages (search, pagination) | Cannot pre-generate all combos | Naturally supported |

## Images served directly from S3/CDN

API responses contain `s3_key` / `thumb_key` / `preview_key`. The frontend constructs image URLs as `/i/{key}`, which the Nitro route `server/routes/i/[...].ts` proxies to `S3_EXTERNAL_URL/{key}`. In production with a CDN, `S3_EXTERNAL_URL` points to the CDN domain and images bypass the proxy entirely.

## S3 is generic

Works with Cloudflare R2, MinIO, AWS S3, or any S3-compatible storage. Switch by changing env vars only (`S3_ENDPOINT`, `S3_EXTERNAL_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`). No code changes needed.

## Pagination, not infinite scroll

Like safebooru — traditional pagination with per-page count selector (20/40/100). URLs are shareable.

---

## v0.7.0 Architecture Decisions

### Single Nuxt/Nitro process (7 containers → 4)

**Decision**: Merge Frontend (Astro), Backend (FastAPI), Worker (ARQ), and Bot (aiogram) into a single Nuxt/Nitro Node process. Keep only gallery-dl as a Python sidecar.

**Rationale**:
- Eliminates 3-4 HTTP hops per SSR page (auth + settings + page data) — in-process function calls are <1ms vs ~5-15ms per HTTP hop
- Bot handlers call service functions directly instead of HTTP-to-backend
- Removes Meilisearch (~200MB RAM) — pg_trgm covers fuzzy search for personal-site scale
- Estimated RAM: ~680MB → ~350MB (-48%)

**Trade-off**: Single process means SSR + API + Bot share resources. Acceptable for personal-site traffic. Nitro can be configured with workers if needed.

### Drizzle ORM over SQLAlchemy

**Decision**: Use Drizzle ORM (TypeScript-first) instead of SQLAlchemy.

**Rationale**: Compile-time type inference, SQL-first query builder, ~20KB package size. Eliminates the 503-line hand-written `api.ts` type definitions from v1. `drizzle-kit` generates SQL migrations from schema changes.

### grammy over aiogram

**Decision**: Use grammy (TypeScript Telegram framework) instead of aiogram (Python), running in-process within Nitro.

**Rationale**: Eliminates the Bot container and all Bot→Backend HTTP calls. grammy's API design is close to aiogram (commands, handlers, middleware). Bot handlers import service functions directly.

### Bare Redis queue over ARQ/BullMQ

**Decision**: Use bare Redis `LPUSH`/`BRPOP` for the job queue instead of a queue library.

**Rationale**: ~20 lines of code for enqueue/poll. The sidecar does `BRPOP kura:jobs`, processes, and `LPUSH kura:results:{id}`. No library dependency, no cron dependency. Retry logic is a simple exponential backoff loop.

### HMAC signed cookie over itsdangerous

**Decision**: Use Node.js `crypto.createHmac('sha256')` for cookie signing instead of Python `itsdangerous`.

**Rationale**: Equivalent security (HMAC-SHA256). The signing/verification functions are ~15 lines. Cookie format is compatible with the v1 approach (value.signature).

### API serialization: camelCase → snake_case

**Decision**: Drizzle schema uses camelCase JS property names (`s3Key`, `thumbKey`), but API responses serialize to snake_case (`s3_key`, `thumb_key`) via `serializePost()` / `serializeTag()` in `queries.ts`.

**Rationale**: Frontend types and components use snake_case to match the v1 API contract. The serialization layer in the query functions ensures consistency and strips sensitive fields (`phash`).

### Nitro route file convention: one method per file

**Decision**: Each HTTP method gets its own file (`index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`).

**Rationale**: Nitro does NOT support combined-method suffixes like `.get.post.ts` or `.patch.delete.ts` — these produce 404 errors. Each method must be a separate file.

---

## v0.9.0 Architecture Decisions

Full ADRs in `docs/adr/`. Summary:

### ADR-0001: Queue — JobQueue interface + pg-boss for Node-side jobs

- `server/platform/queue.ts` defines `JobQueue` interface (enqueue/getStatus/consume/retry); Redis impl wraps existing `kura:jobs`/`kura:results:` semantics.
- pg-boss (v12.26+)收编 AI jobs (was `event.waitUntil`, lost on restart) + 2 scheduled tasks (was setInterval).
- **Not changed**: `kura:jobs`→sidecar Redis bridge, `kura:results:`/`kura:job_status:` result-retrieval protocol (bot/extension/SSE contracts).
- Containers unchanged (4) — pg-boss lives in existing PG.

### ADR-0002: Search — delete RediSearch, autocomplete via PG trgm

- `MEILI_ENABLED` was a triple misnomer (not Meilisearch, only served autocomplete, index freshness half-broken and unnoticed).
- Deleted: `suggest.ts` RediSearch impl, `07-redis-index-sync` plugin, `MEILI_ENABLED` env var.
- Autocomplete now uses PG trgm/ILIKE (`modules/search/suggest.ts`), post_count read live from PG (no drift).

### ADR-0003: Thumbnails — sharp + multi-width srcset (imgproxy archived)

- Extended from 3-piece (thumb/preview/LQIP) to 4-width srcset: 300w/640w/1280w/2000w + LQIP 20².
- Key naming: `<base>-{300w|640w|1280w|2000w}.webp`. Frontend `getSrcset()` derives from thumb/preview keys.
- `/i/` reverse proxy contract unchanged (Range passthrough + `max-age=31536000` without immutable).
- Backfill script: `scripts/backfill-srcset.ts` (dry-run first).
- imgproxy spike validated (10/10 PASS) but not adopted (container count constraint).

### ADR-0004: API contract — 53 endpoint freeze + handler wrappers

- `server/platform/contract/endpoints.ts` is the static source of truth; `check.mjs` does bidirectional drift guard.
- 4 handler wrappers (`defineAdminHandler`/`defineApiKeyHandler`/`defineExtHandler`/`definePublicHandler`) eliminate ~40 × 3-line session boilerplate.
- Errors unified to `AppError` → `{ code, message, details? }`.
- zod enums (`zRating`/`zSourceSite`/`zTagCategory`) derived from PG enums (single source of truth).
- Frozen endpoints (web-import/tasks/[id]/bot webhook/i/) — literals and protocol preserved byte-for-byte.

---

## v0.6.x Lessons Applied

- S3 key normalization + post-upload URL verification
- Multi-stage Dockerfiles with pinned base images
- Stream-based S3 uploads (no memory buffering)
- Unified `BOT_ADMIN_IDS` middleware auth
- phash prefix-bucket indexing for O(1) dedup
- phash NOT exposed in API responses (security)
- Password epoch (Redis-cached) for session invalidation on password change
- Redis fail-open for auth (allow session if Redis is down)
- `Vary: Cookie` requirement for any SSR HTTP caching
- `new URL()` throws on relative paths — use string concat in client-side fetch
- `useAsyncData()` keys must include route parameters to prevent stale cache
