"""S3 storage abstraction using aiobotocore.

Key design decisions (from v1 lessons):
- Stream-based uploads, no memory buffering for large files
- Path normalization: no double slashes, lowercase paths
- Post-upload URL verification to catch key mismatches early
"""

from __future__ import annotations

import io
import logging

import aiobotocore.session
from aiobotocore.session import AioSession
from botocore.config import Config as BotoConfig

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


def _normalize_key(key: str) -> str:
    """Normalize an S3 key: lowercase, strip leading/trailing slashes, collapse
    double slashes.

    v1 lesson: S3 key errors caused broken thumbnail URLs.
    """
    key = key.lower().strip("/")
    # Collapse any double slashes
    while "//" in key:
        key = key.replace("//", "/")
    return key


def _build_key(prefix: str, source_site: str, source_id: str, suffix: str, ext: str) -> str:
    """Build a normalized S3 key.

    Format: {prefix}/{source_site}/{source_id}{suffix}.{ext}
    """
    return _normalize_key(f"{prefix}/{source_site}/{source_id}{suffix}.{ext}")


def original_key(source_site: str, source_id: str, ext: str) -> str:
    """Generate the S3 key for an original image."""
    return _build_key("originals", source_site, source_id, "", ext)


def thumb_key(source_site: str, source_id: str, ext: str) -> str:
    """Generate the S3 key for a thumbnail."""
    return _build_key("thumbs", source_site, source_id, "_thumb", ext)


def preview_key(source_site: str, source_id: str, ext: str) -> str:
    """Generate the S3 key for a preview image."""
    return _build_key("previews", source_site, source_id, "_preview", ext)


class S3Service:
    """Async S3 storage service using aiobotocore.

    The S3 client is lazily created once and reused for all operations,
    avoiding per-operation client setup overhead.
    """

    def __init__(self) -> None:
        self._session: AioSession = aiobotocore.session.get_session()
        self._endpoint_url = settings.S3_ENDPOINT
        self._external_url = settings.S3_EXTERNAL_URL.rstrip("/")
        self._bucket = settings.S3_BUCKET_NAME
        self._region = settings.S3_REGION
        self._client = None  # Lazy-cached S3 client

    def _client_config(self) -> BotoConfig:
        return BotoConfig(
            region_name=self._region,
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        )

    async def get_client(self):
        """Get or lazily create the cached S3 client."""
        if self._client is None:
            cm = self._session.create_client(
                "s3",
                endpoint_url=self._endpoint_url,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
                config=self._client_config(),
            )
            self._client = await cm.__aenter__()
        return self._client

    async def close(self) -> None:
        """Close the cached S3 client. Call on shutdown."""
        if self._client is not None:
            await self._client.__aexit__(None, None, None)
            self._client = None

    async def ensure_bucket(self) -> None:
        """Create the bucket if it does not exist (dev convenience)."""
        client = await self.get_client()
        try:
            await client.head_bucket(Bucket=self._bucket)
            logger.info("Bucket %s exists", self._bucket)
        except client.exceptions.NoSuchBucket:  # type: ignore[attr-defined]
            await client.create_bucket(Bucket=self._bucket)
            logger.info("Created bucket %s", self._bucket)

    async def upload_bytes(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload raw bytes to S3. Returns the normalized key."""
        key = _normalize_key(key)
        client = await self.get_client()
        await client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        url = self.public_url(key)
        logger.debug("Uploaded s3://%s/%s → %s", self._bucket, key, url)
        return key

    async def upload_stream(
        self,
        key: str,
        file_obj: io.IOBase,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Stream-upload a file-like object to S3 (no memory buffering).

        v1 lesson: large file uploads caused OOM — always use streaming.
        """
        key = _normalize_key(key)
        client = await self.get_client()
        await client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=file_obj,
            ContentType=content_type,
        )
        url = self.public_url(key)
        logger.debug("Stream-uploaded s3://%s/%s → %s", self._bucket, key, url)
        return key

    async def delete(self, key: str) -> None:
        """Delete an object from S3."""
        key = _normalize_key(key)
        client = await self.get_client()
        await client.delete_object(Bucket=self._bucket, Key=key)
        logger.debug("Deleted s3://%s/%s", self._bucket, key)

    def public_url(self, key: str) -> str:
        """Construct the public URL for a key served directly from S3/CDN.

        This uses ``S3_EXTERNAL_URL`` (e.g. https://images.your-domain.com)
        and appends the normalized key — no Caddy proxy involved.
        """
        key = _normalize_key(key)
        return f"{self._external_url}/{key}"

    async def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Generate a presigned GET URL for private buckets."""
        key = _normalize_key(key)
        client = await self.get_client()
        url: str = await client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )
        return url

    async def verify_upload(self, key: str) -> bool:
        """Post-upload verification: check that the object exists and is
        accessible.

        v1 lesson: S3 key errors caused broken thumbnail URLs — verify
        immediately after upload.
        """
        key = _normalize_key(key)
        try:
            client = await self.get_client()
            response = await client.head_object(
                Bucket=self._bucket, Key=key
            )
            size = response.get("ContentLength", -1)
            logger.debug(
                "Verified s3://%s/%s (ContentLength=%s)",
                self._bucket,
                key,
                size,
            )
            return size >= 0
        except Exception as exc:
            logger.error("Upload verification failed for %s: %s", key, exc)
            return False


# Module-level singleton
s3_service = S3Service()
