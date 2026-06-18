# Kura Booru V2 — Project Guide

## Overview

Personal anime illustration collection and showcase platform. Core workflow: send a link via Telegram Bot → auto-download original image → store in S3 → browse on web.

Inspired by safebooru (tag system, pagination, fast loading) but with modern UI (Pixiv/Pinterest-like masonry, dark/light/auto theme, cyan gradient accent).

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Bot | aiogram 3.x | Webhook mode |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + ARQ | REST API + task queue |
| Frontend | Astro 5 (SSR) + React 19 + react-photo-album | SSR with Caddy caching, NOT SSG |
| UI | Tailwind CSS v4 + shadcn/ui pattern | Base components, heavy visual customization |
| Storage | S3-compatible (R2 prod / MinIO dev) | Abstract layer, swappable via env vars |
| Database | PostgreSQL 16+ | |
| Cache/Queue | Redis 7.x | ARQ queue + Caddy cache backend |
| Reverse Proxy | Caddy 2.x (host machine) | With Souin cache plugin |
| Deployment | Docker Compose v2 | Internal network, Caddy on host |

## Architecture

```
Internet → Caddy (host) → Docker internal network
  /*      → frontend:4321  (SSR, cached by Souin)
  /api/*  → backend:8000   (no cache)
  /i/*    → S3_ENDPOINT    (direct S3 proxy, zero backend)
  /bot/*  → bot:8080       (Telegram webhook)
```

**Key decision: SSR + Caddy cache, NOT SSG.** SSG cannot do incremental rebuilds — new images would require full site rebuilds. SSR with 5-min TTL Caddy cache gives near-static performance with instant content visibility.

**S3 is generic**: Works with Cloudflare R2, MinIO, AWS S3, or any S3-compatible storage. Switch by changing env vars only. No code changes needed.

## Project Structure

```
kura-booru-v2/
├── backend/          # FastAPI app
│   ├── app/
│   │   ├── main.py              # FastAPI app + lifespan + CORS
│   │   ├── config.py             # pydantic-settings from env vars
│   │   ├── database.py           # SQLAlchemy async engine + session
│   │   ├── api/                  # REST routes
│   │   │   ├── posts.py          #   GET /api/posts, /posts/{id}, /posts/random, /posts/by-source
│   │   │   ├── tags.py           #   GET /api/tags, /tags/{name}, /tags/autocomplete
│   │   │   ├── search.py         #   GET /api/search?q=tag1+tag2
│   │   │   ├── tasks.py          #   POST /api/tasks/ (enqueue image processing)
│   │   │   └── webhook.py         #   POST /api/rebuild/ (cache purge)
│   │   ├── models/               # SQLAlchemy models
│   │   │   ├── post.py           #   Post model (SourceSite enum)
│   │   │   ├── tag.py            #   Tag model (TagCategory enum)
│   │   │   ├── post_tag.py       #   PostTag association
│   │   │   └── tag_alias.py      #   TagAlias model
│   │   ├── schemas/              # Pydantic schemas
│   │   │   ├── post.py           #   PostCreate, PostRead, PostListRead
│   │   │   └── tag.py            #   TagCreate, TagRead, TagListRead
│   │   ├── services/             # Business logic
│   │   │   ├── s3.py             #   S3 storage (upload, delete, presigned URL, verify)
│   │   │   ├── pipeline.py       #   Image processing pipeline (HEAD check → download → phash → thumb → S3)
│   │   │   ├── phash.py          #   Perceptual hash with prefix-bucket indexing
│   │   │   ├── source_resolver.py#   URL → source_site + source_id extraction
│   │   │   └── gallery_dl.py    #   gallery-dl Python API integration (ThreadPoolExecutor)
│   │   ├── source_extractors/    # Per-site metadata extractors
│   │   │   ├── base.py           #   BaseExtractor + ExtractorResult
│   │   │   ├── pixiv.py          #   Pixiv URL parser + gallery-dl metadata
│   │   │   ├── twitter.py        #   Twitter/X URL parser
│   │   │   ├── danbooru.py       #   Danbooru URL parser
│   │   │   └── generic.py        #   Fallback for unknown URLs
│   │   └── tasks/                # ARQ task definitions
│   │       ├── worker.py          #   Worker settings + enqueue helper
│   │       └── process_image.py   #   Main task: resolve → extract → pipeline → DB
│   ├── alembic/                  # Database migrations
│   │   ├── env.py                #   Async Alembic env
│   │   └── versions/001_initial.py  # All tables + indexes
│   ├── alembic.ini
│   ├── requirements.txt
│   └── Dockerfile                # Multi-stage (dev + prod)
├── bot/              # aiogram 3 Telegram bot
│   ├── app/
│   │   ├── main.py              # Bot entry + aiohttp webhook server
│   │   ├── config.py            # Bot env vars
│   │   ├── middleware.py        # Auth middleware (admin IDs check)
│   │   ├── handlers/
│   │   │   ├── start.py         #   /start command
│   │   │   ├── url_handler.py   #   Auto-detect URLs in messages
│   │   │   ├── save.py          #   /save <url> command
│   │   │   ├── search.py        #   /search <query> command
│   │   │   ├── info.py          #   /info <url> command (by-source lookup)
│   │   │   └── callback.py      #   Inline keyboard callbacks
│   │   └── services/
│   │       ├── arq_client.py    #   ARQ Redis pool + task enqueue
│   │       └── backend_api.py   #   HTTP client for backend API
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/         # Astro SSR
│   ├── src/
│   │   ├── components/    # React Islands
│   │   │   ├── ThemeToggle.tsx  # 3-state dark/light/auto toggle
│   │   │   ├── Pagination.tsx  # Page nav + per-page selector (20/40/100)
│   │   │   ├── PhotoAlbum.tsx  # Masonry grid (react-photo-album)
│   │   │   └── SearchBar.tsx   # Tag autocomplete search
│   │   ├── layouts/
│   │   │   └── BaseLayout.astro # Nav + theme + footer
│   │   ├── pages/
│   │   │   ├── index.astro      # Home (masonry + pagination)
│   │   │   ├── posts/[id].astro # Detail (full image + tags + source)
│   │   │   ├── tags/index.astro # Tag cloud + table
│   │   │   ├── tags/[name].astro# Tag detail (filtered posts)
│   │   │   └── search.astro     # Search results
│   │   ├── lib/
│   │   │   ├── api.ts          # Typed API client
│   │   │   └── utils.ts        # cn() utility
│   │   └── styles/
│   │       └── globals.css     # Tailwind v4 + theme tokens
│   ├── astro.config.mjs
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile
├── infra/
│   ├── docker-compose.yml      # Production compose
│   ├── docker-compose.dev.yml  # Dev overrides (hot-reload)
│   ├── caddy/Caddyfile         # Reverse proxy (R2/MinIO/S3 via env var)
│   └── .env.example            # All env vars with examples
├── .env                         # Actual secrets (git-ignored)
├── .gitignore
├── PLAN.md                      # Detailed project plan
├── CLAUDE.md                    # This file
└── README.md
```

## Environment Variables

All config via `.env` file (see `infra/.env.example`). Secrets never in git. Backend `config.py` and bot `config.py` use pydantic-settings with type validation.

Key env vars: `APP_URL`, `S3_ENDPOINT`, `S3_EXTERNAL_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_PROXY_UPSTREAM`, `DATABASE_URL`, `REDIS_URL`, `BOT_TOKEN`, `BOT_WEBHOOK_URL`, `BOT_WEBHOOK_SECRET`, `BOT_ADMIN_IDS`, `MAX_IMAGE_SIZE`, `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID`, `PUBLIC_API_URL`.

### S3 Configuration (Generic)

The S3 layer works with **any** S3-compatible storage. Switch providers by changing env vars only:

| Provider | `S3_ENDPOINT` | `S3_PROXY_UPSTREAM` | `S3_REGION` |
|---|---|---|---|
| Cloudflare R2 | `https://<id>.r2.cloudflarestorage.com` | `https://<id>.r2.cloudflarestorage.com` | `auto` |
| MinIO (dev) | `http://minio:9000` | `http://localhost:9000` | `us-east-1` |
| AWS S3 | `https://s3.<region>.amazonaws.com` | `https://s3.<region>.amazonaws.com` | `<region>` |

- `S3_ENDPOINT`: Internal endpoint for backend uploads (S3 API)
- `S3_PROXY_UPSTREAM`: Caddy proxies `/i/*` to this URL for image serving
- `S3_EXTERNAL_URL`: Public URL prefix for browsers (e.g. `https://domain/i/bucket`)

## Key Constraints

- **6MB image size limit** — HEAD check before download, reject with message if exceeded
- **Pagination, not infinite scroll** — like safebooru, with per-page count selector (20/40/100)
- **gallery-dl as Python library** — not subprocess, use `DownloadJob` API in ThreadPoolExecutor
- **gallery-dl config is global singleton** — set once at startup from env vars, never modify concurrently
- **Pixiv auth requires both** refresh-token AND PHPSESSID cookie
- **Caddy runs on host** — not in Docker Compose, reverse-proxies into Docker internal network
- **S3 is generic** — no provider-specific code; switch via env vars only

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/posts?page=1&per_page=40` | Paginated post list |
| GET | `/api/posts/{id}` | Single post detail |
| GET | `/api/posts/random` | Random post |
| GET | `/api/posts/by-source?source_site=pixiv&source_id=123` | Lookup by source |
| GET | `/api/tags?category=artist&sort=count` | Tag list with filtering |
| GET | `/api/tags/{name}` | Tag detail |
| GET | `/api/tags/autocomplete?q=prefix` | Tag name autocomplete |
| GET | `/api/search?q=tag1+tag2` | Tag-based search (supports `-` exclusion) |
| POST | `/api/tasks/` | Create image processing task |
| POST | `/api/rebuild/` | Purge Caddy cache |
| GET | `/health` | Backend health check |
| GET | `/i/{bucket}/{key}` | S3 image (Caddy direct proxy) |

## Development Commands

```bash
# Start all services (production-like)
docker compose -f infra/docker-compose.yml up -d

# Start all services (development with hot-reload)
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up

# Run backend locally (without Docker)
cd backend && uvicorn app.main:app --reload

# Run bot locally
cd bot && python -m app.main

# Run frontend dev server
cd frontend && npm run dev

# Database migration
cd backend && alembic upgrade head

# Create new migration
cd backend && alembic revision --autogenerate -m "description"

# ARQ worker (process image tasks)
cd backend && arq app.tasks.worker.WorkerSettings
```

## Docker Stages

All Dockerfiles have 3 stages: `dev` (hot-reload), `builder`, and production runner. The `docker-compose.dev.yml` targets the `dev` stage with volume mounts.

## Current Status

**Phase 1-3 code complete.** All core files are in place. Remaining work:

- [ ] `npm install` and test frontend build
- [ ] Database migration `alembic upgrade head` with real PostgreSQL
- [ ] End-to-end test: bot → backend → S3 → frontend
- [ ] Caddy setup on host with real domain + TLS
- [ ] Pixiv credentials in `.env`
- [ ] Phase 4: More extractors, phash dedup refinement, Redis caching, deployment docs

## v1 Lessons Applied

- S3 key normalization + post-upload URL verification
- Multi-stage Dockerfiles with pinned base images
- Stream-based S3 uploads (no memory buffering)
- Unified `BOT_ADMIN_IDS` middleware auth
- phash prefix-bucket indexing for O(1) dedup
- Explicit database indexes in Alembic migrations
- TanStack Query configured correctly from day one
- Caddy Souin cache layer (v1 had SSR but no caching)
- phash NOT exposed in API responses (security)