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
2. **Web import**: Paste URLs → click import → each URL shows real-time SSE progress (⏳→✅/⚠️/❌) → done summary
3. **Delete flow**: Admin panel click delete → confirm → DB record gone + S3 files deleted + tag count decremented
4. **Auto-rating**: Add rule "nsfw → explicit" → import image with that tag → auto-marked as explicit
5. **AI tag processing**: Set `ENABLE_AI_TAG_PROCESSING=true` → import image → tags auto-classified + translated → visible in tag knowledge cache
6. **Tag visibility**: Anonymous visitors can't see tags that only belong to non-safe posts; admin sees all
7. **Frontend performance**: Caddy cache hit TTFB < 10ms, list page zero-JS first paint
8. **Pagination**: Switching pages and per-page count works, URLs are shareable
9. **S3 direct**: Images load directly from S3/CDN, not via backend
10. **Size limit**: Oversized images rejected, Bot replies with reason
11. **Dedup**: Sending the same image again shows "already exists"
12. **Theme toggle**: 3-state toggle works, system preference auto-matched
13. **Rating visibility**: Anonymous sees only safe; non-safe returns 404; admin sees all
14. **Admin login/logout**: `/login` → homepage shows "admin mode" → click logout → back to normal
15. **Pixiv multi-image**: Multi-image Pixiv post → only first image downloaded and stored
16. **Dashboard load**: Login as admin → visit `/admin` (default = dashboard) → see 4 overview cards + 2 distribution charts + 2 leaderboards; numbers match DB
17. **Sub-tab switching**: Click 图片/标签 etc. → switch back to 概览 → numbers consistent (no duplicate requests)
18. **Empty dashboard**: Empty DB → dashboard still renders (shows 0, no crash)
19. **Anon dashboard access**: `/api/admin/dashboard/` returns 401/403 when not logged in (`get_current_admin` rejects)
20. **Merge — duplicates**: Create tags A and B both linked to the same post → merge A→B → B.post_count unchanged (not +1)
21. **Merge — new**: A links post X, B does not → merge A→B → B.post_count += 1
22. **Merge — mixed**: A links 5 posts (3 already in B + 2 new) → merge A→B → response `posts_moved=2, posts_skipped=3, target_new_post_count = B_old+2`
23. **Merge — self-merge protection**: merge A→A → returns 400
24. **Merge — missing tag**: source_id or target_id nonexistent → returns 404
25. **Merge — atomicity**: kill DB connection mid-merge (`docker kill postgres`) → DB has no残留 data
26. **Tag ID tooltip — display**: hover a tag row cell 200ms → tooltip appears with full UUID
27. **Tag ID tooltip — copy**: click "复制" button → clipboard contains full UUID, button changes to "✓ 已复制"
28. **Tag ID tooltip — fallback**: disable Clipboard API (DevTools) → still copies via textarea fallback
29. **View Transitions**: navigate between pages → smooth SPA-like transitions; footer, announcement banner, ThemeToggle, AccentPicker, mobile menu persist without re-render (transition:persist)
30. **Bot /random**: send `/random` → bot replies with a random post image + link
31. **Bot /stats**: send `/stats` → bot replies with dashboard stats (post count, tag count, etc.)
32. **Settings cache TTL**: change a setting in admin → refresh frontend within 10s → new value visible (frontend middleware TTL 10s, backend Redis TTL 60s)
33. **Mobile responsive**: touch targets ≥ 44px; safe-area insets respected on notched devices; tag overlay works on touch

---

## Browser Extension Development

### Load Unpacked in Dev Mode

1. Generate icons: `pip install cairosvg && python3 -c "import cairosvg; [cairosvg.svg2png(url='logo.svg', write_to=f'extension/icons/icon{s}.png', output_width=s, output_height=s) for s in [16,48,128]]"`
2. Open `chrome://extensions/`, enable Developer mode
3. Click "Load unpacked", select the `extension/` directory
4. Navigate to a Pixiv artwork page to test the import button

### Debugging

- **Content script**: Open DevTools on the Pixiv page → Console/Elements tab. Content script logs appear in the page console.
- **Service worker**: Go to `chrome://extensions/` → click "Inspect views: service worker" under the extension. This opens a dedicated DevTools for the background script.
- **Popup**: Right-click the extension icon → "Inspect popup" to debug popup.html/popup.js.
- **Storage**: In service worker DevTools → Application tab → Chrome Extension Storage to inspect saved settings.

### Extension Code Constraints

Content scripts, service worker, and popup scripts must be plain ES5 JavaScript:
- No TypeScript, no arrow functions, no template literals, no `const`/`let` (use `var`)
- This matches the Astro `is:inline` script constraint in the frontend

### Verification Steps

1. **Import flow**: Click "导入到 Kura" → button shows "导入中..." with spinner → "排队中..." → "处理中..." → "已导入！" (bounce + checkmark)
2. **Duplicate detection**: Import same artwork twice → second attempt shows "重复" (amber pulse)
3. **Error handling**: Enter wrong API key → button shows "API 密钥无效" (shake)
4. **Settings persistence**: Set server URL + API key → close popup → reopen → values persist
5. **Not configured**: Click import without setting server URL → shows "未配置"
