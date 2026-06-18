"""API router aggregation.

Includes all sub-routers with their URL prefixes:
- /api/posts   → post listing, detail, random
- /api/tags    → tag listing, detail
- /api/search  → tag-based search
- /api/tasks   → task creation (image processing)
- /api/rebuild → cache purge webhook
"""

from fastapi import APIRouter

from app.api.posts import router as posts_router
from app.api.search import router as search_router
from app.api.tags import router as tags_router
from app.api.tasks import router as tasks_router
from app.api.webhook import router as webhook_router

api_router = APIRouter()

api_router.include_router(posts_router, prefix="/api/posts", tags=["posts"])
api_router.include_router(tags_router, prefix="/api/tags", tags=["tags"])
api_router.include_router(search_router, prefix="/api/search", tags=["search"])
api_router.include_router(tasks_router, prefix="/api/tasks", tags=["tasks"])
api_router.include_router(webhook_router, prefix="/api/rebuild", tags=["webhook"])