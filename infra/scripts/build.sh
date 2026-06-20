#!/bin/bash
# =============================================================================
# Kura Booru Next — Build Script
# =============================================================================
# Builds Docker images with proper version tags.
# Usage:
#   ./build.sh [version]          # Build all images with version tag
#   ./build.sh v0.1.1             # Build with specific version
#   ./build.sh                    # Auto-detect from git tags
#
# The version is injected into:
#   - Image tags (e.g., kura-booru-next-frontend:v0.1.1)
#   - Frontend PUBLIC_GIT_TAG build arg (shows in footer)
#   - Backend package version (if applicable)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Determine version
if [ -n "${1:-}" ]; then
    VERSION="$1"
else
    # Try git tag, fallback to short hash
    VERSION="$(git -C "$PROJECT_ROOT" describe --tags --always 2>/dev/null || echo "dev")"
fi

echo "========================================"
echo "Building Kura Booru Next"
echo "Version: ${VERSION}"
echo "========================================"
echo

# Build backend image (multi-stage: dev + builder + runner)
echo "--- Building backend ---"
docker build \
    --target runner \
    -t "kura-booru-next-backend:${VERSION}" \
    -t "kura-booru-next-backend:latest" \
    "${PROJECT_ROOT}/backend" 2>/dev/null || \
docker build \
    -t "kura-booru-next-backend:${VERSION}" \
    -t "kura-booru-next-backend:latest" \
    "${PROJECT_ROOT}/backend"

# Build bot image (multi-stage: dev + runner)
echo "--- Building bot ---"
docker build \
    -t "kura-booru-next-bot:${VERSION}" \
    -t "kura-booru-next-bot:latest" \
    "${PROJECT_ROOT}/bot"

# Build frontend image with PUBLIC_GIT_TAG injected
echo "--- Building frontend ---"
docker build \
    --build-arg "PUBLIC_GIT_TAG=${VERSION}" \
    --target runner \
    -t "kura-booru-next-frontend:${VERSION}" \
    -t "kura-booru-next-frontend:latest" \
    "${PROJECT_ROOT}/frontend"

echo
echo "========================================"
echo "Build complete!"
echo "========================================"
echo
echo "Images tagged:"
echo "  kura-booru-next-backend:${VERSION}"
echo "  kura-booru-next-bot:${VERSION}"
echo "  kura-booru-next-frontend:${VERSION}"
echo
echo "To deploy, update docker-compose.yml image tags and run:"
echo "  cd infra && docker compose up -d"
