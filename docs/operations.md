# Operations

## Docker Image Management

### Tag Strategy

Custom images are published to GHCR with **two tags**: the release tag
(`:v0.10.0`) and `:latest`. Production deploys **pin a release tag** via
`KURA_IMAGE_TAG` in `.env`; development/rolling deploys track `:latest`.

Version history also lives in git tags + `KURA_VERSION` (footer label) in `.env`.
See [versioning.md](versioning.md) for the full strategy.

### Pulling Pre-built Images (Production)

CI (`docker-publish.yml`) builds and pushes on every `v*` tag. Deployers pull a
pinned tag — no local build needed.

```bash
# .env (project root): KURA_IMAGE_TAG=v0.10.0
# Run from infra/ — --env-file is REQUIRED for ${KURA_IMAGE_TAG} to resolve
docker compose --env-file ../.env -f docker-compose.yml pull
docker compose --env-file ../.env -f docker-compose.yml up -d
```

### Building Images (Local Dev)

```bash
# Nuxt (SSR + API + Bot webhook)
docker build -t ghcr.io/aurorainic/kura-booru-web:latest .

# Sidecar (Python gallery-dl + phash)
cd sidecar && docker build -t ghcr.io/aurorainic/kura-booru-worker:latest .
```

### Production Deployment

```bash
# Pin a tag in .env (KURA_IMAGE_TAG=v0.10.0), then (run from infra/):
docker compose --env-file ../.env -f docker-compose.yml pull
docker compose --env-file ../.env -f docker-compose.yml up -d
```

`docker compose pull` fetches the pinned manifest; `up -d` recreates only the
containers whose image changed. `--force-recreate` is no longer needed because
the pinned tag + `pull` make the image change explicit. **Always pass
`--env-file ../.env`** — without it `${KURA_IMAGE_TAG}` silently resolves to
`:latest` even when `.env` pins a tag.

### Rollback

Rollback is a tag change — no rebuild. See [versioning.md](versioning.md) § Rollback for the full runbook.

```bash
# .env: KURA_IMAGE_TAG=v0.9.0
docker compose --env-file ../.env -f docker-compose.yml pull
docker compose --env-file ../.env -f docker-compose.yml up -d
```

### Cleanup Old Images

```bash
docker image prune -f    # Remove dangling images (local)
docker builder prune -f  # Remove dangling BuildKit cache (local)
```

CI keeps the 3 most recent untagged versions per image in GHCR; tagged release
versions are never auto-deleted.

### Why does the image take ~4× its size on disk?

A freshly built `kura-booru-web` image reports one size in `docker images`,
but the build cache + layer storage on disk can total roughly **4×** that.
This is expected for a multi-stage Node/Nuxt build — it is not a leak.

The multiplier comes from **each stage's layers stacking independently**:

| Source | Approx. size | Why it stays on disk |
|---|---|---|
| `deps` stage — `node_modules` | ~400–600 MB | Full `pnpm install --frozen-lockfile` install; kept as a cache layer so rebuilds skip `pnpm install --frozen-lockfile` |
| `build` stage — `.nuxt` + `.output` | ~200–400 MB | Nuxt build artifacts; layer cached for incremental rebuilds |
| `production` stage — final `.output` | ~150–250 MB | The image `docker images` actually reports |
| BuildKit GHA cache mirror | ~matches build stage | `cache-from: type=gha`/`cache-to: type=gha,mode=max` keeps a second copy for CI |

So the "real" ~200 MB production image plus its `deps`/`build` cache layers and
the GHA mirror easily reach ~800 MB–1 GB on the build host — about 4× the
reported image size. The `dev` stage (used for hot-reload, carries full
`node_modules` + source) adds another copy if you build it locally.

This is by design: the cache is what makes rebuilds take 30 s instead of 5 min.
To reclaim space when you no longer need the cache:

```bash
docker builder prune -f          # drop dangling BuildKit cache (safe)
docker builder prune -af         # drop ALL BuildKit cache (forces full rebuild next time)
docker image prune -f            # drop dangling images
```

On the registry side, `docker-publish.yml`'s `cleanup-old-images` job keeps
only the 3 most recent **untagged** versions per image and never deletes a
**tagged** release, so GHCR storage stays bounded automatically. No manual
registry pruning is needed for normal releases.

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
5. Restart the web container:
   ```bash
   docker compose --env-file ../.env -f docker-compose.yml up -d web
   ```

The `seed-admin.ts` plugin will NOT overwrite an existing admin — it only creates one if none exists.

---

## Release Checklist

### Before Release
- [ ] Code merged to main branch
- [ ] CHANGELOG.md updated
- [ ] `KURA_VERSION` in `.env` updated (e.g. `v0.10.0`)
- [ ] `.env` has all required production variables

### Build & Deploy (CI pushes images on tag)
- [ ] Git tag created and pushed (e.g. `git tag v0.10.0 && git push origin v0.10.0`) — triggers `docker-publish.yml` to push `:v0.10.0` + `:latest` to GHCR
- [ ] Set `KURA_IMAGE_TAG=v0.10.0` in `.env` (project root; matches the git tag)
- [ ] Validate: `./scripts/validate-env.sh prod` (rejects empty `KURA_IMAGE_TAG`)
- [ ] Pull pinned images: `docker compose --env-file ../.env -f docker-compose.yml pull`
- [ ] Deploy: `docker compose --env-file ../.env -f docker-compose.yml up -d`
- [ ] Health check: `docker compose ps` (all healthy)
- [ ] Core functionality verified (homepage, login, admin, image loading)

### After Release
- [ ] Verify deploy in production
- [ ] Clean up old local images: `docker image prune -f` (GHCR untagged cleanup runs in CI)

---

## Extension API Key Management (v0.7.8+)

Extension keys are per-admin (kb_ext_ prefix), distinct from BACKEND_API_KEY
(service-level, shared with the bot). Generate/revoke via admin UI:

- Generate: `/admin?tab=extension` → enter name → 生成. Copy raw value (shown ONCE).
- Revoke: same panel → click 吊销 next to key. Takes effect immediately.

Old (pre-v0.7.8) extension used `BACKEND_API_KEY` directly — that path is no
longer supported by the new extension code. Operators with existing extension
users should:

1. Upgrade server to v0.7.8+ (migration adds extension_keys table)
2. Issue one kb_ext_ key per extension user via admin UI
3. Have each user paste their key into the extension popup

If you must rotate `BACKEND_API_KEY` (e.g. compromised), it no longer affects
extension users — they have their own keys. Rotate via `Settings` → `Password`
in admin UI, or by revoking individual keys in the extension panel.
