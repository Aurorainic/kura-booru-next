# Kura Booru Next — Project Guide

## Overview

Personal anime illustration collection and showcase platform. Core workflow: send a link via Telegram Bot → auto-download original image → store in S3 → browse on web.

Inspired by safebooru (tag system, pagination, fast loading) but with modern UI (Pixiv/Pinterest-like masonry, dark/light/auto theme, cyan gradient accent).

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Bot | aiogram 3.x | Webhook mode |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + ARQ | REST API + task queue |
| Frontend | Astro 5 (SSR) + React 19 | SSR with Caddy caching, NOT SSG |
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
  /bot/*  → bot:8080       (Telegram webhook)

Images → S3/CDN directly (not via Caddy)
  S3_EXTERNAL_URL / PUBLIC_S3_EXTERNAL_URL  (R2/MinIO/AWS S3)
```

**Key decision: SSR + Caddy cache, NOT SSG.** SSG cannot do incremental rebuilds — new images would require full site rebuilds. SSR with 5-min TTL Caddy cache gives near-static performance with instant content visibility.

**Key decision: Images served directly from S3/CDN.** Frontend and API responses use `S3_EXTERNAL_URL` / `PUBLIC_S3_EXTERNAL_URL` pointing directly to S3-compatible storage. This avoids Caddy as a bottleneck and lets CDN caching work naturally. Caddy only serves HTML pages and API responses.

**S3 is generic**: Works with Cloudflare R2, MinIO, AWS S3, or any S3-compatible storage. Switch by changing env vars only. No code changes needed.

## Project Structure

```
kura-booru-next/
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
│   │   │   ├── constants.py      #   Shared API constants (ALLOWED_PER_PAGE, clamp_per_page)
│   │   │   └── webhook.py         #   POST /api/rebuild/ (cache purge)
│   │   ├── models/               # SQLAlchemy models
│   │   │   ├── post.py           #   Post model (SourceSite enum)
│   │   │   ├── tag.py            #   Tag model (TagCategory enum)
│   │   │   ├── post_tag.py       #   PostTag association
│   │   │   └── tag_alias.py      #   TagAlias model
│   │   ├── schemas/              # Pydantic schemas
│   │   │   ├── post.py           #   PostRead, PostListRead
│   │   │   └── tag.py            #   TagRead, TagListRead
│   │   ├── services/             # Business logic
│   │   │   ├── s3.py             #   S3 storage (upload, delete, presigned URL, verify)
│   │   │   ├── pipeline.py       #   Image processing pipeline (HEAD check → download → phash → thumb → S3)
│   │   │   ├── phash.py          #   Perceptual hash with prefix-bucket indexing
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
│   │   ├── config.py            # Bot env vars (including FRONTEND_URL)
│   │   ├── middleware.py        # Auth middleware (admin IDs check)
│   │   ├── handlers/
│   │   │   ├── start.py         #   /start command
│   │   │   ├── url_handler.py   #   Auto-detect URLs + process_url() shared helper
│   │   │   ├── save.py          #   /save <url> command (delegates to process_url)
│   │   │   ├── search.py        #   /search <query> command
│   │   │   ├── info.py          #   /info <url> command (by-source lookup)
│   │   │   └── callback.py      #   Inline keyboard callbacks
│   │   └── services/
│   │       ├── arq_client.py    #   ARQ Redis pool + poll_job_result
│   │       └── backend_api.py   #   HTTP client for backend API
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/         # Astro SSR
│   ├── src/
│   │   ├── components/    # React Islands
│   │   │   ├── ThemeToggle.tsx  # 3-state dark/light/auto toggle
│   │   │   ├── Pagination.tsx  # Page nav + per-page selector (20/40/100)
│   │   │   ├── PhotoAlbum.astro# Masonry grid (pure CSS Grid, SSR)
│   │   │   └── SearchBar.tsx   # Tag autocomplete search
│   │   ├── layouts/
│   │   │   └── BaseLayout.astro # Nav + theme + footer (env-driven gitTag/repoUrl)
│   │   ├── pages/
│   │   │   ├── index.astro      # Home (masonry + pagination)
│   │   │   ├── posts/[id].astro # Detail (full image + tags + source)
│   │   │   ├── tags/index.astro # Tag cloud + table
│   │   │   ├── tags/[name].astro# Tag detail (filtered posts)
│   │   │   └── search.astro     # Search results
│   │   ├── lib/
│   │   │   ├── api.ts          # Typed API client + pagination helpers
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

## Key env vars: `APP_URL`, `APP_DOMAIN`, `SECRET_KEY`, `S3_ENDPOINT`, `S3_EXTERNAL_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_URL`, `BOT_TOKEN`, `BOT_WEBHOOK_URL`, `BOT_WEBHOOK_SECRET`, `BOT_ADMIN_IDS`, `BOT_PORT`, `FRONTEND_URL`, `MAX_IMAGE_SIZE`, `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID`, `PUBLIC_API_URL`, `PUBLIC_S3_EXTERNAL_URL`, `INTERNAL_API_URL`.

### S3 Configuration (Generic)

The S3 layer works with **any** S3-compatible storage. Images are served **directly from S3/CDN** (not via Caddy proxy). Switch providers by changing env vars only:

| Provider | `S3_ENDPOINT` | `S3_EXTERNAL_URL` | `S3_REGION` |
|---|---|---|---|
| Cloudflare R2 | `https://<id>.r2.cloudflarestorage.com` | `https://images.your-domain.com` | `auto` |
| MinIO (dev) | `http://minio:9000` | `http://localhost:9000/kura-booru` | `us-east-1` |
| AWS S3 | `https://s3.<region>.amazonaws.com` | `https://<bucket>.s3.<region>.amazonaws.com` | `<region>` |

- `S3_ENDPOINT`: Internal endpoint for backend uploads (S3 API)
- `S3_EXTERNAL_URL`: Backend public URL prefix (used in API responses)
- `PUBLIC_S3_EXTERNAL_URL`: Frontend public URL prefix (browser → S3/CDN directly)

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
# Start development environment (with MinIO, hot-reload)
docker compose -f infra/docker-compose.dev.yml up

# Start development environment and rebuild images
docker compose -f infra/docker-compose.dev.yml up --build

# Start production environment (requires external S3 like R2/AWS S3)
docker compose -f infra/docker-compose.yml up -d

# Validate environment variables
./infra/scripts/validate-env.sh dev   # Check for development
./infra/scripts/validate-env.sh prod  # Check for production (strict)

# Migrate database from dev to production
./infra/scripts/migrate-db.sh --dump-only                    # Export dev database
./infra/scripts/migrate-db.sh --import-only infra/dumps/xxx.sql  # Import to production

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

**v0.1.0 Released.** Core features complete (bot → worker → S3 → frontend). All P0/P1/P2/P3 audit items resolved.

### What's Done
- Full processing pipeline: Telegram bot → backend API → ARQ worker → gallery-dl → S3 storage
- Frontend: Astro SSR with Tailwind v4, masonry grid, tag system, search, pagination
- Bot: URL auto-detection, /save, /info, /search commands
- Infrastructure: Docker Compose, Caddy reverse proxy, MinIO/R2 S3

### Known Limitations (Phase 4)
- Tag `post_count` auto-sync (currently needs manual SQL)
- Twitter/Danbooru extractors need refinement
- phash dedup optimization
- No admin UI for managing posts/tags

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