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
from bot.handlers import BotContext, export_schedule, handle_document, handle_text
from bot.session import Session, Stage
from extraction import extract_courses
from llm.client import AssistantClient, AssistantReply
from render.website_export import WebsiteExportError
from test_scheduler import make_record

ROOT = Path(__file__).resolve().parents[3]


class BotTests(unittest.TestCase):
    def setUp(self):
        self.fetch_patch = patch("bot.handlers.fetch_exported_schedule", return_value=b"\x89PNG\r\n\x1a\n")
        self.fetch = self.fetch_patch.start()
        self.addCleanup(self.fetch_patch.stop)

    def test_config_is_independent_of_working_directory(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "123:test", "AION_API_KEY": "test",
                                     "AION_MODEL": "test", "SCHEDULE_EXPORT_TOKEN": "test-token"}, clear=True):
            config = load_config()
            self.assertEqual(config.website_export_token, "test-token")
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

    def test_model_budget_and_truncation(self):
        with patch.dict(os.environ, {"AION_MAX_OUTPUT_TOKENS": "512", "AION_REASONING_EFFORT": "none"}):
            client = AssistantClient("test", "aion-labs/aion-3.0-mini")
        self.addCleanup(client._client.close)
        create = Mock(return_value=SimpleNamespace(choices=[SimpleNamespace(
            finish_reason="stop", message=SimpleNamespace(content='{"reply":"ok","actions":[]}'))]))
        client._client.chat.completions.create = create
        course = {"name": "A", "units": 3, "days": ["Saturday"], "startTime": "08:00", "endTime": "10:00"}
        history = [{"role": "user", "content": str(i)} for i in range(10)]
        client.chat([course] * 20, [{"name": "A"}], history, "hello", {"locked": ["A"]})
        args = create.call_args.kwargs
        self.assertEqual(args["max_tokens"], 512)
        self.assertEqual(args["reasoning_effort"], "none")
        self.assertEqual(len(args["messages"]), 7)
        context = json.loads(args["messages"][1]["content"])
        self.assertEqual(len(context["courses"]), 1)
        self.assertEqual(len(context["courses"][0]["offerings"]), 1)
        self.assertEqual(context["state"]["locked"], ["A"])
        create.reset_mock()
        self.assertFalse(client.chat([], [], [], "x" * 1501).actions)
        self.assertFalse(client.chat([{"name": "x" * 24000}], [], [], "hi").actions)
        create.assert_not_called()
        create.return_value.choices[0].finish_reason = "length"
        create.return_value.choices[0].message.content = '{"reply":"ok","actions":[{"action":"regenerate"}]}'
        self.assertFalse(client.chat([], [], [], "hi").actions)
        client._model = "older-model"
        client.chat([], [], [], "hi")
        self.assertNotIn("reasoning_effort", create.call_args.kwargs)

    def test_units_to_render_and_chat_persistence(self):
        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            3, 3)
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
                            3, 3,
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
            with patch("bot.handlers.fetch_exported_schedule", return_value=b"\x89PNG") as mock_fetch:
                asyncio.run(handle_text(update, context))
            mock_fetch.assert_called_once()
            message.reply_photo.assert_awaited_once()
            ctx.store._conn.close()
            ctx.assistant._client.close()

    def test_export_failure_keeps_plan_and_command_retries_without_model(self):
        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            3, 3,
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
            with patch("bot.handlers.fetch_exported_schedule", side_effect=WebsiteExportError("boom")):
                asyncio.run(handle_text(update, context))
            message.reply_photo.assert_not_awaited()
            self.assertTrue(ctx.load_session(790).current_selection)
            sent_texts = [call.args[0] for call in message.reply_text.await_args_list if call.args]
            self.assertTrue(any("/export" in text for text in sent_texts))
            ctx.assistant.chat.reset_mock()
            asyncio.run(export_schedule(update, context))
            ctx.assistant.chat.assert_not_called()
            message.reply_photo.assert_awaited_once()
            self.assertEqual(message.reply_photo.call_args.kwargs["photo"].getvalue(), b"\x89PNG\r\n\x1a\n")
            ctx.store._conn.close()
            ctx.assistant._client.close()

    def test_bot_uses_shared_extractor(self):
        from services.course_extractor.extract_courses import extract_courses as shared
        self.assertIs(extract_courses, shared)

    def test_upload_uses_catalog_units_without_asking_student(self):
        from services.course_extractor.catalog import enrich_course
        with TemporaryDirectory() as directory:
            config = Config("123:test", "test", "test", Path(directory) / "sessions.db",
                            3, 3)
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
