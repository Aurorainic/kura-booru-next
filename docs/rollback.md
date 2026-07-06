# Rollback Runbook

How to revert a Kura Booru deployment to a prior release. No rebuild required —
every release tag stays in GHCR.

## Prerequisites

- A release tag exists in GHCR (e.g. `v0.6.2`). Tags are pushed by
  `docker-publish.yml` on every `v*` git tag and are never auto-deleted.
- You have shell access to the deploy host and can edit `.env`.

## Steps

1. **Identify the target tag.** Pick the last known-good release. List remote
   tags if unsure:

   ```bash
   git ls-remote --tags origin | grep -o 'v[0-9].*$' | sort -V
   ```

2. **Pin `.env` to that tag.**

   ```bash
   # In .env (project root):
   KURA_IMAGE_TAG=v0.6.2
   # Keep KURA_VERSION consistent with the footer label you want shown:
   KURA_VERSION=v0.6.2
   ```

3. **Pull and redeploy.**

   ```bash
   cd infra && docker compose pull && docker compose up -d
   ```

   `pull` fetches the pinned manifest; `up -d` recreates only the web/worker
   containers whose image changed. Postgres and Redis volumes are untouched —
   **no data loss**.

4. **Verify.**

   ```bash
   docker compose ps              # all healthy
   docker compose exec web printenv KURA_VERSION   # footer label
   # Smoke-test: homepage loads, login works, image proxy serves.
   ```

## Rollback vs. the database

Rollback only swaps the application images (web, worker). If the bad release
ran a forward-only DB migration that the older image cannot tolerate, a code
rollback alone is not enough — coordinate with the DB schema (`drizzle/`) and
write a compensating migration. Schema-breaking releases should be flagged in
the release notes.

## If the target tag is missing from GHCR

Rare (only untagged versions are auto-pruned; tagged releases are kept). If it
happens, rebuild from the git tag instead:

```bash
git checkout v0.6.2
docker build -t ghcr.io/aurorainic/kura-booru-web:v0.6.2 .
cd sidecar && docker build -t ghcr.io/aurorainic/kura-booru-worker:v0.6.2 .
cd ../infra && KURA_IMAGE_TAG=v0.6.2 docker compose up -d
```

## Forward-fix is preferred when safe

If the bad release is a minor regression and a fix is close, a forward deploy
(`KURA_IMAGE_TAG=<new-tag>`) is usually lower-risk than rollback. Use rollback
when the release is actively broken and no fix is imminent.
