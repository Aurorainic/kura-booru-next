# Kura Booru — Versioning Strategy

Custom Docker images are published to GHCR with **two tags**: the release tag
(`:v0.10.0`) and `:latest`. Production deploys **pin a release tag** via
`KURA_IMAGE_TAG`; development/rolling deploys track `:latest`.

- `KURA_VERSION` in `.env` → the human-readable version shown in the Nuxt footer.
- `KURA_IMAGE_TAG` in `.env` → the **image tag** the compose stack pulls. Pin it
  to a release tag (`v0.10.0`) in production; leave unset/empty for `:latest`.
- `KURA_IMAGE_REGISTRY` in `.env` → registry prefix (defaults to
  `ghcr.io/aurorainic`). Override for a mirror or private registry.

> `KURA_VERSION` and `KURA_IMAGE_TAG` are usually equal (both `v0.10.0`), but
> they are independent: the footer label is a string, the image tag selects the
> manifest. Keep them in sync on releases.

## ⚠️ `.env` location and Compose interpolation

`.env` lives at the **project root** (next to `package.json`), never in `infra/`.
Compose's `${VAR}` interpolation reads variables **only** from the file passed
to `--env-file` (or auto-found next to the compose file). The `env_file:` key in
`docker-compose.yml` injects variables **into containers** but does **not** feed
interpolation. So every compose command must pass `--env-file ../.env`:

```bash
docker compose --env-file ../.env -f docker-compose.yml <subcommand>
```

Run these from the `infra/` directory (so `-f docker-compose.yml` resolves).
Forgetting `--env-file` silently falls back to `${KURA_IMAGE_TAG:-latest}` →
`:latest`, which is exactly the drift this strategy exists to prevent.
`validate-env.sh prod` rejects an empty `KURA_IMAGE_TAG` as a backstop.

## Flow

### Production (pinned tag, CI-built images)

```bash
# 1. Set version + image tag in .env (project root)
KURA_VERSION=v0.10.0
KURA_IMAGE_TAG=v0.10.0

# 2. Pull the pinned images from GHCR (built by docker-publish.yml on tag push)
docker compose --env-file ../.env -f docker-compose.yml pull

# 3. Deploy
docker compose --env-file ../.env -f docker-compose.yml up -d
```

### Local development (rolling :latest, locally built)

```bash
# 1. Leave KURA_IMAGE_TAG unset (or empty) in .env → resolves to :latest
# 2. Build images locally, tagged :latest
docker build -t ghcr.io/aurorainic/kura-booru-web:latest .
cd sidecar && docker build -t ghcr.io/aurorainic/kura-booru-worker:latest .

# 3. Deploy (--env-file still needed so other vars resolve)
docker compose --env-file ../.env -f docker-compose.yml up -d
```

## Rules

- **Pin a tag in production.** Set `KURA_IMAGE_TAG` to the release tag. This
  makes the deployed manifest explicit and enables rollback without a rebuild.
- **`:latest` is for rolling/local only.** It always points at the newest push;
  never pin production to `:latest` (silent drift, no rollback target).
- **Always pass `--env-file ../.env`.** Without it interpolation silently falls
  back to `:latest` even when `.env` pins a tag. `validate-env.sh prod` guards
  against an empty tag but not against a missing `--env-file`.
- **`pull` before `up`.** With a pinned tag, `docker compose pull` fetches the
  exact manifest; `up -d` recreates only the containers whose image actually
  changed. `--force-recreate` is no longer required.
- **Both tags are pushed per release.** `docker-publish.yml` pushes `:<tag>` and
  `:latest` together — `:<tag>` for pinned deploys, `:latest` for rolling.
- **Old images are garbage-collected.** `docker-publish.yml` keeps the 3 most
  recent untagged versions per image. Locally, run `docker image prune -f`.

## Rollback

No rebuild required — the prior release tag is still in GHCR.

### Prerequisites

- A release tag exists in GHCR (tags are pushed by `docker-publish.yml` on every
  `v*` git tag and are never auto-deleted).
- Shell access to the deploy host and the ability to edit `.env`.

### Steps

1. **Identify the target tag.** Pick the last known-good release. List remote
   tags if unsure:

   ```bash
   git ls-remote --tags origin | grep -o 'v[0-9].*$' | sort -V
   ```

2. **Pin `.env` to that tag.**

   ```bash
   # In .env (project root):
   KURA_IMAGE_TAG=v0.9.0
   # Keep KURA_VERSION consistent with the footer label you want shown:
   KURA_VERSION=v0.9.0
   ```

3. **Pull and redeploy.**

   ```bash
   # Run from infra/ — --env-file ../.env is REQUIRED for ${KURA_IMAGE_TAG} to resolve
   docker compose --env-file ../.env -f docker-compose.yml pull
   docker compose --env-file ../.env -f docker-compose.yml up -d
   ```

   `pull` fetches the pinned manifest; `up -d` recreates only the web/worker
   containers whose image changed. Postgres and Redis volumes are untouched —
   **no data loss**.

4. **Verify.**

   ```bash
   docker compose --env-file ../.env -f docker-compose.yml ps   # all healthy
   docker compose --env-file ../.env -f docker-compose.yml exec web printenv KURA_VERSION   # footer label
   # Smoke-test: homepage loads, login works, image proxy serves.
   ```

### Rollback vs. the database

Rollback only swaps the application images (web, worker). If the bad release
ran a forward-only DB migration that the older image cannot tolerate, a code
rollback alone is not enough — coordinate with the DB schema (`drizzle/`) and
write a compensating migration. Schema-breaking releases should be flagged in
the release notes.

### If the target tag is missing from GHCR

Rare (only untagged versions are auto-pruned; tagged releases are kept). If it
happens, rebuild from the git tag instead:

```bash
git checkout v0.9.0
docker build -t ghcr.io/aurorainic/kura-booru-web:v0.9.0 .
cd sidecar && docker build -t ghcr.io/aurorainic/kura-booru-worker:v0.9.0 .
cd ../infra && KURA_IMAGE_TAG=v0.9.0 docker compose --env-file ../.env -f docker-compose.yml up -d
```

### Forward-fix is preferred when safe

If the bad release is a minor regression and a fix is close, a forward deploy
(`KURA_IMAGE_TAG=<new-tag>`) is usually lower-risk than rollback. Use rollback
when the release is actively broken and no fix is imminent.

## Image names

| Image | Build context | Container |
|---|---|---|
| `ghcr.io/aurorainic/kura-booru-web:<tag>` | `.` (project root) | Nuxt/Nitro SSR + API + Bot webhook |
| `ghcr.io/aurorainic/kura-booru-worker:<tag>` | `sidecar/` | Python gallery-dl + phash worker |

`<tag>` is `KURA_IMAGE_TAG` (release tag, e.g. `v0.10.0`) or `latest` when unset.

PostgreSQL 18 and Redis 8 use official images (`postgres:18-alpine`, `redis:8-alpine`).
