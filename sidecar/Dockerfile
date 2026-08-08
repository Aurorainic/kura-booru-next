FROM python:3.12-slim

WORKDIR /app

# Install system deps for Pillow + gallery-dl
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# 单人部署防 zip bomb：限制 Pillow 解码上限（50M 像素）
ENV PILLOW_MAX_IMAGE_PIXELS=50000000
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

COPY sidecar.py .

USER appuser
CMD ["python", "sidecar.py"]
