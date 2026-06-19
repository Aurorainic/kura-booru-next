# ── Stage 1: Install dependencies ──────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

# Use npmmirror for faster npm install in China
RUN npm config set registry https://registry.npmmirror.com

RUN npm ci

# ── Stage 2: Dev image (Astro dev server with HMR) ─────────────────────
FROM node:22-slim AS dev

WORKDIR /app

# Copy installed dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Source code will be volume-mounted in dev
EXPOSE 4321

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ── Stage 3: Build ────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
RUN npm run build

# ── Stage 4: Production ───────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# Create non-root user
RUN addgroup --system --gid 1001 appgroup && adduser --system --uid 1001 appuser

# Copy built output from builder
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist

# Copy node_modules for SSR runtime
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

USER appuser

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:4321/').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server/entry.mjs"]