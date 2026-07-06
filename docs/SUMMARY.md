# Documentation Index

All project documentation lives under `docs/`.

---

## Architecture

| Document | Description |
|---|---|
| [architecture.md](architecture.md) | Navigation index for architecture sub-documents |
| [architecture/overview.md](architecture/overview.md) | Architecture diagram, tech stack (Nitro/Vue 3), project structure, core flow |
| [architecture/data-model.md](architecture/data-model.md) | Drizzle schema: Posts, Tags, PostTags, TagKnowledge, Admins, Settings |
| [architecture/extension.md](architecture/extension.md) | Browser extension (Manifest V3), import flow, authentication |
| [architecture/decisions.md](architecture/decisions.md) | ADRs: Nitro rewrite, Drizzle over SQLAlchemy, grammy over aiogram |

## Operations

| Document | Description |
|---|---|
| [deployment.md](deployment.md) | Deployment instructions, environment variables, S3 configuration |
| [development.md](development.md) | Local development setup, Drizzle migrations, key notes |
| [operations.md](operations.md) | Docker image management, admin password, release checklist |
| [rollback.md](rollback.md) | Rollback runbook: revert a deploy to a prior release tag |

## Reference

| Document | Description |
|---|---|
| [versioning.md](versioning.md) | Docker image tagging strategy (pin via `KURA_IMAGE_TAG`, `:latest` for rolling) |
| [roadmap.md](roadmap.md) | Project roadmap |
| [theme-design.md](theme-design.md) | Theme design spec (colors, typography, layout, animations) |
| [AI_Retag_internals.md](AI_Retag_internals.md) | AI retagging internals (ported to TypeScript in `server/`) |
