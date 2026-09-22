"""In-memory representation of one student's conversation state.

Serialized to/from JSON by bot.storage.SessionStore between messages.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class Stage(str, Enum):
    IDLE = "idle"                       # waiting for a PDF upload
    AWAITING_UNITS = "awaiting_units"   # asked the student for unit counts
    READY = "ready"                     # has a rendered schedule, open to chat edits


@dataclass
class Session:
    chat_id: int
    stage: Stage = Stage.IDLE
    raw_courses: list[dict[str, Any]] = field(default_factory=list)
    units_map: dict[str, int] = field(default_factory=dict)
    excluded_courses: list[str] = field(default_factory=list)
    locked_courses: list[str] = field(default_factory=list)
    current_selection: list[dict[str, Any]] = field(default_factory=list)
    history: list[dict[str, str]] = field(default_factory=list)  # [{"role": "user"/"assistant", "content": ...}]

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["stage"] = self.stage.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Session":
        data = dict(data)
        data["stage"] = Stage(data.get("stage", Stage.IDLE.value))
        return cls(**data)

    def reset_for_new_upload(self) -> None:
        self.stage = Stage.IDLE
        self.raw_courses = []
        self.units_map = {}
        self.excluded_courses = []
        self.locked_courses = []
        self.current_selection = []
        self.history = []

    def remember(self, role: str, content: str, max_turns: int = 20) -> None:
        self.history.append({"role": role, "content": content})
        if len(self.history) > max_turns:
            self.history[:] = self.history[-max_turns:]
