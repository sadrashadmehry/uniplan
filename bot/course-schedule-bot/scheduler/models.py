
"""Data model shared by the extraction -> scheduling pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TimeBlock:
    """One weekly meeting: a single day and a start/end clock time."""

    day: str
    start: str  # "HH:MM"
    end: str

    def minutes(self) -> tuple[int, int]:
        def to_minutes(value: str) -> int:
            hour, minute = value.split(":")
            return int(hour) * 60 + int(minute)

        return to_minutes(self.start), to_minutes(self.end)

    def overlaps(self, other: "TimeBlock") -> bool:
        if self.day != other.day:
            return False
        a_start, a_end = self.minutes()
        b_start, b_end = other.minutes()
        return a_start < b_end and b_start < a_end


@dataclass
class SectionOffering:
    """One specific, choosable section of a course (a specific instructor /
    section number, meeting at one or more TimeBlocks each week)."""

    course_name: str
    category: str
    section_id: str | None
    instructor: str | None
    blocks: list[TimeBlock]
    confidence: float = 1.0
    source_records: list[str] = field(default_factory=list)
    course_code: str | None = None

    def overlaps(self, other: "SectionOffering") -> bool:
        return any(a.overlaps(b) for a in self.blocks for b in other.blocks)


@dataclass
class Course:
    """A course the student can take, with one or more alternative
    SectionOfferings to choose from (or skip entirely)."""

    name: str
    category: str
    units: int | None
    offerings: list[SectionOffering] = field(default_factory=list)


@dataclass
class ScheduleResult:
    selected: list[SectionOffering]
    total_units: int
    warnings: list[str] = field(default_factory=list)
    unassigned_courses: list[str] = field(default_factory=list)
