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
- **Cache-Control**: API responses set headers via middleware — anon gets `public, s-maxage=60`, admin gets `private, no-store`. SSR HTML always `private, no-store`. SSE endpoints set their own `no-cache` which middleware preserves.
- **phash**: Never expose perceptual hash values in API responses (security).
- **Pagination**: Use traditional pagination, not infinite scroll. Per-page selector with 20/40/100 options.
- **Image size**: `MAX_IMAGE_SIZE` env var controls limit (0 = unlimited).
- **Content rating**: Anonymous visitors see only `safe` posts; non-safe returns 404 (existence hidden). Admin login unlocks all. See [docs/architecture.md](docs/architecture.md) for full rating/auth design.
- **Pixiv auth**: Requires both `PIXIV_REFRESH_TOKEN` AND `PIXIV_PHPSESSID` cookie.
- **Caddy**: Runs on the HOST machine, not in Docker Compose. Containers expose ports to localhost.
- **schemas/__init__.py**: Must only import classes that actually exist. Stale imports crash uvicorn at startup.
- **URL patterns**: Centralized in `backend/app/services/url_patterns.py`. Bot mirrors with sync comment at top of `bot/app/handlers/url_handler.py`.
- **Password epoch**: `get_is_admin` now checks Redis-cached `password_changed_at` on every request. If Redis is down, it fail-opens (allows session). Never bypass this check in new auth code.

## Common Pitfalls

- **`admin/posts.astro` thumbnails**: Always use `getThumbUrl(post)`, never hardcode `/i/` paths.
- **`is:inline` scripts in Astro**: Cannot use TypeScript syntax (no `as`, no arrow functions, no template literals). Must be pure ES5 JavaScript.
- **Redis `--requirepass` with empty password**: Breaks docker-compose parsing. Remove the line entirely when password is empty.
- **Huawei SWR**: Does not support Docker BuildKit attestation manifests. Use `--provenance=false --sbom=false`.
- **Cookie deletion**: Must match all attributes (`Secure`, `HttpOnly`, `SameSite`, `Path`) used when setting the cookie, otherwise browsers silently ignore the deletion.
- **Logout race condition**: Use server-side redirect (SSR endpoint `POST /logout`) instead of client-side `fetch()` + `window.location.href`, to ensure cookie is cleared before next page request.

## Changelog

### v0.5.0 (2026-06-24) — 已发布

- [x] 密码修改后 Session 失效（`password_changed_at` 列 + Redis 60s 缓存）
- [x] Chromium 浏览器扩展（Pixiv 作品页导入按钮，API key 认证）
- [x] `GET /api/tasks/{task_id}` 任务状态查询端点
- [x] `_ensure_tags` 并发安全（IntegrityError catch + re-query）
- [x] 项目 Logo（logo.svg → header + favicon）
- [x] 扩展打包 workflow（build-extension.yml）

### v0.4.2 (2026-06-23) — 已发布

- [x] Tag `post_count` 定时同步（ARQ cron，每小时 + 启动时修正漂移）
- [x] `_ensure_tags` 批量查询（N+1 → 3 queries + inserts）
- [x] S3 client 连接池复用（懒缓存 + lifespan shutdown）
- [x] `random_post` 计数缓存（in-process 5min TTL，跳过 COUNT(*)）
- [x] Cache-Control 策略（API: anon=public s-maxage=60, admin=private no-store; HTML: private no-store）

### v0.4.0 (2026-06-22) — 已发布

- [x] AI Retag：新图入库时自动调用 OpenAI 兼容 API 进行 5 类分类 + 中文翻译 + Danbooru 标准命名
- [x] `tag_knowledge` 知识库缓存表，避免重复调用 AI API
- [x] 管理后台标签管理页（列表/编辑/合并/AI 重处理）
- [x] 详情页管理员可添加/移除标签
- [x] Footer AI 胶囊（`ENABLE_AI_TAG_PROCESSING=true` 时显示紫色"AI ✦"徽章）
- [x] 修复标签管理页 `per_page` 变量引用错误导致页面空白
- [x] 修复详情页标签移除按钮定位错误（`<li>` 缺 `relative`）
- [x] 修复 `admin/tags.astro` 误导入不存在的 `getTagCategoryColorClass`
- [x] 横幅"安全"二字使用主题色（绿色）高亮

### v0.4.1 (2026-06-23) — 已发布

- [x] Pixiv 多图帖子只抓第一张（`image-range` + 防御性排序取首）
- [x] 详情页管理员删除按钮（跳转画廊首页）
- [x] 网页端批量导入队列实时更新（SSE `GET /api/tasks/web-import/stream`）
- [x] Caddy `flush_interval -1` 避免 SSE 缓冲
- [x] roadmap 合并重复 SSE 条目，标记已完成功能

### v0.3.0 (2026-06-16) — 已发布

- [x] PG18 + Redis8 迁移（生产部署）
- [x] Bot `_confirmed_posts` Redis SETEX 机制（存活重启，24h TTL）
- [x] phash 去重基础实现
- [x] 单用户场景优化（PG18 io_method + Redis8 activedefrag/HSETEX）
