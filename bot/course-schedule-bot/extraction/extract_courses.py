#!/usr/bin/env python3
"""Bot-side adapter for the shared UniPlan course extractor.

The website extractor is the single source of truth. The Telegram bot keeps
this small compatibility module so existing bot imports continue working:

    from extraction import extract_courses

Bot-specific processing should stay in the bot layer and should not modify the
shared parser.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Project root: <project>/bot/course-schedule-bot/extraction/extract_courses.py
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services.course_extractor.extract_courses import extract_courses  # noqa: E402,F401


__all__ = ["extract_courses"]
