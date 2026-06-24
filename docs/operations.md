# Operations

## Docker Image Management

### Tag Strategy

Uses **latest + versioned** dual tags:

- **`latest`** — Always points to the current stable version
- **`v0.4.1`, ...** — Versioned tags for rollback and audit

Tag lifecycle:
1. **Build**: Each release tags both `latest` and `v0.2.x`
2. **Push**: Both tags pushed to registry
3. **Deploy**: Production uses `latest` tag
4. **Rollback**: Specify a versioned tag (e.g., `v0.4.1`)

### Building Images

Using the unified build script:

```bash
./infra/scripts/build.sh v0.4.1
```

Or manually per service:

```bash
# Backend (API + Worker share this image)
docker build --provenance=false --sbom=false -t kura-booru-next-backend:v0.4.1 -t kura-booru-next-backend:latest ./backend

# Bot (aiogram 3, webhook mode)
docker build --provenance=false --sbom=false -t kura-booru-next-bot:v0.4.1 -t kura-booru-next-bot:latest ./bot

# Frontend (Astro SSR, Node.js runtime)
docker build --provenance=false --sbom=false -t kura-booru-next-frontend:v0.4.1 -t kura-booru-next-frontend:latest ./frontend
```

> **Note**: `--provenance=false --sbom=false` is required for Huawei SWR, which does not support Docker BuildKit attestation manifests.

### Registry Login & Push (SWR)

```bash
docker login swr.cn-east-3.myhuaweicloud.com
```

```bash
VERSION=v0.4.1
REGISTRY="swr.cn-east-3.myhuaweicloud.com/lainsaka"

# Backend
docker tag kura-booru-next-backend:${VERSION} ${REGISTRY}/kura-booru-next-backend:${VERSION}
docker tag kura-booru-next-backend:latest ${REGISTRY}/kura-booru-next-backend:latest
docker push ${REGISTRY}/kura-booru-next-backend:${VERSION}
docker push ${REGISTRY}/kura-booru-next-backend:latest

# Bot
docker tag kura-booru-next-bot:${VERSION} ${REGISTRY}/kura-booru-next-bot:${VERSION}
docker tag kura-booru-next-bot:latest ${REGISTRY}/kura-booru-next-bot:latest
docker push ${REGISTRY}/kura-booru-next-bot:${VERSION}
docker push ${REGISTRY}/kura-booru-next-bot:latest

# Frontend
docker tag kura-booru-next-frontend:${VERSION} ${REGISTRY}/kura-booru-next-frontend:${VERSION}
docker tag kura-booru-next-frontend:latest ${REGISTRY}/kura-booru-next-frontend:latest
docker push ${REGISTRY}/kura-booru-next-frontend:${VERSION}
docker push ${REGISTRY}/kura-booru-next-frontend:latest
```

### Local Test Run

```bash
docker run -p 8000:8000 --env-file .env kura-booru-next-backend:v0.4.1
docker run --env-file .env kura-booru-next-backend:v0.4.1 arq app.tasks.worker.WorkerSettings
docker run -p 8080:8080 --env-file .env kura-booru-next-bot:v0.4.1
docker run -p 4321:4321 --env-file .env kura-booru-next-frontend:v0.4.1
```

### Production Deployment

```bash
# On the production server
cd infra/
docker compose pull
docker compose up -d
```

### Rollback

```bash
# Edit docker-compose.yml to pin a specific version
# e.g., image: kura-booru-next-backend:v0.4.0
docker compose up -d
```

### Cleanup Old Images

```bash
# View all kura-booru images
docker images | grep kura-booru

# Delete specific old versions
docker rmi kura-booru-next-backend:v0.4.0

# Batch delete (keep latest and current)
CURRENT_VERSION="v0.4.1"
docker images --format "{{.Repository}}:{{.Tag}}" | grep kura-booru | grep -v latest | grep -v ${CURRENT_VERSION} | xargs docker rmi -f
```

---

## Scripts

### build.sh

```bash
./infra/scripts/build.sh v0.4.1
```

Unified Docker image build script. Injects `PUBLIC_GIT_TAG` build arg into the frontend for version display in the footer. Builds all three images with both `latest` and versioned tags.

### validate-env.sh

```bash
./infra/scripts/validate-env.sh dev    # Development mode (relaxed)
./infra/scripts/validate-env.sh prod   # Production mode (strict)
```

Validates that all required environment variables are set. Production mode requires all critical vars; development mode warns but doesn't fail.

### migrate-db.sh

```bash
./infra/scripts/migrate-db.sh --dump-only                     # Export dev database only
./infra/scripts/migrate-db.sh --import-only dumps/xxx.sql     # Import to production only
./infra/scripts/migrate-db.sh                                 # Interactive mode
```

Migrates the database from a development environment to production. Supports dump-only, import-only, and interactive modes.

---

## Release Checklist

### Before Release
- [ ] Code merged to main branch
- [ ] CHANGELOG.md updated
- [ ] All docker-compose.yml image tags updated

### Build & Push
- [ ] Build three images (backend, bot, frontend) with both latest + versioned tags
- [ ] Push to registry (latest + versioned)
- [ ] Verify registry image tags
- [ ] Extension zip built and uploaded as CI artifact (build-extension.yml)

### Deploy & Verify
- [ ] Production server pulls latest images
- [ ] Restart all containers: `docker compose up -d`
- [ ] Health check passes: `curl http://localhost:8000/health`
- [ ] Core functionality verified
- [ ] Git tag created and pushed

### After Release
- [ ] Clean up old version local images
- [ ] Update documentation if needed

---

## China Build Notes

Docker builds in China require mirror overrides due to network restrictions:

- **Python base images** use `deb.debian.org`, not the host's apt source. Add Aliyun mirror replacement in every Dockerfile stage that runs `apt-get`:
  ```dockerfile
  RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
      && sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
  ```
- **`pip install`** needs `-i https://mirrors.aliyun.com/pypi/simple/` for PyPI in China
- **`npm ci`** needs `npm config set registry https://registry.npmmirror.com` for npmmirror
- **Huawei SWR** does NOT support Docker BuildKit attestation manifests. Use `--provenance=false --sbom=false` or `DOCKER_BUILDKIT=0`

### Docker Compose Notes

- Production compose needs `ports: 127.0.0.1:PORT:PORT` bindings — Caddy runs on the **host**, not in Docker
- Redis command with empty `${REDIS_PASSWORD:-}` breaks parsing. Remove `--requirepass` line entirely when password is empty
- `schemas/__init__.py` must only import classes that actually exist — stale imports crash uvicorn at startup

### Caddy `/i/*` Image Proxy

- Frontend renders `/i/originals/...`, `/i/thumbs/...`, `/i/previews/...` paths
- Caddy MUST have a `handle /i/*` block with `uri strip_prefix /i` + `reverse_proxy` to S3/CDN
- R2 API endpoint (`*.r2.cloudflarestorage.com`) requires S3 auth headers — use the public CDN domain (e.g., `images.your-domain.com`) as upstream instead

### Caddy SSE (Server-Sent Events)

- The web import page uses SSE for real-time progress updates
- Caddy **must** have `flush_interval -1` in the `/api/*` reverse_proxy block, otherwise SSE responses are buffered and the browser never receives events
- This is already set in the provided Caddyfile template — do not remove it

### Extension API Key Rotation

When rotating `BACKEND_API_KEY`, notify all extension users — they must manually update the API Key in their extension popup settings. The old key stops working immediately upon backend restart.
