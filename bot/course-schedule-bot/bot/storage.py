"""Lightweight SQLite-backed session persistence.

Each Telegram chat gets one row holding its whole conversation state as
a JSON blob (see `bot.session.Session`). SQLite (part of the Python
standard library) is enough for an MVP with a single bot process; swap
this module for a real database if the bot needs to scale horizontally
across multiple processes (see ROADMAP.md).
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


class SessionStore:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                chat_id INTEGER PRIMARY KEY,
                state TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        self._conn.commit()

    def load(self, chat_id: int) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT state FROM sessions WHERE chat_id = ?", (chat_id,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, chat_id: int, state: dict[str, Any]) -> None:
        self._conn.execute(
            """
            INSERT INTO sessions (chat_id, state, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(chat_id) DO UPDATE SET
                state = excluded.state,
                updated_at = CURRENT_TIMESTAMP
            """,
            (chat_id, json.dumps(state, ensure_ascii=False)),
        )
        self._conn.commit()

    def delete(self, chat_id: int) -> None:
        self._conn.execute("DELETE FROM sessions WHERE chat_id = ?", (chat_id,))
        self._conn.commit()
