from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    # Ensure a default admin exists on first startup
    from app.auth import ensure_default_admin
    from app.database import async_session_factory
    async with async_session_factory() as db:
        await ensure_default_admin(db)
    yield
    # Shutdown — nothing to clean up currently


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


@app.get("/health")
async def health_check():
    return {"status": "ok"}


from app.api import api_router

app.include_router(api_router)