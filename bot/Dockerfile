# ── Stage 1: Install dependencies ──────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

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

# ── Stage 2: Dev image ────────────────────────────────────────────────
FROM python:3.12-slim AS dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Use Aliyun Debian mirror
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
    && sed -i 's/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

# Install curl for health check + dev convenience
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed dependencies from builder
COPY --from=builder /install /usr/local

# Copy application code (will be overridden by volume mount in dev)
COPY app/ ./app/

EXPOSE 8080

CMD ["python", "-m", "app.main"]

# ── Stage 3: Production image ─────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# Copy installed dependencies from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY --chown=appuser:appuser app/ ./app/

# Switch to non-root user
USER appuser

# Expose webhook port
EXPOSE 8080

# Health check via HTTP GET /
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/')" || exit 1

CMD ["python", "-m", "app.main"]
