"""Smoke test for sidecar SSRF guards.

These functions are pure (no Redis, no network) so they're the cheapest layer
to lock down in CI. A regression here would be a security hole, not a flaky
test — see sidecar.py validate_url / _is_blocked_ip / HTTPAdapter redirect guard.

NOTE: validate_url() resolves the host via DNS, so only scheme-validation is
testable offline. The IP-range guard and redirect tests are covered via
_is_blocked_ip and mock-asserted HTTPAdapter intercepts.
"""

import pytest
from unittest import mock

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
        ("0.0.0.0", True),
        ("10.0.0.1", True),
        ("172.16.0.1", True),
        ("192.168.1.1", True),
        ("169.254.169.254", True),  # cloud metadata endpoint
        ("100.64.0.1", True),  # CGNAT
        ("192.0.2.1", True),  # documentation
        ("198.18.0.1", True),  # benchmarking
        ("203.0.113.1", True),  # documentation
        ("224.0.0.1", True),  # multicast
        ("240.0.0.1", True),  # reserved
        ("::1", True),
        ("fc00::1", True),  # IPv6 ULA
        ("2001:db8::1", True),  # IPv6 documentation
        ("ff02::1", True),  # IPv6 multicast
        ("8.8.8.8", False),
        ("1.1.1.1", False),
    ],
)
def test_is_blocked_ip_private_and_metadata_ranges(ip, blocked):
    """RFC1918, link-local, loopback, ULA, and the metadata endpoint are blocked."""
    assert sidecar._is_blocked_ip(ip) is blocked


# ── Redirect SSRF protection tests (HTTPAdapter.send intercept) ──


class _MockRequest:
    """Minimal mock of requests.PreparedRequest with a .url attribute."""
    def __init__(self, url: str):
        self.url = url


class _MockResponse:
    """Minimal mock of requests.Response with headers and status_code."""
    def __init__(self, status_code: int, location: str | None = None):
        self.status_code = status_code
        self.headers = {}
        if location:
            self.headers["Location"] = location


def test_redirect_to_private_ip_rejected():
    """An HTTP 302 redirect to a private IP is rejected by validate_url."""
    # Not using the adapter patch — just validate that the URL itself
    # would be caught if it resolved to a private IP.
    with pytest.raises(ValueError, match="Blocked IP|hostname|scheme"):
        sidecar.validate_url("http://192.168.1.1/evil")


def test_redirect_to_public_ip_accepted():
    """An HTTP 302 redirect to a public IP passes validate_url."""
    # A public-IP URL — validation checks scheme + hostname.
    result = sidecar.validate_url("http://1.1.1.1/redirect-target")
    assert result == "http://1.1.1.1/redirect-target"


def test_chained_redirect_truncated_by_max_redirects():
    """gallery-dl config max-redirects=1 cuts off chained redirects.

    This tests the gallery-dl-level guard (config max-redirects=1).
    A chain of 2+ redirects is stopped by gallery-dl before the
    HTTPAdapter-level IP check even runs.
    """
    from gallery_dl import config as gdl_config
    # max-redirects 由 setup_gallery_dl() 写入全局 config — 测试先初始化，
    # 否则直接 import 模块时 config 未设置（CI 上实测为 None）
    sidecar.setup_gallery_dl()
    max_redir = gdl_config.get((), "max-redirects")
    assert max_redir == 1, (
        f"Expected max-redirects=1 (DNS rebind defense), got {max_redir}. \n"
        "If gallery-dl bumped this, chain-redirect attacks become possible."
    )


@mock.patch.object(sidecar, "_original_adapter_send")
def test_redirect_hop_revalidates_url(mock_original_send):
    """The HTTPAdapter.send override validates URL on initial request
    AND on every redirect hop's Location header.

    We simulate a 302 redirect to a blocked IP — the adapter patch
    must reject it at the hop, not just the initial URL.
    """
    # Simulate: initial request succeeds with redirect.
    # 初始 URL 用 IP 字面量（公网 1.1.1.1）— getaddrinfo 对字面 IP 不做
    # DNS 查询，测试不依赖外部 DNS（原 public.example.com 在 CI runner 上
    # 解析失败导致初始校验直接抛 DNS resolution failed）。
    redirect_resp = _MockResponse(302, "http://192.168.1.99/internal")
    mock_original_send.return_value = redirect_resp

    adapter = sidecar.HTTPAdapter()
    req = _MockRequest("https://1.1.1.1/safe")

    # The patch on HTTPAdapter.send calls validate_url on the redirect
    # Location, which should raise for the private IP.
    with pytest.raises(ValueError, match="Blocked IP"):
        sidecar._patched_adapter_send(adapter, req)
