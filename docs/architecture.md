# Architecture

## Overview

Kura Booru Next is a personal anime illustration collection and showcase platform. Core workflow: send a link via Telegram Bot → auto-download original image → store in S3 → browse on web. Inspired by safebooru (tag system, pagination, fast loading) but with modern UI (Pixiv/Pinterest-like masonry, dark/light/auto theme, cyan gradient accent).

---

## Architecture Diagram

```
Internet
   │
   ▼
┌──────────────────┐
│  Caddy (宿主机)   │  ← HTTPS termination + cache + reverse proxy
│  + Souin cache    │
└──┬────────┬───────┘
   │        │
   │ /i/*   │ rest
   │        │
   ▼        ▼
 S3-compat  ┌──────────────────────────────────────┐
 storage    │          Docker internal network      │
(R2/MinIO)  │                                      │
            │  ┌──────────┐  ┌──────────┐         │
            │  │ Backend  │  │ Frontend │         │
            │  │ FastAPI  │  │ Astro SSR│         │
            │  │ :8000    │  │ :4321    │         │
            │  └────┬─────┘  └──────────┘         │
            │       │                              │
            │  ┌────▼────┐  ┌───────┐  ┌─────┐   │
            │  │ Bot     │  │ Redis │  │ PG  │   │
            │  │ aiogram │  │ :6379  │  │ 18  │   │
            │  │ :8080   │  └───────┘  └─────┘   │
            │  └────┬────┘                         │
            │       │                              │
            │  ┌────▼────┐  (MinIO only in dev)     │
            │  │ MinIO   │                          │
            │  │ :9000   │                          │
            │  └─────────┘                          │
            └──────────────────────────────────────┘

┌──────────────┐
│  Extension   │  X-Api-Key → POST /api/tasks/ + GET /api/tasks/{id}
│  (Manifest3) │
└──────────────┘
```

---

## Tech Stack

| Layer | Tech | Version | Purpose |
|---|---|---|---|
| **Bot** | aiogram | 3.x | Telegram Bot (webhook mode) |
| **Extension** | Chromium (Manifest V3) | — | Pixiv artwork import button |
| **Backend** | FastAPI | 0.110+ | REST API |
| | SQLAlchemy | 2.0+ (async) | ORM |
| | Alembic | latest | Database migrations |
| | Pydantic | 2.x | Validation + Settings |
| | ARQ | latest | Async task queue (Redis-backed) |
| | Pillow | latest | Thumbnail generation |
| | imagehash | latest | Perceptual hash dedup |
| | gallery-dl | latest | Unified image download engine (Python API) |
| | openai | latest | OpenAI-compatible API client (AI tag classification) |
| | aiobotocore | latest | Async S3 client |
| **Frontend** | Astro | 5.x | **SSR mode** (not SSG) |
| | React | 19.x | Interactive Island components |
| | Tailwind CSS | v4 | Styling |
| **Storage** | S3-compatible | — | Object storage (R2/MinIO/AWS S3) |
| **Database** | PostgreSQL | 18 | Primary data store |
| **Cache/Queue** | Redis | 8.x | ARQ queue + Caddy cache backend |
| **Proxy** | Caddy | 2.x | Host machine, HTTPS + cache + reverse proxy |
| **Deploy** | Docker Compose | v2 | Orchestration |

---

## Key Design Decisions

### SSR + Caddy cache, NOT SSG

| Comparison | SSG (original plan) | SSR + Caddy cache (adopted) |
|---|---|---|
| New image visibility | Wait for rebuild (30s–15min) | Immediately visible |
| Cache-hit performance | ~3ms (static file) | ~5–8ms (Caddy cache) |
| Ops complexity | Needs build pipeline + deploy | Just another Node process |
| Build time vs content growth | O(n), eventually unacceptable | No build step |
| Dynamic pages (search, pagination) | Cannot pre-generate all combos | Naturally supported |
| Perceived difference for personal site | Slightly faster | Virtually no difference |

### Images served directly from S3/CDN

Frontend and API responses use `S3_EXTERNAL_URL` / `PUBLIC_S3_EXTERNAL_URL` pointing directly to S3-compatible storage. Caddy only serves HTML pages and API responses. This avoids Caddy as a bottleneck and lets CDN caching work naturally.

### S3 is generic

Works with Cloudflare R2, MinIO, AWS S3, or any S3-compatible storage. Switch by changing env vars only. No code changes needed.

### Pagination, not infinite scroll

Like safebooru — traditional pagination with per-page count selector (20/40/100). URLs are shareable.

---

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
│   │   │   ├── posts.py          #   GET/PATCH/DELETE /api/posts, PUT /api/posts/{id}/tags
│   │   │   ├── tags.py           #   GET /api/tags (safe-only counts for non-admin)
│   │   │   ├── admin_tags.py     #   GET/PATCH/POST /api/admin/tags (tag management + AI reprocess)
│   │   │   ├── search.py         #   GET /api/search?q=tag1+tag2+rating:safe
│   │   │   ├── tasks.py          #   POST /api/tasks/ (X-Api-Key), POST /api/tasks/web-import (admin session), GET /api/tasks/web-import/stream (SSE)
│   │   │   ├── auto_rating_rules.py # GET/POST/DELETE /api/auto-rating-rules (admin only)
│   │   │   ├── settings.py          # GET/PUT /api/settings, GET /public, POST /test-pg|test-redis
│   │   │   ├── constants.py      #   Shared API constants (ALLOWED_PER_PAGE, clamp_per_page)
│   │   │   └── webhook.py         #   POST /api/rebuild/ (X-Api-Key required)
│   │   ├── auth.py               # Admin auth (signed cookie, bcrypt verify, DB lookup, auto-create default admin)
│   │   ├── models/               # SQLAlchemy models
│   │   │   ├── admin.py           #   Admin model (username, password_hash)
│   │   │   ├── auto_rating_rule.py #  AutoRatingRule model (tag_name → target_rating)
│   │   │   ├── setting.py            #   Setting model (key-value site config)
│   │   │   ├── post.py            #   Post model (with Rating enum)
│   │   │   ├── tag.py            #   Tag model (TagCategory enum, danbooru_name, translation, ai_processed_at)
│   │   │   ├── tag_knowledge.py  #   TagKnowledge model (AI tag knowledge cache)
│   │   │   ├── post_tag.py       #   PostTag association
│   │   │   └── tag_alias.py      #   TagAlias model
│   │   ├── schemas/              # Pydantic schemas
│   │   │   ├── post.py           #   PostRead, PostListRead, PostRatingUpdate
│   │   │   └── tag.py            #   TagRead, TagListRead, TagKnowledgeRead
│   │   ├── services/             # Business logic
│   │   │   ├── s3.py             #   S3 storage (upload, delete, presigned URL, verify)
│   │   │   ├── settings.py      #   Site settings (Redis-cached key-value, connectivity tests, env seed)
│   │   │   ├── pipeline.py       #   Image processing pipeline (HEAD check → download → phash → thumb → S3)
│   │   │   ├── phash.py          #   Perceptual hash with prefix-bucket indexing
│   │   │   ├── ai_tag.py         #   AI tag processing (OpenAI-compatible API, 5-category classification)
│   │   │   ├── tag_knowledge.py  #   Tag knowledge cache (avoid repeated AI API calls)
│   │   │   ├── url_patterns.py   #   Centralized URL regex patterns + source identification
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
│   │   └── versions/             #   001_initial, 002_add_rating, 003_add_admin, 004_add_auto_rating_rules, 005_ai_tag, 006_password_changed_at, 007_add_settings
│   ├── requirements.txt
│   └── Dockerfile                # Multi-stage (dev + builder + runner)
├── bot/              # aiogram 3 Telegram bot
│   ├── app/
│   │   ├── main.py              # Bot entry + aiohttp webhook server
│   │   ├── config.py            # Bot env vars (including FRONTEND_URL)
│   │   ├── middleware.py        # Auth middleware (admin IDs check)
│   │   ├── handlers/
│   │   │   ├── start.py         #   /start command
│   │   │   ├── url_handler.py   #   Auto-detect URLs + process_url() shared helper
│   │   │   ├── search.py        #   /search <query> command
│   │   │   ├── info.py          #   /info <url> command (by-source lookup)
│   │   │   └── callback.py      #   Inline keyboard callbacks
│   │   └── services/
│   │       ├── arq_client.py    #   ARQ Redis pool + poll_job_result
│   │       └── backend_api.py   #   HTTP client for backend API
│   ├── requirements.txt
│   └── Dockerfile
├── extension/        # Chromium extension (Manifest V3)
│   ├── manifest.json          # Extension manifest
│   ├── content/
│   │   ├── content.js         #   Content script (Pixiv page injection)
│   │   └── content.css        #   Button styles + animations
│   ├── background/
│   │   └── service-worker.js  #   API proxy (X-Api-Key auth)
│   ├── popup/
│   │   ├── popup.html         #   Settings UI
│   │   └── popup.js           #   Save config to chrome.storage
│   └── icons/                 #   16/48/128px PNGs (rasterized from logo.svg)
├── frontend/         # Astro SSR
│   ├── src/
│   │   ├── components/    # React Islands
│   │   │   ├── ThemeToggle.tsx  # 3-state dark/light/auto toggle
│   │   │   ├── AccentPicker.tsx # Accent hue picker (Cookie+localStorage, SSR-anti-flash)
│   │   │   ├── Pagination.tsx  # Page nav + per-page selector (20/40/100, Cookie-persisted)
│   │   │   ├── PhotoAlbum.astro# Masonry grid (rating badges for admin)
│   │   │   ├── TagBadge.astro  # Tag with category-colored dot
│   │   │   └── SearchBar.tsx   # Tag autocomplete search
│   │   ├── layouts/
│   │   │   └── BaseLayout.astro # Nav + auth controls + theme + accent + announcement banner + footer
│   │   ├── middleware.ts   # SSR cookie forwarding + admin session resolution + settings cache + maintenance mode redirect
│   │   ├── pages/
│   │   │   ├── index.astro      # Home (masonry + pagination + rating filter)
│   │   │   ├── logout.ts        # SSR logout endpoint (POST → redirect)
│   │   │   ├── 404.astro        # 404 page
│   │   │   ├── maintenance.astro # Maintenance mode notice (shown to non-admins when enabled)
│   │   │   ├── login.astro      # Admin login form
│   │   │   ├── posts/[id].astro # Detail (Danbooru tag sidebar + rating badge + edit)
│   │   │   ├── tags/index.astro # Tag cloud + table
│   │   │   ├── tags/[name].astro# Tag detail (filtered posts)
│   │   │   ├── search.astro     # Search results (+ rating:safe syntax)
│   │   │   └── admin/
│   │   │       ├── index.astro      # Single-page admin panel (sub-tabs: posts/tags/auto-rating/settings/password)
│   │   │       ├── posts.astro      # 301 redirect → /admin?tab=posts
│   │   │       ├── tags.astro       # 301 redirect → /admin?tab=tags
│   │   │       ├── auto-rating.astro # 301 redirect → /admin?tab=auto-rating
│   │   │       ├── import.astro      # Batch URL import (standalone page)
│   │   │       ├── settings.astro    # 301 redirect → /admin?tab=settings
│   │   │       └── password.astro    # 301 redirect → /admin?tab=password
│   ├── astro.config.mjs
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile
├── infra/
│   ├── docker-compose.yml      # Production compose
│   ├── docker-compose.dev.yml  # Dev overrides (hot-reload)
│   ├── caddy/Caddyfile         # Reverse proxy template
│   ├── scripts/
│   │   ├── build.sh            # Docker image build script
│   │   ├── validate-env.sh     # Environment variable validation
│   │   └── migrate-db.sh       # Database migration (dev→prod)
│   └── .env.example            # Environment variable template
└── docs/                       # This documentation directory
```

---

## Data Models

### Post

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| s3_key | String | S3 original image path |
| thumb_key | String | S3 thumbnail path |
| preview_key | String | S3 preview path |
| source_url | String | Original URL |
| source_site | Enum | pixiv / twitter / danbooru / other |
| source_id | String | Artwork ID on source site |
| width / height | Integer | Original dimensions |
| file_size | Integer | File size in bytes |
| mime_type | String | e.g. image/png |
| title | String? | Artwork title |
| description | Text? | Artwork description |
| rating | Enum | safe / questionable / explicit |
| created_at | DateTime | Import timestamp |

### Tag

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| name | String | Tag name (unique) |
| danbooru_name | String? | Danbooru canonical name |
| translation | String? | Chinese translation |
| category | Enum | artist / character / copyright / general / meta |
| post_count | Integer | Denormalized count |
| ai_processed_at | DateTime? | Last AI classification timestamp |

### PostTag (many-to-many)

| Field | Type |
|---|---|
| post_id | UUID (FK, ON DELETE CASCADE) |
| tag_id | UUID (FK, ON DELETE CASCADE) |

### TagKnowledge

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| tag_name | String | Tag name (unique) |
| danbooru_name | String? | Danbooru canonical name |
| translation | String? | Chinese translation |
| category | String | AI-classified category |
| source | String | Knowledge source (ai / manual / danbooru_api) |
| created_at | DateTime | Creation time |

### TagAlias

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| alias_name | String | Alias (unique) |
| tag_id | UUID (FK) | Points to canonical tag |

### AutoRatingRule

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| tag_name | String | Trigger tag name (unique) |
| target_rating | Enum | Target rating (questionable/explicit) |
| created_at | DateTime | Creation time |

### Setting

| Field | Type | Description |
|---|---|---|
| key | String (PK) | Setting identifier (e.g. site_title, database_url) |
| value | Text | Setting value (string, empty string default) |
| updated_at | DateTime(tz) | Last update timestamp (auto-set on change) |

Known keys: `site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode` (public); `database_url`, `redis_url` (admin-only infrastructure).

### Admin

| Field | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| username | String | Username (unique) |
| password_hash | String | bcrypt hash |
| password_changed_at | DateTime? | Timestamp of last password change (null = never changed, all sessions valid) |
| created_at | DateTime | Creation time |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/posts?page=1&per_page=40&rating=safe` | Paginated post list (admin can filter by rating) |
| GET | `/api/posts/{id}` | Single post detail (404 for non-safe if not admin) |
| GET | `/api/posts/random` | Random post (safe-only for anonymous) |
| GET | `/api/posts/by-source?source_site=pixiv&source_id=123` | Lookup by source |
| PATCH | `/api/posts/{id}` | Update post rating (admin only) |
| DELETE | `/api/posts/{id}` | Delete post (admin only; deletes S3 objects + decrements tag counts) |
| PUT | `/api/posts/{id}/tags` | Update post tags (admin only; add/remove tags) |
| GET | `/api/tags?category=artist&sort=count` | Tag list with filtering (non-admin: safe-only counts, hidden if 0) |
| GET | `/api/tags/{name}` | Tag detail (404 for non-admin if 0 safe posts) |
| GET | `/api/tags/autocomplete?q=prefix` | Tag name autocomplete (non-admin: safe-only counts) |
| GET | `/api/search?q=tag1+tag2&rating=safe` | Tag search (supports `-` exclusion, `rating:` syntax for admin) |
| POST | `/api/tasks/` | Create image processing task (requires X-Api-Key; used by Bot and Extension) |
| POST | `/api/tasks/web-import` | Batch import images (requires admin session) |
| GET | `/api/tasks/web-import/stream?task_ids=...` | SSE progress stream for import jobs (admin session) |
| GET | `/api/tasks/{task_id}` | Task status polling (requires X-Api-Key; used by browser extension) |
| GET | `/api/admin/tags` | List all tags with pagination (admin only) |
| PATCH | `/api/admin/tags/{id}` | Update tag (name, category, translation) (admin only) |
| POST | `/api/admin/tags/merge` | Merge tags (admin only) |
| POST | `/api/admin/tags/reprocess` | Re-run AI classification on tags (admin only) |
| GET | `/api/admin/tags/knowledge` | List tag knowledge cache (admin only) |
| GET | `/api/auto-rating-rules` | List auto-rating rules (admin only) |
| POST | `/api/auto-rating-rules` | Create auto-rating rule (admin only) |
| DELETE | `/api/auto-rating-rules/{id}` | Delete auto-rating rule (admin only) |
| GET | `/api/settings/` | List all settings (admin only) |
| PUT | `/api/settings/` | Batch update settings (admin only) |
| GET | `/api/settings/public` | Public settings (no auth; site_title, description, announcement, head_inject, maintenance_mode) |
| POST | `/api/settings/test-pg` | Test PostgreSQL connectivity (admin only) |
| POST | `/api/settings/test-redis` | Test Redis connectivity (admin only) |
| POST | `/api/rebuild/` | Purge Caddy cache (requires X-Api-Key) |
| POST | `/api/auth/login` | Admin login (username + password → set cookie) |
| POST | `/api/auth/logout` | Admin logout (clear cookie) |
| POST | `/api/auth/change-password` | Change admin password |
| GET | `/api/auth/status` | Check admin session status |
| GET | `/health` | Backend health check |

---

## Core Flow: Send Link → Stored

```
[Telegram user sends link]
      │
      ▼
[Bot webhook /bot/webhook]
      │ AuthMiddleware (chat.id ∈ BOT_ADMIN_IDS)
      ▼
[url_handler.handle_url_message]
      │ identify_source (regex) → (site, source_id)
      ▼
[backend_api.create_process_task]
      │ POST /api/tasks/  (X-Api-Key)
      ▼
[FastAPI tasks.create_process_task]
      │ enqueue_process_image → ARQ Redis
      ▼
[ARQ Worker: process_image]
      │
      ├─ source_extractor.extract → gallery_dl.download_from_url
      │       └─ DataJob + DownloadJob (ThreadPoolExecutor)
      ├─ pipeline.download_and_process
      │       ├─ _head_check (Content-Length)
      │       ├─ compute_phash + find_duplicate (prefix bucket)
      │       ├─ _generate_thumbnail (Pillow WebP)
      │       └─ s3_service.upload_bytes × 3 (orig, thumb, preview)
      ├─ _ensure_tags (alias resolve + category upgrade + post_count++)
      ├─ ai_tag.process_tags (if ENABLE_AI_TAG_PROCESSING — 5-category classify + translation + danbooru_name)
      ├─ auto-rating rules check (escalate only)
      └─ db.commit (Post + Tags + PostTag)
      ▼
[Bot _poll_and_notify] (asyncio.create_task)
      │ poll_job_result (timeout=300s)
      ▼
[Bot displays rating menu / countdown auto-confirm]
```

---

## Authentication & Authorization

### Content Rating

- `safe` — Public: always visible to everyone
- `questionable` — Sensitive: hidden from anonymous visitors; visible to admin
- `explicit` — Restricted: hidden from anonymous visitors; visible to admin
- Danbooru metadata auto-populates rating (`rating:s→safe, q→questionable, e→explicit`); Pixiv `x_restrict` mapping is intentionally removed (unreliable, all Pixiv images default to safe)
- All list/search/detail endpoints filter `WHERE rating='safe'` for non-admin callers; non-safe posts return 404 (existence hidden)
- **Tag visibility**: Non-admin users cannot see tags that only belong to non-safe posts. Tag endpoints compute `post_count` via subquery counting only safe posts. Tags with 0 safe posts are completely hidden.

### Admin Auth

- Admin credentials stored in `admins` DB table (not env vars)
- On first startup, if the `admins` table is empty, a default admin is auto-created with username `ADMIN_USERNAME` (default "admin") and a randomly generated password printed to the server logs (WARNING level)
- Signed cookie (`kura_admin_session`) via `itsdangerous`, max age `ADMIN_SESSION_MAX_AGE` (default 7 days)
- Cookie: HttpOnly, Secure (prod), SameSite=Lax, Path=/
- Frontend Astro middleware reads cookie, verifies with backend `/api/auth/status`, injects `isAdmin` into `Astro.locals`
- Logout via SSR endpoint (`POST /logout`) to avoid fetch/navigation race condition

### API Key (Bot ↔ Backend)

- `BACKEND_API_KEY` env var shared between bot and backend
- Bot sends `X-Api-Key` header on all backend calls
- Backend `require_api_key` dependency gates `POST /api/tasks/` and `POST /api/rebuild/`
- When `BACKEND_API_KEY` is empty (dev), the check is skipped

### Web Import (Admin ↔ Backend)

- `POST /api/tasks/web-import` uses admin session auth (not API key)
- Accepts `{ urls: string[] }` (max 50 URLs) and enqueues each URL as a separate ARQ task

### Auto-Rating Rules

- `AutoRatingRule` model maps tag names to target ratings (questionable/explicit)
- Admin CRUD at `/api/auto-rating-rules`
- During image processing, after tags are resolved, rules are checked
- Rules only escalate ratings (explicit > questionable > safe); never de-escalate
- Multiple matching rules: most restrictive wins

### Cache-Control Policy

- **API responses (anonymous)**: `Cache-Control: public, s-maxage=60, max-age=30` — cacheable by shared caches for 60s, browsers for 30s
- **API responses (admin)**: `Cache-Control: private, no-store` — never cached
- **SSR HTML**: `Cache-Control: private, no-store` — never cached at CDN/proxy level (admin content embedded in HTML)
- **SSE streams**: `Cache-Control: no-cache` — set by endpoint, preserved by middleware
- **Hashed static assets**: `Cache-Control: public, max-age=31536000, immutable` — content-hashed, safe to cache forever

Do NOT enable Souin/HTTP cache for SSR pages without `Vary: Cookie` + cookie-in-cache-key. Otherwise, an admin's logged-in HTML (showing non-safe posts) could be served to anonymous visitors.

---

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and usage instructions |
| `/save <url>` | Save an image |
| `/search <tags>` | Search posts |
| `/info <url>` | View post details by source URL |
| Send URL directly | Auto-detect and save |

Supports Pixiv, Twitter/X, Danbooru links. Unknown URLs fall back to generic download.

---

## Browser Extension

Chromium 扩展提供 Pixiv 作品页一键导入按钮。

### Architecture

- **Manifest V3** (Chromium, 不支持 Firefox)
- **Content script** (`content/content.js`): 注入于 `*://www.pixiv.net/artworks/*`，创建浮动按钮，发送 `IMPORT_URL` 消息给 service worker，轮询 `CHECK_STATUS` 获取结果
- **Service worker** (`background/service-worker.js`): 代理 API 调用，使用 `X-Api-Key` 认证。两种消息：`IMPORT_URL` → `POST /api/tasks/`，`CHECK_STATUS` → `GET /api/tasks/{id}`
- **Popup** (`popup/popup.html` + `popup.js`): 设置界面，配置服务器地址和 API 密钥，存储于 `chrome.storage.sync`

### Import Flow

```
[用户点击「导入到 Kura」]
      │
      ▼
[Content script → IMPORT_URL message]
      │
      ▼
[Service worker: POST /api/tasks/ (X-Api-Key)]
      │
      ▼
[Backend 入队 ARQ task → 返回 task_id]
      │
      ▼
[Content script 轮询: CHECK_STATUS 每 2s]
      │
      ▼
[Service worker: GET /api/tasks/{id}]
      │
      ├─ queued / in_progress → 继续轮询 (spinner 动画)
      ├─ complete + success   → 「已导入！」(绿色弹跳+勾号)
      ├─ complete + duplicate → 「重复」(琥珀色脉冲)
      ├─ complete + too_large → 「图片过大」(红色抖动)
      └─ not_found            → 「任务丢失」(红色抖动)
```

### Authentication

使用 `BACKEND_API_KEY`（与 Telegram Bot 相同），存储于扩展设置中。每次 API 调用通过 `X-Api-Key` header 发送。未配置时显示「未配置」错误。

---

## Admin Pages

| Page | Path | Features |
|---|---|---|
| Post management | `/admin/posts` | All posts (including Q/E), rating filter, inline rating change, delete |
| Tag management | `/admin/tags` | Tag list, edit, merge, AI reprocess, knowledge cache |
| Auto-rating rules | `/admin/auto-rating` | Rule list, add rule (with tag autocomplete), delete rule |
| Import images | `/admin/import` | Textarea for URLs (one per line), real-time SSE progress display |
| Change password | `/admin/password` | Current + new + confirm |

---

## Frontend Design

### Pagination
- Traditional pagination at page bottom: `< 1 2 3 ... 50 >`
- Per-page selector in corner: `20 | 40 | 100` (default 40)
- Switching per-page count navigates to page 1

### Layout
- **Home**: Masonry grid + pagination + per-page selector + rating filter (admin)
- **Tags**: Tag cloud (category-colored) + popular tag list + pagination
- **Detail**: Large image + sidebar tag list + source link + adjacent navigation
- **Search**: Search bar + tag autocomplete + result pagination

### Visual Style
- **Palette**: Light cyan (#7DD3C0) → mint (#A7F3D0) → sky blue (#BAE6FD) gradient
- **3-state theme**: auto / dark / light toggle
- **Cards**: Rounded corners + soft shadows + hover lift + tag preview on hover
- **Progressive image loading**: blur placeholder → thumbnail → preview → click for original
- **Responsive**: 2 cols mobile, 3 cols tablet, 4–5 cols desktop

---

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
