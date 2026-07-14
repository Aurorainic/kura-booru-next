# Extension Architecture

Chromium extension providing a one-click import button on Pixiv artwork pages.

## Architecture

- **Manifest V3** (Chromium only, not Firefox)
- **Content script** (`content/content.js`): Injected on `*://www.pixiv.net/artworks/*`, creates a floating button, sends `IMPORT_URL` message to service worker, polls `CHECK_STATUS` for results
- **Service worker** (`background/service-worker.js`): Proxies API calls to the Nuxt server, using `X-Api-Key` header auth (kb_ext_ prefix). Two message types: `IMPORT_URL` → `POST /api/tasks/web-import`, `CHECK_STATUS` → `GET /api/tasks/{id}`
- **Popup** (`popup/popup.html` + `popup.js`): Settings UI for server URL, API key, and content-rating override (`auto` / `safe` / `questionable` / `explicit`). Persisted in `chrome.storage.sync`.

## Import Flow

```
[User clicks "导入到 Kura"]
      │
      ▼
[Content script → IMPORT_URL message]
      │
      ▼
[Service worker: POST /api/tasks/web-import (X-Api-Key)]
      │   body: { urls: [url], force_rating?: "safe" | "questionable" | "explicit" }
      │
      ▼
[Nitro enqueues sidecar job → returns { results: [{ task_id, status, url }] }]
      │
      ▼
[Content script polls: CHECK_STATUS every 2s]
      │
      ▼
[Service worker: GET /api/tasks/{id}]
      │
      ├─ queued / in_progress → continue polling (spinner animation)
      ├─ complete + success   → "已导入！" (green bounce + checkmark)
      ├─ complete + duplicate → "重复" (amber pulse)
      ├─ complete + too_large → "图片过大" (red shake)
      └─ not_found            → "任务丢失" (red shake)
```

## Authentication (v0.7.8+)

**Per-admin API keys**, generated from the admin web UI (`/admin?tab=extension`).
Each key has format `kb_ext_` + 32 base62 chars. Server stores only the SHA-256
hash plus a 12-char visible prefix for UI identification.

Distinct from `BACKEND_API_KEY` (which is service-level, shared with the Telegram
bot). Each extension user gets their own key; revoking one does not affect
others. Rate limit: 60 imports/minute per key.

### How to issue a new key

1. Sign in to Kura Booru as admin
2. Go to `/admin?tab=extension`
3. Enter a friendly name (e.g. "Lainsaka Chrome 笔记本")
4. Click 生成 — copy the raw key value (shown ONCE, never recoverable)
5. Paste into the extension popup

### How to revoke a key

1. Sign in as admin
2. Go to `/admin?tab=extension`
3. Click 吊销 next to the key — sets `revoked_at` (soft delete, audit trail kept)

## Code Constraints

Content scripts, service worker, and popup scripts must be plain **ES5 JavaScript**:
- No TypeScript, no arrow functions, no template literals, no `const`/`let` (use `var`)
- This is a Chromium MV3 constraint for content scripts

## v0.7.8 Compatibility

**Breaking change**: extension must use the new `/api/tasks/web-import` endpoint
with `{ urls: [...] }` payload format. Old `/api/tasks/` endpoint no longer
exposed for extension auth. Upgrade the extension alongside the server.