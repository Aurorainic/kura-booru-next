#!/usr/bin/env bash
# =============================================================================
# Kura Booru Next — Environment Variable Validator
# =============================================================================
#
# Usage:
#   ./validate-env.sh [prod|dev]
#
# Checks if required environment variables are set in ../.env
#
# Modes:
#   prod — Strict validation: all required vars must be set
#   dev  — Lenient validation: allows development defaults
#
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MODE="${1:-prod}"
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    log_error ".env file not found at: $ENV_FILE"
    log_info "Copy .env.example to .env and configure it:"
    log_info "  cp infra/.env.example infra/.env"
    exit 1
fi

# Source the .env file
set -a
source "$ENV_FILE"
set +a

# Required variables for production
PROD_REQUIRED_VARS=(
    "SITE_URL"
    "SECRET_KEY"
    "SESSION_SECRET"
    "BACKEND_API_KEY"
    "S3_ENDPOINT"
    "S3_EXTERNAL_URL"
    "S3_ACCESS_KEY"
    "S3_SECRET_KEY"
    "S3_BUCKET"
    "S3_REGION"
    "DATABASE_URL"
    "POSTGRES_USER"
    "POSTGRES_PASSWORD"
    "POSTGRES_DB"
    "REDIS_URL"
    "BOT_TOKEN"
    "BOT_ADMIN_IDS"
)

# Check a variable is set and not empty
check_var() {
    local var_name="$1"
    local var_value="${!var_name:-}"

    if [ -z "$var_value" ]; then
        return 1
    fi
    return 0
}

# Validate production mode
validate_prod() {
    log_info "Validating environment variables for PRODUCTION..."
    echo ""

    local missing_vars=()
    local weak_vars=()

    # Check required variables
    for var in "${PROD_REQUIRED_VARS[@]}"; do
        if ! check_var "$var"; then
            missing_vars+=("$var")
        fi
    done

    # Check for weak/insecure values
    if [ "${SECRET_KEY:-}" = "change-me-in-production" ]; then
        weak_vars+=("SECRET_KEY (using default value)")
    fi

    if [ "${POSTGRES_PASSWORD:-}" = "kura_password" ]; then
        weak_vars+=("POSTGRES_PASSWORD (using weak default)")
    fi

    if [ "${S3_ACCESS_KEY:-}" = "minioadmin" ]; then
        weak_vars+=("S3_ACCESS_KEY (using dev default)")
    fi

    if [ "${S3_SECRET_KEY:-}" = "minioadmin" ]; then
        weak_vars+=("S3_SECRET_KEY (using dev default)")
    fi

    # Report results
    if [ ${#missing_vars[@]} -gt 0 ]; then
        log_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
    fi

    if [ ${#weak_vars[@]} -gt 0 ]; then
        log_warn "Weak or insecure values detected:"
        for var in "${weak_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
    fi

    if [ ${#missing_vars[@]} -eq 0 ] && [ ${#weak_vars[@]} -eq 0 ]; then
        log_success "All production environment variables are properly configured"
        return 0
    elif [ ${#missing_vars[@]} -gt 0 ]; then
        log_error "Production validation failed"
        return 1
    else
        log_warn "Production validation passed with warnings"
        return 0
    fi
}

# Validate development mode
validate_dev() {
    log_info "Validating environment variables for DEVELOPMENT..."
    echo ""

    local missing_critical=()

    # In dev mode, only check truly critical variables
    local dev_critical_vars=(
        "BOT_TOKEN"
    )

    for var in "${dev_critical_vars[@]}"; do
        if ! check_var "$var"; then
            missing_critical+=("$var")
        fi
    done

    # Report results
    if [ ${#missing_critical[@]} -gt 0 ]; then
        log_warn "Missing critical environment variables (required even in dev):"
        for var in "${missing_critical[@]}"; do
            echo "  - $var"
        done
        echo ""
        log_info "Development mode allows weak defaults for most variables"
        log_info "But the above variables must be set for proper functionality"
        return 1
    else
        log_success "Development environment is ready"
        log_info "Using development defaults (not suitable for production)"
        return 0
    fi
}

# Main logic
main() {
    case "$MODE" in
        prod|production)
            validate_prod
            ;;
        dev|development)
            validate_dev
            ;;
        --help|-h)
            echo "Usage: $0 [prod|dev]"
            echo ""
            echo "Modes:"
            echo "  prod  — Strict validation for production (default)"
            echo "  dev   — Lenient validation for development"
            ;;
        *)
            log_error "Unknown mode: $MODE"
            log_info "Usage: $0 [prod|dev]"
            exit 1
            ;;
    esac
}

main
