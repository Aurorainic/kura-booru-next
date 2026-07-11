# =============================================================================
# Kura Booru — Nuxt/Nitro multi-stage Dockerfile
# =============================================================================
# Build:
#   docker build -t kura-booru-web:latest --build-arg KURA_VERSION=v0.7.0 .
#   docker build -t kura-booru-web:latest --target dev .           # hot-reload
# =============================================================================

# ── Stage 1: deps ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ──
# ponytail: NODE_ENV=production 是 prod 构建根因开关。Nuxt 按 NODE_ENV 决定
# build/dev 入口、devtools、客户端产物 — 缺失 = 静默产出 dev 包(网页含 "nuxt dev"
# 文案、左下角 dev 角标)。validate-build-stage 防误删:缺失 NODE_ENV 或非
# production 时构建直接失败,绝不让 dev 包进入 :<tag> / :latest。
FROM node:22-alpine AS build
ARG KURA_VERSION
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV KURA_VERSION=${KURA_VERSION}
# nuxt.config reads process.env.NODE_ENV to decide whether @nuxt/devtools is
# registered into the client bundle. The base node image leaves NODE_ENV unset
# during `npm run build`, so devtools shipped to prod again after the v0.7.2
# upgrade. Pin it here at the build stage — the production stage sets it again
# for runtime, but the build-time value is what gates the client build.
ENV NODE_ENV=production
RUN test "${NODE_ENV:-}" = "production" || { echo "FATAL: build stage requires NODE_ENV=production, got '${NODE_ENV:-unset}' — this would ship a dev bundle to GHCR"; exit 1; }
RUN npm run build

# ── Stage 3: production ──
FROM node:22-alpine AS production
WORKDIR /app
COPY --from=build /app/.output ./.output
EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
ARG KURA_VERSION
ENV KURA_VERSION=${KURA_VERSION}
CMD ["node", ".output/server/index.mjs"]

# ── Stage 4: dev (hot-reload, for local dev only) ──
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
