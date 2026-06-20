# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3-pre2] - 2026-06-20

### Added
- **`ADMIN_PASSWORD` environment variable** — Configurable password for the initial admin account (created on first startup). If empty, falls back to random password printed in logs.
- **`backend/scripts/reset_admin_password.py`** — Utility script to reset the admin password to the configured `ADMIN_PASSWORD` env var.
- **Astro `allowedHosts` auto-detection** — `astro.config.mjs` now auto-extracts hostname from `APP_URL` when `APP_DOMAIN` is not set, in addition to the existing `APP_DOMAIN` explicit config.

### Changed
- **Footer version label** — Removed redundant "Version" text: now displays just `{gitTag}` (e.g., `v0.1.3-pre2` instead of `Version v0.1.3-pre2`).
- **`infra/.env.example`** — Updated `PUBLIC_S3_EXTERNAL_URL` documentation to clarify it should NOT include `/i/` path segment (images served directly from S3/CDN).
- **`docker-compose.yml`** — Image tags bumped to `v0.1.3-pre2`.

### Fixed
- **Admin backend rating change not working** — `frontend/src/pages/admin/posts.astro` inline `<script is:inline>` contained TypeScript syntax (`as HTMLSelectElement`, arrow functions, template literals) which is NOT compiled by Astro's `is:inline` scripts. Converted to pure ES5 JavaScript. Also added instant visual feedback (rating badge updates immediately in the same row after successful change).
- **`infra/scripts/build.sh`** — Fixed `PROJECT_ROOT` path from `../..` (was one level too shallow, pointing to `infra/`).

### Security
- Admin `PATCH /api/posts/{id}` endpoint returns 403 for unauthenticated requests (verified). Rating changes require valid admin session cookie.

## [0.1.3-pre1] - 2026-06-20

### Added
- **Content rating system** — Posts now have a `safe`/`questionable`/`explicit` rating (aligned with Danbooru). Anonymous visitors only see safe posts; admin login unlocks all ratings.
  - `Rating` enum and `rating` column on `Post` model (Alembic migration 002)
  - Pixiv `x_restrict` and Danbooru `rating` metadata auto-mapped to our Rating enum
  - All list/detail/search endpoints filter by rating for anonymous users
  - `rating:safe`/`rating:q`/`rating:e` search syntax (admin only)
- **Admin authentication** — Single-admin login with signed cookie session
  - `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/status` endpoints
  - `POST /api/auth/change-password` — change password after first login
  - `backend/app/auth.py` — itsdangerous signed cookie + bcrypt password verification
  - Admin credentials stored in `admins` DB table (not env vars)
  - First startup auto-creates a default admin with random password printed to logs
  - `ADMIN_USERNAME` config var (default "admin") for the auto-created admin
  - `ADMIN_SESSION_MAX_AGE` config var retained
- **API key gating** — `POST /api/tasks/` and `POST /api/rebuild/` now require `X-Api-Key` header matching `BACKEND_API_KEY`
  - Bot `backend_api.py` updated to send `X-Api-Key` header automatically
  - `BACKEND_API_KEY` config var added to both backend and bot
- **Danbooru-style tag sidebar** — Post detail page now groups tags by category (Copyright → Character → Artist → General → Meta) with counts, matching Danbooru's left-sidebar layout
- **Rating badge and admin edit** — Posts display a colored rating badge (S/Q/E). Admin users see a dropdown to change rating directly on the detail page.
- **Admin management page** — `/admin/posts` lists all posts (including non-safe) with inline rating change and filter
- **Login page** — `/login` with username/password form
- **Admin mode indicator** — Top banner "🔒 管理模式" visible when logged in
- **Nav bar auth controls** — Login/Logout/Admin links in navigation
- **404 page** — Proper 404 page (fixes redirect to non-existent `/404`)
- **Middleware** — Astro middleware resolves admin session from cookie and injects `isAdmin`/`ssrCookie` into `Astro.locals`
- **Admin `admins` DB table** — Alembic migration 003 adds the `admins` table for database-backed admin credentials
- **Auto-generated admin password** — On first startup, if no admin exists, one is created with a random password printed to server logs (WARNING level). No more `ADMIN_PASSWORD_HASH` env var needed.
- **Change password endpoint** — `POST /api/auth/change-password` for admins to update their password after first login
- **Password change page** — `/admin/password` with current/new/confirm form

### Changed
- **Frontend API client** — `fetchApi` now forwards SSR cookie header to backend for auth; all fetch functions accept `ssrCookie` param
- **PhotoAlbum.astro** — Accepts `isAdmin` prop; shows Q/E rating badges on cards for admin users
- **Post detail** — Redesigned to Danbooru three-column layout (tag sidebar + image + info sidebar) on desktop; mobile shows tags below image
- **BaseLayout** — Reads `Astro.locals.isAdmin` to show admin/logout/login nav items and admin mode banner
- **`.env.example`** — Added `ADMIN_USERNAME`, `ADMIN_SESSION_MAX_AGE`, `BACKEND_API_KEY` sections; removed `ADMIN_PASSWORD_HASH`
- **`validate-env.sh`** — Added `BACKEND_API_KEY` and `ADMIN_SESSION_MAX_AGE` to production required vars; removed `ADMIN_PASSWORD_HASH`

### Removed
- `ADMIN_PASSWORD_HASH` environment variable — admin credentials now stored in `admins` database table
- `backend/scripts/generate_password_hash.py` — no longer needed; passwords are auto-generated on first startup

### Security
- `POST /api/tasks/` and `POST /api/rebuild/` are now gated by `X-Api-Key` (was previously unauthenticated)
- Non-safe posts return 404 to anonymous users (existence hidden, not just 403)
- Admin session cookies are HttpOnly, Secure (in production), SameSite=Lax

## [0.1.2] - 2026-06-19

### Added
- **Tag categorization system** — Tags from Pixiv/Danbooru sources are now properly categorized into artist/character/copyright/general/meta instead of all being "general".
  - `tag_categories` field flows from gallery-dl metadata → Pydantic schema → database storage
  - Danbooru `tag_string_*` fields mapped to our `TagCategory` enum
  - Pixiv `user.name` extracted as artist tag automatically
  - Category upgrade logic: existing "general" tags upgraded when source provides better category
  - Migration script for existing tags: `backend/scripts/recategorize_tags.py`

- **Bot forwarded message support** — Bot now correctly processes forwarded Telegram channel messages containing image URLs.
  - Fixed `AuthMiddleware` to use `chat.id` (forwarding user) instead of `from_user.id` (channel ID) for private chat auth
  - Added `handle_photo_url` handler for forwarded messages with photo + caption URLs
  - Batch processing: multiple recognized URLs processed sequentially with progress updates

- **HTML description rendering** — Pixiv artwork descriptions with HTML (hyperlinks, formatting) now render correctly in the frontend.
  - Backend: `bleach` library sanitizes HTML descriptions (allows safe tags: `<a>`, `<br>`, `<p>`, etc.)
  - Backend: External links automatically get `target="_blank"` + `rel="noopener noreferrer"`
  - Frontend: `set:html` directive renders sanitized HTML instead of escaped text
  - Meta description tags use plain text (HTML stripped)

### Changed
- **Backend requirements**: Added `bleach` for HTML sanitization
- **Bot handler architecture**: `url_handler.py` split into `handle_url_message` (text), `handle_photo_url` (photo+caption), and shared `_handle_urls_from_text()` helper
- **docker-compose.yml**: All services updated to v0.1.2 images

### Fixed
- **AuthMiddleware forwarding bug**: `from_user.id` was channel ID (negative) for forwarded messages, causing auth rejection. Now uses `chat.id` for private chats.
- **Tag categories empty**: All tags were hardcoded as `general`. Now properly categorized from source metadata.
- **HTML description escaped**: Raw HTML rendered as literal text (`<a href="...">`). Now sanitized and rendered as clickable links.

### Security
- HTML descriptions sanitized server-side with `bleach` to prevent XSS
- External links marked with `rel="noopener noreferrer"`

## [0.1.1] - 2025-06-19

### Added
- `infra/scripts/build.sh` — unified Docker image build script that injects version tag into frontend footer.
- `CHANGELOG.md` — version history tracking.

### Changed
- **Frontend version display**: `BaseLayout.astro` footer now reads `PUBLIC_GIT_TAG` from Docker build args instead of hardcoded `"dev"`. ([infra/scripts/build.sh](infra/scripts/build.sh) `--build-arg PUBLIC_GIT_TAG=<version>`)
- **Date display**: "添加时间" on post detail page now uses the **browser's default locale/timezone** (`toLocaleDateString(undefined, ...)`) instead of hardcoded `ja-JP`. Falls back to the browser's system settings.

### Fixed
- Frontend `package.json` version bumped from `0.0.1` → `0.1.1`.
- China build mirrors documented in `CLAUDE.md` (v0.1.1 lessons).
- Redis empty-password `--requirepass` parsing issue documented.
- `schemas/__init__.py` stale import crash documented.
- Caddy `/i/*` S3 proxy configuration notes added.

## [0.1.0] - 2025-06-18

### Added
- Full processing pipeline: Telegram bot → backend API → ARQ worker → gallery-dl → S3 storage.
- Frontend: Astro SSR with Tailwind v4, masonry grid, tag system, search, pagination.
- Bot: URL auto-detection, `/save`, `/info`, `/search` commands.
- Infrastructure: Docker Compose, Caddy reverse proxy, MinIO/R2 S3.
- Perceptual hash (phash) deduplication with prefix-bucket indexing.
- Source extractors for Pixiv, Twitter/X, Danbooru + generic fallback.
- Image pipeline: HEAD size check → download → phash → thumbnail/preview generation → S3 upload.
- Tag system with categories (artist, character, copyright, general, meta).
- `/api/search` with tag inclusion/exclusion (`-tag`) support.
- `/api/tags/autocomplete` for search bar suggestions.
- Caddy Souin cache layer for SSR pages (5-min TTL).

### Changed
- **Architecture decision**: SSR + Caddy cache (NOT SSG), because SSG cannot do incremental rebuilds.
- **Image serving**: Direct from S3/CDN, not proxied through Caddy.
- **S3 abstraction**: Generic S3-compatible layer — switch providers (R2/MinIO/AWS S3) via env vars only, no code changes.

### Security
- phash values never exposed in API responses.
- `BOT_ADMIN_IDS` unified middleware auth for all bot commands.
- Multi-stage Dockerfiles with pinned base images.

### Infrastructure
- Multi-stage Dockerfiles (`dev` / `builder` / `runner`).
- Stream-based S3 uploads (no memory buffering).
- S3 key normalization + post-upload URL verification.
- Explicit database indexes in Alembic migrations.
- Database migration scripts (`migrate-db.sh`, `validate-env.sh`).

