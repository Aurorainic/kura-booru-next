# Kura Booru — Nuxt/Nitro multi-stage Dockerfile
# Build: docker build -t kura-booru-web:latest --build-arg KURA_VERSION=v0.7.0 .
#        docker build -t kura-booru-web:latest --target dev .  # hot-reload

# ── Stage 1: deps ──
FROM node:22-alpine AS deps
WORKDIR /app
# 国内加速:容器内无宿主机 ~/.npmrc,且 pnpm 不读 npm_config_*;需写用户级 .npmrc(默认 npmmirror,--build-arg NPM_REGISTRY 可覆盖)
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}"
RUN npm install -g pnpm@11.3.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extension/package.json ./extension/package.json
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ──
FROM node:22-alpine AS build
ARG KURA_VERSION
WORKDIR /app
# 同 deps:本阶段 pnpm 安装也走加速镜像
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}"
RUN npm install -g pnpm@11.3.0
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV KURA_VERSION=${KURA_VERSION}
# Build-time NODE_ENV=production gates @nuxt/devtools inclusion (base image leaves it unset, which re-shipped devtools to prod after v0.7.2). Runtime stage sets it again.
ENV NODE_ENV=production
RUN test "${NODE_ENV:-}" = "production" || { echo "FATAL: build stage requires NODE_ENV=production, got '${NODE_ENV:-unset}' — this would ship a dev bundle to GHCR"; exit 1; }
RUN pnpm run build

# ── Stage 3: production ──
FROM node:22-alpine AS production
WORKDIR /app

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /app/.output ./.output
EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512 --max-semi-space-size=32"
ARG KURA_VERSION
ENV KURA_VERSION=${KURA_VERSION}
USER appuser
CMD ["node", ".output/server/index.mjs"]

# ── Stage 4: dev (hot-reload, for local dev only) ──
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "dev", "--", "--host", "0.0.0.0"]
