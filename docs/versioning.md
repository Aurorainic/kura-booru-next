# Kura Booru — Versioning Strategy

All custom Docker images use the `:latest` tag. No version-pinned tags.

## Flow

```bash
# 1. Set version in .env
KURA_VERSION=v0.7.0

# 2. Build images (always tag as :latest)
docker build -t kura-booru-web:latest .
cd sidecar && docker build -t kura-booru-worker:latest .

# 3. Deploy (always use --force-recreate)
cd infra && docker compose up -d --force-recreate
```

## Rules

- **`:latest` is the only tag**. No `:v0.7.0`, etc. Version history lives in git commits + `.env` `KURA_VERSION`.
- **`--force-recreate` is mandatory**. Without it, Docker may reuse cached containers even when the `:latest` image changed.
- **Every deployment = rebuild + force-recreate**. Don't try to "just restart" — always rebuild.
- **Old images are garbage-collected by Docker**. Run `docker image prune -f` periodically to clean up.

## Version tracking

- `KURA_VERSION` in `.env` → shown in Nuxt footer at runtime (read via `runtimeConfig.public.gitTag`)
- `git tag` → marks the commit that was deployed
- `docker images` → shows current `:latest` image IDs

##  image names

| Image | Build context | Container |
|---|---|---|
| `kura-booru-web:latest` | `.` (project root) | Nuxt/Nitro SSR + API + Bot webhook |
| `kura-booru-worker:latest` | `sidecar/` | Python gallery-dl + phash worker |

PostgreSQL 18 and Redis 8 use official images (`postgres:18-alpine`, `redis:8-alpine`).
