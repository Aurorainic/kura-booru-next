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
| title | title | text, nullable | Artwork title |
| description | description | text, nullable | Artwork description |
| rating | rating | enum, default 'safe' | safe / questionable / explicit |
| created_at | createdAt | timestamp(tz), notNull, defaultNow() | Import timestamp |
| ai_tag_processed_at | aiTagProcessedAt | timestamp(tz), nullable | Last AI classification time |
| ai_tag_status | aiTagStatus | text, default 'pending' | pending / processed / error |

**Indexes**: source(site, id), created_at, rating, phash, title trigram (GIN)

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

---

## Configuration Layering

| Tier | Source | Restart required | Examples |
|---|---|---|---|
| Infrastructure | Environment variables (`.env`) | Yes | `DATABASE_URL`, `REDIS_URL`, `S3_*`, `SECRET_KEY`, `ADMIN_PASSWORD` |
| Site behaviour | `settings` DB table → in-process cache (10s TTL) | No (≤10s hot reload) | `site_title`, `site_description`, `announcement`, `head_inject`, `maintenance_mode` |

The SSR middleware (`01-ssr-context.ts`) caches public settings in-process with a 10s revalidation interval. On cache refresh failure, stale data is kept and the cache backs off for the full TTL — never hammers a dead backend.
