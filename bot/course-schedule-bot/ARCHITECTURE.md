# Architecture

## Overview

```
Student (Telegram, Persian)
        │
        ▼
┌───────────────────┐
│   bot/handlers.py   │  <- Telegram Application, per-chat Session (bot/session.py)
└─────────┬──────────┘
          │ PDF upload
          ▼
┌───────────────────┐
│ extraction package  │  <- wraps the supplied extract_courses.py
└─────────┬──────────┘
          │ list[dict] of raw course meetings
          ▼
┌───────────────────┐        ┌────────────────────┐
│ scheduler/engine.py │◄──────┤ llm/client.py        │  <- Claude: chat text -> structured actions
│ (deterministic solve)│      │ (NLU + Persian NLG)   │
└─────────┬──────────┘        └─────────┬──────────┘
          │ ScheduleResult                     ▲
          ▼                                     │ free-form Persian chat
┌───────────────────┐                            │
│ render/schedule_image│───────────────────────────┘
│  .py (PNG, RTL text)│  -> photo sent back to the student
└───────────────────┘
```

`bot/storage.py` (SQLite) persists each chat's `Session` between
messages so the bot survives restarts and handles multiple students
concurrently.

## Why the LLM and the scheduler are separate

The assistant's two jobs are split on purpose:

- **`llm/client.py` + `llm/prompts.py`** turn a free-form Persian
  message into (a) a short natural-language reply and (b) a small set
  of structured actions (`exclude_course`, `lock_course`, `set_units`,
  ...). This is a natural-language-understanding problem, which is
  what an LLM is good at.
- **`scheduler/engine.py`** is the only thing that ever decides which
  courses actually end up in the schedule. It is plain, deterministic
  Python: no time-conflict or unit-arithmetic reasoning is ever
  delegated to the model.

This means a modification the LLM proposes can never silently produce
an invalid schedule (overlapping classes, wrong unit total) — the
solver re-validates and re-optimizes from scratch every time, given
the student's current locks/exclusions/units.

## Data flow in detail

1. **Extraction** (`extraction/extract_courses.py`, supplied by you,
   unmodified): parses the fixed-layout, visually-stored-RTL timetable
   PDF into a flat list of course-meeting dictionaries (name, days,
   start/end time, instructor, section, category, confidence, ...).

2. **Grouping** (`scheduler.engine.group_raw_courses`): the flat list
   is regrouped into `Course` objects, each holding one or more
   alternative `SectionOffering`s (different instructors/sections of
   the same course), each offering holding one or more `TimeBlock`s
   (a section that meets more than once a week).

3. **Units.** The source PDF's layout doesn't expose a unit-count
   column (see README's *Known limitations*), so `units_map` is
   filled in from the student's chat reply, parsed into
   `{course_name: units}` by `AssistantClient.parse_units`.

4. **Solving** (`scheduler.engine.solve_schedule`): a backtracking
   search with branch-and-bound pruning (sorted by unit count,
   descending) picks at most one `SectionOffering` per `Course` such
   that no two chosen offerings' `TimeBlock`s overlap and the total
   units land in `[MIN_UNITS, MAX_UNITS]` (16–19 by default). Courses
   the student has explicitly locked/excluded are respected. If no
   combination reaches the unit range, it falls back to the
   highest-unit conflict-free combination it can find and says so in
   `ScheduleResult.warnings`.

5. **Rendering** (`render/schedule_image.py`): draws a day × time-slot
   grid with Pillow. Persian labels are passed through
   `arabic_reshaper` (contextual letter shaping) and `python-bidi`
   (visual reordering) before drawing, since Pillow only lays out
   plain left-to-right glyph runs.

6. **Conversation loop** (`bot/handlers.py`): after the first schedule
   is sent, every text message goes to `AssistantClient.chat`, which
   returns a reply plus zero or more actions. Actions mutate the
   session's `units_map` / `excluded_courses` / `locked_courses`; if
   anything changed, `solve_schedule` and `render_schedule` run again
   and a fresh image is sent.

## Session state machine

`bot/session.py` defines three stages per chat:

- `IDLE` — no PDF uploaded yet.
- `AWAITING_UNITS` — courses extracted, waiting on unit counts.
- `READY` — a schedule exists; further text is treated as a
  modification request.

Uploading a new PDF resets a chat back to `IDLE` and clears the
previous course list, unit map, and selection (but keeps chat
`history`, so the assistant retains conversational context).

## Persistence

`bot/storage.py` is a minimal SQLite key-value store keyed by
`chat_id`, storing each `Session` as a JSON blob. This keeps the
project dependency-free for persistence (`sqlite3` is in the Python
standard library) while surviving bot restarts. See ROADMAP.md for
when to graduate to something else.
