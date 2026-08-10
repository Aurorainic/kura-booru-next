# Documentation Index

All project documentation lives under `docs/`.

---

## Architecture

| Document | Description |
|---|---|
| [architecture/overview.md](architecture/overview.md) | Architecture diagram, tech stack, project structure, core flow, v0.9.0 refactor summary + v0.10.0 (settings 入 DB / AI agent 化) |
| [architecture/data-model.md](architecture/data-model.md) | Drizzle schema: Posts（含 series 列）、Tags、PostTags、TagKnowledge、TagAliases、AutoRatingRules、Settings、Admins、ExtensionKeys、AiProviders |
| [architecture/extension.md](architecture/extension.md) | Browser extension (Manifest V3), import flow, authentication |
| [architecture/decisions.md](architecture/decisions.md) | ADRs: Nitro rewrite, Drizzle, grammy, bare Redis queue, HMAC cookie, v0.9.0 (queue/search/thumbnails/contract) |

## ADRs

| Document | Description |
|---|---|
| [adr/adr-0001-queue.md](adr/adr-0001-queue.md) | ADR-0001: JobQueue interface + pg-boss for Node-side jobs |
| [adr/adr-0002-search-index.md](adr/adr-0002-search-index.md) | ADR-0002: Delete RediSearch, autocomplete via PG trgm |
| [adr/adr-0003-thumbnails.md](adr/adr-0003-thumbnails.md) | ADR-0003: sharp + multi-width srcset (imgproxy archived) |
| [adr/adr-0004-api-contract.md](adr/adr-0004-api-contract.md) | ADR-0004: 61 路由 / 62 端点契约冻结（v0.9.0 时 53）+ handler 包装 |

## Operations

| Document | Description |
|---|---|
| [deployment.md](deployment.md) | Deployment instructions, environment variables, S3 configuration |
| [development.md](development.md) | Local development setup, Drizzle migrations, key notes |
| [operations.md](operations.md) | Docker image management, admin password, release checklist |
| [versioning.md](versioning.md) | Docker image tagging strategy + rollback runbook (pin via `KURA_IMAGE_TAG`, `:latest` for rolling) |
