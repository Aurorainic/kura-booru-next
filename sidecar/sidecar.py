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

# ── SSRF Protection ──
ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
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

# ── Redirect SSRF protection: re-validate every redirect hop ──
import requests as _requests
_original_send = _requests.Session.send


def _patched_send(self, request, **kwargs):
    response = _original_send(self, request, **kwargs)
    if response.status_code in (301, 302, 303, 307, 308):
        location = response.headers.get("Location", "")
        if location:
            validate_url(location)
    return response


_requests.Session.send = _patched_send  # type: ignore[method-assign]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [sidecar] %(message)s")
log = logging.getLogger(__name__)

# gallery-dl config: set at startup from env vars
GALLERY_DL_CONFIG = {}


def setup_gallery_dl():
    """Configure gallery-dl global settings from env vars."""
    global GALLERY_DL_CONFIG
    from gallery_dl import config

    # Rate limiting to avoid bans
    config.set(("extractor",), "sleep-request", [0.5, 1.5])
    config.set(("extractor",), "image-range", "1-1")  # first image only
    config.set(("extractor",), "parallel", 1)
    # SSRF: limit redirect hops (gallery-dl uses requests; no per-hop IP filter available).
    # ponytail: max-redirects=1 — chained redirects are the standard DNS-rebind
    # vector. Legitimate single-hop 301/302 still works; chained hops are blocked.
    config.set((), "max-redirects", 1)

    pixiv_refresh = os.environ.get("PIXIV_REFRESH_TOKEN", "")
    pixiv_phpsessid = os.environ.get("PIXIV_PHPSESSID", "")
    if pixiv_refresh and pixiv_phpsessid:
        GALLERY_DL_CONFIG["extractor"] = {
            "pixiv": {
                "refresh-token": pixiv_refresh,
                "cookies": {"PHPSESSID": pixiv_phpsessid},
            }
        }
        config.set(("extractor",), "pixiv", {
            "refresh-token": pixiv_refresh,
            "cookies": {"PHPSESSID": pixiv_phpsessid},
        })


def download_with_gallery_dl(url: str) -> tuple[bytes, dict]:
    """Download image using gallery-dl as a library. Returns (image_bytes, metadata)."""
    validate_url(url)
    from gallery_dl import config

    # Re-apply Pixiv auth (gallery-dl sessions may reset config)
    pixiv_refresh = os.environ.get("PIXIV_REFRESH_TOKEN", "")
    pixiv_phpsessid = os.environ.get("PIXIV_PHPSESSID", "")
    if pixiv_refresh and pixiv_phpsessid:
        config.set(("extractor",), "pixiv", {
            "refresh-token": pixiv_refresh,
            "cookies": {"PHPSESSID": pixiv_phpsessid},
        })

    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        # Set base-directory via config (not job.path — that doesn't work)
        config.set((), "base-directory", tmpdir)
        config.set(("output",), "progress", False)

        from gallery_dl.job import DownloadJob
        job = DownloadJob(url)
        job.run()

        # Find downloaded file
        import glob
        files = glob.glob(os.path.join(tmpdir, "**", "*"), recursive=True)
        files = [f for f in files if os.path.isfile(f)]

        if not files:
            raise RuntimeError("gallery-dl downloaded no files")

        with open(files[0], "rb") as f:
            image_bytes = f.read()

        # Extract metadata from gallery-dl job
        metadata = {}
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

                metadata = {
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
                    metadata["source_id"] = str(sid)
        except Exception:
            pass

        return image_bytes, metadata


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
    """Process a single download job."""
    job_id = job["id"]
    url = job["url"]
    log.info(f"Processing job {job_id}: {url}")

    # Mark as processing
    await r.set(f"kura:job_status:{job_id}", "processing", ex=7200)

    try:
        # Download in thread pool (gallery-dl is sync)
        loop = asyncio.get_event_loop()
        image_bytes, gdl_metadata = await loop.run_in_executor(
            None, download_with_gallery_dl, url
        )

        # Compute phash + get dimensions/mime in one PIL decode (avoid decoding twice).
        # Raster resize/encode for thumbnails/LQIP is done in the Node sharp
        # pipeline; the sidecar only reads enough to phash + report raw dims.
        img = await loop.run_in_executor(None, lambda: Image.open(BytesIO(image_bytes)))
        phash = str(imagehash.phash(img))
        width, height = img.size
        mime_type = Image.MIME.get(img.format, "image/png")
        file_size = len(image_bytes)

        # MAX_IMAGE_SIZE check
        max_size = int(os.environ.get("MAX_IMAGE_SIZE", "0"))
        if max_size > 0 and file_size > max_size:
            result = {"status": "too_large", "max_size": max_size}
        else:
            result = {
                "status": "ok",
                "image_bytes_b64": base64.b64encode(image_bytes).decode("ascii"),
                "phash": phash,
                "metadata": {
                    "width": width,
                    "height": height,
                    "mime_type": mime_type,
                    "file_size": file_size,
                    "title": gdl_metadata.get("title", ""),
                    "description": gdl_metadata.get("description", ""),
                    "source_url": url,
                    "source_site": job.get("source_site", ""),
                    "source_id": gdl_metadata.get("source_id", job.get("source_id", "")),
                    "tag_names": gdl_metadata.get("tag_names", []),
                    "artist_name": gdl_metadata.get("artist_name"),
                },
            }

    except Exception as e:
        log.error(f"Job {job_id} failed: {e}")
        result = {"status": "error", "error": str(e)}

    # Set result with 1h TTL (prevent Redis leak)
    await r.set(f"kura:results:{job_id}", json.dumps(result), ex=3600)
    # Do NOT set job_status to "done" here — let the Nitro pipeline worker
    # set it after processing (prevents pollJobResult from reading raw sidecar
    # result with image_bytes_b64/phash before pipeline strips them)
    # Notify Nitro pipeline consumer
    await r.lpush("kura:pending_results", job_id)
    log.info(f"Job {job_id} sidecar done: {result.get('status', 'unknown')}")


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
