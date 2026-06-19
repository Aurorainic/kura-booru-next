# Docker 镜像构建 & 推送 (Huawei Cloud SWR)

## 构建镜像

```bash
# Backend (API + Worker 共用) — 默认 CMD 启动 uvicorn，Worker 运行时覆盖为 ARQ
docker build -t kura-booru-next-backend:v0.1.0 ./backend

# Bot — aiogram 3 Telegram Bot (webhook mode)
docker build -t kura-booru-next-bot:v0.1.0 ./bot

# Frontend — Astro SSR (Node.js runtime)
docker build -t kura-booru-next-frontend:v0.1.0 ./frontend
```

> **注意**：`backend` 与 `worker` 共用同一个 `backend/Dockerfile`，区别仅在于容器启动命令。
> - Backend 默认：`uvicorn app.main:app --host 0.0.0.0 --port 8000`
> - Worker 运行时覆盖：`arq app.tasks.worker.WorkerSettings`

## 登录 SWR

```bash
docker login swr.cn-east-3.myhuaweicloud.com
```

## 打标签 & 推送到 SWR

```bash
TAG=v0.1.0
REGISTRY="swr.cn-east-3.myhuaweicloud.com/lainsaka"

# 1. Backend (API + Worker 共用)
docker tag kura-booru-next-backend:${TAG} ${REGISTRY}/kura-booru-next-backend:${TAG}
docker push ${REGISTRY}/kura-booru-next-backend:${TAG}

# 2. Bot
docker tag kura-booru-next-bot:${TAG} ${REGISTRY}/kura-booru-next-bot:${TAG}
docker push ${REGISTRY}/kura-booru-next-bot:${TAG}

# 3. Frontend
docker tag kura-booru-next-frontend:${TAG} ${REGISTRY}/kura-booru-next-frontend:${TAG}
docker push ${REGISTRY}/kura-booru-next-frontend:${TAG}
```

## 本地测试运行

```bash
# Backend (API)
docker run -p 8000:8000 --env-file .env kura-booru-next-backend:v0.1.0

# Worker (ARQ)
docker run --env-file .env kura-booru-next-backend:v0.1.0 arq app.tasks.worker.WorkerSettings

# Bot
docker run -p 8080:8080 --env-file .env kura-booru-next-bot:v0.1.0

# Frontend
docker run -p 4321:4321 --env-file .env kura-booru-next-frontend:v0.1.0
```
