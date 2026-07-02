# Operations

## Docker Image Management

### Tag Strategy

All custom images use **`:latest` only**. No version-pinned tags. Version history lives in git commits + `KURA_VERSION` in `.env`.

### Building Images

```bash
# Nuxt (SSR + API + Bot webhook)
docker build -t kura-booru-web:latest .

# Sidecar (Python gallery-dl + phash)
cd sidecar && docker build -t kura-booru-worker:latest .
```

### Production Deployment

```bash
# Build new images, then deploy (always use --force-recreate)
docker build -t kura-booru-web:latest .
cd sidecar && docker build -t kura-booru-worker:latest .
cd infra && docker compose up -d --force-recreate
```

`--force-recreate` is mandatory — without it, Docker may reuse cached containers even when the `:latest` image changed.

### Rollback

Since there are no version-pinned tags, rollback is via git: checkout the previous commit, rebuild, and redeploy.

```bash
git checkout <previous-commit>
docker build -t kura-booru-web:latest .
cd infra && docker compose up -d --force-recreate
```

### Cleanup Old Images

```bash
docker image prune -f    # Remove dangling images
```

---

## Container Overview

| Container | Image | Purpose |
|---|---|---|
| `kura-web` | `kura-booru-web:latest` | SSR + REST API + Bot webhook (single Node process) |
| `kura-worker` | `kura-booru-worker:latest` | Python gallery-dl + imagehash phash worker |
| `kura-postgres` | `postgres:18-alpine` | Primary database |
| `kura-redis` | `redis:8-alpine` | Job queue + cache |

---

## Scripts

### validate-env.sh

```bash
./infra/scripts/validate-env.sh dev    # Development mode (relaxed)
./infra/scripts/validate-env.sh prod   # Production mode (strict)
```

---

## Admin Password Management

### Change Admin Password

1. Update `ADMIN_PASSWORD` in `.env`
2. Generate bcrypt hash:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.env.ADMIN_PASSWORD || 'newpassword', 12))"
   ```
3. Update the database:
   ```bash
   docker compose exec postgres psql -U kura -d kurabooru -c "UPDATE admins SET password_hash = '<hash>', password_changed_at = NOW() WHERE username = 'admin';"
   ```
4. Update Redis password epoch (invalidates all existing sessions):
   ```bash
   docker compose exec redis redis-cli SET kura:password_epoch "$(date +%s)000"
   ```
5. Restart the nuxt container:
   ```bash
   cd infra && docker compose up -d --force-recreate nuxt
   ```

The `seed-admin.ts` plugin will NOT overwrite an existing admin — it only creates one if none exists.

---

## Release Checklist

### Before Release
- [ ] Code merged to main branch
- [ ] CHANGELOG.md updated
- [ ] `KURA_VERSION` in `.env` updated
- [ ] `.env` has all required production variables

### Build & Deploy
- [ ] Build nuxt image: `docker build -t kura-booru-web:latest .`
- [ ] Build sidecar image (if sidecar changed): `cd sidecar && docker build -t kura-booru-worker:latest .`
- [ ] Deploy: `cd infra && docker compose up -d --force-recreate`
- [ ] Health check: `docker compose ps` (all healthy)
- [ ] Core functionality verified (homepage, login, admin, image loading)

### After Release
- [ ] Git tag created and pushed
- [ ] Clean up old images: `docker image prune -f`

---

## Docker Compose Notes

- Port bindings use `127.0.0.1:PORT:PORT` — the reverse proxy runs on the **host**, not in Docker, so containers expose ports to localhost only
- Redis `--requirepass` with empty password breaks docker-compose parsing. Remove the line entirely when password is empty
- PG 18+ volume mount: use `/var/lib/postgresql` (not `/var/lib/postgresql/data`) — PG 18 changed its data directory layout

---

## Reverse Proxy Configuration

The reverse proxy runs on the **host machine**, not in Docker Compose. It proxies all traffic to the Nuxt container at `127.0.0.1:3000`.

### Caddy

```
your-domain.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;   # Required for SSE
        proxy_cache off;
        client_max_body_size 50m;
    }
}
```

### Traefik

Add a router/service in your dynamic config pointing to `http://127.0.0.1:3000`. SSE works out of the box.

### SSE Note

The web import page uses SSE (`GET /api/tasks/web-import/stream`). Your reverse proxy must not buffer SSE responses:

| Proxy | Configuration |
|---|---|
| **Caddy** | `flush_interval -1` in the `reverse_proxy` block |
| **nginx** | `proxy_buffering off; proxy_cache off;` in the `location /` block |
| **Traefik** | Works out of the box (no buffering by default) |

### `/i/*` Image Proxy

The Nuxt server handles `/i/*` internally (proxying to `S3_EXTERNAL_URL`). The reverse proxy does not need a separate `/i/*` block — all traffic goes to the Nuxt container.

---

## Extension API Key Rotation

When rotating `BACKEND_API_KEY`, notify all extension users — they must manually update the API Key in their extension popup settings. The old key stops working immediately upon nuxt container restart.
