# Docker 镜像构建 & 推送 (Huawei Cloud SWR)

## 构建镜像

```bash
# Backend (API) — 默认 CMD 启动 uvicorn
docker build -t kura-booru-next-backend:latest ./backend

# Worker — 复用同一个 backend 镜像，运行时覆盖命令为 ARQ worker
docker build -t kura-booru-next-worker:latest ./backend

# Bot — aiogram 3 Telegram Bot (webhook mode)
docker build -t kura-booru-next-bot:latest ./bot

# Frontend — Astro SSR (Node.js runtime)
docker build -t kura-booru-next-frontend:latest ./frontend
```

> **注意**：`backend` 与 `worker` 共用同一个 `backend/Dockerfile`，区别仅在于容器启动命令。
> - Backend 默认：`uvicorn app.main:app --host 0.0.0.0 --port 8000`
> - Worker 运行时覆盖：`arq app.tasks.worker.WorkerSettings`

## 打标签 & 推送到 SWR

```bash
# 变量（可按需修改）
TAG=${TAG:-latest}
REGISTRY="swr.cn-east-3.myhuaweicloud.com/lainsaka"

# 1. Backend (API)
docker tag kura-booru-next-backend:${TAG} ${REGISTRY}/kura-booru-next-backend:${TAG}
docker push ${REGISTRY}/kura-booru-next-backend:${TAG}

# 2. Worker (ARQ)
docker tag kura-booru-next-worker:${TAG} ${REGISTRY}/kura-booru-next-worker:${TAG}
docker push ${REGISTRY}/kura-booru-next-worker:${TAG}

# 3. Bot
docker tag kura-booru-next-bot:${TAG} ${REGISTRY}/kura-booru-next-bot:${TAG}
docker push ${REGISTRY}/kura-booru-next-bot:${TAG}

# 4. Frontend
docker tag kura-booru-next-frontend:${TAG} ${REGISTRY}/kura-booru-next-frontend:${TAG}
docker push ${REGISTRY}/kura-booru-next-frontend:${TAG}
```

## 示例（使用具体版本号）

```bash
TAG=v0.1
REGISTRY="swr.cn-east-3.myhuaweicloud.com/lainsaka"

# Backend (API)
docker tag kura-booru-next-backend:${TAG} ${REGISTRY}/kura-booru-next-backend:${TAG}
docker push ${REGISTRY}/kura-booru-next-backend:${TAG}

# Worker (ARQ)
docker tag kura-booru-next-worker:${TAG} ${REGISTRY}/kura-booru-next-worker:${TAG}
docker push ${REGISTRY}/kura-booru-next-worker:${TAG}

# Bot
docker tag kura-booru-next-bot:${TAG} ${REGISTRY}/kura-booru-next-bot:${TAG}
docker push ${REGISTRY}/kura-booru-next-bot:${TAG}

# Frontend
docker tag kura-booru-next-frontend:${TAG} ${REGISTRY}/kura-booru-next-frontend:${TAG}
docker push ${REGISTRY}/kura-booru-next-frontend:${TAG}
```

## 登录 SWR

```bash
docker login swr.cn-east-3.myhuaweicloud.com --username=<区域@用户名>
```

> 用户名格式为 `<区域名>@<华为云账号名>`，密码为 SWR 临时登录指令中的密码。

## 生产构建建议

```bash
# 使用 buildx 支持多平台（可选）
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t swr.cn-east-3.myhuaweicloud.com/lainsaka/kura-booru-next-backend:v0.1 \
  -t swr.cn-east-3.myhuaweicloud.com/lainsaka/kura-booru-next-worker:v0.1 \
  -t swr.cn-east-3.myhuaweicloud.com/lainsaka/kura-booru-next-bot:v0.1 \
  -t swr.cn-east-3.myhuaweicloud.com/lainsaka/kura-booru-next-frontend:v0.1 \
  ./backend --push
```

## 本地测试运行

```bash
# Backend (API)
docker run -p 8000:8000 --env-file .env kura-booru-next-backend:latest

# Worker (ARQ)
docker run --env-file .env kura-booru-next-worker:latest arq app.tasks.worker.WorkerSettings

# Bot
docker run -p 8080:8080 --env-file .env kura-booru-next-bot:latest

# Frontend
docker run -p 4321:4321 --env-file .env kura-booru-next-frontend:latest
```
