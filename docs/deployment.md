# Deployment

## Prerequisites

- Docker + Docker Compose
- S3-compatible storage (Cloudflare R2 / MinIO / AWS S3)
- Caddy 2.x / nginx / Traefik **optional** since v0.7.0 — see Deployment Modes below

---

## Environment Variables

All configuration is via `.env` file at the **project root** (next to
`package.json`), created from the template:

```bash
cp infra/.env.example .env   # .env MUST live at project root, NOT in infra/
```

> ⚠️ **`.env` location matters.** Compose's `${VAR}` interpolation reads only
> from the file passed to `--env-file` (or auto-found next to the compose file).
> The `env_file:` key in `docker-compose.yml` injects vars **into containers**
> but does **not** feed interpolation. So `KURA_IMAGE_TAG` (and any other
> `${VAR}` in the compose file) only resolves when you pass
> `--env-file ../.env`. Without it, `KURA_IMAGE_TAG` silently falls back to
> `:latest`. Always run compose from `infra/` with `--env-file ../.env`. See
> [versioning.md](versioning.md).

For the complete list of all variables with descriptions and defaults, see [`infra/.env.example`](../infra/.env.example).

### Production-Required Variables

| Variable | Description |
|---|---|
| `SITE_URL` | Your public site URL (e.g., `https://kura-booru.example.com`) — **seed-only**: imported into the settings table on first boot; after that, change it in the admin Settings panel (editing `.env` and restarting has no effect once seeded) |
| `KURA_IMAGE_TAG` | Release tag to pin (e.g. `v0.10.0`); empty → `:latest` (rejected by `validate-env.sh prod`) |
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
| AI Tag Processing | `ENABLE_AI_TAG_PROCESSING`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_ENDPOINT`, `AI_PROVIDER_MODEL` — 仅首启 seed / 冷启动兜底，运行时在后台「AI 设置」面板管理 |
| Bot | `BOT_TOKEN`, `BOT_WEBHOOK_SECRET`, `BOT_ADMIN_IDS` |
| Image Processing | `MAX_IMAGE_SIZE`, `THUMB_SIZE`, `PREVIEW_SIZE` — 首启 seed，后台「图片」卡片维护 |
| gallery-dl Auth | `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID` |
| Frontend | `INTERNAL_API_URL` (default: `http://127.0.0.1:3000/api` — in-process) |

### Validate Environment

```bash
./scripts/validate-env.sh prod   # Strict: all production-required vars + KURA_IMAGE_TAG must be set (run from infra/)
./scripts/validate-env.sh dev    # Relaxed: warns but doesn't fail
```

---

## Deployment Modes

### Standalone Mode (Simplest)

No reverse proxy needed. The Nuxt/Nitro server handles SSR, API, Bot webhook, and `/i/*` image proxy all in one process.

```bash
# Only 1 address variable required:
#   SITE_URL=https://kura-booru.example.com
# Run from infra/ — --env-file ../.env is REQUIRED (see Environment Variables above)
docker compose --env-file ../.env -f docker-compose.yml pull
docker compose --env-file ../.env -f docker-compose.yml up -d
```

The browser talks directly to the Nuxt server (`:3000`), which handles SSR and proxies image requests to S3 internally.

### Run Mode: Intranet vs Public (Admin Panel Switch)

The run mode is a **database setting**, configured in the admin panel at
`/admin?tab=settings` → **站点 → 运行模式** (default: `public`). No environment
variable is involved; changing it takes effect immediately (hot-reload).

- **intranet（内网）** — no admin login wall: every visitor is treated as an
  admin, all content ratings are visible, `/admin` and all panels are open,
  and login/logout UI entries are hidden. Use only on a trusted local network
  (LAN or VPN).
- **public（公网）** — login wall + rating restrictions restored: anonymous
  visitors see only `safe` content, non-safe returns 404, and admin actions
  require an admin session.

Do **not** run the public internet in `intranet` mode, because it completely
disables the admin access control.

> 提示：首次部署（settings 表无 `run_mode` 记录）时默认即为 `public`（登录墙 + 评级限制）；
> 仅可信内网可在后台切换为「内网模式」（所有访客视为管理员）。

### Reverse Proxy Optimized Mode (Production)

Use any reverse proxy for HTTPS termination, compression, and static asset caching. The proxy forwards all traffic to the Nuxt container.

```bash
# Start all services (run from infra/)
docker compose --env-file ../.env -f docker-compose.yml pull
docker compose --env-file ../.env -f docker-compose.yml up -d

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

- `S3_ENDPOINT`: 服务端上传与 `/i/*` 代理使用的 S3 API 地址（容器部署用 `host.docker.internal` 走本机闭环）
- `S3_EXTERNAL_URL`: 公网直出 URL 前缀（CDN 域名）——浏览器直连 / bot 发图等场景；留空则一律走站内 `/i/*` 代理

---

## Deployment Steps

### 1. Configure Environment Variables

```bash
cp infra/.env.example .env   # .env at project root, NOT in infra/
# Edit .env and fill in real values (set KURA_IMAGE_TAG in production)
```

### 2. Start Services

```bash
# Run from infra/ — --env-file ../.env is REQUIRED for ${KURA_IMAGE_TAG} to resolve
docker compose --env-file ../.env -f docker-compose.yml pull
docker compose --env-file ../.env -f docker-compose.yml up -d
```

`docker compose pull` fetches the image tag pinned by `KURA_IMAGE_TAG` in `.env`
(defaults to `:latest` when unset). See [versioning.md](versioning.md) for tag
strategy and rollback.

### 3. Initialize Database

The stack uses the same PostgreSQL as v1. Existing tables and data are reused. If starting fresh:

```bash
pnpm run db:push   # Push Drizzle schema to database
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
- **4 containers**（见 `infra/docker-compose.yml`）:

| Container | Image | Purpose |
|---|---|---|
| `kura-web` | `ghcr.io/aurorainic/kura-booru-web:${KURA_IMAGE_TAG:-latest}` | SSR + REST API + Bot webhook (single Node process) |
| `kura-worker` | `ghcr.io/aurorainic/kura-booru-worker:${KURA_IMAGE_TAG:-latest}` | Python gallery-dl + imagehash phash worker |
| `kura-postgres` | `postgres:18-alpine` | Primary database |
| `kura-redis` | `redis:8-alpine` | Job queue + cache |

---

## `/i/*` Image Proxy

The Nuxt server handles `/i/*` internally via `server/routes/i/[...].ts`（key
校验防路径遍历，Range 透传 + 流式转发），它从**服务进程视角**按 `s3_endpoint`
（DB settings，容器部署 = `http://host.docker.internal:9000`）向 S3 拉取——
不依赖 `s3_external_url`。宿主机裸跑 `pnpm run dev` 时需在 `/etc/hosts` 把
`host.docker.internal` 解析到 127.0.0.1，否则图片 502。反向代理无需单独的
`/i/*` 规则，所有流量都进 Nuxt 容器。

生产推荐直连 CDN：设 `S3_EXTERNAL_URL` 为 CDN 域名后，浏览器与 bot 等公网场景
直出对象存储，完全绕过 Nuxt 代理。

---

## AI Tag Processing

AI 标签处理由**后台「AI 设置」面板**（`/admin?tab=ai`）管理，无需改环境变量：

- **全局开关** `ai_tag_processing_enabled`（settings 表）— 开启后新导入图片自动
  调用 AI 分类：5 类标签（artist/character/copyright/general/meta）+ 中文翻译 +
  Danbooru 标准命名；结果缓存进 `tag_knowledge` 表避免重复调用。
- **Provider 配置**存 `ai_providers` 表（endpoint / model / api_key，单活跃），
  在面板中增删改即时生效（热刷新）。

`.env` 中的 `ENABLE_AI_TAG_PROCESSING` / `AI_PROVIDER_API_KEY` /
`AI_PROVIDER_ENDPOINT` / `AI_PROVIDER_MODEL` 仅作**首启 seed 与冷启动兜底**：
settings 表无 `ai_tag_processing_enabled` 记录时回退到 env 布尔值；`ai_providers`
表为空时从 env 导入一个 provider 行。正常维护一律在后台面板操作。

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
- A per-admin extension key (`kb_ext_` prefix) issued from the admin panel at `/admin?tab=extension` — NOT the shared `BACKEND_API_KEY` (v0.7.8+)

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

The extension uses **per-admin extension keys** (`kb_ext_` prefix), generated
and revoked in the admin panel（`/admin?tab=extension`）— each key is scoped to
one admin, the raw value is shown only once, and revoking a key takes effect
immediately. This is distinct from `BACKEND_API_KEY` (service-level, shared with
the Telegram bot). See [operations.md](operations.md) § Extension API Key
Management for the full workflow.
