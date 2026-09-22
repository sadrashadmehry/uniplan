"""Entry point: `python run.py` starts the bot in long-polling mode."""
from __future__ import annotations

import logging
import sys

from telegram.ext import Application, CommandHandler, MessageHandler, filters

from bot.config import load_config
from bot.handlers import BotContext, handle_document, handle_text, start

logging.basicConfig(
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    level=logging.INFO,
)

logging.getLogger("httpx").setLevel(logging.WARNING)


async def on_error(update, context):
    logging.error("Bot update failed: %s", type(context.error).__name__)
    if update and update.effective_message:
        await update.effective_message.reply_text("خطایی رخ داد. لطفاً دوباره تلاش کن.")


def main() -> None:
    config = load_config()
    application = Application.builder().token(config.telegram_token).build()
    application.bot_data["bot_ctx"] = BotContext(config)

    application.add_error_handler(on_error)
    if "--check" in sys.argv:
        logging.info("Bot configuration, dependencies, font and database are ready (offline check).")
        return

    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.Document.PDF, handle_document))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    logging.info("Bot is starting (long polling)...")
    application.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()
