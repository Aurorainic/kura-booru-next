"""API router aggregation.

Includes all sub-routers with their URL prefixes:
- /api/auth              → admin login/logout/status (NSFW visibility unlock)
- /api/posts             → post listing, detail, random, delete
- /api/tags              → tag listing, detail
- /api/search            → tag-based search
- /api/tasks             → task creation (image processing)
- /api/auto-rating-rules → tag-based auto-rating rule CRUD (admin only)
- /api/admin/tags        → admin tag management (edit, merge, reprocess)
- /api/settings          → site settings CRUD + connectivity tests
- /api/rebuild           → cache purge webhook
"""

from fastapi import APIRouter

from app.api.admin_tags import router as admin_tags_router
from app.api.auth import router as auth_router
from app.api.auto_rating_rules import router as auto_rating_rules_router
from app.api.posts import router as posts_router
from app.api.search import router as search_router
from app.api.settings import router as settings_router
from app.api.tags import router as tags_router
from app.api.tasks import router as tasks_router
from app.api.webhook import router as webhook_router

api_router = APIRouter()

api_router.include_router(auth_router, prefix="/api/auth", tags=["auth"])
api_router.include_router(posts_router, prefix="/api/posts", tags=["posts"])
api_router.include_router(tags_router, prefix="/api/tags", tags=["tags"])
api_router.include_router(search_router, prefix="/api/search", tags=["search"])
api_router.include_router(tasks_router, prefix="/api/tasks", tags=["tasks"])
api_router.include_router(auto_rating_rules_router, prefix="/api/auto-rating-rules", tags=["auto-rating-rules"])
api_router.include_router(admin_tags_router, prefix="/api/admin/tags", tags=["admin-tags"])
api_router.include_router(settings_router, prefix="/api/settings", tags=["settings"])
api_router.include_router(webhook_router, prefix="/api/rebuild", tags=["webhook"])