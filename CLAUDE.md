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
│   │   │   ├── auth.py            #   POST /api/auth/login|logout|change-password, GET /api/auth/status
│   │   │   ├── posts.py          #   GET/PATCH/DELETE /api/posts
│   │   │   ├── tags.py           #   GET /api/tags (safe-only counts for non-admin)
│   │   │   ├── search.py         #   GET /api/search?q=tag1+tag2+rating:safe
│   │   │   ├── tasks.py          #   POST /api/tasks/ (X-Api-Key), POST /api/tasks/web-import (admin session)
│   │   │   ├── auto_rating_rules.py # GET/POST/DELETE /api/auto-rating-rules (admin only)
│   │   │   ├── constants.py      #   Shared API constants (ALLOWED_PER_PAGE, clamp_per_page)
│   │   │   └── webhook.py         #   POST /api/rebuild/ (X-Api-Key required)
│   │   ├── auth.py               # Admin auth (signed cookie, bcrypt verify, DB lookup, auto-create default admin)
│   │   ├── models/               # SQLAlchemy models
│   │   │   ├── admin.py           #   Admin model (username, password_hash)
│   │   │   ├── auto_rating_rule.py #  AutoRatingRule model (tag_name → target_rating)
│   │   │   ├── post.py            #   Post model (with Rating enum)
│   │   │   ├── tag.py            #   Tag model (TagCategory enum)
│   │   │   ├── post_tag.py       #   PostTag association
│   │   │   └── tag_alias.py      #   TagAlias model
│   │   ├── schemas/              # Pydantic schemas
│   │   │   ├── post.py           #   PostRead, PostListRead, PostRatingUpdate
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
│   │   └── versions/002_add_rating.py  # Rating enum + posts.rating column
│   │   └── versions/003_add_admin_table.py  # Admins table
│   │   └── versions/004_add_auto_rating_rules.py  # Auto-rating rules table
│   ├── alembic.ini
│   ├── requirements.txt          # + bcrypt, itsdangerous
│   └── Dockerfile                # Multi-stage (dev + prod)
│   └── scripts/
│       └── generate_password_hash.py  # Admin password bcrypt generator
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
│   │   │   ├── PhotoAlbum.astro# Masonry grid (rating badges for admin)
│   │   │   └── SearchBar.tsx   # Tag autocomplete search
│   │   ├── layouts/
│   │   │   └── BaseLayout.astro # Nav + auth controls + theme + footer
│   │   ├── middleware.ts   # SSR cookie forwarding + admin session resolution
│   │   ├── pages/
│   │   │   ├── index.astro      # Home (masonry + pagination + rating filter)
│   │   │   ├── 404.astro        # 404 page
│   │   │   ├── login.astro      # Admin login form
│   │   │   ├── posts/[id].astro # Detail (Danbooru tag sidebar + rating badge + edit)
│   │   │   ├── tags/index.astro # Tag cloud + table
│   │   │   ├── tags/[name].astro# Tag detail (filtered posts)
│   │   │   ├── search.astro     # Search results (+ rating:safe syntax)
│   │   │   └── admin/
│   │   │       ├── posts.astro      # Admin post management (rating filter + inline edit + delete)
│   │   │       ├── auto-rating.astro # Auto-rating rules (add/delete with tag autocomplete)
│   │   │       ├── import.astro      # Batch URL import (textarea + status display)
│   │   │       └── password.astro    # Change password
│   │   ├── lib/
│   │   │   ├── api.ts          # Typed API client + pagination + auto-rating + import helpers
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

## Key env vars: `APP_URL`, `APP_DOMAIN`, `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_SESSION_MAX_AGE`, `BACKEND_API_KEY`, `S3_ENDPOINT`, `S3_EXTERNAL_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_URL`, `BOT_TOKEN`, `BOT_WEBHOOK_URL`, `BOT_WEBHOOK_SECRET`, `BOT_ADMIN_IDS`, `BOT_PORT`, `FRONTEND_URL`, `MAX_IMAGE_SIZE`, `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID`, `PUBLIC_API_URL`, `PUBLIC_S3_EXTERNAL_URL`, `INTERNAL_API_URL`.

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

- **Image size limit** — `MAX_IMAGE_SIZE` env var (0 = no limit, >0 = byte limit). Default is 0 (unlimited).
- **Pagination, not infinite scroll** — like safebooru, with per-page count selector (20/40/100)
- **gallery-dl as Python library** — not subprocess, use `DownloadJob` API in ThreadPoolExecutor
- **gallery-dl config is global singleton** — set once at startup from env vars, never modify concurrently
- **Pixiv auth requires both** refresh-token AND PHPSESSID cookie
- **Caddy runs on host** — not in Docker Compose, reverse-proxies into Docker internal network
- **S3 is generic** — no provider-specific code; switch via env vars only
- **Content rating visibility** — anonymous visitors see only `safe` posts; `questionable`/`explicit` return 404 (existence hidden). Admin login unlocks all ratings.
- **Admin auth is signed cookie** — `itsdangerous` signer with `SECRET_KEY`, `HttpOnly` + `Secure` (prod) + `SameSite=Lax`. No server-side session storage.
- **Bot→backend auth is shared secret** — `BACKEND_API_KEY` env var sent as `X-Api-Key` header. When empty, gating is skipped (dev compat).
- **⚠️ SSR cache constraint** — do NOT enable Souin/HTTP cache for SSR pages without `Vary: Cookie` + cookie-in-cache-key. Otherwise admin HTML leaks to anonymous users.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/posts?page=1&per_page=40&rating=safe` | Paginated post list (admin can filter by rating) |
| GET | `/api/posts/{id}` | Single post detail (404 for non-safe if not admin) |
| GET | `/api/posts/random` | Random post (safe-only for anonymous) |
| GET | `/api/posts/by-source?source_site=pixiv&source_id=123` | Lookup by source |
| PATCH | `/api/posts/{id}` | Update post rating (admin only) |
| DELETE | `/api/posts/{id}` | Delete post (admin only; deletes S3 objects + decrements tag counts) |
| GET | `/api/tags?category=artist&sort=count` | Tag list with filtering (non-admin: safe-only counts, hidden if 0 safe posts) |
| GET | `/api/tags/{name}` | Tag detail (404 for non-admin if 0 safe posts) |
| GET | `/api/tags/autocomplete?q=prefix` | Tag name autocomplete (non-admin: safe-only counts) |
| GET | `/api/search?q=tag1+tag2&rating=safe` | Tag search (supports `-` exclusion, `rating:` syntax for admin) |
| POST | `/api/tasks/` | Create image processing task (requires X-Api-Key) |
| POST | `/api/tasks/web-import` | Batch import images (requires admin session) |
| GET | `/api/auto-rating-rules` | List auto-rating rules (admin only) |
| POST | `/api/auto-rating-rules` | Create auto-rating rule (admin only) |
| DELETE | `/api/auto-rating-rules/{id}` | Delete auto-rating rule (admin only) |
| POST | `/api/rebuild/` | Purge Caddy cache (requires X-Api-Key) |
| POST | `/api/auth/login` | Admin login (username + password → set cookie) |
| POST | `/api/auth/logout` | Admin logout (clear cookie) |
| POST | `/api/auth/change-password` | Change admin password |
| GET | `/api/auth/status` | Check admin session status |
| GET | `/health` | Backend health check |
| GET | `/i/{bucket}/{key}` | S3 image (Caddy direct proxy) |

## Development Commands

```bash
# Start development environment (with MinIO, hot-reload)
docker compose -f infra/docker-compose.dev.yml up

# Start development environment and rebuild images
docker compose -f infra/docker-compose.dev.yml up --build

# Start production environment (requires external S3 like R2/AWS S3)
cd infra && docker compose up -d

# Build production images with version tag
./infra/scripts/build.sh v0.1.1

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

**v0.2.0 released.** Full management panel + auto-rating + web import + visibility hardening on top of the v0.1.x foundation.

### What's Done (v0.1.0 → v0.2.0)
- Full processing pipeline: Telegram bot → backend API → ARQ worker → gallery-dl → S3 storage
- Frontend: Astro SSR with Tailwind v4, masonry grid, tag system, search, pagination
- Bot: URL auto-detection, /save, /info, /search commands
- Infrastructure: Docker Compose, Caddy reverse proxy, MinIO/R2 S3
- Production build: version-tagged Docker images, China mirror support, footer version display
- **Tag categorization** (v0.1.2): Tags from Pixiv/Danbooru properly categorized
- **HTML description rendering** (v0.1.2): Pixiv descriptions with HTML links render correctly
- **Bot forwarded message support** (v0.1.2): Forwarded channel messages with multiple URLs
- **Rating system** (v0.1.3): Posts have safe/questionable/explicit rating; anonymous only see safe
- **Admin authentication** (v0.1.3): Signed cookie sessions, DB-backed admin, change password
- **API key gating** (v0.1.3): Bot↔Backend shared secret via X-Api-Key header
- **Danbooru-style UI** (v0.1.3): Tag sidebar, rating badges, rating filter, rating: syntax
- **Post deletion** (v0.2.0): Admin delete with S3 cleanup + tag count decrement
- **Auto-rating rules** (v0.2.0): Tag→rating mapping; automatic escalation on import
- **Web-based import** (v0.2.0): Batch URL import via admin UI (not just bot)
- **Tag visibility hardening** (v0.2.0): Non-admin users cannot see tags that only belong to non-safe posts
- **Logout redirect** (v0.2.0): Logout now redirects to homepage instead of showing raw JSON
- **Fixed password icon** (v0.2.0): Lock-closed icon instead of wrong tag icon

### Known Limitations
- Tag `post_count` auto-sync (currently needs manual SQL)
- Twitter/Danbooru extractors need refinement
- phash dedup optimization
- No SSE/WebSocket for real-time import progress

## Rating System & Auth Architecture

### Content Rating
- `safe` — 公开：always visible to everyone (like safebooru)
- `questionable` — 敏感：hidden from anonymous visitors; visible to admin
- `explicit` — 限制：hidden from anonymous visitors; visible to admin
- Danbooru metadata auto-populates rating (`rating:s→safe,q→questionable,e→explicit`); Pixiv `x_restrict` mapping is intentionally removed (unreliable, all Pixiv images default to safe)
- All list/search/detail endpoints filter `WHERE rating='safe'` for non-admin callers; non-safe posts return 404 (existence hidden)
- **Tag visibility**: Non-admin users cannot see tags that only belong to non-safe posts. Tag endpoints compute `post_count` via subquery counting only safe posts. Tags with 0 safe posts are completely hidden (404 for detail, filtered from list/autocomplete).
- Admin can change rating via `PATCH /api/posts/{id}` or inline dropdown on admin/posts page
- Admin can delete posts via `DELETE /api/posts/{id}` which also deletes S3 objects and decrements tag post_counts

### Admin Auth
- Admin credentials stored in `admins` DB table (not env vars)
- On first startup, if the `admins` table is empty, a default admin is auto-created with username `ADMIN_USERNAME` (default "admin") and a **randomly generated password printed to the server logs** (WARNING level)
- After first login, admin changes password via `/admin/password` web UI
- Signed cookie (`kura_admin_session`) via `itsdangerous`, max age `ADMIN_SESSION_MAX_AGE` (default 7 days)
- Cookie: HttpOnly, Secure (prod), SameSite=Lax, Path=/
- Frontend Astro middleware reads cookie, verifies with backend `/api/auth/status`, injects `isAdmin` into `Astro.locals`
- SSR pages pass `ssrCookie` to `fetchApi()` so backend can see the admin session
- `POST /api/auth/change-password` allows password change (validates current password first)

### API Key (Bot ↔ Backend)
- `BACKEND_API_KEY` env var shared between bot and backend
- Bot sends `X-Api-Key` header on all backend calls
- Backend `require_api_key` dependency gates `POST /api/tasks/` and `POST /api/rebuild/`
- When `BACKEND_API_KEY` is empty (dev), the check is skipped for backward compatibility

### Web Import (Admin ↔ Backend)
- `POST /api/tasks/web-import` uses admin session auth (not API key)
- Accepts `{ urls: string[] }` and enqueues each URL as a separate ARQ task
- Returns per-URL results with task IDs

### Auto-Rating Rules
- `AutoRatingRule` model maps tag names to target ratings (敏感/限制)
- Admin CRUD at `/api/auto-rating-rules`
- During image processing (`process_image` task), after tags are resolved, rules are checked
- Rules only escalate ratings (限制 > 敏感 > 公开); never de-escalate
- Multiple matching rules: most restrictive wins

### ⚠️ SSR Cache Constraint
- **Do NOT enable Souin/HTTP cache for SSR pages without also adding `Vary: Cookie` and a cache key that includes the admin session cookie.** Otherwise, an admin's logged-in HTML (showing non-safe posts) could be served to anonymous visitors.
- The current Caddyfile has no SSR cache block, so this is not an issue yet. Document this constraint prominently if/when enabling SSR caching.

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

## v0.1.1 Lessons (from production deployment)

### Docker Build in China
- Python base images use `deb.debian.org`, not host's apt source. Add Aliyun mirror replacement in every Dockerfile stage that runs `apt-get`.
- `sed` must handle both `/etc/apt/sources.list` AND `/etc/apt/sources.list.d/debian.sources` (new Debian format).
- `pip install` needs `-i https://mirrors.aliyun.com/pypi/simple/` for PyPI in China.
- `npm ci` needs `npm config set registry https://registry.npmmirror.com` for npmmirror.
- Huawei SWR does NOT support Docker BuildKit attestation manifests. Use `--provenance=false --sbom=false` or `DOCKER_BUILDKIT=0`.

### docker-compose.yml
- Production compose needs `ports: 127.0.0.1:PORT:PORT` bindings — Caddy runs on the HOST, not in Docker, so containers must expose ports to localhost.
- Redis command with empty `${REDIS_PASSWORD:-}` breaks parsing. Remove `--requirepass` line entirely when password is empty.
- `schemas/__init__.py` must only import classes that actually exist — stale `PostCreate`/`TagCreate` imports crash uvicorn at startup.

### Caddy /i/* Image Proxy
- Frontend renders `/i/originals/...`, `/i/thumbs/...`, `/i/previews/...` paths.
- Caddy MUST have a `handle /i/*` block with `uri strip_prefix /i` + `reverse_proxy` to S3/CDN.
- R2 API endpoint (`*.r2.cloudflarestorage.com`) requires S3 auth headers — use the public CDN domain (e.g., `images.your-domain.com`) as upstream instead.
- The template `infra/caddy/Caddyfile` must be copied to `/etc/caddy/Caddyfile` on the host and customized.