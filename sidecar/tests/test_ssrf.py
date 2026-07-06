"""Smoke test for sidecar SSRF guards.

These functions are pure (no Redis, no network) so they're the cheapest layer
to lock down in CI. A regression here would be a security hole, not a flaky
test — see sidecar.py validate_url / _is_blocked_ip.

NOTE: validate_url() resolves the host via DNS, so only scheme-validation is
testable offline. The IP-range guard is covered directly via _is_blocked_ip.
"""

import pytest

import sidecar


def test_validate_url_accepts_https():
    """http/https URLs with a resolvable host are accepted (returns the URL)."""
    # pixiv.net is publicly resolvable and not in a blocked range.
    assert sidecar.validate_url("https://www.pixiv.net/artworks/123") == "https://www.pixiv.net/artworks/123"


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/file",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<script>",
        "gopher://example.com/",
    ],
)
def test_validate_url_rejects_non_http_schemes(url):
    """Non-http(s) schemes raise ValueError — the SSRF first-line guard."""
    with pytest.raises(ValueError, match="scheme"):
        sidecar.validate_url(url)


def test_validate_url_rejects_missing_host():
    """A scheme without a hostname is rejected (no silent pass-through)."""
    with pytest.raises(ValueError, match="hostname"):
        sidecar.validate_url("https:///path")


@pytest.mark.parametrize(
    "ip,blocked",
    [
        ("127.0.0.1", True),
        ("10.0.0.1", True),
        ("172.16.0.1", True),
        ("192.168.1.1", True),
        ("169.254.169.254", True),  # cloud metadata endpoint
        ("::1", True),
        ("fc00::1", True),  # IPv6 ULA
        ("8.8.8.8", False),
        ("1.1.1.1", False),
    ],
)
def test_is_blocked_ip_private_and_metadata_ranges(ip, blocked):
    """RFC1918, link-local, loopback, ULA, and the metadata endpoint are blocked."""
    assert sidecar._is_blocked_ip(ip) is blocked
