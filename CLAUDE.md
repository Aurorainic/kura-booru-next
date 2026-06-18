# Kura Booru V2 — Project Guide

## Overview

Personal anime illustration collection and showcase platform. Core workflow: send a link via Telegram Bot → auto-download original image → store in S3 → browse on web.

Inspired by safebooru (tag system, pagination, fast loading) but with modern UI (Pixiv/Pinterest-like masonry, dark/light/auto theme, cyan gradient accent).

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Bot | aiogram 3.x | Webhook mode |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + ARQ | REST API + task queue |
| Frontend | Astro 5 (SSR) + React 19 + react-photo-album | SSR with Caddy caching, NOT SSG |
| UI | Tailwind CSS v4 + shadcn/ui | Base components, heavy visual customization |
| Storage | S3-compatible (MinIO dev / R2 prod) | Abstract layer, swappable |
| Database | PostgreSQL 16+ | |
| Cache/Queue | Redis 7.x | ARQ queue + Caddy cache backend |
| Reverse Proxy | Caddy 2.x (host machine) | With Souin cache plugin |
| Deployment | Docker Compose v2 | Internal network, Caddy on host |

## Architecture

```
Internet → Caddy (host) → Docker internal network
  /*      → frontend:4321  (SSR, cached by Souin)
  /api/*  → backend:8000   (no cache)
  /i/*    → minio:9000     (direct S3, zero backend)
  /bot/*  → bot:8080       (Telegram webhook)
```

**Key decision: SSR + Caddy cache, NOT SSG.** SSG cannot do incremental rebuilds — new images would require full site rebuilds. SSR with 5-min TTL Caddy cache gives near-static performance with instant content visibility.

## Project Structure

```
kura-booru-v2/
├── backend/          # FastAPI app
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py          # pydantic-settings from env vars
│   │   ├── database.py
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── api/               # REST routes
│   │   ├── services/          # Business logic
│   │   │   ├── pipeline.py    # Image processing pipeline
│   │   │   ├── s3.py          # S3 storage abstraction
│   │   │   ├── source_resolver.py
│   │   │   └── phash.py       # Perceptual hash dedup
│   │   ├── source_extractors/ # Per-site URL parsers
│   │   └── tasks/             # ARQ task definitions
│   ├── alembic/
│   ├── requirements.txt
│   └── Dockerfile
├── bot/              # aiogram 3 Telegram bot
│   ├── app/
│   │   ├── main.py
│   │   └── handlers/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/         # Astro SSR
│   ├── src/
│   │   ├── components/    # React Islands
│   │   ├── layouts/
│   │   ├── pages/
│   │   └── styles/
│   ├── package.json
│   └── Dockerfile
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── caddy/             # Caddyfile (host reference)
│   └── .env.example
├── PLAN.md
└── README.md
```

## Key Constraints

- **6MB image size limit** — HEAD check before download, reject with message if exceeded
- **Pagination, not infinite scroll** — like safebooru, with per-page count selector (20/40/100)
- **gallery-dl as Python library** — not subprocess, use `DownloadJob` API in ThreadPoolExecutor
- **gallery-dl config is global singleton** — set once at startup from env vars, never modify concurrently
- **Pixiv auth requires both** refresh-token AND PHPSESSID cookie
- **Caddy runs on host** — not in Docker Compose, reverse-proxies into Docker internal network

## Environment Variables

All config via `.env` file (see `infra/.env.example`). Secrets never in git. Backend `config.py` uses pydantic-settings with type validation and defaults.

Key env vars: `APP_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, `BOT_TOKEN`, `BOT_WEBHOOK_URL`, `BOT_ADMIN_IDS`, `MAX_IMAGE_SIZE` (6MB), `PIXIV_REFRESH_TOKEN`, `PIXIV_PHPSESSID`.

## v1 Lessons Applied

- S3 key normalization + post-upload URL verification
- Multi-stage Dockerfiles with pinned base images
- Stream-based S3 uploads (no memory buffering)
- Unified `BOT_ADMIN_IDS` middleware auth
- phash prefix-bucket indexing for O(1) dedup
- Explicit database indexes in Alembic migrations
- TanStack Query configured correctly from day one
- Caddy Souin cache layer (v1 had SSR but no caching)

## Development Commands

```bash
# Start all services
docker compose -f infra/docker-compose.dev.yml up

# Run backend locally
cd backend && uvicorn app.main:app --reload

# Run bot locally
cd bot && python -m app.main

# Run frontend dev server
cd frontend && npm run dev

# Database migration
cd backend && alembic upgrade head

# Create new migration
cd backend && alembic revision --autogenerate -m "description"
```