# Deployment

## Prerequisites

- Docker + Docker Compose v2
- Caddy 2.x (on host machine, with Souin cache plugin optional)
- S3-compatible storage (Cloudflare R2 / MinIO / AWS S3)

---

## Environment Variables

All configuration is via `.env` file. Copy and edit the template:

```bash
cp infra/.env.example .env
```

For the complete list of all variables with descriptions and defaults, see [`infra/.env.example`](../infra/.env.example).

### Production-Required Variables

| Variable | Description |
|---|---|
| `APP_URL` / `APP_DOMAIN` | Your domain (e.g., `https://kura-booru.example.com`) |
| `SECRET_KEY` | Generate with: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `POSTGRES_PASSWORD` | Database password |
| `S3_ENDPOINT` / `S3_EXTERNAL_URL` | S3 storage endpoint (see S3 Configuration below) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3 credentials |
| `BOT_TOKEN` | Telegram Bot Token (from @BotFather) |
| `BOT_WEBHOOK_URL` | `https://<domain>/bot/webhook` |
| `BOT_WEBHOOK_SECRET` | Webhook verification secret |
| `BOT_ADMIN_IDS` | Comma-separated Telegram user IDs allowed to use the bot |

### Environment Variable Categories

| Category | Key Variables |
|---|---|
| Application | `APP_URL`, `APP_DOMAIN` (Caddy/Astro only, not read by backend) |
| Secret | `SECRET_KEY` |
| Admin Auth | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_MAX_AGE`, `BACKEND_API_KEY` |
| S3 Storage | `S3_ENDPOINT`, `S3_EXTERNAL_URL`, `PUBLIC_S3_EXTERNAL_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION` |
| Database | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Redis | `REDIS_URL` (password included in URL if needed; `REDIS_PASSWORD` alone is unused by code) |
| AI Tag Processing | `ENABLE_AI_TAG_PROCESSING`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_ENDPOINT`, `AI_PROVIDER_MODEL` |
| Bot | `BOT_TOKEN`, `BOT_WEBHOOK_URL`, `BOT_WEBHOOK_SECRET`, `BOT_ADMIN_IDS`, `BOT_PORT`, `FRONTEND_URL` |
| Image Processing | `MAX_IMAGE_SIZE`, `THUMB_SIZE`, `PREVIEW_SIZE` |
| gallery-dl Auth | `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID` |
| Frontend | `PUBLIC_GIT_TAG`, `PUBLIC_API_URL`, `PUBLIC_S3_EXTERNAL_URL`, `INTERNAL_API_URL` |
| Caddy (host-side) | `BACKEND_HOST`, `BACKEND_PORT`, `BOT_HOST`, `BOT_PORT`, `FRONTEND_HOST`, `FRONTEND_PORT`, `S3_PROXY_UPSTREAM` |
| Migration | `DEV_PG_CONTAINER`, `PROD_DATABASE_URL` |

### Validate Environment

```bash
cd infra && ./scripts/validate-env.sh prod   # Strict: all production-required vars must be set
cd infra && ./scripts/validate-env.sh dev    # Relaxed: warns but doesn't fail
```

---

## S3 Configuration

The S3 layer works with **any** S3-compatible storage. Images are served **directly from S3/CDN** (not via Caddy proxy). Switch providers by changing env vars only — no code changes needed.

| Variable | Cloudflare R2 (Production) | MinIO (Development) | AWS S3 |
|---|---|---|---|
| `S3_ENDPOINT` | `https://<id>.r2.cloudflarestorage.com` | `http://minio:9000` | `https://s3.<region>.amazonaws.com` |
| `S3_EXTERNAL_URL` | `https://images.your-domain.com` | `http://localhost:9000/kura-booru` | `https://<bucket>.s3.<region>.amazonaws.com` |
| `S3_REGION` | `auto` | `us-east-1` | `<region>` |

- `S3_ENDPOINT`: Internal endpoint for backend uploads (S3 API)
- `S3_EXTERNAL_URL`: Backend public URL prefix (used in API responses)
- `PUBLIC_S3_EXTERNAL_URL`: Frontend public URL prefix (browser → S3/CDN directly)

---

## Deployment Steps

### 1. Configure Environment Variables

```bash
cp infra/.env.example .env
# Edit .env and fill in real values
```

### 2. Start Services

```bash
cd infra && docker compose up -d
```

Production compose requires external S3 (R2/AWS S3). For development with MinIO, use the dev compose override (see [development.md](development.md)).

### 3. Initialize Database

```bash
cd infra && docker compose exec backend alembic upgrade head
```

### 4. Configure Caddy

Deploy the Caddyfile template to the host machine:

```bash
cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

The Caddyfile uses `{$VAR}` syntax for environment variable substitution. Key variables:
- `{$APP_DOMAIN}` — your domain
- `{$BACKEND_HOST}:{$BACKEND_PORT}` — backend address
- `{$BOT_HOST}:{$BOT_PORT}` — bot address
- `{$FRONTEND_HOST}:{$FRONTEND_PORT}` — frontend address

**Important**: The Caddyfile is a template — replace `{APP_DOMAIN}` and the S3 upstream URL with your actual values before deploying.

### 5. Set Telegram Webhook

The bot automatically sets the webhook on startup. Ensure `BOT_WEBHOOK_URL` points to your domain: `https://<domain>/bot/webhook`.

### 6. First Admin Login

On first startup, the system auto-creates a default admin account. The randomly-generated password is printed to server logs:

```bash
docker compose logs backend | grep "DEFAULT ADMIN CREATED"
```

After logging in at `/login`, change the password at `/admin/password`.

---

## Production Docker Compose Notes

- Port bindings use `127.0.0.1:PORT:PORT` — Caddy runs on the **host machine**, not in Docker, so containers expose ports to localhost only
- Redis `--requirepass` with empty password breaks docker-compose parsing. Remove the line entirely when password is empty
- Backend and Worker share the same Docker image (`kura-booru-next-backend`); the Worker overrides the command to `arq app.tasks.worker.WorkerSettings`

---

## Caddy `/i/*` Image Proxy

The Caddyfile includes a `handle /i/*` block that proxies image requests to S3-compatible storage:

- **Cloudflare R2**: Use the public CDN domain (e.g., `https://images.your-domain.com`) as upstream — the R2 API endpoint requires S3 auth headers
- **MinIO**: Use `http://localhost:9000/<bucket>`
- **AWS S3**: Use `https://<bucket>.s3.<region>.amazonaws.com`

This proxy is only needed when `PUBLIC_S3_EXTERNAL_URL` is set to `/i` (Caddy proxy mode). When using direct S3/CDN URLs (recommended), images bypass Caddy entirely.

---

## AI Tag Processing

When `ENABLE_AI_TAG_PROCESSING=true`, newly imported images are automatically classified by an OpenAI-compatible API:

- Tags are classified into 5 categories (artist/character/copyright/general/meta)
- Chinese translations are generated
- Danbooru canonical names are assigned
- Results are cached in `tag_knowledge` table to avoid repeated API calls

### Required Variables

| Variable | Description |
|---|---|
| `AI_PROVIDER_API_KEY` | API key for the OpenAI-compatible provider |
| `AI_PROVIDER_ENDPOINT` | Base URL (e.g., `https://api.openai.com/v1`) |
| `AI_PROVIDER_MODEL` | Model name (e.g., `gpt-4o-mini`) |

All three are required when `ENABLE_AI_TAG_PROCESSING=true`. When disabled (default), these variables are ignored.

### Caddy SSE Note

The web import page uses SSE (`GET /api/tasks/web-import/stream`) for real-time progress. Caddy must have `flush_interval -1` in the `/api/*` reverse_proxy block, otherwise SSE responses are buffered and the browser never receives updates. This is already set in the provided Caddyfile template.

---

## Browser Extension Installation

### Prerequisites

- Chromium-based browser (Chrome, Edge, Brave, etc.)
- `BACKEND_API_KEY` from your Kura Booru server (same key used by Telegram Bot)

### Install from CI Artifact

1. Download the latest `kura-booru-importer-v*.zip` from [GitHub Actions build-extension workflow artifacts](https://github.com/<owner>/kura-booru-next/actions/workflows/build-extension.yml)
2. Unzip the file
3. Open `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode" (top-right toggle)
5. Click "Load unpacked" and select the unzipped folder
6. Click the extension icon in the toolbar, enter your server URL and API Key, click "保存"

### Install from Source

```bash
# Generate icons from logo.svg
pip install cairosvg
python3 -c "
import cairosvg
for size in [16, 48, 128]:
    cairosvg.svg2png(url='logo.svg', write_to=f'extension/icons/icon{size}.png',
                     output_width=size, output_height=size)
"

# Then load unpacked from the extension/ directory
```

### API Key

The extension uses the same `BACKEND_API_KEY` environment variable as the Telegram Bot. If you rotate this key, extension users must update their saved API Key in the extension popup.
