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

COPY sidecar.py .

USER appuser
CMD ["python", "sidecar.py"]
