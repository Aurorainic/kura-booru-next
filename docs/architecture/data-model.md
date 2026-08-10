# Data Models

> Schema definitions live in `server/schema/*.ts` (Drizzle ORM). Database columns use snake_case; Drizzle JS properties use camelCase. API responses serialize to snake_case via `serializePost()` / `serializeTag()`.

## Post

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | Auto-generated |
| s3_key | s3Key | text, notNull | S3 original image path |
| thumb_key | thumbKey | text, notNull | S3 thumbnail path |
| preview_key | previewKey | text, notNull | S3 preview path |
| source_url | sourceUrl | text, notNull | Original artwork URL |
| source_site | sourceSite | enum | pixiv / twitter / danbooru / other |
| source_id | sourceId | text, notNull | Artwork ID on source site |
| width | width | integer, notNull | Original pixel width |
| height | height | integer, notNull | Original pixel height |
| file_size | fileSize | integer, notNull | File size in bytes |
| mime_type | mimeType | text, notNull | e.g. image/png |
| phash | phash | text, notNull | Perceptual hash (never exposed in API) |
| lqip | lqip | text, nullable | 20×20 base64 webp blur placeholder, embedded in API response |
| title | title | text, nullable | Artwork title |
| description | description | text, nullable | Artwork description |
| rating | rating | enum, default 'safe' | safe / questionable / explicit |
| series_id | seriesId | uuid, nullable | Multi-image series anchor (v0.7.8 PR-C); NULL = single image |
| page_index | pageIndex | integer, nullable | Page ordinal within the series |
| page_count | pageCount | integer, nullable | Denormalized series page count |
| created_at | createdAt | timestamp(tz), notNull, defaultNow() | Import timestamp |
| ai_tag_processed_at | aiTagProcessedAt | timestamp(tz), nullable | Last AI classification time |
| ai_tag_status | aiTagStatus | text, default 'pending' | pending / processed / error |

**Indexes**: `(source_site, source_id, page_index)` UNIQUE — the dedup key for
both series rows and legacy single-image rows (PG treats NULLs as distinct, so
`page_index IS NULL` rows never collide); `series_id` (series navigation);
`(created_at DESC, id DESC)` (list/search pagination sort); `rating`; `phash`;
`title` trigram (GIN). 多图系列（PostSeries）无独立表，以内嵌的
`series_id` / `page_index` / `page_count` 列表达。

## Tag

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | Auto-generated |
| name | name | text, unique, notNull | Tag name |
| category | category | enum, notNull | artist / character / copyright / general / meta |
| post_count | postCount | integer, default 0 | Denormalized count |
| danbooru_name | danbooruName | text, nullable | Danbooru canonical name |
| translation | translation | text, nullable | Chinese translation |
| ai_processed_at | aiProcessedAt | timestamp(tz), nullable | Last AI classification timestamp |

**Indexes**: name trigram (GIN), translation trigram (GIN), danbooru_name trigram (GIN), post_count

## PostTag (many-to-many)

| DB Column | Drizzle Property | Type |
|---|---|---|
| post_id | postId | UUID (FK → posts.id, CASCADE) |
| tag_id | tagId | UUID (FK → tags.id, CASCADE) |

**Primary key**: composite (post_id, tag_id)

## TagKnowledge

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | |
| name | name | text, unique, notNull | Tag name |
| danbooru_name | danbooruName | text, nullable | Danbooru canonical name |
| type | type | text, notNull | AI-classified category |
| translation | translation | text, nullable | Chinese translation |
| source | source | text, default 'ai' | Knowledge source |
| created_at | createdAt | timestamp(tz), notNull | |
| updated_at | updatedAt | timestamp(tz), notNull | |

## TagAlias

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | |
| alias_name | aliasName | text, unique, notNull | Alias name |
| tag_id | tagId | UUID (FK → tags.id, CASCADE) | Points to canonical tag |

## AutoRatingRule

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | |
| tag_name | tagName | text, unique, notNull | Trigger tag name |
| target_rating | targetRating | enum, notNull | questionable / explicit |
| created_at | createdAt | timestamp(tz), notNull | |

## Setting

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| key | key | text (PK) | Setting identifier |
| value | value | text, default '' | Setting value |
| version | version | integer, default 1 | Auto-incremented on update |
| updated_at | updatedAt | timestamp(tz), notNull | Last update timestamp |

**Public keys**: `site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode`
**Admin-only keys** (never exposed in `/api/settings/public`): `database_url`, `redis_url`

## Admin

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | |
| username | username | text, unique, notNull | Username |
| password_hash | passwordHash | text, notNull | bcrypt hash |
| password_changed_at | passwordChangedAt | timestamp(tz), nullable | Last password change (null = all sessions valid) |
| created_at | createdAt | timestamp(tz), notNull | |

## ExtensionKey (v0.7.8+)

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | |
| name | name | text, notNull | Human-friendly label shown in the admin panel |
| key_hash | keyHash | text, unique, notNull | SHA-256 of the raw key (only the hash is stored) |
| key_prefix | keyPrefix | text, notNull | 12-char visible prefix (`kb_ext_…`) for UI identification |
| created_by | createdBy | text, nullable | Admin username (best-effort audit) |
| can_force_rating | canForceRating | boolean, default false | Opt-in power to bypass auto-rating |
| last_used_at | lastUsedAt | timestamp(tz), nullable | |
| revoked_at | revokedAt | timestamp(tz), nullable | Soft-delete revoke timestamp (audit trail kept) |
| created_at | createdAt | timestamp(tz), notNull | |

## AiProvider (v0.9.0+)

| DB Column | Drizzle Property | Type | Description |
|---|---|---|---|
| id | id | UUID (PK) | |
| name | name | varchar(64), notNull | Provider display name |
| endpoint | endpoint | text, notNull | OpenAI-compatible base URL |
| model | model | varchar(128), notNull | Model name |
| api_key | apiKey | text, notNull | Plaintext in DB (DB is trust boundary); never leaves server unmasked |
| enabled | enabled | boolean, default false | Single-active: enabling one row disables the rest (enforced in the admin API) |
| created_at | createdAt | timestamp(tz), notNull | |
| updated_at | updatedAt | timestamp(tz), notNull | |

> 全局 AI 开关是 settings 键 `ai_tag_processing_enabled`（独立于 provider 的
> enabled 标志）。AI 未配置时 `ai_providers` 表为空，env 变量
> `ENABLE_AI_TAG_PROCESSING` / `AI_PROVIDER_*` 仅作首启 seed 与兜底。

## mv_dashboard_stats (materialized view, v0.10.0)

后台仪表盘读数聚合视图（`drizzle/0008_dashboard_mv_v2.sql`），由 pg-boss
`dashboard-refresh` 定时任务（`server/platform/jobs.ts`，`*/5 * * * *`）执行
`REFRESH MATERIALIZED VIEW CONCURRENTLY`。`source` / `rating` breakdown 以
jsonb 列由 PG 侧聚合，前端零改动。

---

## Configuration Layering

| Tier | Source | Restart required | Examples |
|---|---|---|---|
| Bootstrap | Environment variables (`.env`) | Yes | `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `SESSION_SECRET`, `POSTGRES_*`, `PORT` |
| Business config | `settings` DB table → in-process cache (10s TTL) | No (≤10s hot reload) | `site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode`, `run_mode`, S3 六项, Bot token/代理, Pixiv 凭证, `ai_tag_processing_enabled` |

v0.10.0 起业务配置（S3 / Bot / Pixiv / 站点 / 图片尺寸 / 运行模式）全部迁入
`settings` 表，由后台「设置」页 7 类卡片维护，保存即热刷新生效；`.env` 只保留
启动必需项。`infra/.env.example` 中 `SITE_URL` / `S3_*` / `BOT_*` / `PIXIV_*` /
`MAX_IMAGE_SIZE` 等仅作**首启 seed**（settings 表无记录时导入），之后以 DB 为准。

The SSR middleware (`01-ssr-context.ts`) caches public settings in-process with a 10s revalidation interval. On cache refresh failure, stale data is kept and the cache backs off for the full TTL — never hammers a dead backend.
