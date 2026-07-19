# Architecture Overview

Kura Booru Next is a personal anime illustration collection and showcase platform. Core workflow: send a link via Telegram Bot → auto-download original image → store in S3 → browse on web. Inspired by safebooru (tag system, pagination, fast loading) but with modern UI (Pixiv/Pinterest-like masonry, dark/light/auto theme, cyan gradient accent).

**v0.9.0** (current): Full TypeScript stack — Nuxt 4 + Nitro for SSR, REST API, and Bot webhook in a single Node process. Python sidecar handles gallery-dl downloads and phash computation via a Redis queue. v0.9.0 refactored the server into `modules/` (domain logic) + `platform/` (cross-cutting: handler wrappers, zod schemas, JobQueue, pg-boss) — see `docs/architecture/decisions.md` for the refactor decisions.

---

## Architecture Diagram

```
Internet
   │
   ▼
┌──────────────────┐
│  Reverse Proxy    │  ← HTTPS termination + reverse proxy (Caddy / nginx / Traefik / any)
│  (宿主机, optional)│
└────────┬──────────┘
         │
         ▼
┌────────────────────────────────────────────────┐
│           Docker internal network               │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  Nuxt/Nitro (:3000, single Node process) │  │
│  │    ├── SSR pages (Vue 3)                  │  │
│  │    ├── REST API (h3 routes)               │  │
│  │    └── Bot webhook (grammy)               │  │
│  │         │                                  │  │
│  │    Drizzle ORM ──→ PostgreSQL 18 (:5432) │  │
│  │    Redis client ──→ Redis 8 (:6379)       │  │
│  │    S3 SDK ────────→ S3-compatible storage │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  Python Sidecar                           │  │
│  │  BRPOP kura:jobs → gallery-dl download    │  │
│  │  → imagehash phash → LPUSH kura:results   │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘

┌──────────────┐
│  Extension   │  X-Api-Key → POST /api/tasks/ + GET /api/tasks/{id}
│  (Manifest3) │
└──────────────┘
```

---

## Tech Stack

| Layer | Tech | Version | Purpose |
|---|---|---|---|
| **SSR + API + Bot** | Nuxt + Nitro | 4.x | Single Node process: Vue 3 SSR, h3 REST routes, grammy webhook |
| **UI** | Vue 3 | 3.5+ | Template + composition API |
| **Styling** | Tailwind CSS | v4 | Utility-first, `@tailwindcss/vite` plugin |
| **ORM** | Drizzle ORM | 0.45+ | TS-first, SQL-like query builder, compile-time types |
| **Migrations** | drizzle-kit | 0.31+ | Schema diff → SQL migration files |
| **Database** | PostgreSQL | 18 | Primary data store, pg_trgm for fuzzy search |
| **Cache/Queue** | Redis | 8 | Bare LPUSH/BRPOP queue (sidecar bridge) + cache + rate limit + session |
| **Job Queue (Node-side)** | pg-boss | 12.26+ | AI jobs + scheduled tasks (ADR-0001, lives in existing PG) |
| **S3** | @aws-sdk/client-s3 | 3.x | Provider-agnostic object storage |
| **Bot** | grammy | 1.44+ | Telegram Bot framework (webhook mode, in-process) |
| **Auth** | h3 cookie + bcryptjs | — | HMAC signed cookie (`kura_admin_session`), bcrypt password hash |
| **AI tags** | OpenAI-compatible API | — | 5-category classification + Chinese translation + danbooru_name |
| **Image download** | gallery-dl (Python) | latest | Pixiv/Twitter/Danbooru anti-crawl bypass — in sidecar |
| **phash** | imagehash (Python) | latest | Perceptual hash dedup — in sidecar |
| **Proxy** | Any reverse proxy | — | Host machine, HTTPS + reverse proxy (optional since v0.7.0; Caddy/nginx/Traefik all work) |
| **Deploy** | Docker Compose | | 4 containers: nuxt, sidecar, postgres, redis |

> Docker Compose (the CLI tool). The application version is v0.9.0.

---

## Project Structure

```
├── app/                       # Vue components, pages, composables
│   ├── components/            # UI components (admin/, PhotoCard, Pagination...)
│   ├── pages/                 # Route pages
│   ├── composables/           # Reusable logic (api, ai, useAiJobPolling, utils)
│   └── layouts/               # Layouts (default.vue)
├── server/                    # Nitro server
│   ├── routes/api/            # REST API routes (define*Handler wrappers)
│   ├── modules/               # Domain logic (v0.9.0 refactor)
│   │   ├── posts/             # serialize, repo (listPosts/getPost/searchPosts...)
│   │   ├── tags/              # repo (listTags/autocomplete/getTagByName)
│   │   ├── search/            # parser, suggest (PG trgm, ADR-0002)
│   │   ├── import/            # pipeline + steps (dedup/thumbnails/upload/rating/tags)
│   │   ├── ai/                # client/classify/reprocess/merges/ratings/summary/assistant/jobs
│   │   └── bot/               # grammy bot logic
│   ├── platform/              # Cross-cutting (v0.9.0 refactor)
│   │   ├── http/              # define*Handler wrappers (auth.ts, handler.ts)
│   │   ├── schemas/           # zod enums (zRating/zSourceSite/zTagCategory)
│   │   ├── contract/          # 53 endpoint contract freeze (check.mjs, endpoints.ts)
│   │   ├── openapi/           # OpenAPI registry
│   │   ├── queue.ts           # JobQueue interface + Redis impl
│   │   ├── jobs.ts            # pg-boss single-point job registration
│   │   └── errors.ts          # AppError ({ code, message, details? })
│   ├── middleware/            # SSR context, cache-control, CORS
│   ├── utils/                 # Legacy utils (re-export shims + auth/redis/s3/db)
│   ├── schema/                # Drizzle database schema
│   └── plugins/               # Startup plugins (pipeline worker, pg-boss, bot setup)
├── sidecar/                   # Python gallery-dl + phash worker
├── infra/                     # Docker Compose + Caddy/Nginx config
├── docs/                      # Architecture docs, dev guide, ADRs
├── drizzle/                   # Database migrations
├── scripts/                   # backfill-srcset.ts, api-diff.mjs
├── nuxt.config.ts             # Nuxt config (Tailwind v4, runtimeConfig)
├── package.json               # Dependencies (drizzle, grammy, @aws-sdk, redis, pg-boss, zod)
```

---

## Core Flow: Send Link → Stored

```
[Telegram user sends link]
      │
      ▼
[Nuxt /bot/webhook (grammy)]
      │ AuthMiddleware (chat.id ∈ BOT_ADMIN_IDS)
      ▼
[enqueueJob → Redis LPUSH kura:jobs]
      │
      ▼
[Python Sidecar: BRPOP kura:jobs]
      │ gallery-dl DownloadJob (ThreadPoolExecutor)
      │ imagehash.phash()
      ▼
[LPUSH kura:results:{id} → image_bytes + phash]
      │
      ▼
[Nitro pollJobResult → processJobResult]
      │ sharp/S3: generate thumb + preview → upload to S3
      │ Drizzle: insert Post + ensure Tags + PostTag
      │ Auto-rating rules check
      │ AI tag classification (if ENABLE_AI_TAG_PROCESSING)
      ▼
[Bot displays rating menu → user confirms → rating applied]
```

---

## v0.8.x → v0.9.0 Refactor Summary

| Dimension | v0.8.1 (prior) | v0.9.0 (current) |
|---|---|---|
| Server structure | flat `server/utils/` (queries.ts 525行, ai.ts 735行, bot.ts 677行, pipeline.ts 609行) | `modules/` (domain) + `platform/` (cross-cutting) + re-export shims |
| Route handlers | `defineEventHandler` + 3-line session boilerplate ×40 | `defineAdminHandler` / `defineApiKeyHandler` / `defineExtHandler` / `definePublicHandler` wrappers |
| Validation | manual `if (!body.x) throw createError(...)` | zod schemas (`zRating`/`zTagCategory`/`zSourceSite` from enums) |
| Errors | `throw createError({ statusCode, statusMessage })` | `throw new AppError('CODE', status, message)` → `{ code, message, details? }` |
| Autocomplete | RediSearch (MEILI_ENABLED, triple misnomer) + SQL fallback | PG trgm/ILIKE only (ADR-0002, RediSearch deleted) |
| AI jobs | `event.waitUntil` fire-and-forget (lost on restart) | pg-boss persistent queue (ADR-0001) |
| Timers | setInterval (06-dashboard-refresh, 03-sync-tasks) | `boss.schedule()` cron (unified in platform/jobs.ts) |
| Pipeline | 609行 monolith, 5 duplicated step blocks | modules/import/pipeline.ts + steps/{dedup,thumbnails,upload,rating,tags}.ts |
| Thumbnails | 3-piece (thumb/preview/LQIP) | 4-width srcset (300w/640w/1280w/2000w) + LQIP (ADR-0003) |
| Queue reliability | handleJobWithRetry dead code (0 callers) | JobQueue interface + MAX_RETRIES=3 + kura:dlq (ADR-0001) |
| Contract | none | 53 endpoint freeze (platform/contract/check.mjs, CI gate) |
| Drizzle operators | auto-import via queries.ts re-export | explicit `import { eq, sql, ... } from 'drizzle-orm'` per file |
| phash lookup | seq-scan `left(phash,4)` (no index) | `ix_posts_phash_prefix` expression index (R2.1, Bitmap Scan) |
