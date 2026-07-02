#!/usr/bin/env bash
# =============================================================================
# Kura Booru Next — Database Migration Script (Dev → Prod)
# =============================================================================
#
# Usage:
#   ./migrate-db.sh                       # Interactive: dump → confirm → import
#   ./migrate-db.sh --dump-only           # Only export dump file
#   ./migrate-db.sh --import-only <file>  # Only import specified dump file
#
# Environment variables (can be set in .env):
#   DEV_PG_CONTAINER   — Dev PostgreSQL container name (default: kura-postgres-dev)
#   PROD_DATABASE_URL  — Production database connection string (postgresql://...)
#   POSTGRES_DB        — Database name (default: kurabooru)
#   POSTGRES_USER      — Database user (default: kura)
#
# Examples:
#   ./migrate-db.sh --dump-only
#   ./migrate-db.sh --import-only dumps/backup-20260619-143022.sql
#   PROD_DATABASE_URL="postgresql://prod-user:pass@prod-host:5432/kurabooru" ./migrate-db.sh
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DEV_PG_CONTAINER="${DEV_PG_CONTAINER:-kura-postgres}"
POSTGRES_DB="${POSTGRES_DB:-kurabooru}"
POSTGRES_USER="${POSTGRES_USER:-kura}"
PROD_DATABASE_URL="${PROD_DATABASE_URL:-}"
DUMPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../dumps" && pwd)"

# Ensure dumps directory exists
mkdir -p "$DUMPS_DIR"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Dump database from dev container
dump_database() {
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local dump_file="$DUMPS_DIR/backup-${timestamp}.sql"

    log_info "Dumping database from dev container..."

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${DEV_PG_CONTAINER}$"; then
        log_error "Dev PostgreSQL container '${DEV_PG_CONTAINER}' is not running"
        log_info "Start it with: cd infra && docker compose up -d postgres"
        exit 1
    fi

    # Dump database
    docker exec "$DEV_PG_CONTAINER" \
        pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        --clean --if-exists --no-owner --no-privileges \
        > "$dump_file"

    if [ $? -eq 0 ]; then
        log_info "Database dumped successfully to: $dump_file"
        log_info "Dump size: $(du -h "$dump_file" | cut -f1)"
        echo "$dump_file"
    else
        log_error "Failed to dump database"
        exit 1
    fi
}

# Import dump to production database
import_database() {
    local dump_file="$1"

    if [ ! -f "$dump_file" ]; then
        log_error "Dump file not found: $dump_file"
        exit 1
    fi

    if [ -z "$PROD_DATABASE_URL" ]; then
        log_error "PROD_DATABASE_URL is not set"
        log_info "Set it in .env or as environment variable:"
        log_info "  export PROD_DATABASE_URL='postgresql://user:pass@host:5432/dbname'"
        exit 1
    fi

    log_warn "⚠️  WARNING: This will overwrite the production database!"
    log_warn "Dump file: $dump_file"
    log_warn "Target: $PROD_DATABASE_URL"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        log_info "Import cancelled"
        exit 0
    fi

    log_info "Importing dump to production database..."

    # Import dump
    psql "$PROD_DATABASE_URL" < "$dump_file"

    if [ $? -eq 0 ]; then
        log_info "Database imported successfully"
    else
        log_error "Failed to import database"
        exit 1
    fi
}

# Main logic
main() {
    case "${1:-}" in
        --dump-only)
            dump_database
            ;;
        --import-only)
            if [ -z "${2:-}" ]; then
                log_error "Missing dump file path"
                log_info "Usage: $0 --import-only <dump-file.sql>"
                exit 1
            fi
            import_database "$2"
            ;;
        --help|-h)
            head -30 "$0" | tail -28
            ;;
        "")
            # Interactive mode
            log_info "Starting database migration (dev → prod)"
            echo ""

            # Step 1: Dump
            dump_file=$(dump_database)
            echo ""

            # Step 2: Confirm
            log_info "Dump created: $dump_file"
            log_info "Next step: Import to production database"
            echo ""
            read -p "Continue with import? (yes/no): " confirm

            if [ "$confirm" != "yes" ]; then
                log_info "Import cancelled. Dump file saved at: $dump_file"
                exit 0
            fi

            # Step 3: Import
            import_database "$dump_file"
            ;;
        *)
            log_error "Unknown option: $1"
            log_info "Usage: $0 [--dump-only|--import-only <file>|--help]"
            exit 1
            ;;
    esac
}

main "$@"
