"""Sidecar: BRPOP kura:jobs → gallery-dl download + imagehash phash → kura:results:{job_id}.

Owns download + phash + dims/mime (phash needs imagehash's exact DCT, which
sharp can't reproduce); thumbnail/preview/LQIP stay in the Node pipeline.
"""

import asyncio
import base64
import ipaddress
import json
import logging
import os
import socket
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import imagehash
import redis.asyncio as aioredis
from PIL import Image

import requests
from requests.adapters import HTTPAdapter

# ── SSRF Protection ──
ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("2001:db8::/32"),
    ipaddress.ip_network("ff00::/8"),
    ipaddress.ip_network("fc00::/7"),
]


def _normalize_ip(addr: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Normalize IP — converts IPv4-mapped IPv6 (::ffff:x.x.x.x) to IPv4."""
    ip = ipaddress.ip_address(addr)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        return ip.ipv4_mapped
    return ip


def _is_blocked_ip(addr: str) -> bool:
    """Check if IP address is in a blocked (private/reserved) range."""
    ip = _normalize_ip(addr)
    for blocked in BLOCKED_NETWORKS:
        if ip in blocked:
            return True
    return False


def validate_url(url: str) -> str:
    """Validate URL for SSRF: reject non-HTTP schemes and private/reserved IPs."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise ValueError(f"Forbidden URL scheme: {parsed.scheme}")
    host = parsed.hostname
    if host is None:
        raise ValueError("No hostname in URL")
    try:
        for _, _, _, _, sockaddr in socket.getaddrinfo(host, None):
            if _is_blocked_ip(sockaddr[0]):
                raise ValueError(f"Blocked IP range: {sockaddr[0]}")
    except OSError:
        raise ValueError(f"DNS resolution failed: {host}")
    return url


# SSRF TOCTOU fix: validate inside HTTPAdapter.send (not Session.send) so the IP
# check runs right before the socket opens — closes the DNS-rebind window.
_original_adapter_send = HTTPAdapter.send


def _patched_adapter_send(self, request, **kwargs):
    # Validate at connection time — closes DNS rebind
    validate_url(request.url)

    response = _original_adapter_send(self, request, **kwargs)

    # Re-validate every redirect hop
    if response.status_code in (301, 302, 303, 307, 308):
        location = response.headers.get("Location", "")
        if location:
            validate_url(location)
    return response


HTTPAdapter.send = _patched_adapter_send  # type: ignore[method-assign]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [sidecar] %(message)s")
log = logging.getLogger(__name__)

GALLERY_DL_CONFIG = {}

_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.environ.get("SIDECAR_WORKERS", "1")))


async def load_pixiv_credentials(r) -> tuple[str, str]:
    """Pixiv creds: Redis (server-synced, hot-reload) → env fallback; "" means explicitly unset."""
    try:
        refresh = await r.get("kura:pixiv:refresh_token")
        phpsessid = await r.get("kura:pixiv:phpsessid")
    except Exception:
        refresh = phpsessid = None
    if refresh is None:
        refresh = os.environ.get("PIXIV_REFRESH_TOKEN", "")
    if phpsessid is None:
        phpsessid = os.environ.get("PIXIV_PHPSESSID", "")
    return refresh or "", phpsessid or ""


def apply_pixiv_config(refresh: str, phpsessid: str):
    """Apply Pixiv auth into gallery-dl config (idempotent)."""
    if not (refresh and phpsessid):
        return
    GALLERY_DL_CONFIG["extractor"] = {
        "pixiv": {
            "refresh-token": refresh,
            "cookies": {"PHPSESSID": phpsessid},
        },
    }
    from gallery_dl import config

    config.set(("extractor",), "pixiv", {
        "refresh-token": refresh,
        "cookies": {"PHPSESSID": phpsessid},
    })


async def load_dl_proxy(r) -> str:
    """Download proxy: Redis (server-synced, hot-reload) → env fallback; socks type auto-prefixed socks5://."""
    try:
        proxy_type = await r.get("kura:dl_proxy_type") or ""
        proxy_url = await r.get("kura:dl_proxy_url") or ""
    except Exception:
        proxy_type = ""
        proxy_url = ""
    if not proxy_url:
        return ""
    if proxy_type == "socks" and not proxy_url.startswith("socks"):
        proxy_url = f"socks5://{proxy_url.split('://')[-1]}" if "://" in proxy_url else f"socks5://{proxy_url}"
    return proxy_url


def apply_dl_proxy(proxy_url: str):
    """Apply proxy to gallery-dl global config (idempotent)."""
    from gallery_dl import config
    if proxy_url:
        config.set(("extractor",), "proxy", proxy_url)
        log.info(f"[sidecar] download proxy set: {proxy_url}")
    else:
        config.set(("extractor",), "proxy", None)


def setup_gallery_dl():
    """Configure gallery-dl global settings from env vars."""
    global GALLERY_DL_CONFIG
    from gallery_dl import config

    # Rate limiting to avoid bans
    config.set(("extractor",), "sleep-request", [0.5, 1.5])
    # v0.7.8 PR-C: cap Pixiv multi-image at 5 pages (per-page storage cost);
    # process_job narrows ugoira to 1 (zip → first frame).
    config.set(("extractor",), "image-range", "1-5")
    config.set(("extractor",), "parallel", 1)
    # SSRF: limit redirect hops (no per-hop IP filter available in gallery-dl).
    config.set((), "max-redirects", 1)

    # Startup seed: env-only (Redis may be unreachable yet); per-job override later.
    pixiv_refresh = os.environ.get("PIXIV_REFRESH_TOKEN", "")
    pixiv_phpsessid = os.environ.get("PIXIV_PHPSESSID", "")
    apply_pixiv_config(pixiv_refresh, pixiv_phpsessid)


def download_with_gallery_dl(url: str, pixiv: tuple[str, str] | None = None, proxy: str = "") -> tuple[list[tuple[bytes, dict]], str | None]:
    """Download via gallery-dl as a library.

    Returns (pages, illust_type): pages = [(bytes, shared_metadata)] up to the
    5-page cap; illust_type == "ugoira" marks animated posts for process_job
    to collapse to one frame.
    """
    validate_url(url)
    from gallery_dl import config

    # Re-apply Pixiv auth — gallery-dl sessions may reset config
    if pixiv:
        apply_pixiv_config(*pixiv)
    else:
        apply_pixiv_config(
            os.environ.get("PIXIV_REFRESH_TOKEN", ""),
            os.environ.get("PIXIV_PHPSESSID", ""),
        )

    apply_dl_proxy(proxy)

    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        # base-directory via config, not job.path (that doesn't work)
        config.set((), "base-directory", tmpdir)
        config.set(("output",), "progress", False)

        from gallery_dl.job import DownloadJob
        job = DownloadJob(url)
        job.run()

        # Find downloaded files — gallery-dl writes one per image page.
        import glob
        files = sorted(glob.glob(os.path.join(tmpdir, "**", "*"), recursive=True))
        files = [f for f in files if os.path.isfile(f)]

        if not files:
            raise RuntimeError("gallery-dl downloaded no files")

        shared_metadata: dict = {}
        illust_type: str | None = None
        try:
            # gallery-dl 1.32: metadata lives in pathfmt.kwdict, not job.kwdict
            data = getattr(getattr(job, 'pathfmt', None), 'kwdict', None) or {}
            if not data:
                data = getattr(job, 'kwdict', None) or {}
            if data:
                tags_raw = data.get("tags", [])
                # Tags are plain strings in gallery-dl 1.32
                if isinstance(tags_raw, list):
                    tag_names = [str(t) if not isinstance(t, dict) else t.get("name", str(t)) for t in tags_raw]
                elif isinstance(tags_raw, str):
                    tag_names = tags_raw.split()
                else:
                    tag_names = []

                # Artist: 'nick' = display name, 'name' = handle
                user = data.get("user", {})
                if isinstance(user, dict):
                    artist_name = user.get("nick") or user.get("name", "")
                else:
                    artist_name = ""

                illust_type = data.get("type")
                shared_metadata = {
                    "title": data.get("title", ""),
                    "description": data.get("caption") or data.get("description", ""),
                    "source_url": url,
                    "tag_names": tag_names,
                    "artist_name": artist_name or None,
                }
                sid = data.get("id") or ""
                if sid:
                    shared_metadata["source_id"] = str(sid)
        except Exception:
            pass

        # One (bytes, metadata) per file; metadata shallow-copied so callers can decorate per page
        results = []
        for path in files:
            with open(path, "rb") as f:
                image_bytes = f.read()
            results.append((image_bytes, dict(shared_metadata)))
        return results, illust_type


def compute_phash(image_bytes: bytes) -> str:
    """Perceptual hash for dedup — kept in imagehash, not sharp: a sharp
    reimplementation drifts 6-14 Hamming bits (dedup threshold is 8)."""
    img = Image.open(BytesIO(image_bytes))
    return str(imagehash.phash(img))


async def process_job(r: aioredis.Redis, job: dict):
    """Process one job — may yield 1..N images (multi-image Pixiv); pipeline.ts
    splits them into rows sharing series_id. Ugoira collapses to one frame."""
    job_id = job["id"]
    url = job["url"]
    log.info(f"Processing job {job_id}: {url}")

    await r.set(f"kura:job_status:{job_id}", "processing", ex=7200)

    # Pre-init so the except/log line below never NameErrors if download raises
    downloaded: list = []
    illust_type: str | None = None

    try:
        # Download in thread pool (gallery-dl is sync); ugoira collapses to first frame
        loop = asyncio.get_event_loop()
        pixiv = await load_pixiv_credentials(r)
        dl_proxy = await load_dl_proxy(r)
        downloaded, illust_type = await loop.run_in_executor(
            _EXECUTOR, download_with_gallery_dl, url, pixiv, dl_proxy
        )

        is_ugoira = illust_type == "ugoira"
        if is_ugoira:
            log.info(f"Job {job_id} detected as Ugoira — collapsing to first frame")
            downloaded = downloaded[:1]

        # MAX_IMAGE_SIZE: Redis (server-synced) → env fallback
        try:
            _redis_max = await r.get("kura:max_image_size")
            max_size = int(_redis_max) if _redis_max is not None else int(os.environ.get("MAX_IMAGE_SIZE", "0"))
        except Exception:
            max_size = int(os.environ.get("MAX_IMAGE_SIZE", "0"))
        page_count = len(downloaded)
        pages: list[dict] = []

        def _process_page(img: Image.Image, image_bytes: bytes, gdl_metadata: dict, page_index: int) -> dict | None:
            """phash + dims for one page; None when over max_size. Takes an opened Image to avoid re-Image.open()."""
            phash = str(imagehash.phash(img))
            width, height = img.size
            mime_type = Image.MIME.get(img.format, "image/png")
            file_size = len(image_bytes)

            if max_size > 0 and file_size > max_size:
                # Drop over-size page so it's not uploaded (page_count still counts it)
                log.warning(f"Job {job_id} page {page_index}: {file_size} > {max_size}, skipping")
                return None

            return {
                "page_index": page_index,
                "image_bytes_b64": base64.b64encode(image_bytes).decode("ascii"),
                "phash": phash,
                "width": width,
                "height": height,
                "mime_type": mime_type,
                "file_size": file_size,
            }

        for i, (image_bytes, gdl_metadata) in enumerate(downloaded, start=1):
            img = Image.open(BytesIO(image_bytes))
            page = await loop.run_in_executor(_EXECUTOR, _process_page, img, image_bytes, gdl_metadata, i)
            if page is None:
                # Over-size: skip row but keep page_count/page_index consistent with gallery-dl output
                continue
            # Pipeline reads page["width"/"height"/...] as dims; source_site/id hoisted below
            pages.append(page)

        if not pages:
            # All pages over-size — short-circuit to a single too_large result
            result = {"status": "too_large", "max_size": max_size}
        elif len(pages) == 1:
            # Single-image path — v0.7.7 shape
            only = pages[0]
            shared = downloaded[0][1]
            result = {
                "status": "ok",
                "image_bytes_b64": only["image_bytes_b64"],
                "phash": only["phash"],
                "metadata": {
                    "width": only["width"],
                    "height": only["height"],
                    "mime_type": only["mime_type"],
                    "file_size": only["file_size"],
                    "title": shared.get("title", ""),
                    "description": shared.get("description", ""),
                    "source_url": url,
                    "source_site": job.get("source_site", ""),
                    "source_id": shared.get("source_id") or job.get("source_id", ""),
                    "tag_names": shared.get("tag_names", []),
                    "artist_name": shared.get("artist_name"),
                },
            }
        else:
            # Multi-image path (v0.7.8 PR-C)
            shared = downloaded[0][1]
            common_meta = {
                "title": shared.get("title", ""),
                "description": shared.get("description", ""),
                "source_url": url,
                "source_site": job.get("source_site", ""),
                "source_id": shared.get("source_id") or job.get("source_id", ""),
                "tag_names": shared.get("tag_names", []),
                "artist_name": shared.get("artist_name"),
            }
            result = {
                "status": "ok",
                "metadata": {
                    **common_meta,
                    "is_multi": True,
                    "page_count": page_count,
                    "pages": pages,
                },
            }

    except Exception as e:
        log.error(f"Job {job_id} failed: {e}")
        result = {"status": "error", "error": str(e)}

    # 1h TTL prevents Redis leak. WARNING: multi-page results embed full base64
    # images (10-20 MB/key); fine while the Nitro pipeline consumes fast.
    await r.set(f"kura:results:{job_id}", json.dumps(result), ex=3600)
    # Do NOT set job_status "done" here — the Nitro pipeline does, after it
    # strips image_bytes_b64/phash (else pollJobResult reads raw sidecar result)
    await r.lpush("kura:pending_results", job_id)
    log.info(f"Job {job_id} sidecar done: status={result.get('status')} pages={len(downloaded)}")


async def main():
    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    r = aioredis.from_url(redis_url, decode_responses=True, socket_timeout=None)
    log.info(f"Sidecar started, polling {redis_url}")

    setup_gallery_dl()

    while True:
        try:
            _, data = await r.brpop("kura:jobs", timeout=0)
            job = json.loads(data)
            await process_job(r, job)
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error(f"Job loop error: {e}")
            await asyncio.sleep(1)

    await r.aclose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
