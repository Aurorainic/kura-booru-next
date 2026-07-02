# Development

## Development Environment

### Prerequisites

- Node.js 22+
- Python 3.12+ (for sidecar)
- Docker + Docker Compose

### Start Dev Server (without Docker)

```bash
cd .
npm install
npm run dev          # Nuxt dev server at http://localhost:3000
```

The sidecar and PostgreSQL/Redis need to be running separately (via Docker or local install).

### Start Dev Compose

```bash
cd infra && docker compose up
```

This starts all 4 containers (nuxt, sidecar, postgres, redis). The nuxt container uses the `dev` Dockerfile stage with hot-reload.

### Environment Variable Validation

```bash
cd infra && ./scripts/validate-env.sh dev    # Check development config (relaxed)
cd infra && ./scripts/validate-env.sh prod   # Check production config (strict)
```

---

## Database

### Running Migrations (Drizzle)

```bash
cd .
npm run db:generate     # Generate migration from schema changes
npm run db:migrate      # Apply migrations
npm run db:push         # Push schema directly (dev only — no migration files)
npm run db:studio       # Open Drizzle Studio (visual DB browser)
```

### Dev → Production Database

The stack connects to the same PostgreSQL as v1. Existing data is reused — no data migration needed. The Drizzle schema matches the existing table structure.

---

## Running Services Locally (without Docker)

```bash
# Nuxt (SSR + API + Bot webhook)
cd . cd . &&cd . && npm run dev

# Python sidecar (gallery-dl + phash)
cd ./sidecar && python sidecar.py
```

PostgreSQL and Redis must be running and accessible via `DATABASE_URL` and `REDIS_URL` env vars.

---

## Docker Stages (Dockerfile)

1. **`deps`** — `npm ci` (cached dependency layer)
2. **`build`** — `npm run build` (Nuxt build → `.output/`)
3. **`dev`** — Hot-reload, volume mounts. Used for development.
4. **`production`** — Minimal image with only `.output/`. `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`.

---

## Key Development Notes

### Nitro Auto-Imports

Everything under `server/utils/` is auto-imported by Nitro. Do NOT add explicit `import` statements for `db`, `redis`, `getIsAdmin`, `enqueueJob`, `serializePost`, etc. Schema tables are auto-imported via `server/utils/schema.ts` re-export.

### Route File Convention

Each HTTP method is a separate file: `index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`. Combined-method files (`.get.post.ts`) are NOT supported and will 404.

### Client-Side Fetch

`fetchApi()` in `app/composables/api.ts` uses string concat + `URLSearchParams` for URL construction. Never use `new URL()` with relative paths — it throws `TypeError: Invalid URL` in the browser.

### useAsyncData Keys

Keys must include route parameters (page, query, perPage) to prevent stale cache hits during client-side navigation. Example: `` `posts-${page}-${perPage}-${rating || 'all'}` ``

### CSS

Tailwind v4 is configured via `@tailwindcss/vite` in `nuxt.config.ts`. Design tokens (colors, spacing, animations) are defined in `assets/css/main.css` using `@theme {}`. Component classes (`.filter-pill`, `.masonry-item`, `.card`, etc.) are defined in the same file.

**Caution**: CSS minifiers may strip `0` from `filter: blur(0)` → `filter: blur()` (invalid). Use `filter: none` instead of `filter: blur(0)` / `filter: brightness(1)`.

---

## Testing & Verification

1. **Bot flow**: Send a Pixiv link → receive "downloading" → receive "saved" → visible on frontend
2. **Web import**: Paste URLs → click import → real-time SSE progress → done summary
3. **Delete flow**: Admin panel click delete → confirm → DB record gone + S3 files deleted + tag count decremented
4. **Auto-rating**: Add rule "nsfw → explicit" → import image with that tag → auto-marked as explicit
5. **AI tag processing**: Set `ENABLE_AI_TAG_PROCESSING=true` → import image → tags auto-classified + translated
6. **Tag visibility**: Anonymous visitors see only tags with safe posts; admin sees all
7. **Pagination**: Switching pages and per-page count works, URLs are shareable
8. **Image loading**: Images load via `/i/{key}` proxy → S3_EXTERNAL_URL
9. **Dedup**: Sending the same image again shows "already exists"
10. **Theme toggle**: 3-state toggle works, system preference auto-matched, no FOUC
11. **Rating visibility**: Anonymous sees only safe; non-safe returns 404; admin sees all
12. **Admin login/logout**: `/login` → homepage shows admin controls → logout → back to normal
13. **Client-side navigation**: Click a post → content loads → click back → content loads (no blank page)
14. **Dashboard load**: Login as admin → `/admin` → see overview cards + breakdowns
15. **Merge tags**: Merge A→B → B.post_count recomputed via COUNT(*)
16. **Settings hot reload**: Change a setting in admin → refresh within 10s → new value visible
17. **Mobile responsive**: Bottom tab bar, touch targets, safe-area insets
