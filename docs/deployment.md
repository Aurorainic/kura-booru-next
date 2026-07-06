# Deployment

## Prerequisites

- Docker + Docker Compose
- S3-compatible storage (Cloudflare R2 / MinIO / AWS S3)
- Caddy 2.x / nginx / Traefik **optional** since v0.7.0 — see Deployment Modes below

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
| `SITE_URL` | Your public site URL (e.g., `https://kura-booru.example.com`) |
| `SECRET_KEY` | Generate with: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `POSTGRES_PASSWORD` | Database password |
| `S3_ENDPOINT` / `S3_EXTERNAL_URL` | S3 storage endpoint (see S3 Configuration below) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3 credentials |
| `BOT_TOKEN` | Telegram Bot Token (from @BotFather) |
| `BOT_WEBHOOK_SECRET` | Webhook verification secret |
| `BOT_ADMIN_IDS` | Comma-separated Telegram user IDs allowed to use the bot |

### Environment Variable Categories

| Category | Key Variables |
|---|---|
| Application | `SITE_URL` (required), `KURA_VERSION`, `KURA_IMAGE_TAG`, `KURA_IMAGE_REGISTRY` |
| Secret | `SECRET_KEY`, `SESSION_SECRET` |
| Admin Auth | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `BACKEND_API_KEY` |
| S3 Storage | `S3_ENDPOINT`, `S3_EXTERNAL_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` |
| Database | `DATABASE_URL` (postgres-js format: `postgres://...`), `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Redis | `REDIS_URL` (password included in URL if needed) |
| AI Tag Processing | `ENABLE_AI_TAG_PROCESSING`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_ENDPOINT`, `AI_PROVIDER_MODEL` |
| Bot | `BOT_TOKEN`, `BOT_WEBHOOK_SECRET`, `BOT_ADMIN_IDS` |
| Image Processing | `MAX_IMAGE_SIZE`, `THUMB_SIZE`, `PREVIEW_SIZE` |
| gallery-dl Auth | `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID` |
| Frontend | `INTERNAL_API_URL` (default: `http://127.0.0.1:3000/api` — in-process) |

### Validate Environment

```bash
cd infra && ./scripts/validate-env.sh prod   # Strict: all production-required vars must be set
cd infra && ./scripts/validate-env.sh dev    # Relaxed: warns but doesn't fail
```

---

## Deployment Modes

### Standalone Mode (Simplest)

No reverse proxy needed. The Nuxt/Nitro server handles SSR, API, Bot webhook, and `/i/*` image proxy all in one process.

```bash
# Only 1 address variable required:
#   SITE_URL=https://kura-booru.example.com
cd infra && docker compose pull && docker compose up -d
```

The browser talks directly to the Nuxt server (`:3000`), which handles SSR and proxies image requests to S3 internally.

### Reverse Proxy Optimized Mode (Production)

Use any reverse proxy for HTTPS termination, compression, and static asset caching. The proxy forwards all traffic to the Nuxt container.

```bash
# Start all services
cd infra && docker compose pull && docker compose up -d

# Deploy reverse proxy config (on the host machine)
# Caddy:
cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

# nginx:
cp infra/nginx/kura-booru.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/kura-booru.conf /etc/nginx/sites-enabled/
systemctl reload nginx

# Traefik: add the router/service to your traefik.yml or dynamic config
```

---

## S3 Configuration

The S3 layer works with **any** S3-compatible storage. Images are served **directly from S3/CDN** (not via reverse proxy). Switch providers by changing env vars only — no code changes needed.

| Variable | Cloudflare R2 (Production) | MinIO (Development) | AWS S3 |
|---|---|---|---|
| `S3_ENDPOINT` | `https://<id>.r2.cloudflarestorage.com` | `http://minio:9000` | `https://s3.<region>.amazonaws.com` |
| `S3_EXTERNAL_URL` | `https://images.your-domain.com` | `http://localhost:9000/kura-booru` | `https://<bucket>.s3.<region>.amazonaws.com` |
| `S3_REGION` | `auto` | `us-east-1` | `<region>` |

- `S3_ENDPOINT`: Internal endpoint for backend uploads (S3 API)
- `S3_EXTERNAL_URL`: Backend public URL prefix (used in API responses; in Standalone mode, images are served via `/i/*` proxy)

---

## Deployment Steps

### 1. Configure Environment Variables

```bash
cp infra/.env.example .env
# Edit .env and fill in real values
```

### 2. Start Services

```bash
cd infra && docker compose pull && docker compose up -d
```

`docker compose pull` fetches the image tag pinned by `KURA_IMAGE_TAG` in `.env`
(defaults to `:latest`). See [versioning.md](versioning.md) for tag strategy and
rollback.

### 3. Initialize Database

The stack uses the same PostgreSQL as v1. Existing tables and data are reused. If starting fresh:

```bash
npm run db:push   # Push Drizzle schema to database
```

### 4. Configure Reverse Proxy (Reverse Proxy Optimized mode only)

Deploy the reverse proxy config to the host machine. The proxy forwards all traffic to the Nuxt container at `127.0.0.1:3000`.

**Caddy** — see [`infra/caddy/Caddyfile`](../infra/caddy/Caddyfile) for an example:

```bash
cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Edit the Caddyfile: replace the site domain with your actual domain
systemctl reload caddy
```

**nginx** — minimal config:

```nginx
server {
    listen 443 ssl http2;
    server_name kura-booru.example.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE (web import progress)
        proxy_buffering off;
        proxy_cache off;

        client_max_body_size 50m;
    }
}
```

**Traefik** — add a router/service in your dynamic config pointing to `http://127.0.0.1:3000`.

### 5. Set Telegram Webhook

The bot automatically sets the webhook on startup. Ensure `SITE_URL` is set correctly — the webhook URL is derived as `{SITE_URL}/bot/webhook`.

### First Admin Login

The `seed-admin.ts` plugin auto-creates a default admin account on first startup using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`. Log in at `/login` with those credentials.

---

## Production Docker Compose Notes

- Port bindings use `127.0.0.1:PORT:PORT` — the reverse proxy runs on the **host machine** (in Reverse Proxy Optimized mode), not in Docker, so containers expose ports to localhost only
- Redis `--requirepass` with empty password breaks docker-compose parsing. Remove the line entirely when password is empty
- PG 18+ volume mount: use `/var/lib/postgresql` (not `/var/lib/postgresql/data`) — PG 18 changed its data directory layout
- **4 containers**: nuxt, sidecar, postgres, redis. See `infra/docker-compose.yml`

---

## `/i/*` Image Proxy

In, the Nuxt server handles `/i/*` internally via `server/routes/i/[...].ts`, which proxies to `S3_EXTERNAL_URL/{key}`. The reverse proxy does not need a separate `/i/*` block — all traffic goes to the Nuxt container.

When using direct S3/CDN URLs (recommended for production), set `S3_EXTERNAL_URL` to the CDN domain and images bypass the Nuxt proxy entirely.

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

### SSE Note

The web import page uses SSE (`GET /api/tasks/web-import/stream`) for real-time progress. Your reverse proxy must **not buffer** SSE responses:

| Proxy | Configuration |
|---|---|
| **Caddy** | `flush_interval -1` in the `reverse_proxy` block |
| **nginx** | `proxy_buffering off; proxy_cache off;` in the `location /` block |
| **Traefik** | Works out of the box (no buffering by default) |

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
