# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-06-23

### Changed
- **`_ensure_tags` batch query** — Replace N+1 loop (2-3 SELECTs per tag) with 3 batch queries (alias + tag + canonical lookup). 30 tags: 60→3 queries.
- **S3 client reuse** — Lazy-cached S3 client replaces per-operation client creation. Single client reused across uploads/verifications. Registered shutdown cleanup in lifespan.
- **`random_post` count cache** — In-process 5-min TTL cache skips COUNT(*) on repeated random requests.

### Added
- **Tag `post_count` auto-sync** — ARQ cron job (hourly + run_at_startup) recalculates `post_count` from `post_tags`, fixing drift from +=1/-=1 accumulation.
- **Cache-Control headers** — API middleware: anonymous responses `public, s-maxage=60`, admin responses `private, no-store`. SSE endpoints preserve their own `no-cache`. SSR HTML always `private, no-store`.

## [0.4.1] - 2026-06-23

### Added
- **Pixiv 多图帖子只抓第一张** — gallery-dl `image-range` 配置 `"1-1"`，仅下载 Pixiv 多图帖的第一张图。防御性加固：`_download_sync` 文件读取改为排序取首，双重保险。
- **详情页管理员删除按钮** — 右侧 info sidebar 添加红色「删除作品」按钮（仅管理员可见），删除后跳转画廊首页 `/`。
- **网页端批量导入队列实时更新（SSE）** — `GET /api/tasks/web-import/stream` 端点，复用 ARQ 轮询模型，实时推送每个 job 的完成状态（success / duplicate / too_large / failed）+ 最终汇总。前端 `import.astro` 使用 `EventSource` 实时更新每行状态。
- **Caddy `flush_interval -1`** — `/api/*` reverse_proxy 块新增 `flush_interval -1`，确保 SSE 流不被 Caddy 缓冲。

### Changed
- **import.astro 实时视图** — 从「已入队 ✓ / 失败 ✗」静态显示改为 SSE 实时进度：⏳ 处理中 → ✅/⚠️/❌ 完成状态，done 事件显示汇总。
- **roadmap.md** — 合并重复的 SSE/WebSocket 条目，标记已完成功能。

## [0.4.0] - 2026-06-22

### Added
- **AI Retag** — 新图入库时自动调用 OpenAI 兼容 API（DeepSeek 等）对标签进行 5 类分类（artist / character / copyright / general / meta）+ 中文翻译 + Danbooru 标准命名。结果缓存到 `tag_knowledge` 表，避免重复调用。由 `ENABLE_AI_TAG_PROCESSING` + `AI_PROVIDER_*` 环境变量控制。
- **`tag_knowledge` 知识库表** — 作为 AI 结果的 truth source，`Tag` 表的分类/翻译字段成为冗余副本。支持 `ai` / `manual` / `danbooru_import` / `danbooru_api` 四种 source。
- **管理后台标签管理页** (`/admin/tags`) — 列表/筛选/搜索、行内编辑分类与翻译、标签合并、触发 AI 重处理（仅未处理 / 全部强制重处理）。
- **详情页管理员标签编辑** — 左侧标签栏每行 hover 显示红色 ✕ 移除按钮，底部输入框可添加新标签。
- **Footer AI 胶囊** — 当 `ENABLE_AI_TAG_PROCESSING=true` 时，左下角版本号胶囊旁额外显示紫色白字"AI ✦"胶囊。Footer 改为 `flex-wrap`，移动端拥挤时右下角"个人动漫插画收藏"自动换行。
- **横幅"安全"二字高亮** — 非管理员横幅中"安全"使用站点主题色（`var(--accent-color)`，绿色）显示。

### Fixed
- **标签管理页空白** — `admin/tags.astro` frontmatter 中 `fetchAdminTags` 调用误用 `per_page`（下划线变量名不存在），实际变量是 `perPage`（驼峰）。`ReferenceError` 被静默 `try/catch` 吞掉，页面渲染"共 0 个标签"。改为 `per_page: perPage`。
- **详情页标签移除按钮定位错误** — `<li>` 缺少 `relative`，导致 `absolute` 按钮相对外层 `.card`（sticky 算 positioned）定位，所有 ✕ 都叠在标签卡片右上角同一位置，只对应最后一条标签。给 `<li>` 加 `relative`，按钮改为 `top-1/2 -translate-y-1/2` 垂直居中。
- **`admin/tags.astro` 误导入不存在的 `getTagCategoryColorClass`** — `api.ts` 只导出 `getTagCategoryColor`。删除未使用的导入。

### Changed
- **数据库迁移 005** — `tags` 表新增 `danbooru_name` / `translation` / `ai_processed_at` 三列；`posts` 表新增 `ai_tag_processed_at` / `ai_tag_status` 两列（当前为死字段，预留）；新建 `tag_knowledge` 表。
- **Docker 镜像标签** — 从 `v0.4.0-dev` 升级为 `v0.4.0`。
- **Footer 布局** — `flex` 改为 `flex-wrap` + `gap-y-2`，左侧胶囊组改为 `inline-flex items-center gap-2`。

## [0.2.3] - 2026-06-21

### Fixed
- **Logout not actually clearing session** — Replaced client-side `fetch()` logout with a server-side Astro endpoint (`POST /logout`). The previous approach had a race condition: the browser navigated to `/` before the `Set-Cookie` header from the logout response was applied, leaving the old session cookie alive. The new SSR endpoint forwards the cookie to the backend, injects the `Set-Cookie` deletion into a 302 redirect, and the browser processes it as a native navigation — guaranteeing the cookie is cleared before the next page request.
- **Admin posts page thumbnails broken with direct S3/CDN** — `admin/posts.astro` was using hardcoded `/i/{thumb_key}` paths instead of the `getThumbUrl()` helper. When `PUBLIC_S3_EXTERNAL_URL` points to R2/CDN directly (not via Caddy `/i/*` proxy), all admin list thumbnails returned 404.
- **Duplicate `<script define:vars>` block in auto-rating page** — Removed the second identical `TAG_NAMES` injection block (copy-paste leftover).
- **Dead `meta[name="api-base"]` query in post detail** — The rating editor script queried a `<meta>` tag that doesn't exist in the template. Replaced with a direct `'/api'` constant.
- **`image_urls` not deduplicated in process_image** — gallery-dl's infojson branch could append duplicate URLs, causing unnecessary download retries. Added `list(dict.fromkeys(...))` dedup.

### Changed
- **Logout button is now a form POST** — The "退出登录" button changed from a JS `fetch()` + `window.location.href` to a native `<form action="/logout" method="post">`, eliminating the cookie/navigation race condition entirely.
- **Frontend version** bumped to `0.2.3`.

## [0.2.2] - 2026-06-21

### Added
- **Bot rating selection countdown** — 10-second countdown timer displayed in the rating prompt message (`⏳ 等待评级 (Ns)`). If the user doesn't select a rating within 10 seconds, the system auto-confirms:
  - With auto-rating rules: uses the rule-suggested rating, labeled `（自动规则）`
  - Without auto-rating rules: defaults to safe, labeled `（默认）`
- **Auto-rating hint in Bot** — When auto-rating rules match a post's tags, the Bot shows `建议评级: 🟡 敏感（自动规则）` alongside the rating buttons, so the admin knows the system's suggestion before choosing.
- **`auto_rating` field in task result** — ARQ `process_image` task now returns `auto_rating` (the rule-suggested rating or `null`) so the Bot can display the hint and use it for countdown auto-confirm.

### Changed
- **Rating prompt text** — Changed from `✅ 处理完成` to `⏳ 等待评级 / Awaiting rating` when showing the rating selection menu. `✅ 处理完成` now only appears after the user confirms a rating (or auto-confirm fires).
- **Auto-confirm timeout** — Reduced from 5 minutes to 10 seconds. The original 5-minute timeout was too long for a simple 3-button choice.
- **Manual rating overrides auto-rating** — When the user manually selects a rating, it always takes final priority, even if it's less restrictive than the auto-rating rule suggestion. The backend `PATCH /api/posts/{id}` applies the user's choice directly.
- **Auto-confirm message format** — Now shows `评级: 🟢 公开（默认）` or `评级: 🟡 敏感（自动规则）` for consistency with manual confirmation format.

### Fixed
- **Logout not working on HTTPS** — `clear_session_cookie` was missing `secure` and `httponly` parameters, causing browsers to silently ignore the cookie deletion directive when the site uses HTTPS. The delete must match all attributes (`Secure`, `HttpOnly`, `SameSite`, `Path`) used when setting the cookie.

## [0.2.1] - 2026-06-21

### Added
- **Bot rating selection menu** — After image processing completes, the Bot now shows inline keyboard buttons (🟢 公开 / 🟡 敏感 / 🔴 限制) for the admin to choose the post's rating, instead of auto-linking with the source-extracted rating. This gives admins direct control over content classification.

### Changed
- **Rating label rename** — Rating display labels updated for consistency across the UI.
- **Pixiv mapping removal** — Pixiv `x_restrict` field no longer auto-maps to rating (unreliable indicator); all Pixiv images now default to `safe` and must be manually escalated.
- **Masonry layout** — Improved masonry grid rendering on the frontend.
- **WebP thumbnails** — Thumbnails now generated in WebP format for smaller file sizes.
- **Admin dropdown** — Admin navigation consolidated into a dropdown menu in the top bar.
- **File limit removal** — `MAX_IMAGE_SIZE` default changed to 0 (unlimited).
- **SSR cookie fix** — Frontend middleware correctly forwards admin session cookie on SSR requests.

## [0.2.0] - 2026-06-20

### Added
- **Post deletion** — Admin can delete posts from the management page. Deletes the database record (cascade to post_tags), removes all S3 objects (original, thumb, preview), and decrements tag post_counts.
  - `DELETE /api/posts/{id}` endpoint (admin only, requires full admin session)
  - Trash icon button in `/admin/posts` table with confirmation dialog
  - Tag `post_count` decremented atomically with `GREATEST(post_count - 1, 0)` to prevent negative counts
- **Tag-based auto-rating rules** — Automatically escalate post ratings when specific tags are present.
  - `AutoRatingRule` model — maps tag name → target rating (questionable/explicit)
  - `GET / POST / DELETE /api/auto-rating-rules` — CRUD endpoints (admin only)
  - `process_image` task checks rules after tag resolution; only escalates (never de-escalates) the source-extracted rating
  - `/admin/auto-rating` — Admin page to manage rules with tag autocomplete and inline delete
  - Alembic migration 004 — `auto_rating_rules` table (reuses existing `rating_enum`)
- **Web-based image import** — Batch import images via admin UI (previously bot-only).
  - `POST /api/tasks/web-import` — Admin session auth (not API key), enqueues each URL as ARQ task
  - `/admin/import` — Textarea for URLs (one per line), per-URL status display (queued ✓ / error ✗)
  - Nav bar "导入" icon link for admin users
- **Admin nav expansion** — Navigation bar now shows icons for: 管理, 自动评级规则, 导入图片, 修改密码, 退出

### Changed
- **Logout redirects to homepage** — Logout button now uses JS `fetch()` instead of form POST, redirecting to `/` after clearing the session cookie. No more raw `{"ok":true}` JSON page.
- **Password change icon** — Replaced incorrect "tag" SVG icon with HeroIcons "lock-closed" outline icon.

### Fixed
- **Tag visibility leak for non-safe posts** — Anonymous users could previously see tag names, categories, and `post_count` that included non-safe posts, allowing inference of hidden content. Now:
  - Tag `post_count` for anonymous users is computed dynamically via subquery, counting only safe-rated posts
  - Tags with zero safe posts are completely hidden from tag lists, tag cloud, and autocomplete
  - Single tag detail returns 404 for anonymous users if the tag has zero safe posts
  - Admin users see the full denormalized `post_count` as before
  - Added `is_admin: bool = Depends(get_is_admin)` to all three tag endpoints

### Security
- Tag endpoints now respect admin/non-admin visibility boundary, consistent with post endpoints
- Auto-rating rules only escalate ratings (never de-escalate), preventing accidental public exposure of NSFW content

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

## [0.1.1] - 2026-06-19

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

## [0.1.0] - 2026-06-18

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
