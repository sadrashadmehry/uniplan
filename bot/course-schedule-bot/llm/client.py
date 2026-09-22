"""Thin wrapper around the Aion Labs (OpenAI-compatible) API."""

from __future__ import annotations

import json
import importlib
import re
from dataclasses import dataclass, field
from typing import Any

from . import prompts

JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


@dataclass
class AssistantReply:
    reply: str
    actions: list[dict[str, Any]] = field(default_factory=list)


class AssistantClient:
    def __init__(self, api_key: str, model: str) -> None:
        try:
            openai = importlib.import_module("openai")
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "The 'openai' package is required. Install it with: pip install openai"
            ) from exc

        self._client = openai.OpenAI(
            api_key=api_key,
            timeout=45.0,
            max_retries=1,
            base_url="https://api.aionlabs.ai/v1",
        )
        self._model = model

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        match = JSON_OBJECT.search(text)
        if not match:
            raise ValueError(f"The model did not return JSON: {text!r}")
        data = json.loads(match.group(0))
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object")
        return data

    @staticmethod
    def _text_of(response: Any) -> str:
        return response.choices[0].message.content or ""

    def chat(self, course_catalog, current_schedule, history, user_message):
        context = (
            "لیست درس‌های موجود دانشجو (JSON):\n"
            + json.dumps(course_catalog, ensure_ascii=False)
            + "\n\nبرنامه‌ی فعلی انتخاب‌شده (JSON):\n"
            + json.dumps(current_schedule, ensure_ascii=False)
        )

        messages = [{"role": "user", "content": context}]
        for turn in history[-10:]:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": user_message})

        response = self._client.chat.completions.create(
            model=self._model,
            max_tokens=1024,
            messages=[{"role": "system", "content": prompts.SYSTEM_PROMPT}, *messages],
        )

        text = self._text_of(response)
        try:
            data = self._extract_json(text)
            reply = data.get("reply")
            actions = data.get("actions", [])
            if not isinstance(reply, str) or not reply.strip() or not isinstance(actions, list):
                raise ValueError("Invalid assistant response")
            names = {course["name"] for course in course_catalog}
            valid_actions = []
            for action in actions:
                if not isinstance(action, dict):
                    continue
                kind = action.get("action")
                if kind == "regenerate":
                    valid_actions.append({"action": kind})
                elif isinstance(kind, str) and kind in {"exclude_course", "include_course", "lock_course", "unlock_course", "set_units"} and isinstance(action.get("course"), str) and action["course"] in names:
                    if kind == "set_units":
                        units = self._valid_units(action.get("units"))
                        if units is None:
                            continue
                        action = {**action, "units": units}
                    valid_actions.append(action)
            return AssistantReply(reply=reply, actions=valid_actions)
        except (ValueError, json.JSONDecodeError):
            return AssistantReply(reply=text, actions=[])

    def parse_units(self, course_names, user_message):
        prompt = (
            prompts.UNITS_REQUEST_PROMPT
            + "\nنام دقیق درس‌ها:\n"
            + json.dumps(course_names, ensure_ascii=False)
        )

        response = self._client.chat.completions.create(
            model=self._model,
            max_tokens=512,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_message},
            ],
        )

        text = self._text_of(response)

        try:
            data = self._extract_json(text)
        except (ValueError, json.JSONDecodeError):
            return {}

        units = data.get("units", {})
        if not isinstance(units, dict):
            return {}
        return {name: parsed for name, value in units.items()
                if name in course_names and (parsed := self._valid_units(value)) is not None}

    @staticmethod
    def _valid_units(value):
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return None
        try:
            units = int(value)
        except ValueError:
            return None
        return units if 1 <= units <= 24 else None
