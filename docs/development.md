# Development

## Development Environment

### Start Dev Compose (with MinIO + hot-reload)

```bash
docker compose -f infra/docker-compose.dev.yml up
```

Start and rebuild images:

```bash
docker compose -f infra/docker-compose.dev.yml up --build
```

The dev compose includes MinIO (local S3), volume mounts for hot-reload, and targets the `dev` Dockerfile stage.

### Environment Variable Validation

```bash
cd infra && ./scripts/validate-env.sh dev    # Check development config (relaxed)
cd infra && ./scripts/validate-env.sh prod   # Check production config (strict)
```

---

## Database

### Running Migrations

```bash
cd backend
alembic upgrade head                                 # Apply all pending migrations
alembic revision --autogenerate -m "description"     # Create a new migration
```

### Dev → Production Database Migration

```bash
cd infra && ./scripts/migrate-db.sh --dump-only                     # Export dev database only
cd infra && ./scripts/migrate-db.sh --import-only dumps/xxx.sql     # Import to production only
cd infra && ./scripts/migrate-db.sh                                  # Interactive mode
```

---

## Running Services Locally (without Docker)

```bash
# Backend (API)
cd backend && uvicorn app.main:app --reload

# ARQ Worker (process image tasks)
cd backend && arq app.tasks.worker.WorkerSettings

# Bot
cd bot && python -m app.main

# Frontend dev server
cd frontend && npm run dev
```

---

## Docker Stages

All Dockerfiles have 3 stages:

1. **`dev`** — Hot-reload, volume mounts, debug tools. Used by `docker-compose.dev.yml`.
2. **`builder`** — Installs dependencies, builds frontend assets.
3. **`runner`** — Minimal production image with only runtime dependencies.

---

## Testing & Verification

1. **Bot flow**: Send a Pixiv link → receive "downloading" → receive "saved" → visible on frontend immediately
2. **Web import**: Paste URLs → click import → each URL shows "queued" → visible after ARQ processes
3. **Delete flow**: Admin panel click delete → confirm → DB record gone + S3 files deleted + tag count decremented
4. **Auto-rating**: Add rule "nsfw → explicit" → import image with that tag → auto-marked as explicit
5. **Tag visibility**: Anonymous visitors can't see tags that only belong to non-safe posts; admin sees all
6. **Frontend performance**: Caddy cache hit TTFB < 10ms, list page zero-JS first paint
7. **Pagination**: Switching pages and per-page count works, URLs are shareable
8. **S3 direct**: Images load directly from S3/CDN, not via backend
9. **Size limit**: Oversized images rejected, Bot replies with reason
10. **Dedup**: Sending the same image again shows "already exists"
11. **Theme toggle**: 3-state toggle works, system preference auto-matched
12. **Rating visibility**: Anonymous sees only safe; non-safe returns 404; admin sees all
13. **Admin login/logout**: `/login` → homepage shows "admin mode" → click logout → back to normal
