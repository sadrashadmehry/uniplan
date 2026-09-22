"""Render a selected weekly schedule as a PNG image.

Persian text needs shaping and bidi reordering before Pillow can draw it
correctly (Pillow only lays out plain left-to-right glyph runs), so every
label goes through `arabic_reshaper` + `python-bidi` first.
"""
from __future__ import annotations

from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

from scheduler.models import SectionOffering

PERSIAN_DAY_LABELS = {
    "Saturday": "شنبه",
    "Sunday": "یک‌شنبه",
    "Monday": "دوشنبه",
    "Tuesday": "سه‌شنبه",
    "Wednesday": "چهارشنبه",
    "Thursday": "پنج‌شنبه",
    "Friday": "جمعه",
}
DAY_ORDER = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

CATEGORY_COLORS = {
    "Major requirements": "#4C6EF5",
    "Track": "#12B886",
    "General": "#F59F00",
    "Elective courses": "#E64980",
    "": "#868E96",
}
CATEGORY_LABELS_FA = {
    "Major requirements": "دروس اصلی",
    "Track": "دروس تخصصی",
    "General": "دروس عمومی",
    "Elective courses": "دروس اختیاری",
    "": "نامشخص",
}

MARGIN = 60
HEADER_HEIGHT = 50
ROW_HEIGHT = 70
COL_WIDTH = 190
SLOT_MINUTES = 60


def _rtl(text: str) -> str:
    return get_display(arabic_reshaper.reshape(text))


def _load_font(font_path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not font_path.is_file():
        raise FileNotFoundError(
            f"Persian font not found at {font_path}. Download a font such as Vazirmatn "
            "(https://github.com/rastikerdar/vazirmatn) and set FONT_PATH in .env, or see "
            "render/fonts/README.md."
        )
    return ImageFont.truetype(str(font_path), size)


def render_schedule(
    selection: list[SectionOffering],
    font_path: Path,
    output_path: Path,
    title: str = "برنامه‌ی هفتگی پیشنهادی",
) -> Path:
    days_used = sorted(
        {block.day for offering in selection for block in offering.blocks},
        key=lambda d: DAY_ORDER.index(d) if d in DAY_ORDER else len(DAY_ORDER),
    ) or DAY_ORDER[:6]

    all_minutes = [b.minutes() for offering in selection for b in offering.blocks] or [(8 * 60, 10 * 60)]
    start_minute = min(m[0] for m in all_minutes) // 60 * 60
    end_minute = -(-max(m[1] for m in all_minutes) // 60) * 60  # round up to the next full hour
    slot_count = max(1, (end_minute - start_minute) // SLOT_MINUTES)

    width = max(880, MARGIN * 2 + COL_WIDTH * (len(days_used) + 1))
    height = MARGIN * 2 + HEADER_HEIGHT + ROW_HEIGHT * slot_count + 40

    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    title_font = _load_font(font_path, 26)
    header_font = _load_font(font_path, 20)
    label_font = _load_font(font_path, 16)
    body_font = _load_font(font_path, 14)

    draw.text((width / 2, MARGIN / 2), _rtl(title), font=title_font, fill="black", anchor="mm")

    grid_top = MARGIN + HEADER_HEIGHT
    grid_left = MARGIN + COL_WIDTH

    # Horizontal grid lines + time labels.
    for row in range(slot_count + 1):
        y = grid_top + row * ROW_HEIGHT
        draw.line([(MARGIN, y), (grid_left + COL_WIDTH * len(days_used), y)], fill="#DEE2E6")
        if row < slot_count:
            minute = start_minute + row * SLOT_MINUTES
            label = f"{minute // 60:02d}:{minute % 60:02d}"
            draw.text(
                (MARGIN + COL_WIDTH / 2, y + ROW_HEIGHT / 2),
                label, font=label_font, fill="#495057", anchor="mm",
            )

    # Vertical grid lines + day headers.
    for col in range(len(days_used) + 2):
        x = MARGIN + COL_WIDTH * col
        draw.line([(x, grid_top), (x, grid_top + ROW_HEIGHT * slot_count)], fill="#DEE2E6")
    for index, day in enumerate(days_used):
        x = grid_left + COL_WIDTH * index
        label = _rtl(PERSIAN_DAY_LABELS.get(day, day))
        draw.text(
            (x + COL_WIDTH / 2, grid_top - HEADER_HEIGHT / 2),
            label, font=header_font, fill="black", anchor="mm",
        )

    # Course blocks.
    for offering in selection:
        color = CATEGORY_COLORS.get(offering.category, CATEGORY_COLORS[""])
        for block in offering.blocks:
            if block.day not in days_used:
                continue
            col = days_used.index(block.day)
            b_start, b_end = block.minutes()
            y0 = grid_top + (max(b_start, start_minute) - start_minute) / SLOT_MINUTES * ROW_HEIGHT
            y1 = grid_top + (min(b_end, end_minute) - start_minute) / SLOT_MINUTES * ROW_HEIGHT
            x0 = grid_left + COL_WIDTH * col + 4
            x1 = x0 + COL_WIDTH - 8
            draw.rectangle([x0, y0, x1, y1], fill=color, outline="white", width=2)

            label_lines = [offering.course_name]
            if offering.instructor:
                label_lines.append(offering.instructor)
            for line_index, line in enumerate(label_lines):
                text = _rtl(line)
                while draw.textlength(text, font=body_font) > x1 - x0 - 10 and len(line) > 1:
                    line = line[:-1]
                    text = _rtl(line + "…")
                line_y = (y0 + y1) / 2 + (line_index - (len(label_lines) - 1) / 2) * 18
                draw.text(((x0 + x1) / 2, line_y), text, font=body_font, fill="white", anchor="mm")

    # Legend.
    legend_y = grid_top + ROW_HEIGHT * slot_count + 20
    legend_x = MARGIN
    for category, color in CATEGORY_COLORS.items():
        if not category:
            continue
        draw.rectangle([legend_x, legend_y, legend_x + 16, legend_y + 16], fill=color)
        draw.text(
            (legend_x + 22, legend_y + 8),
            _rtl(CATEGORY_LABELS_FA.get(category, category)),
            font=label_font, fill="black", anchor="lm",
        )
        legend_x += 190

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)
    return output_path
