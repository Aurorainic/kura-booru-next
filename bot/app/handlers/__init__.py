from __future__ import annotations

from aiogram import Dispatcher

from app.handlers.start import router as start_router
from app.handlers.url_handler import router as url_handler_router
from app.handlers.save import router as save_router
from app.handlers.search import router as search_router
from app.handlers.info import router as info_router
from app.handlers.callback import router as callback_router
from app.handlers.random import router as random_router
from app.handlers.stats import router as stats_router


def register_all_handlers(dp: Dispatcher) -> None:
    """Register all handler routers on the dispatcher."""
    dp.include_router(start_router)
    dp.include_router(url_handler_router)
    dp.include_router(save_router)
    dp.include_router(search_router)
    dp.include_router(info_router)
    dp.include_router(callback_router)
    dp.include_router(random_router)
    dp.include_router(stats_router)
