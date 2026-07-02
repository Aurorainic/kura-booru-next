# Architecture Overview

Kura Booru Next is a personal anime illustration collection and showcase platform. Core workflow: send a link via Telegram Bot → auto-download original image → store in S3 → browse on web. Inspired by safebooru (tag system, pagination, fast loading) but with modern UI (Pixiv/Pinterest-like masonry, dark/light/auto theme, cyan gradient accent).

**v0.7.0** (current): Full TypeScript stack — Nuxt 4 + Nitro for SSR, REST API, and Bot webhook in a single Node process. Python sidecar handles gallery-dl downloads and phash computation via a Redis queue.

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
| **Cache/Queue** | Redis | 8 | Bare LPUSH/BRPOP queue + cache (no queue library) |
| **S3** | @aws-sdk/client-s3 | 3.x | Provider-agnostic object storage |
| **Bot** | grammy | 1.44+ | Telegram Bot framework (webhook mode, in-process) |
| **Auth** | h3 cookie + bcryptjs | — | HMAC signed cookie (`kura_admin_session`), bcrypt password hash |
| **AI tags** | OpenAI-compatible API | — | 5-category classification + Chinese translation + danbooru_name |
| **Image download** | gallery-dl (Python) | latest | Pixiv/Twitter/Danbooru anti-crawl bypass — in sidecar |
| **phash** | imagehash (Python) | latest | Perceptual hash dedup — in sidecar |
| **Proxy** | Any reverse proxy | — | Host machine, HTTPS + reverse proxy (optional since v0.7.0; Caddy/nginx/Traefik all work) |
| **Deploy** | Docker Compose | | 4 containers: nuxt, sidecar, postgres, redis |

> Docker Compose (the CLI tool). The application version is v0.7.0.

---

## Project Structure

```
├── app/                       # Vue components, pages, composables
│   ├── components/            # UI components (admin/, PhotoCard, Pagination...)
│   ├── pages/                 # Route pages
│   ├── composables/           # Reusable logic (api, useSsrContext, utils)
│   └── layouts/               # Layouts (default.vue)
├── server/                    # Nitro server
│   ├── routes/api/            # REST API routes
│   ├── middleware/             # SSR context, cache-control, CORS
│   ├── utils/                 # Core logic (auth, bot, queries, pipeline, redis...)
│   ├── schema/                # Drizzle database schema
│   └── plugins/               # Startup plugins (pipeline worker, bot setup, seed)
├── sidecar/                   # Python gallery-dl + phash worker
├── infra/                     # Docker Compose + Caddy/Nginx config
├── docs/                      # Architecture docs, dev guide
├── drizzle/                   # Database migrations
├── nuxt.config.ts             # Nuxt config (Tailwind v4, runtimeConfig)
├── package.json               # Dependencies (drizzle, grammy, @aws-sdk, redis, bcryptjs)
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

## v0.6.x → v0.7.0 Migration Summary

| Dimension | ≤0.6.x (Python/Astro) | v0.7.0 (current, TypeScript) |
|---|---|---|
| Containers | 7 (Astro, FastAPI, ARQ Worker, Bot, Meilisearch, PG, Redis) | 4 (Nuxt, Sidecar, PG, Redis) |
| Languages | Python + TypeScript | TypeScript + 80 lines Python |
| SSR internal calls | 3-4 HTTP hops per page | 0 (in-process function calls) |
| Search | pg_trgm + Meilisearch (dual sync) | pg_trgm only |
| ORM | SQLAlchemy 2 async | Drizzle ORM |
| Auth | itsdangerous + bcrypt | HMAC signed cookie + bcryptjs |
| Bot | aiogram (separate container) | grammy (in-process) |
| Image processing | Pillow (~60ms thumb) | sharp (~15ms, planned) / sidecar Pillow (current) |
| Estimated RAM | ~680MB | ~350MB |
