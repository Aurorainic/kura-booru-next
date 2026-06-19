# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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

