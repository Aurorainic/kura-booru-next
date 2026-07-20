# Documentation Index

All project documentation lives under `docs/`.

---

## Architecture

| Document | Description |
|---|---|
| [architecture.md](architecture.md) | Navigation index for architecture sub-documents |
| [architecture/overview.md](architecture/overview.md) | Architecture diagram, tech stack, project structure, core flow, v0.9.0 refactor summary |
| [architecture/data-model.md](architecture/data-model.md) | Drizzle schema: Posts, Tags, PostTags, TagKnowledge, Admins, Settings |
| [architecture/extension.md](architecture/extension.md) | Browser extension (Manifest V3), import flow, authentication |
| [architecture/decisions.md](architecture/decisions.md) | ADRs: Nitro rewrite, Drizzle, grammy, bare Redis queue, HMAC cookie, v0.9.0 (queue/search/thumbnails/contract) |

## ADRs (v0.9.0)

| Document | Description |
|---|---|
| [adr/adr-0001-queue.md](adr/adr-0001-queue.md) | ADR-0001: JobQueue interface + pg-boss for Node-side jobs |
| [adr/adr-0002-search-index.md](adr/adr-0002-search-index.md) | ADR-0002: Delete RediSearch, autocomplete via PG trgm |
| [adr/adr-0003-thumbnails.md](adr/adr-0003-thumbnails.md) | ADR-0003: sharp + multi-width srcset (imgproxy archived) |
| [adr/adr-0004-api-contract.md](adr/adr-0004-api-contract.md) | ADR-0004: 53 endpoint freeze + handler wrappers |

## Operations

| Document | Description |
|---|---|
| [deployment.md](deployment.md) | Deployment instructions, environment variables, S3 configuration |
| [development.md](development.md) | Local development setup, Drizzle migrations, key notes |
| [operations.md](operations.md) | Docker image management, admin password, release checklist |
| [rollback.md](rollback.md) | Rollback runbook: revert a deploy to a prior release tag |
| [versioning.md](versioning.md) | Docker image tagging strategy (pin via `KURA_IMAGE_TAG`, `:latest` for rolling) |
