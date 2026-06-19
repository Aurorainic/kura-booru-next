# Docker 镜像管理规范

## 镜像标签策略

采用 **latest + versioned** 双标签模式，贴合现代容器镜像管理实践：

### 标签类型
- **`latest`** — 始终指向当前最新稳定版本，用于日常部署和拉取
- **`v0.1.0`, `v0.1.1`, ...** — 版本化标签，用于回滚和审计

### 标签生命周期
1. **构建时**：每次发布同时打 `latest` 和 `v0.1.x` 双标签
2. **推送时**：同时推送到 SWR（latest + versioned）
3. **部署时**：生产环境使用 `latest` 标签，确保自动获取最新版本
4. **回滚时**：指定具体版本标签（如 `v0.1.2`）进行回滚

### 示例流程
```bash
# v0.1.2 发布流程
docker build -t kura-booru-next-backend:v0.1.2 -t kura-booru-next-backend:latest ./backend
docker build -t kura-booru-next-bot:v0.1.2 -t kura-booru-next-bot:latest ./bot
docker build -t kura-booru-next-frontend:v0.1.2 -t kura-booru-next-frontend:latest ./frontend
```

---

## 构建镜像

```bash
# Backend (API + Worker 共用) — 默认 CMD 启动 uvicorn，Worker 运行时覆盖为 ARQ
docker build --provenance=false --sbom=false -t kura-booru-next-backend:v0.1.2 -t kura-booru-next-backend:latest ./backend

# Bot — aiogram 3 Telegram Bot (webhook mode)
docker build --provenance=false --sbom=false -t kura-booru-next-bot:v0.1.2 -t kura-booru-next-bot:latest ./bot

# Frontend — Astro SSR (Node.js runtime)
docker build --provenance=false --sbom=false -t kura-booru-next-frontend:v0.1.2 -t kura-booru-next-frontend:latest ./frontend
```

> **注意**：
> - `backend` 与 `worker` 共用同一个 `backend/Dockerfile`，区别仅在于容器启动命令。
>   - Backend 默认：`uvicorn app.main:app --host 0.0.0.0 --port 8000`
>   - Worker 运行时覆盖：`arq app.tasks.worker.WorkerSettings`
> - `--provenance=false --sbom=false`：Huawei SWR 不支持 BuildKit attestation manifests，必须禁用
> - 构建上下文必须指定目录（如 `./backend`），不能省略

---

## 登录 SWR

```bash
docker login swr.cn-east-3.myhuaweicloud.com
```

---

## 打标签 & 推送到 SWR

```bash
VERSION=v0.1.2
REGISTRY="swr.cn-east-3.myhuaweicloud.com/lainsaka"

# 1. Backend (API + Worker 共用)
docker tag kura-booru-next-backend:${VERSION} ${REGISTRY}/kura-booru-next-backend:${VERSION}
docker tag kura-booru-next-backend:latest ${REGISTRY}/kura-booru-next-backend:latest
docker push ${REGISTRY}/kura-booru-next-backend:${VERSION}
docker push ${REGISTRY}/kura-booru-next-backend:latest

# 2. Bot
docker tag kura-booru-next-bot:${VERSION} ${REGISTRY}/kura-booru-next-bot:${VERSION}
docker tag kura-booru-next-bot:latest ${REGISTRY}/kura-booru-next-bot:latest
docker push ${REGISTRY}/kura-booru-next-bot:${VERSION}
docker push ${REGISTRY}/kura-booru-next-bot:latest

# 3. Frontend
docker tag kura-booru-next-frontend:${VERSION} ${REGISTRY}/kura-booru-next-frontend:${VERSION}
docker tag kura-booru-next-frontend:latest ${REGISTRY}/kura-booru-next-frontend:latest
docker push ${REGISTRY}/kura-booru-next-frontend:${VERSION}
docker push ${REGISTRY}/kura-booru-next-frontend:latest
```

---

## 本地测试运行

```bash
# Backend (API)
docker run -p 8000:8000 --env-file .env kura-booru-next-backend:v0.1.2

# Worker (ARQ)
docker run --env-file .env kura-booru-next-backend:v0.1.2 arq app.tasks.worker.WorkerSettings

# Bot
docker run -p 8080:8080 --env-file .env kura-booru-next-bot:v0.1.2

# Frontend
docker run -p 4321:4321 --env-file .env kura-booru-next-frontend:v0.1.2
```

---

## 部署到生产

### docker-compose.yml 配置
```yaml
services:
  backend:
    image: kura-booru-next-backend:latest
    # ...
  
  worker:
    image: kura-booru-next-backend:latest
    # ...
  
  bot:
    image: kura-booru-next-bot:latest
    # ...
  
  frontend:
    image: kura-booru-next-frontend:latest
    # ...
```

### 部署流程
```bash
# 在生产服务器上
cd infra/
docker compose pull
docker compose up -d
```

### 回滚流程
```bash
# 修改 docker-compose.yml 中的镜像标签为具体版本
# 例如：image: kura-booru-next-backend:v0.1.2

# 然后重新部署
docker compose up -d
```

---

## 清理旧版本镜像

```bash
# 查看所有 kura-booru 镜像
docker images | grep kura-booru

# 删除指定版本（保留 latest）
docker rmi kura-booru-next-backend:v0.1.0 kura-booru-next-backend:v0.1.1

# 批量删除除 latest 和当前版本外的所有旧版本
CURRENT_VERSION="v0.1.2"
docker images --format "{{.Repository}}:{{.Tag}}" | grep kura-booru | grep -v latest | grep -v ${CURRENT_VERSION} | xargs docker rmi -f
```

---

## 版本发布检查清单

### 发布前
- [ ] 代码已合并到 main 分支
- [ ] CHANGELOG.md 已更新
- [ ] CLAUDE.md 当前状态已更新
- [ ] PLAN.md 完成项已标记

### 构建 & 推送
- [ ] 构建三个镜像（backend, bot, frontend）同时打 latest + versioned 标签
- [ ] 推送到 SWR（latest + versioned）
- [ ] 验证 SWR 上的镜像标签

### 部署 & 验证
- [ ] 生产服务器拉取最新镜像
- [ ] 重启所有容器
- [ ] 验证 health check 通过
- [ ] 验证核心功能正常
- [ ] Git tag 创建并推送

### 发布后
- [ ] 清理旧版本本地镜像
- [ ] 更新文档（如需要）
