"""Deterministic, conflict-free schedule construction.

Design note: the LLM decides *what the student wants* (drop a course,
avoid Saturdays, swap a section...). This module decides *whether a
resulting timetable is actually valid* -- no overlapping meetings, unit
total inside the student's target range. Keeping these hard constraints
in plain Python, instead of asking a language model to reason about
overlapping time intervals, means a change the LLM proposes can never
silently produce a schedule that conflicts or misses the unit target.
See ARCHITECTURE.md for the full rationale.
"""
from __future__ import annotations

from typing import Any

from .models import Course, ScheduleResult, SectionOffering, TimeBlock

DAY_ORDER = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def group_raw_courses(raw_courses: list[dict[str, Any]], units_map: dict[str, int]) -> list[Course]:
    """Group the flat list produced by `extraction.extract_courses` into
    Course objects, each holding its alternative SectionOfferings.

    Raw records share (name, instructor, section, type) for every meeting
    that belongs to the same section; they only differ in `days` /
    `startTime` / `endTime` when a section meets more than once a week at
    different times. This function reconstructs those offerings.
    """
    units_map = {**{r["name"]: r.get("units") for r in raw_courses}, **units_map}
    offerings_by_key: dict[tuple[str, str | None, str | None], SectionOffering] = {}
    for record in raw_courses:
        key = (record["name"], record.get("instructor"), record.get("section"))
        blocks = [
            TimeBlock(day=day, start=record["startTime"], end=record["endTime"])
            for day in record.get("days", [])
        ]
        if key not in offerings_by_key:
            offerings_by_key[key] = SectionOffering(
                course_name=record["name"],
                category=record.get("type", ""),
                section_id=record.get("section"),
                instructor=record.get("instructor"),
                blocks=[],
                confidence=record.get("confidence", 1.0),
                source_records=[],
                course_code=record.get("courseCode"),
            )
        offering = offerings_by_key[key]
        offering.blocks.extend(blocks)
        offering.source_records.append(record.get("sourceContext", ""))
        offering.confidence = min(offering.confidence, record.get("confidence", 1.0))

    courses_by_name: dict[str, Course] = {}
    for offering in offerings_by_key.values():
        course = courses_by_name.setdefault(
            offering.course_name,
            Course(
                name=offering.course_name,
                category=offering.category,
                units=units_map.get(offering.course_name),
            ),
        )
        course.offerings.append(offering)
    return list(courses_by_name.values())


def _has_conflict(offering: SectionOffering, chosen: list[SectionOffering]) -> bool:
    return any(offering.overlaps(other) for other in chosen)


def solve_schedule(
    courses: list[Course],
    min_units: int = 16,
    max_units: int = 19,
    must_include: list[str] | None = None,
    must_exclude: list[str] | None = None,
    max_nodes: int = 200_000,
) -> ScheduleResult:
    """Backtracking search (with branch-and-bound pruning) for a
    conflict-free set of course sections whose combined units fall
    inside [min_units, max_units].

    Suitable for a normal semester's worth of offerings (tens of
    courses). For much larger inputs, swap this for an ILP solver --
    see ROADMAP.md.
    """
    if not 1 <= min_units <= max_units:
        raise ValueError("Invalid unit range")
    must_include = set(must_include or [])
    must_exclude = set(must_exclude or [])
    warnings: list[str] = []

    candidates = [c for c in courses if c.name not in must_exclude]
    unknown_units = sorted({c.name for c in candidates if c.units is None})
    if unknown_units:
        warnings.append(
            "Some courses have no confirmed unit count and were skipped: "
            + ", ".join(unknown_units)
        )
    candidates = [c for c in candidates if c.units]
    unavailable = must_include - {c.name for c in candidates}
    if unavailable:
        raise ValueError("Required courses unavailable: " + ", ".join(sorted(unavailable)))

    # Required courses first, then largest-unit courses first: classic
    # bounded-knapsack ordering, fitting big items first prunes faster.
    candidates.sort(key=lambda c: (c.name not in must_include, -c.units))

    # Suffix sums for branch-and-bound: the most units still reachable
    # from index i onward, used to prune branches that can never reach
    # min_units.
    suffix_max_units = [0] * (len(candidates) + 1)
    for i in range(len(candidates) - 1, -1, -1):
        suffix_max_units[i] = suffix_max_units[i + 1] + candidates[i].units

    best: dict[str, Any] = {"selection": None, "units": -1}
    nodes = {"count": 0}

    def backtrack(index: int, chosen: list[SectionOffering], units: int) -> None:
        nodes["count"] += 1
        if nodes["count"] > max_nodes:
            return
        if units > max_units:
            return
        if (min_units <= units <= max_units and units > best["units"]
                and must_include <= {o.course_name for o in chosen}):
            best["selection"] = list(chosen)
            best["units"] = units
        if index >= len(candidates):
            return
        if units + suffix_max_units[index] < min_units:
            return  # even taking everything left can't reach the target
        if units >= max_units:
            return

        course = candidates[index]
        if course.name not in must_include:
            backtrack(index + 1, chosen, units)  # skip this course
        for offering in course.offerings:
            if not _has_conflict(offering, chosen):
                chosen.append(offering)
                backtrack(index + 1, chosen, units + course.units)
                chosen.pop()

    backtrack(0, [], 0)

    if best["selection"] is None:
        warnings.append(
            f"No conflict-free combination reaches {min_units}-{max_units} units; "
            "showing the closest option found instead."
        )
        greedy: list[SectionOffering] = []
        total = 0
        for course in candidates:
            for offering in course.offerings:
                if not _has_conflict(offering, greedy) and total + course.units <= max_units:
                    greedy.append(offering)
                    total += course.units
                    break
        best["selection"], best["units"] = greedy, total

    selected_names = {o.course_name for o in best["selection"]}
    missing_required = must_include - selected_names
    if missing_required:
        raise ValueError("Cannot fit all required courses without conflicts: " + ", ".join(sorted(missing_required)))
    unassigned = [c.name for c in candidates if c.name not in selected_names]
    return ScheduleResult(
        selected=best["selection"],
        total_units=best["units"],
        warnings=warnings,
        unassigned_courses=unassigned,
    )
