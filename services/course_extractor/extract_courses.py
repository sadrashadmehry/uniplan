#!/usr/bin/env python3
"""Extract course offerings from the university's fixed timetable PDF.

The document stores Persian glyphs in visual order, so this parser repairs each
line before interpreting the table. It intentionally uses geometry and regular
expressions rather than a remote AI/OCR service.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pdfplumber

if __package__:
    from .catalog import enrich_course
else:
    from catalog import enrich_course


DAY_NAMES = {
    "شنبه": "Saturday",
    "یکشنبه": "Sunday",
    "دوشنبه": "Monday",
    "سهشنبه": "Tuesday",
    "چهارشنبه": "Wednesday",
}
DAY_ORDER = list(DAY_NAMES.values())
PERSIAN_TRANSLATION = str.maketrans({"ي": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه"})
ASCII_RUN = re.compile(r"[0-9:./-]+")
ROOM_AT_END = re.compile(r"\(\d{2,3}\)\s*$")
EXPLICIT_TIME = re.compile(r"\((\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\)")
SECTION = re.compile(r"گ\s*(\d+)")
INSTRUCTOR = re.compile(r"\([دم]\.\s*([^)]*)\)")
PERSIAN_LETTERS = re.compile(r"[\u0600-\u06ff]")


@dataclass(frozen=True)
class TimeSlot:
    x0: float
    x1: float
    start: str
    end: str


@dataclass(frozen=True)
class VerticalBand:
    top: float
    bottom: float
    value: str


def repair_visual_line(value: str) -> str:
    """Turn the PDF's visually stored RTL line into logical Unicode order."""
    value = value.strip().translate(PERSIAN_TRANSLATION)
    if not value:
        return ""
    if not PERSIAN_LETTERS.search(value):
        return normalize_spaces(value)
    repaired = value[::-1]
    repaired = ASCII_RUN.sub(lambda match: match.group(0)[::-1], repaired)
    repaired = repaired.translate(PERSIAN_TRANSLATION)
    repaired = repaired.replace(")(", ") (")
    return normalize_spaces(repaired)


def normalize_spaces(value: str) -> str:
    value = value.replace("\u200c", " ")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s+([)،,:])", r"\1", value)
    value = re.sub(r"([(/])\s+", r"\1", value)
    replacements = {
        "برنام ه": "برنامه ",
        "شبک ه": "شبکه ",
        "داد ه": "داده ",
        "شبی ه": "شبیه ",
        "زبا نها": "زبان ها",
        "زبا نهای": "زبان های",
        "ماشی نها": "ماشین ها",
        "سیست مهای": "سیستم های",
        "الگوریت مها": "الگوریتم ها",
        "نر مافزار": "نرم افزار",
        "دادهساختارها": "داده ساختارها",
        "الگوریتمها": "الگوریتم ها",
        "سیستمها": "سیستم ها",
        "سیگنالها": "سیگنال ها",
        "مهارتهای": "مهارت های",
        "اطالعات": "اطلاعات",
        "جبرخطی": "جبر خطی",
        "مقدم های": "مقدمه ای",
        "مقدمهای": "مقدمه ای",
        "رباتی ک": "رباتیک",
        "شغل ی": "شغلی",
        "تدری سیار": "تدریس یار",
        "حاج یصادقی": "حاجی صادقی",
        "صاح بالزمانی": "صاحب الزمانی",
        "روش نفکر": "روشن فکر",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)
    return value.strip(" -|/")


def compact_persian(value: str) -> str:
    return re.sub(r"[\s/\u200c-]+", "", value.translate(PERSIAN_TRANSLATION))


def crop_lines(page: Any, bbox: tuple[float, float, float, float]) -> list[str]:
    text = page.crop(bbox).extract_text(x_tolerance=1.5, y_tolerance=2.5) or ""
    return [repair_visual_line(line) for line in text.splitlines() if line.strip()]


def largest_table(page: Any) -> Any:
    tables = page.find_tables()
    if not tables:
        raise ValueError("No bordered timetable was detected on this page.")
    return max(
        tables,
        key=lambda table: (table.bbox[2] - table.bbox[0]) * (table.bbox[3] - table.bbox[1]),
    )


def parse_clock(value: str) -> str:
    value = value.strip()
    if ":" in value:
        hour, minute = value.split(":", 1)
    else:
        hour, minute = value, "00"
    return f"{int(hour):02d}:{int(minute):02d}"


def clock_minutes(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":"))
    return hour * 60 + minute


def find_time_slots(page: Any, table: Any) -> list[TimeSlot]:
    table_top = table.bbox[1]
    candidates: list[TimeSlot] = []
    for cell in table.cells:
        x0, top, x1, bottom = cell
        if abs(top - table_top) > 1.5 or bottom - top > 35 or x0 >= page.width * 0.91:
            continue
        text = page.crop(cell).extract_text() or ""
        times = re.findall(r"\d{1,2}(?::\d{2})?", text)
        if len(times) != 2:
            continue
        parsed = sorted((parse_clock(times[0]), parse_clock(times[1])), key=clock_minutes)
        candidates.append(TimeSlot(x0=x0, x1=x1, start=parsed[0], end=parsed[1]))
    if len(candidates) != 6:
        raise ValueError("The expected six timetable time columns were not found.")
    return sorted(candidates, key=lambda slot: slot.x0)


def scale_time_slots(slots: Iterable[TimeSlot], source_width: float, target_width: float) -> list[TimeSlot]:
    ratio = target_width / source_width
    return [
        TimeSlot(slot.x0 * ratio, slot.x1 * ratio, slot.start, slot.end)
        for slot in slots
    ]


def find_day_bands(page: Any, table: Any, fallback_offset: int) -> tuple[list[VerticalBand], list[str]]:
    warnings: list[str] = []
    day_column_left = page.width * 0.96
    ranges = {
        (round(cell[1], 2), round(cell[3], 2))
        for cell in table.cells
        if cell[0] >= day_column_left and cell[3] - cell[1] >= 30
    }
    bands: list[VerticalBand] = []
    for index, (top, bottom) in enumerate(sorted(ranges)):
        raw = page.crop((day_column_left, top, table.bbox[2], bottom)).extract_text() or ""
        repaired = "".join(repair_visual_line(line) for line in reversed(raw.splitlines()))
        compact = compact_persian(repaired)
        ordered_names = sorted(DAY_NAMES, key=len, reverse=True)
        day = next((DAY_NAMES[persian] for persian in ordered_names if persian in compact), "")
        if not day:
            fallback_index = fallback_offset + index
            if fallback_index < len(DAY_ORDER):
                day = DAY_ORDER[fallback_index]
                warnings.append(f"The {day} label was inferred from its fixed table position.")
        if day:
            bands.append(VerticalBand(top, bottom, day))
    return bands, warnings


def category_type(value: str) -> str:
    compact = compact_persian(value)
    if "اصلی" in compact:
        return "Major requirements"
    if "تخصصی" in compact:
        return "Track"
    if "عمومی" in compact:
        return "General"
    if "اختیاری" in compact:
        return "Elective courses"
    return ""


def find_category_bands(page: Any, table: Any, day: VerticalBand, time_right: float) -> list[VerticalBand]:
    bands: list[VerticalBand] = []
    tolerance = max(2.0, page.width * 0.003)
    for cell in table.cells:
        x0, top, x1, bottom = cell
        if abs(x0 - time_right) > tolerance:
            continue
        if top < day.top - 1 or bottom > day.bottom + 1 or bottom - top < 9:
            continue
        lines = crop_lines(page, (x0, top, x1, bottom))
        bands.append(VerticalBand(top, bottom, category_type("".join(lines))))
    unique = {(round(band.top, 2), round(band.bottom, 2), band.value): band for band in bands}
    result = sorted(unique.values(), key=lambda band: band.top)
    if not result:
        return [VerticalBand(day.top, day.bottom, "")]
    return result


def split_course_records(lines: list[str]) -> list[str]:
    records: list[str] = []
    pending: list[str] = []
    for line in lines:
        if not PERSIAN_LETTERS.search(line):
            continue
        pending.append(line)
        if ROOM_AT_END.search(line):
            records.append(normalize_spaces(" ".join(pending)))
            pending = []
    if pending:
        candidate = normalize_spaces(" ".join(pending))
        if len(PERSIAN_LETTERS.findall(candidate)) >= 5:
            records.append(candidate)
    return records


def clean_course_name(record: str) -> str:
    markers = []
    section = SECTION.search(record)
    instructor = INSTRUCTOR.search(record)
    if section:
        markers.append(section.start())
    if instructor:
        markers.append(instructor.start())
    name = record[: min(markers)] if markers else record
    name = re.sub(r"\([^)]*\)\s*$", "", name)
    return normalize_spaces(name).strip("() ")


def explicit_or_slot_time(record: str, slot: TimeSlot) -> tuple[str, str]:
    match = EXPLICIT_TIME.search(record)
    if not match:
        return slot.start, slot.end
    first, second = parse_clock(match.group(1)), parse_clock(match.group(2))
    ordered = sorted((first, second), key=clock_minutes)
    return ordered[0], ordered[1]


def make_course(record: str, day: str, category: str, slot: TimeSlot) -> dict[str, Any] | None:
    name = clean_course_name(record)
    if len(PERSIAN_LETTERS.findall(name)) < 3:
        return None
    instructor_match = INSTRUCTOR.search(record)
    section_match = SECTION.search(record)
    start_time, end_time = explicit_or_slot_time(record, slot)
    instructor = normalize_spaces(instructor_match.group(1)) if instructor_match else None
    section = section_match.group(1) if section_match else None
    confidence = 0.96
    if not instructor:
        confidence -= 0.08
    if not ROOM_AT_END.search(record):
        confidence -= 0.1
    return {
        "name": name,
        "days": [day],
        "startTime": start_time,
        "endTime": end_time,
        "examDate": None,
        "type": category,
        "trackName": None,
        "instructor": instructor,
        "section": section,
        "sourceContext": record,
        "confidence": round(max(0.5, confidence), 2),
        "missingFields": ["examDate"],
    }


def merge_matching_meetings(courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for course in courses:
        key = (
            course["name"],
            course["instructor"],
            course["section"],
            course["startTime"],
            course["endTime"],
            course["type"],
        )
        if key not in merged:
            merged[key] = course
            continue
        days = merged[key]["days"]
        for day in course["days"]:
            if day not in days:
                days.append(day)
        merged[key]["days"] = sorted(days, key=DAY_ORDER.index)
    return list(merged.values())


def extract_courses(pdf_path: Path) -> dict[str, Any]:
    courses: list[dict[str, Any]] = []
    warnings: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages:
            raise ValueError("The PDF has no pages.")
        first_table = largest_table(pdf.pages[0])
        reference_slots = find_time_slots(pdf.pages[0], first_table)
        reference_width = pdf.pages[0].width
        day_offset = 0

        for page_number, page in enumerate(pdf.pages, start=1):
            if not page.extract_words():
                raise ValueError(
                    "This PDF page is an image. This local parser currently expects the fixed text-based timetable PDF."
                )
            table = largest_table(page)
            slots = scale_time_slots(reference_slots, reference_width, page.width)
            days, day_warnings = find_day_bands(page, table, day_offset)
            warnings.extend(day_warnings)
            day_offset += len(days)
            if not days:
                warnings.append(f"No weekday block was detected on page {page_number}.")
                continue
            time_right = max(slot.x1 for slot in slots)
            for day in days:
                categories = find_category_bands(page, table, day, time_right)
                for category in categories:
                    for slot in slots:
                        inset = 1.0
                        bbox = (
                            slot.x0 + inset,
                            category.top + inset,
                            slot.x1 - inset,
                            category.bottom - inset,
                        )
                        for record in split_course_records(crop_lines(page, bbox)):
                            course = make_course(record, day.value, category.value, slot)
                            if course:
                                courses.append(enrich_course(course))

        if len(pdf.pages) > 1:
            warnings.append(f"The uploaded file contains {len(pdf.pages)} pages; all pages were parsed.")

    merged = merge_matching_meetings(courses)
    if not merged:
        raise ValueError("No course offerings were found in the expected timetable cells.")
    warnings.append("Exam dates are not present in this timetable and must be completed before adding a course.")
    unknown = sorted({course["name"] for course in merged if course["units"] is None})
    for name in unknown:
        warnings.append(f"No verified curriculum match for '{name}'; units and requirements remain unknown.")
    return {"courses": merged, "warnings": warnings}


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: extract_courses.py <timetable.pdf>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file() or path.suffix.lower() != ".pdf":
        print("The input must be an existing PDF file.", file=sys.stderr)
        return 2
    try:
        result = extract_courses(path)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
