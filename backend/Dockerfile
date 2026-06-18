# ── Stage 1: Install dependencies ──────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install system dependencies needed for Pillow and imagehash
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libjpeg-dev \
        libpng-dev \
        libwebp-dev \
        zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Dev image (hot-reload, debug tools) ──────────────────────
FROM python:3.12-slim AS dev

# Install runtime system libraries + dev tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libjpeg62-turbo \
        libpng16-16 \
        libwebp7 \
        zlib1g \
        curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application code (will be overridden by volume mount in dev)
COPY . .

EXPOSE 8000

# Dev server with hot-reload (overridden by docker-compose.dev.yml command)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 3: Production image ─────────────────────────────────────────
FROM python:3.12-slim

# Install runtime system libraries for Pillow
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libjpeg62-turbo \
        libpng16-16 \
        libwebp7 \
        zlib1g && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Ensure alembic directory exists for migrations
RUN mkdir -p /app/alembic/versions

# Switch to non-root user
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]