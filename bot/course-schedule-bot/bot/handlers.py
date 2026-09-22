
"""Telegram update handlers.

Flow: /start -> upload PDF -> match curriculum -> receive the
generated schedule image -> free-form Persian chat to request changes.
"""
from __future__ import annotations

import asyncio
import io
import logging
import tempfile
from pathlib import Path

from telegram import Update
from telegram.ext import ContextTypes

from extraction import extract_courses
from llm.client import AssistantClient
from render.website_export import WebsiteExportError, fetch_exported_schedule
from scheduler.engine import group_raw_courses, solve_schedule
from scheduler.models import Course, SectionOffering

from .config import Config
from .session import Session, Stage
from .storage import SessionStore

logger = logging.getLogger(__name__)

WELCOME = (
    "سلام! 👋 من دستیار برنامه‌ریزی درسی هستم.\n"
    "فایل PDF برنامه‌ی هفتگی دانشگاهت رو برام بفرست تا درس‌های قابل انتخاب رو استخراج کنم "
    "و یک برنامه‌ی ۱۶ تا ۱۹ واحدیِ بدون تداخل برات پیشنهاد بدم.\n"
    "بعد از دریافت برنامه، هر تغییری که بخوای می‌تونی همین‌جا باهام در میون بذاری."
)


class BotContext:
    """Bundles the shared, process-wide dependencies handlers need."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.store = SessionStore(config.database_path)
        self.assistant = AssistantClient(config.aion_api_key, config.aion_model)

    def load_session(self, chat_id: int) -> Session:
        data = self.store.load(chat_id)
        return Session.from_dict(data) if data else Session(chat_id=chat_id)

    def save_session(self, session: Session) -> None:
        self.store.save(session.chat_id, session.to_dict())


def _unique_course_names(raw_courses: list[dict]) -> list[str]:
    seen: list[str] = []
    for record in raw_courses:
        if record["name"] not in seen:
            seen.append(record["name"])
    return seen


def _selection_to_dicts(selection: list[SectionOffering]) -> list[dict]:
    return [
        {
            "name": offering.course_name,
            "courseCode": offering.course_code,
            "category": offering.category,
            "instructor": offering.instructor,
            "section": offering.section_id,
            "blocks": [{"day": b.day, "start": b.start, "end": b.end} for b in offering.blocks],
        }
        for offering in selection
    ]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    bot_ctx: BotContext = context.bot_data["bot_ctx"]
    session = Session(chat_id=update.effective_chat.id)
    bot_ctx.save_session(session)
    await update.message.reply_text(WELCOME)


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    bot_ctx: BotContext = context.bot_data["bot_ctx"]
    document = update.message.document
    if not document or not (document.file_name or "").lower().endswith(".pdf"):
        await update.message.reply_text("لطفاً فقط فایل PDF برنامه‌ی هفتگی رو بفرست.")
        return

    if document.file_size and document.file_size > 10 * 1024 * 1024:
        await update.message.reply_text("حداکثر حجم فایل ۱۰ مگابایت است.")
        return

    session = bot_ctx.load_session(update.effective_chat.id)
    session.reset_for_new_upload()

    with tempfile.TemporaryDirectory() as tmp_dir:
        pdf_path = Path(tmp_dir) / "timetable.pdf"
        telegram_file = await document.get_file()
        await telegram_file.download_to_drive(str(pdf_path))
        try:
            result = await asyncio.to_thread(extract_courses, pdf_path)
        except Exception as error:  # extraction raises plain ValueError/Exception on bad input
            logger.exception("Extraction failed")
            await update.message.reply_text(
                "متأسفانه نتونستم درس‌ها رو از این فایل استخراج کنم:\n"
                f"{error}\n"
                "لطفاً از فایل PDF متنیِ برنامه‌ی هفتگیِ دانشگاه (نه اسکن‌شده) استفاده کن."
            )
            return

    if not result["courses"]:
        await update.message.reply_text("درسی در این فایل پیدا نشد. لطفاً فایل برنامه را بررسی کن.")
        return

    session.raw_courses = result["courses"]
    session.units_map = {course["name"]: course["units"] for course in session.raw_courses
                         if isinstance(course.get("units"), int) and course["units"] > 0}

    course_names = _unique_course_names(session.raw_courses)
    # Send bounded messages even for large catalogs (Telegram's limit is 4096).
    lines = []
    for name in course_names:
        units = session.units_map.get(name)
        lines.append(f"• {name}: {units} واحد" if units else f"• {name}: در مرجع یافت نشد؛ از برنامه حذف شد")
    for offset in range(0, len(lines), 15):
        await update.message.reply_text("\n".join(lines[offset:offset + 15]))
    if not session.units_map:
        bot_ctx.save_session(session)
        await update.message.reply_text("هیچ درسی با مرجع تطبیق نداشت؛ برنامه ساخته نشد.")
        return
    await update.message.reply_text(
        "تعداد واحدها از مرجع درسی خوانده شد. پیش‌نیاز و هم‌نیاز ثبت شده‌اند، "
        "اما بدون سوابق درسی شما احراز نشده‌اند؛ پیش از انتخاب واحد بررسی‌شان کن."
    )
    await _finalize_schedule(update, session, bot_ctx)


async def _finalize_schedule(
    update: Update, session: Session, bot_ctx: BotContext
) -> None:
    """Validate/solve the plan, then always request the website's PNG."""
    courses: list[Course] = group_raw_courses(session.raw_courses, session.units_map)
    schedule = solve_schedule(
        courses,
        min_units=bot_ctx.config.min_units,
        max_units=bot_ctx.config.max_units,
        must_include=session.locked_courses,
        must_exclude=session.excluded_courses,
    )
    session.current_selection = _selection_to_dicts(schedule.selected)
    session.stage = Stage.READY
    bot_ctx.save_session(session)

    if not schedule.selected:
        if schedule.warnings:
            await update.message.reply_text("توجه:\n" + "\n".join(f"- {w}" for w in schedule.warnings))
        await update.message.reply_text(
            "با محدودیت‌های فعلی نتونستم برنامه‌ای بسازم. می‌تونی یک درس رو حذف/باز کنی یا "
            "محدوده‌ی واحد رو تغییر بدی."
        )
        return

    caption = f"برنامه‌ی پیشنهادی — مجموع {schedule.total_units} واحد"
    try:
        image_bytes = await asyncio.to_thread(
            fetch_exported_schedule,
            schedule.selected,
            schedule.total_units,
            bot_ctx.config.website_export_url,
            bot_ctx.config.website_export_token,
        )
    except WebsiteExportError:
        logger.warning("Website schedule export failed")
        await update.message.reply_text(
            "برنامه ذخیره شد، ولی خروجی تصویر سایت فعلاً در دسترس نیست. "
            "برای تلاش دوباره /export را بفرست."
        )
        return
    await update.message.reply_photo(photo=io.BytesIO(image_bytes), caption=caption)

    if schedule.warnings:
        await update.message.reply_text("توجه:\n" + "\n".join(f"- {w}" for w in schedule.warnings))
    await update.message.reply_text(
        "اگر می‌خوای تغییری بدی (مثلاً حذف یا اضافه‌کردن یک درس، یا تغییر تعداد واحد)، "
        "همین‌جا برام بنویس."
    )


async def export_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Retry rendering from persisted constraints without asking the model."""
    bot_ctx: BotContext = context.bot_data["bot_ctx"]
    session = bot_ctx.load_session(update.effective_chat.id)
    if session.stage != Stage.READY:
        await update.message.reply_text("اول فایل برنامه‌ی هفتگی را بفرست.")
        return
    await _finalize_schedule(update, session, bot_ctx)


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    bot_ctx: BotContext = context.bot_data["bot_ctx"]
    session = bot_ctx.load_session(update.effective_chat.id)
    text = (update.message.text or "").strip()

    if session.stage == Stage.IDLE:
        await update.message.reply_text("برای شروع، فایل PDF برنامه‌ی هفتگیت رو برام بفرست.")
        return

    if session.stage == Stage.AWAITING_UNITS:
        course_names = _unique_course_names(session.raw_courses)
        parsed = await asyncio.to_thread(bot_ctx.assistant.parse_units, course_names, text)
        session.units_map.update(parsed)
        missing = [name for name in course_names if name not in session.units_map]
        if missing:
            bot_ctx.save_session(session)
            await update.message.reply_text(
                "این درس‌ها هنوز واحدشون مشخص نیست، لطفاً برام بفرست:\n"
                + "\n".join(f"• {name}" for name in missing)
            )
            return
        await _finalize_schedule(update, session, bot_ctx)
        return

    # Stage.READY: free-form modification requests handled by the assistant.
    reply = await asyncio.to_thread(
        bot_ctx.assistant.chat,
        session.raw_courses,
        session.current_selection,
        session.history,
        text,
    )
    session.remember("user", text)
    changed = False
    for action in reply.actions:
        kind = action.get("action")
        course = action.get("course")
        if kind == "exclude_course" and course:
            if course not in session.excluded_courses:
                session.excluded_courses.append(course)
            session.locked_courses = [c for c in session.locked_courses if c != course]
            changed = True
        elif kind == "include_course" and course:
            if course not in session.locked_courses:
                session.locked_courses.append(course)
            session.excluded_courses = [c for c in session.excluded_courses if c != course]
            changed = True
        elif kind == "lock_course" and course:
            if course not in session.locked_courses:
                session.locked_courses.append(course)
            session.excluded_courses = [c for c in session.excluded_courses if c != course]
            changed = True
        elif kind == "unlock_course" and course:
            session.locked_courses = [c for c in session.locked_courses if c != course]
            changed = True
        elif kind == "set_units" and course and "units" in action:
            session.units_map[course] = int(action["units"])
            changed = True
        elif kind == "regenerate":
            changed = True

    session.remember("assistant", reply.reply)
    await update.message.reply_text(reply.reply)

    if changed:
        await _finalize_schedule(update, session, bot_ctx)
    else:
        bot_ctx.save_session(session)
