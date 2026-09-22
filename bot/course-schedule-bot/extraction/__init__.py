"""Course-timetable extraction utilities.

This package wraps the PDF parser that turns a university's fixed
Persian-language timetable PDF into a list of course dictionaries.
See `extract_courses.extract_courses` for the main entry point.
"""

from .extract_courses import extract_courses

__all__ = ["extract_courses"]
