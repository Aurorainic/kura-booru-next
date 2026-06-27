from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings
from app.database import create_tables
from app.services.gallery_dl import setup_gallery_dl_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    if not settings.SECRET_KEY:
        import logging
        logging.warning("SECRET_KEY is not set — using insecure default")
    await create_tables()
    setup_gallery_dl_config()
    # Ensure a default admin exists on first startup, then seed settings from env
    from app.auth import ensure_default_admin
    from app.database import async_session_factory
    from app.services.settings import seed_settings_from_env
    async with async_session_factory() as db:
        await ensure_default_admin(db)
        await seed_settings_from_env(db)
    yield
    # Shutdown
    from app.auth import _redis_client
    from app.services.s3 import s3_service
    await s3_service.close()
    if _redis_client is not None:
        await _redis_client.aclose()


async def _cache_control_dispatch(request: Request, call_next):
    """Set Cache-Control headers on API responses.

    - Anonymous: public, s-maxage=60 (cacheable by shared caches for 60s)
    - Admin: private, no-store (never cache)
    - Preserves existing Cache-Control (e.g. SSE endpoint sets its own)

    Exception: GET /api/posts/random — anonymous callers only ever see safe
    posts, so the response is highly cacheable. We bump the public TTL to
    s-maxage=10 there because repeated refreshes on the /random page don't
    need every request to hit the backend.
    """
    from app.auth import SESSION_COOKIE_NAME, verify_session

    response = await call_next(request)

    if request.url.path.startswith("/api/") and not response.headers.get("cache-control"):
        path = request.url.path
        token = request.cookies.get(SESSION_COOKIE_NAME)
        is_admin = verify_session(token) is not None

        if is_admin:
            response.headers["Cache-Control"] = "private, no-store"
        elif path == "/api/posts/random":
            # Anonymous random — safe pool only, cacheable aggressively.
            response.headers["Cache-Control"] = "public, s-maxage=10, max-age=5"
        else:
            response.headers["Cache-Control"] = "public, s-maxage=60, max-age=30"

    return response


app = FastAPI(
    title="Kura Booru API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.APP_URL] if settings.APP_URL else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(BaseHTTPMiddleware, dispatch=_cache_control_dispatch)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


from app.api import api_router

app.include_router(api_router)