# ── Stage 1: Install dependencies ──────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Use Aliyun Debian mirror for faster downloads in China
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
    && sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

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

RUN pip install --no-cache-dir --no-compile --prefix=/install -r requirements.txt \
    -i https://mirrors.aliyun.com/pypi/simple/ \
    --trusted-host mirrors.aliyun.com \
    && find /install -type d \( -name test -o -name tests -o -name __pycache__ \) -prune -exec rm -rf {} + \
    && find /install -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete \
    && rm -rf /install/lib/python3.12/site-packages/pip* \
              /install/lib/python3.12/site-packages/setuptools* \
              /install/lib/python3.12/site-packages/wheel* \
              /install/bin/pip* \
              /install/bin/wheel

# ── Stage 2: Dev image (hot-reload, debug tools) ──────────────────────
FROM python:3.12-slim AS dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Use Aliyun Debian mirror
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
    && sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

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
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini
COPY scripts/ ./scripts/

EXPOSE 8000

# Dev server with hot-reload (overridden by docker-compose.dev.yml command)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 3: Production image ─────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Use Aliyun Debian mirror
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
    && sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

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

# Copy only runtime files
COPY --chown=appuser:appuser app/ ./app/
COPY --chown=appuser:appuser alembic/ ./alembic/
COPY --chown=appuser:appuser alembic.ini ./alembic.ini
COPY --chown=appuser:appuser scripts/ ./scripts/

# Switch to non-root user
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
