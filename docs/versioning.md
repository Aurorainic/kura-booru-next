# Kura Booru — Versioning Strategy

Custom Docker images are published to GHCR with **two tags**: the release tag
(`:v0.7.0`) and `:latest`. Production deploys **pin a release tag** via
`KURA_IMAGE_TAG`; development/rolling deploys track `:latest`.

- `KURA_VERSION` in `.env` → the human-readable version shown in the Nuxt footer.
- `KURA_IMAGE_TAG` in `.env` → the **image tag** the compose stack pulls. Pin it
  to a release tag (`v0.7.0`) in production; leave unset/empty for `:latest`.
- `KURA_IMAGE_REGISTRY` in `.env` → registry prefix (defaults to
  `ghcr.io/aurorainic`). Override for a mirror or private registry.

> `KURA_VERSION` and `KURA_IMAGE_TAG` are usually equal (both `v0.7.0`), but
> they are independent: the footer label is a string, the image tag selects the
> manifest. Keep them in sync on releases.

## Flow

### Production (pinned tag, CI-built images)

```bash
# 1. Set version + image tag in .env
KURA_VERSION=v0.7.0
KURA_IMAGE_TAG=v0.7.0

# 2. Pull the pinned images from GHCR (built by docker-publish.yml on tag push)
cd infra && docker compose pull

# 3. Deploy
cd infra && docker compose up -d
```

### Local development (rolling :latest, locally built)

```bash
# 1. Leave KURA_IMAGE_TAG unset (or empty) in .env → resolves to :latest
# 2. Build images locally, tagged :latest
docker build -t ghcr.io/aurorainic/kura-booru-web:latest .
cd sidecar && docker build -t ghcr.io/aurorainic/kura-booru-worker:latest .

# 3. Deploy
cd infra && docker compose up -d
```

## Rules

- **Pin a tag in production.** Set `KURA_IMAGE_TAG` to the release tag. This
  makes the deployed manifest explicit and enables rollback without a rebuild.
- **`:latest` is for rolling/local only.** It always points at the newest push;
  never pin production to `:latest` (silent drift, no rollback target).
- **`pull` before `up`.** With a pinned tag, `docker compose pull` fetches the
  exact manifest; `docker compose up -d` recreates only the containers whose
  image actually changed. `--force-recreate` is no longer required.
- **Both tags are pushed per release.** `docker-publish.yml` pushes `:<tag>` and
  `:latest` together — `:<tag>` for pinned deploys, `:latest` for rolling.
- **Old images are garbage-collected.** `docker-publish.yml` keeps the 3 most
  recent untagged versions per image. Locally, run `docker image prune -f`.

## Rollback

No rebuild required — the prior tag is still in the registry.

```bash
# .env: KURA_IMAGE_TAG=v0.6.2
cd infra && docker compose pull && docker compose up -d
```

## Image names

| Image | Build context | Container |
|---|---|---|
| `ghcr.io/aurorainic/kura-booru-web:<tag>` | `.` (project root) | Nuxt/Nitro SSR + API + Bot webhook |
| `ghcr.io/aurorainic/kura-booru-worker:<tag>` | `sidecar/` | Python gallery-dl + phash worker |

`<tag>` is `KURA_IMAGE_TAG` (release tag, e.g. `v0.7.0`) or `latest` when unset.

PostgreSQL 18 and Redis 8 use official images (`postgres:18-alpine`, `redis:8-alpine`).
