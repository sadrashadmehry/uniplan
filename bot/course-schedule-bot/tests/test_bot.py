"""Offline integration checks: no real Telegram or model requests."""
import asyncio
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from bot.config import Config, load_config
from bot.handlers import BotContext, handle_document, handle_text
from bot.session import Session, Stage
from extraction import extract_courses
from llm.client import AssistantClient, AssistantReply
from render.website_export import WebsiteExportError
from test_scheduler import make_record

ROOT = Path(__file__).resolve().parents[3]


class BotTests(unittest.TestCase):
    def test_config_is_independent_of_working_directory(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123:test", "AION_API_KEY": "test",
                                     "AION_MODEL": "test", "FONT_PATH": "../../public/fonts/xb-niloofar.ttf"}, clear=True):
            config = load_config()
            self.assertTrue(config.font_path.is_file())
            self.assertEqual(config.aion_model, "test")

    def test_missing_credentials_fail_clearly(self):
        with patch.dict(os.environ, {}, clear=True), patch("bot.config.load_dotenv"):
            with self.assertRaisesRegex(RuntimeError, "AION_API_KEY"):
                load_config()

    def test_model_output_validation(self):
        client = AssistantClient("test", "test")
        create = Mock()
        client._client.chat.completions.create = create
        def respond(data):
            create.return_value = SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(data)))])
        respond({"units": {"A": "3", "B": -1, "C": True, "D": 2.5, "E": "bad"}})
        self.assertEqual(client.parse_units(list("ABCDE"), "units"), {"A": 3})
        respond({"reply": "ok", "actions": [None, {"action": "set_units", "course": "A", "units": "bad"},
                                               {"action": "lock_course", "course": "unknown"},
                                               {"action": "include_course", "course": "A"}]})
        reply = client.chat([{"name": "A"}], [], [], "include A")
        self.assertEqual(reply.actions, [{"action": "include_course", "course": "A"}])
        respond({"reply": 5, "actions": None})
        self.assertEqual(client.chat([], [], [], "hello").actions, [])
        client._client.close()

    def test_units_to_render_and_chat_persistence(self):
        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            ROOT / "public/fonts/xb-niloofar.ttf", 3, 3)
            ctx = BotContext(config)
            session = Session(123, stage=Stage.AWAITING_UNITS,
                              raw_courses=[make_record("A", "Saturday", "08:00", "10:00")])
            ctx.save_session(session)
            ctx.assistant.parse_units = Mock(return_value={"A": 3})
            message = SimpleNamespace(text="A: 3", reply_text=AsyncMock(), reply_photo=AsyncMock())
            update = SimpleNamespace(effective_chat=SimpleNamespace(id=123), message=message)
            context = SimpleNamespace(bot_data={"bot_ctx": ctx})
            asyncio.run(handle_text(update, context))
            self.assertEqual(ctx.load_session(123).stage, Stage.READY)
            message.reply_photo.assert_awaited_once()
            ctx.assistant.chat = Mock(return_value=AssistantReply("ok", [{"action": "include_course", "course": "A"}]))
            message.text = "include A"
            asyncio.run(handle_text(update, context))
            self.assertEqual(ctx.load_session(123).locked_courses, ["A"])
            self.assertEqual(ctx.load_session(123).history, [{"role": "user", "content": "include A"},
                                                           {"role": "assistant", "content": "ok"}])
            ctx.store._conn.close()
            ctx.assistant._client.close()

    def test_website_export_used_when_configured(self):
        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            ROOT / "public/fonts/xb-niloofar.ttf", 3, 3,
                            website_export_url="http://127.0.0.1:3000/api/schedule/export",
                            website_export_token="secret")
            ctx = BotContext(config)
            session = Session(789, stage=Stage.READY,
                              raw_courses=[make_record("A", "Saturday", "08:00", "10:00")],
                              units_map={"A": 3})
            ctx.save_session(session)
            message = SimpleNamespace(text="regenerate", reply_text=AsyncMock(), reply_photo=AsyncMock())
            update = SimpleNamespace(effective_chat=SimpleNamespace(id=789), message=message)
            context = SimpleNamespace(bot_data={"bot_ctx": ctx})
            ctx.assistant.chat = Mock(return_value=AssistantReply("ok", [{"action": "regenerate"}]))
            with patch("bot.handlers.fetch_exported_schedule", return_value=b"\x89PNG") as mock_fetch, \
                 patch("bot.handlers.render_schedule") as mock_local:
                asyncio.run(handle_text(update, context))
            mock_fetch.assert_called_once()
            mock_local.assert_not_called()
            message.reply_photo.assert_awaited_once()
            ctx.store._conn.close()
            ctx.assistant._client.close()

    def test_website_export_failure_falls_back_to_local_render(self):
        def fake_render(selection, font_path, output_path):
            output_path.write_bytes(b"\x89PNG")
            return output_path

        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            ROOT / "public/fonts/xb-niloofar.ttf", 3, 3,
                            website_export_url="http://127.0.0.1:3000/api/schedule/export",
                            website_export_token="secret")
            ctx = BotContext(config)
            session = Session(790, stage=Stage.READY,
                              raw_courses=[make_record("A", "Saturday", "08:00", "10:00")],
                              units_map={"A": 3})
            ctx.save_session(session)
            message = SimpleNamespace(text="regenerate", reply_text=AsyncMock(), reply_photo=AsyncMock())
            update = SimpleNamespace(effective_chat=SimpleNamespace(id=790), message=message)
            context = SimpleNamespace(bot_data={"bot_ctx": ctx})
            ctx.assistant.chat = Mock(return_value=AssistantReply("ok", [{"action": "regenerate"}]))
            with patch("bot.handlers.fetch_exported_schedule", side_effect=WebsiteExportError("boom")), \
                 patch("bot.handlers.render_schedule", side_effect=fake_render) as mock_local:
                asyncio.run(handle_text(update, context))
            mock_local.assert_called_once()
            message.reply_photo.assert_awaited_once()
            sent_texts = [call.args[0] for call in message.reply_text.await_args_list if call.args]
            self.assertTrue(any("ساده‌تر" in text for text in sent_texts))
            ctx.store._conn.close()
            ctx.assistant._client.close()

    def test_bot_uses_shared_extractor(self):
        from services.course_extractor.extract_courses import extract_courses as shared
        self.assertIs(extract_courses, shared)

    def test_upload_uses_catalog_units_without_asking_student(self):
        from services.course_extractor.catalog import enrich_course
        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            ROOT / "public/fonts/xb-niloofar.ttf", 3, 3)
            ctx = BotContext(config)
            ctx.assistant.parse_units = Mock(side_effect=AssertionError("Must not ask for units"))
            known = enrich_course(make_record("برنامهسازی پیشرفت ه", "Saturday", "08:00", "10:00"))
            unknown = enrich_course(make_record("کاربینی", "Sunday", "08:00", "10:00"))
            document = SimpleNamespace(file_name="timetable.pdf", file_size=100,
                get_file=AsyncMock(return_value=SimpleNamespace(download_to_drive=AsyncMock())))
            message = SimpleNamespace(document=document, reply_text=AsyncMock(), reply_photo=AsyncMock())
            update = SimpleNamespace(effective_chat=SimpleNamespace(id=456), message=message)
            with patch("bot.handlers.extract_courses", return_value={"courses": [known, unknown], "warnings": []}):
                asyncio.run(handle_document(update, SimpleNamespace(bot_data={"bot_ctx": ctx})))
            session = ctx.load_session(456)
            self.assertEqual(session.stage, Stage.READY)
            self.assertEqual(session.units_map, {"برنامه سازی پیشرفته": 3})
            self.assertEqual([c["name"] for c in session.current_selection], ["برنامه سازی پیشرفته"])
            self.assertEqual(session.raw_courses[0]["prerequisites"], ["مبانی کامپیوتر و برنامه سازی"])
            ctx.assistant.parse_units.assert_not_called()
            message.reply_photo.assert_awaited_once()
            # A completely unknown upload cannot reuse the previous schedule.
            with patch("bot.handlers.extract_courses", return_value={"courses": [unknown], "warnings": []}):
                asyncio.run(handle_document(update, SimpleNamespace(bot_data={"bot_ctx": ctx})))
            self.assertEqual(ctx.load_session(456).stage, Stage.IDLE)
            self.assertEqual(ctx.load_session(456).current_selection, [])
            self.assertEqual(message.reply_photo.await_count, 1)
            ctx.store._conn.close()
            ctx.assistant._client.close()


if __name__ == "__main__":
    unittest.main()
