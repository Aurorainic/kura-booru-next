# Kura Booru Next — AI Coding Guide

> For project architecture, API endpoints, data models, and tech stack, see [docs/architecture.md](docs/architecture.md).
> For deployment and environment variables, see [docs/deployment.md](docs/deployment.md).
> For development setup, see [docs/development.md](docs/development.md).
> For operational procedures, see [docs/operations.md](docs/operations.md).

---

## Code Generation Constraints

- **gallery-dl**: Use as Python library (`DownloadJob` API in `ThreadPoolExecutor`), NOT as subprocess. Config is global singleton — set once at startup from env vars, never modify concurrently.
- **S3 storage**: Generic abstraction layer. No provider-specific code. Switch providers via env vars only.
- **SSR cache**: Do NOT enable Souin/HTTP cache for SSR pages without `Vary: Cookie` + cookie-in-cache-key. Otherwise, admin HTML could leak to anonymous users.
- **phash**: Never expose perceptual hash values in API responses (security).
- **Pagination**: Use traditional pagination, not infinite scroll. Per-page selector with 20/40/100 options.
- **Image size**: `MAX_IMAGE_SIZE` env var controls limit (0 = unlimited).
- **Content rating**: Anonymous visitors see only `safe` posts; non-safe returns 404 (existence hidden). Admin login unlocks all. See [docs/architecture.md](docs/architecture.md) for full rating/auth design.
- **Pixiv auth**: Requires both `PIXIV_REFRESH_TOKEN` AND `PIXIV_PHPSESSID` cookie.
- **Caddy**: Runs on the HOST machine, not in Docker Compose. Containers expose ports to localhost.
- **schemas/__init__.py**: Must only import classes that actually exist. Stale imports crash uvicorn at startup.
- **URL patterns**: Centralized in `backend/app/services/url_patterns.py`. Bot mirrors with sync comment at top of `bot/app/handlers/url_handler.py`.

## Common Pitfalls

- **`admin/posts.astro` thumbnails**: Always use `getThumbUrl(post)`, never hardcode `/i/` paths.
- **`is:inline` scripts in Astro**: Cannot use TypeScript syntax (no `as`, no arrow functions, no template literals). Must be pure ES5 JavaScript.
- **Redis `--requirepass` with empty password**: Breaks docker-compose parsing. Remove the line entirely when password is empty.
- **Huawei SWR**: Does not support Docker BuildKit attestation manifests. Use `--provenance=false --sbom=false`.
- **Cookie deletion**: Must match all attributes (`Secure`, `HttpOnly`, `SameSite`, `Path`) used when setting the cookie, otherwise browsers silently ignore the deletion.
- **Logout race condition**: Use server-side redirect (SSR endpoint `POST /logout`) instead of client-side `fetch()` + `window.location.href`, to ensure cookie is cleared before next page request.

## Changelog

### v0.3.0 (2026-06-16) — 已发布

- [x] PG18 + Redis8 迁移（生产部署）
- [x] Bot `_confirmed_posts` Redis SETEX 机制（存活重启，24h TTL）
- [x] phash 去重基础实现
- [x] 单用户场景优化（PG18 io_method + Redis8 activedefrag/HSETEX）
