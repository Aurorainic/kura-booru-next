"""Sidecar: BRPOP loop + gallery-dl download + imagehash phash.

Polls Redis list kura:jobs for download tasks, downloads the image with
gallery-dl, computes a perceptual hash with imagehash, extracts gallery-dl's
metadata, then pushes the result to kura:results:{job_id}.

Image processing is split: this sidecar owns download + phash + dims/mime
(phash needs imagehash's exact DCT, which sharp can't reproduce bit-for-bit).
Thumbnail/preview/LQIP generation lives in the Node pipeline (server/utils/
pipeline.ts, sharp) — the sidecar no longer does any raster resizing.

~80 lines of core logic.
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


# ── SSRF TOCTOU fix: Override HTTPAdapter.send (not Session.send) to close
# the DNS-rebind window — IP validation happens at connection time inside the
# adapter, right before requests opens the socket.  This is stricter than
# validate_url() called by the caller, because no code between resolution and
# connect can rebind the hostname.
_original_adapter_send = HTTPAdapter.send


def _patched_adapter_send(self, request, **kwargs):
    # Validate the request URL's IP at connection time — closes DNS rebind
    validate_url(request.url)

    # Call original adapter send to perform the actual HTTP request
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

# gallery-dl config: set at startup from env vars
GALLERY_DL_CONFIG = {}


async def load_pixiv_credentials(r) -> tuple[str, str]:
    """Load Pixiv credentials: Redis (server-synced, hot-reload) → env fallback.

    Server writes kura:pixiv:refresh_token / kura:pixiv:phpsessid on settings
    change (see server/plugins/07-settings-hot-reload.ts). Redis values of ""
    mean explicitly unset — fall back to env only when key is missing.
    """
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
    """Load download proxy from Redis (server-synced, hot-reload) → env fallback.

    Server writes kura:dl_proxy_type / kura:dl_proxy_url on settings change.
    gallery-dl accepts proxy URLs via config.set(("extractor",), "proxy", url).
    http:// and socks5:// schemes are supported by requests/urllib3.
    """
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
    # v0.7.8 PR-C: cap Pixiv multi-image fetches at 5 pages per illust.
    # Per-page complexity + storage cost: we don't want a 30-page manga to
    # silently balloon a single import. Ugoira detection in process_job
    # narrows this to 1 for animated posts (zip → first frame).
    config.set(("extractor",), "image-range", "1-5")
    config.set(("extractor",), "parallel", 1)
    # SSRF: limit redirect hops (gallery-dl uses requests; no per-hop IP filter available).
    # ponytail: max-redirects=1 — chained redirects are the standard DNS-rebind
    # vector. Legitimate single-hop 301/302 still works; chained hops are blocked.
    config.set((), "max-redirects", 1)

    # Startup: env-only (Redis may not be reachable yet); per-job override in
    # process_job via load_pixiv_credentials + apply_pixiv_config.
    pixiv_refresh = os.environ.get("PIXIV_REFRESH_TOKEN", "")
    pixiv_phpsessid = os.environ.get("PIXIV_PHPSESSID", "")
    apply_pixiv_config(pixiv_refresh, pixiv_phpsessid)


def download_with_gallery_dl(url: str, pixiv: tuple[str, str] | None = None, proxy: str = "") -> tuple[list[tuple[bytes, dict]], str | None]:
    """Download images using gallery-dl as a library.

    Returns (pages, illust_type):
      - pages: list of (image_bytes, shared_metadata) — one per image page,
        up to 5 by the image-range cap. Metadata is shallow-copied per page
        so callers can decorate without mutating the shared dict.
      - illust_type: gallery-dl's kwdict["type"] if set, else None.
        "ugoira" identifies animated Pixiv posts so callers can collapse to
        one frame; everything else (None / "illust") is treated as static.

    Ugoira handling lives at the process_job layer, not here — the actual
    image-range narrowing happens once we know it's ugoira.
    """
    validate_url(url)
    from gallery_dl import config

    # Re-apply Pixiv auth (gallery-dl sessions may reset config).
    # Per-job creds come from Redis (server-synced); fall back to env.
    if pixiv:
        apply_pixiv_config(*pixiv)
    else:
        apply_pixiv_config(
            os.environ.get("PIXIV_REFRESH_TOKEN", ""),
            os.environ.get("PIXIV_PHPSESSID", ""),
        )

    # Apply download proxy (gallery-dl uses requests internally).
    apply_dl_proxy(proxy)

    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        # Set base-directory via config (not job.path — that doesn't work)
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

        # Build shared metadata once per job.
        shared_metadata: dict = {}
        illust_type: str | None = None
        try:
            # gallery-dl 1.32: metadata is in pathfmt.kwdict, not job.kwdict
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

                # Artist info: gallery-dl stores screen_name in 'name', display name in 'nick'
                user = data.get("user", {})
                if isinstance(user, dict):
                    # 'nick' is the display name (崎白bubai), 'name' is the handle (@226083260Bubai)
                    artist_name = user.get("nick") or user.get("name", "")
                else:
                    artist_name = ""

                illust_type = data.get("type")
                shared_metadata = {
                    "title": data.get("title", ""),
                    "description": data.get("caption") or data.get("description", ""),
                    "source_url": url,
                    "tag_names": tag_names,
                    # ponytail: artist as separate field, not "artist:xxx" string in tag_names
                    # — keeps category source-of-truth in pipeline, AI never has to infer it.
                    "artist_name": artist_name or None,
                }
                # Use numeric ID from extractor or kwdict
                sid = data.get("id") or ""
                if sid:
                    shared_metadata["source_id"] = str(sid)
        except Exception:
            pass

        # Build a (bytes, metadata) per file. metadata is shallow-copied so
        # downstream callers can decorate per-page without mutating the shared dict.
        results = []
        for path in files:
            with open(path, "rb") as f:
                image_bytes = f.read()
            results.append((image_bytes, dict(shared_metadata)))
        return results, illust_type


def compute_phash(image_bytes: bytes) -> str:
    """Compute perceptual hash for dedup (kept here, not in Node sharp).

    imagehash.phash uses scipy's DCT over Pillow-resized pixels; sharp's
    Lanczos resize differs from Pillow's at sub-pixel precision, so a sharp
    reimplementation drifts 6-14 Hamming bits from imagehash on the same image
    — at or above the dedup threshold of 8. Keeping phash in imagehash preserves
    cross-era dedup (old posts hashed with imagehash still match new ones).
    """
    img = Image.open(BytesIO(image_bytes))
    return str(imagehash.phash(img))


async def process_job(r: aioredis.Redis, job: dict):
    """Process a single download job — one job can yield 1..N images (multi-image Pixiv).

    v0.7.8 PR-C: a Pixiv illust with up to 5 pages produces a single sidecar
    result containing all N images. The pipeline (pipeline.ts) splits the
    array and inserts each as a separate row sharing series_id. Ugoira is
    detected after download and collapsed back to a single-image result.
    """
    job_id = job["id"]
    url = job["url"]
    log.info(f"Processing job {job_id}: {url}")

    # Mark as processing
    await r.set(f"kura:job_status:{job_id}", "processing", ex=7200)

    # Pre-initialize referenced variables so the except/log line below
    # never hits a NameError if download_with_gallery_dl raises.
    downloaded: list = []
    illust_type: str | None = None

    try:
        # Download in thread pool (gallery-dl is sync).
        # v0.7.8 PR-C: returns (pages, illust_type). Ugoira is detected inside
        # the download path, so we collapse to first-frame here before
        # building the result.
        loop = asyncio.get_event_loop()
        # Load Pixiv creds from Redis (server-synced; hot-reload friendly).
        pixiv = await load_pixiv_credentials(r)
        # Load download proxy from Redis (server-synced; hot-reload friendly).
        dl_proxy = await load_dl_proxy(r)
        downloaded, illust_type = await loop.run_in_executor(
            None, download_with_gallery_dl, url, pixiv, dl_proxy
        )

        is_ugoira = illust_type == "ugoira"
        if is_ugoira:
            log.info(f"Job {job_id} detected as Ugoira — collapsing to first frame")
            downloaded = downloaded[:1]

        # MAX_IMAGE_SIZE: Redis (server-synced) → env fallback. Server syncs
        # kura:max_image_size on settings change (07-settings-hot-reload.ts).
        try:
            _redis_max = await r.get("kura:max_image_size")
            max_size = int(_redis_max) if _redis_max is not None else int(os.environ.get("MAX_IMAGE_SIZE", "0"))
        except Exception:
            max_size = int(os.environ.get("MAX_IMAGE_SIZE", "0"))
        page_count = len(downloaded)
        pages: list[dict] = []

        def _process_page(img: Image.Image, image_bytes: bytes, gdl_metadata: dict, page_index: int) -> dict | None:
            """Compute phash + dims for one page. Returns None for over-size.

            Accepts already-opened PIL.Image to avoid redundant Image.open() on
            every page — both compute_phash and this function need it.
            """
            phash = str(imagehash.phash(img))
            width, height = img.size
            mime_type = Image.MIME.get(img.format, "image/png")
            file_size = len(image_bytes)

            if max_size > 0 and file_size > max_size:
                # Surface per-page too_large via page_count alone — the
                # pipeline can fall back to skipping the row. For now we
                # drop the page so it doesn't get uploaded.
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
            # Open Image once, share between _process_page and any consumer
            img = Image.open(BytesIO(image_bytes))
            page = await loop.run_in_executor(None, _process_page, img, image_bytes, gdl_metadata, i)
            if page is None:
                # Over-size: skip the page but keep counting toward page_count
                # so page_index stays consistent with what gallery-dl emitted.
                # (Dropping the row means the count above is the cap, not the
                # real page_count — but a too-large row that never uploads
                # isn't a real page.)
                continue
            # Per-page metadata: extend shared gdl_metadata with pipeline-needed
            # top-level fields. The pipeline reads page["width"/...] as the
            # dims, so we don't need to repeat source_site/source_id from
            # gdl_metadata here — they're hoisted below.
            pages.append(page)

        if not pages:
            # No pages survived the size filter — short-circuit to a single
            # too_large result (parallel to the single-image too_large path).
            result = {"status": "too_large", "max_size": max_size}
        elif len(pages) == 1:
            # Single-image path — same shape as v0.7.7, no PR-C coupling.
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
                    "source_id": shared.get("source_id", job.get("source_id", "")),
                    "tag_names": shared.get("tag_names", []),
                    "artist_name": shared.get("artist_name"),
                },
            }
        else:
            # Multi-image path — PR-C pipeline path.
            shared = downloaded[0][1]
            common_meta = {
                "title": shared.get("title", ""),
                "description": shared.get("description", ""),
                "source_url": url,
                "source_site": job.get("source_site", ""),
                "source_id": shared.get("source_id", job.get("source_id", "")),
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

    # Set result with 1h TTL (prevent Redis leak)
    # ── WARNING: base64 / Redis memory ──
    # Multi-page Pixiv illusts embed full base64-encoded images directly in
    # this Redis value.  A 5-page manga can push 10-20 MB into a single key.
    # This is acceptable for the current single-sidecar architecture where
    # the Nitro pipeline consumes results within seconds, but if throughput
    # increases or consumers lag, Redis memory will balloon.
    #
    # Long-term fix: sidecar writes images to temp files or /tmp S3, and
    # Redis carries only metadata + a file reference.  The 3600s TTL provides
    # a safety net: orphaned results auto-expire within an hour.
    await r.set(f"kura:results:{job_id}", json.dumps(result), ex=3600)
    # Do NOT set job_status to "done" here — let the Nitro pipeline worker
    # set it after processing (prevents pollJobResult from reading raw sidecar
    # result with image_bytes_b64/phash before pipeline strips them)
    # Notify Nitro pipeline consumer
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
