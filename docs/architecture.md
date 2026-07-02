# Architecture

Navigation index for architecture documentation. Full content in sub-documents below.

---

## Sub-Documents

| Document | Content |
|---|---|
| [overview.md](architecture/overview.md) | Architecture diagram (4-container), tech stack (Nitro/Vue 3/Drizzle/grammy), project structure, core flow |
| [data-model.md](architecture/data-model.md) | Drizzle schema: Posts, Tags, PostTags, TagKnowledge, TagAliases, AutoRatingRules, Settings, Admins. snake_case ↔ camelCase serialization |
| [extension.md](architecture/extension.md) | Browser extension (Manifest V3, content script, service worker), import flow, authentication |
| [decisions.md](architecture/decisions.md) | ADRs: Nitro rewrite, Drizzle over SQLAlchemy, grammy over aiogram, bare Redis queue, HMAC cookie auth |

---

## Quick Reference

### Core Flow

1. User sends link via Telegram Bot
2. Bot handler (grammy, in-process) identifies source site, enqueues job → Redis `LPUSH kura:jobs`
3. Worker container `BRPOP kura:jobs` → gallery-dl download → imagehash phash → `LPUSH kura:results:{id}`
4. Pipeline worker processes result → thumbnails → S3 upload → Drizzle writes Post + Tags → auto-rating
5. Bot displays rating menu to user

### Auth

| Mechanism | Usage |
|---|---|
| Signed cookie (`kura_admin_session`) | Admin web UI |
| X-Api-Key header | Bot webhook + Extension |

### Content Rating

- **safe**: visible to all
- **questionable/explicit**: hidden from anonymous visitors (404, filtered from lists/searches)

### Containers

4 containers: **web** (SSR + API + Bot), **worker** (Python gallery-dl + phash), **postgres** (18), **redis** (8). See `infra/docker-compose.yml`.
