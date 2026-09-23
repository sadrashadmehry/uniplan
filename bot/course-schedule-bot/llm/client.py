"""Thin wrapper around the Aion Labs (OpenAI-compatible) API."""

from __future__ import annotations

import json
import importlib
import re
import os
from dataclasses import dataclass, field
from typing import Any

from . import prompts

SHORTER_REQUEST = "لطفاً درخواستت را کوتاه‌تر و در چند پیام جدا بفرست. برنامه تغییری نکرد."
INVALID_REPLY = "پاسخ مدل کامل نبود؛ برنامه تغییری نکرد. لطفاً درخواست را کوتاه‌تر تکرار کن."

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
            max_retries=0,
            base_url="https://api.aionlabs.ai/v1",
        )
        self._model = model
        self._max_tokens = int(os.getenv("AION_MAX_OUTPUT_TOKENS", "512"))
        if not 128 <= self._max_tokens <= 2048:
            raise ValueError("AION_MAX_OUTPUT_TOKENS must be between 128 and 2048")
        self._reasoning = os.getenv("AION_REASONING_EFFORT", "none")
        if self._reasoning not in {"none", "low", "medium", "high", "max"}:
            raise ValueError("Invalid AION_REASONING_EFFORT")

    def _complete(self, messages):
        # UTF-8 bytes bound input size without assuming an incompatible tokenizer.
        # Do not silently drop catalog/state when the budget is exceeded.
        if sum(len(m["content"].encode("utf-8")) for m in messages) > 24000:
            return None
        options = {}
        if self._model.split("/")[-1] in {"aion-2.0", "aion-3.0", "aion-3.0-mini"}:
            options["reasoning_effort"] = self._reasoning
        return self._client.chat.completions.create(
            model=self._model, max_tokens=self._max_tokens, messages=messages, **options)


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

    def chat(self, course_catalog, current_schedule, history, user_message, state=None):
        if len(user_message) > 1500:
            return AssistantReply(SHORTER_REQUEST)
        catalog = {}
        for course in course_catalog:
            name = course["name"]
            entry = catalog.setdefault(name, {key: course[key] for key in
                ("name", "units", "prerequisites", "corequisites") if key in course})
            offering = {key: course[key] for key in
                ("days", "startTime", "endTime", "instructor") if key in course}
            if offering and offering not in entry.setdefault("offerings", []):
                entry["offerings"].append(offering)
        context = json.dumps({"courses": list(catalog.values()),
            "selected": [c["name"] for c in current_schedule], "state": state or {}},
            ensure_ascii=False, separators=(",", ":"))
        recent = []
        remaining = 3000
        for turn in reversed(history[-4:]):
            size = len(turn["content"].encode("utf-8"))
            if size > remaining:
                break
            recent.insert(0, {"role": turn["role"], "content": turn["content"]})
            remaining -= size
        response = self._complete([
            {"role": "system", "content": prompts.SYSTEM_PROMPT},
            {"role": "user", "content": context}, *recent,
            {"role": "user", "content": user_message}])
        if response is None:
            return AssistantReply("اطلاعات درس‌ها بیش از حد بزرگ است؛ فایل را به درس‌های موردنیاز محدود کن. برنامه تغییری نکرد.")
        if getattr(response.choices[0], "finish_reason", None) == "length":
            return AssistantReply(INVALID_REPLY)

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
            return AssistantReply(reply=INVALID_REPLY, actions=[])

    def parse_units(self, course_names, user_message):
        prompt = (
            prompts.UNITS_REQUEST_PROMPT
            + "\nنام دقیق درس‌ها:\n"
            + json.dumps(course_names, ensure_ascii=False)
        )

        if len(user_message) > 1500:
            return {}
        response = self._complete([
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message}])
        if response is None or getattr(response.choices[0], "finish_reason", None) == "length":
            return {}

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
