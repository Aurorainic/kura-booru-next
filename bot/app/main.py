from __future__ import annotations

import logging

from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.webhook.aiohttp_server import SimpleRequestProcessor, TokenBasedRequest, setup_application

from app.config import settings
from app.middleware import AuthMiddleware
from app.handlers import register_all_handlers
from app.services.backend_api import close_session
from app.services.arq_client import close_arq_pool

logger = logging.getLogger(__name__)

# Global request processor — must be a single instance shared across requests
REQUEST_PROCESSOR = SimpleRequestProcessor()


async def on_startup(bot: Bot) -> None:
    """Set webhook URL on startup."""
    logger.info("Setting webhook: %s", settings.BOT_WEBHOOK_URL)
    await bot.set_webhook(
        url=settings.BOT_WEBHOOK_URL,
        secret=settings.BOT_WEBHOOK_SECRET,
        drop_pending_updates=True,
    )


async def on_shutdown(bot: Bot) -> None:
    """Clean up on shutdown — delete webhook, close sessions."""
    logger.info("Shutting down bot...")

    # Delete the webhook
    await bot.delete_webhook(drop_pending_updates=True)

    # Close bot session
    await bot.session.close()

    # Close backend API session
    await close_session()

    # Close ARQ pool
    await close_arq_pool()

    logger.info("Bot shut down complete.")


async def health_check(request: web.Request) -> web.Response:
    """Simple health check endpoint for Docker HEALTHCHECK and load balancers."""
    return web.Response(text="ok")


def create_app() -> web.Application:
    """Create and configure the aiohttp web application with the bot."""
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Create Bot and Dispatcher
    bot = Bot(
        token=settings.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN),
    )
    dp = Dispatcher()

    # Register middleware
    dp.message.middleware(AuthMiddleware())
    dp.callback_query.middleware(AuthMiddleware())

    # Register all handlers
    register_all_handlers(dp)

    # Startup / shutdown hooks
    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)

    # Create aiohttp web app
    app = web.Application()

    # Health check endpoint (GET /)
    app.router.add_get("/", health_check)

    # Set up webhook handler with secret token verification
    webhook_handler = TokenBasedRequest(
        processor=REQUEST_PROCESSOR,
        token=settings.BOT_TOKEN,
    )
    # Register the webhook path at /bot/webhook (matching Caddy config)
    app.router.add_route("POST", "/bot/webhook", webhook_handler)

    # Setup aiogram integration
    setup_application(app, dp, bot=bot)

    return app


def main() -> None:
    """Entry point — start the aiohttp web server on port 8080."""
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()