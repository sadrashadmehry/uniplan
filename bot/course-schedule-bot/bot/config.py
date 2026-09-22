"""Bot configuration; paths are relative to the bot directory, not the shell."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Config:
    telegram_token: str
    aion_api_key: str
    aion_model: str
    database_path: Path
    min_units: int = 16
    max_units: int = 19
    # Website rendering is mandatory; both processes share this token.
    website_export_url: str = ""
    website_export_token: str = ""


def load_config() -> Config:
    load_dotenv(PROJECT_ROOT / ".env")
    values = {name: os.environ.get(name, "").strip() for name in
              ("TELEGRAM_BOT_TOKEN", "AION_API_KEY", "AION_MODEL", "SCHEDULE_EXPORT_TOKEN")}
    missing = [name for name, value in values.items() if not value or value.startswith("your-")]
    if missing:
        raise RuntimeError("Set " + ", ".join(missing) + " in bot/course-schedule-bot/.env")
    min_units = int(os.environ.get("MIN_UNITS", "16"))
    max_units = int(os.environ.get("MAX_UNITS", "19"))
    if not 1 <= min_units <= max_units:
        raise ValueError("Unit range must satisfy 1 <= MIN_UNITS <= MAX_UNITS")
    return Config(
        telegram_token=values["TELEGRAM_BOT_TOKEN"],
        aion_api_key=values["AION_API_KEY"],
        aion_model=values["AION_MODEL"],
        database_path=PROJECT_ROOT / os.environ.get("DATABASE_PATH", "data/sessions.db"),
        min_units=min_units,
        max_units=max_units,
        website_export_url=os.environ.get("SCHEDULE_EXPORT_URL", "http://127.0.0.1:3000/api/schedule/export").strip(),
        website_export_token=os.environ.get("SCHEDULE_EXPORT_TOKEN", "").strip(),
    )
