"""API constants shared across endpoint modules."""

from __future__ import annotations

# Allowed per_page values (like safebooru)
ALLOWED_PER_PAGE = {20, 40, 100}

# Pagination defaults
DEFAULT_PER_PAGE = 40
MAX_PER_PAGE = 100


def clamp_per_page(value: int) -> int:
    """Clamp per_page to an allowed value."""
    if value in ALLOWED_PER_PAGE:
        return value
    # Find closest allowed value
    if value < min(ALLOWED_PER_PAGE):
        return min(ALLOWED_PER_PAGE)
    if value > max(ALLOWED_PER_PAGE):
        return max(ALLOWED_PER_PAGE)
    # Pick the nearest allowed value
    return min(ALLOWED_PER_PAGE, key=lambda x: abs(x - value))
