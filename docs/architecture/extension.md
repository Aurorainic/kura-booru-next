# Extension Architecture

Chromium extension providing a one-click import button on Pixiv artwork pages.

## Architecture

- **Manifest V3** (Chromium only, not Firefox)
- **Content script** (`content/content.js`): Injected on `*://www.pixiv.net/artworks/*`, creates a floating button, sends `IMPORT_URL` message to service worker, polls `CHECK_STATUS` for results
- **Service worker** (`background/service-worker.js`): Proxies API calls to the Nuxt server, using `X-Api-Key` header auth. Two message types: `IMPORT_URL` → `POST /api/tasks/`, `CHECK_STATUS` → `GET /api/tasks/{id}`
- **Popup** (`popup/popup.html` + `popup.js`): Settings UI for server URL and API key, stored in `chrome.storage.sync`

## Import Flow

```
[User clicks "导入到 Kura"]
      │
      ▼
[Content script → IMPORT_URL message]
      │
      ▼
[Service worker: POST /api/tasks/ (X-Api-Key)]
      │
      ▼
[Nitro enqueues sidecar job → returns task_id]
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

## Authentication

Uses `BACKEND_API_KEY` (same as Telegram Bot), stored in extension settings. Each API call sends the key via `X-Api-Key` header. If not configured, shows "未配置" error.

## Code Constraints

Content scripts, service worker, and popup scripts must be plain **ES5 JavaScript**:
- No TypeScript, no arrow functions, no template literals, no `const`/`let` (use `var`)
- This is a Chromium MV3 constraint for content scripts

## v0.7.0 Compatibility

The extension is a pure HTTP client — it makes the same API calls as before (`POST /api/tasks/` and `GET /api/tasks/{id}`). The v0.7.0 rewrite did not change these endpoint paths or request/response formats, so **the extension requires zero changes**.
