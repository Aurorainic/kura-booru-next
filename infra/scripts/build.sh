#!/bin/bash
# =============================================================================
# Kura Booru Next — Build Script
# =============================================================================
# Builds Docker images with proper version tags.
# Usage:
#   ./build.sh [version]          # Build all images with version tag (cached)
#   ./build.sh v0.6.0            # Build with specific version
#   ./build.sh                    # Auto-detect from git tags
#   ./build.sh --no-cache v0.6.0 # Force no-cache build
#
# The version is injected into:
#   - Image tags (e.g., kura-booru-next-frontend:v0.6.0)
#   - Frontend PUBLIC_GIT_TAG build arg (shows in footer)
#   - Backend package version (if applicable)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

NO_CACHE=false
VERSION=""

# Parse args
for arg in "$@"; do
    case "$arg" in
        --no-cache) NO_CACHE=true ;;
        *) VERSION="$arg" ;;
    esac
done

# Determine version
if [ -z "$VERSION" ]; then
    VERSION="$(git -C "$PROJECT_ROOT" describe --tags --always 2>/dev/null || echo "dev")"
fi

DOCKER_ARGS=()
if [ "$NO_CACHE" = true ]; then
    DOCKER_ARGS+=(--no-cache)
fi

echo "========================================"
echo "Building Kura Booru Next"
echo "Version: ${VERSION}"
echo "Cache: $([ "$NO_CACHE" = true ] && echo "disabled (--no-cache)" || echo "enabled")"
echo "========================================"
echo

# Build backend image (multi-stage: dev + builder + runner)
echo "--- Building backend ---"
docker build \
    ${DOCKER_ARGS[@]+"${DOCKER_ARGS[@]}"} \
    --target runner \
    -t "kura-booru-next-backend:${VERSION}" \
    -t "kura-booru-next-backend:latest" \
    "${PROJECT_ROOT}/backend" 2>/dev/null || \
docker build \
    ${DOCKER_ARGS[@]+"${DOCKER_ARGS[@]}"} \
    -t "kura-booru-next-backend:${VERSION}" \
    -t "kura-booru-next-backend:latest" \
    "${PROJECT_ROOT}/backend"

# Build bot image (multi-stage: dev + runner)
echo "--- Building bot ---"
docker build \
    ${DOCKER_ARGS[@]+"${DOCKER_ARGS[@]}"} \
    -t "kura-booru-next-bot:${VERSION}" \
    -t "kura-booru-next-bot:latest" \
    "${PROJECT_ROOT}/bot"

# Build frontend image with PUBLIC_GIT_TAG injected
echo "--- Building frontend ---"
docker build \
    ${DOCKER_ARGS[@]+"${DOCKER_ARGS[@]}"} \
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
