# ── Stage 1: Install ALL dependencies (incl. devDeps for the build) ────
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

# Use npmmirror for faster npm install in China
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --include=dev

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

ARG PUBLIC_GIT_TAG=dev
ARG APP_URL
ARG APP_DOMAIN
ARG PUBLIC_API_URL
ARG PUBLIC_S3_EXTERNAL_URL
ENV PUBLIC_GIT_TAG=${PUBLIC_GIT_TAG}
ENV APP_URL=${APP_URL}
ENV APP_DOMAIN=${APP_DOMAIN}
ENV PUBLIC_API_URL=${PUBLIC_API_URL}
ENV PUBLIC_S3_EXTERNAL_URL=${PUBLIC_S3_EXTERNAL_URL}
ENV NODE_ENV=production
RUN npm run build

# ── Stage 4: Production runtime (minimal node_modules) ─────────────────
# Why this stage does what it does:
#
# 1. `npm ci --omit=dev --omit=optional --ignore-scripts`
#    Drops everything in devDependencies (typescript / @types/* /
#    vite-tsconfig-paths) and every `optionalDependency` declared anywhere
#    in the resolved tree — that includes `sharp` (Astro's image-service
#    dependency). We don't use astro:assets / <Image>, so sharp is dead
#    weight: ~17 MB of native libvips + the 410 KB sharp.node binding.
#    `--ignore-scripts` blocks the (slow, large) postinstall scripts of
#    tools like esbuild/rollup/sharp that prebuild platform binaries.
#
# 2. Explicit `rm -rf` for tooling-only native modules:
#      - esbuild / @esbuild : only used by Vite at build time
#      - rollup / @rollup    : only used by Vite at build time
#      - lightningcss        : used by Tailwind v4 at build time
#      - @tailwindcss/oxide  : used by Tailwind v4 at build time
#      - vite                : Astro loads it transitively, but only via
#                              dev/build-time entry points; the SSR bundle
#                              does NOT `import vite` at runtime
#      - @img                : platform-specific sharp bindings (libvips)
#    Verified: `grep -rE "from ['\"]vite['\"]|require\\(['\"]vite" dist/server/`
#    returns nothing — the SSR bundle never loads these.
#
# 3. Pruning TS source maps / non-d.ts TS files / .bin stubs:
#    The SSR runtime only loads the JS bundles from `dist/server`, which
#    already contain all compiled code. Source maps, .ts sources, and the
#    .bin shims (vite, tsc, esbuild, etc.) are useless at runtime.
#
# Result: the production image carries only what `dist/server/entry.mjs`
# transitively `import`s at request time, nothing else.
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# Create non-root user
RUN addgroup --system --gid 1001 appgroup && adduser --system --uid 1001 appuser

# Copy package.json + lockfile from the deps stage (where they were used by `npm ci`)
COPY --from=deps --chown=appuser:appgroup /app/package.json ./package.json
COPY --from=deps --chown=appuser:appgroup /app/package-lock.json ./package-lock.json

RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --omit=dev --omit=optional --ignore-scripts \
    && rm -rf node_modules/sharp \
              node_modules/@img \
              node_modules/esbuild \
              node_modules/@esbuild \
              node_modules/rollup \
              node_modules/@rollup \
              node_modules/lightningcss \
              node_modules/lightningcss-linux-x64-gnu \
              node_modules/@tailwindcss/oxide \
              node_modules/@tailwindcss/oxide-linux-x64-gnu \
              node_modules/vite \
              node_modules/.cache \
              node_modules/.bin \
              node_modules/@babel \
              node_modules/@shikijs \
              node_modules/shiki \
              node_modules/prismjs \
              node_modules/@types \
              node_modules/typescript \
              node_modules/caniuse-lite \
              node_modules/browserslist \
              node_modules/lucide-react/dist/lucide-react.d.ts \
              node_modules/lucide-react/dist/lucide-react.prefixed.d.ts \
              node_modules/lucide-react/dist/lucide-react.suffixed.d.ts \
              node_modules/lucide-react/dist/umd \
              node_modules/lucide-react/dist/esm/icons \
              node_modules/lucide-react/dist/esm/icons.d.ts \
              node_modules/lucide-react/dist/esm/dynamicIconImports.js \
              node_modules/lucide-react/dist/esm/dynamicIconImports.d.ts \
              node_modules/lucide-react/dist/esm/dynamic.js \
              node_modules/lucide-react/dist/esm/dynamic.d.ts \
              node_modules/lucide-react/dynamic.mjs \
              node_modules/lucide-react/dynamic.d.ts \
              node_modules/lucide-react/dynamicIconImports.mjs \
              node_modules/lucide-react/dynamicIconImports.d.ts \
              node_modules/lucide-react/README.md \
    && find node_modules -name "*.map" -delete \
    && find node_modules \( -name "*.ts" -o -name "*.tsx" -o -name "*.cts" -o -name "*.mts" \) ! -name "*.d.ts" -delete \
    && find node_modules -name "*.d.ts.map" -delete \
    && find node_modules -type f \( -name "LICENSE*" -o -name "license*" -o -name "LICENCE*" -o -name "README*" \) -delete \
    && find node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "fixtures" -o -name "docs" \) -not -path "*/node_modules/*/node_modules/*" -exec rm -rf {} + \
    && npm cache clean --force

# Copy the compiled output last so layer caching skips it on rebuilds
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist

USER appuser

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:4321/').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server/entry.mjs"]
