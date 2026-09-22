# Roadmap

## Milestones

- [x] **M0 — Skeleton.** Package layout, `.env`-based config, SQLite
      session storage, `.gitignore` (no secrets committed).
- [x] **M1 — Extraction integration.** Wrapped the supplied
      `extract_courses.py` as an importable package
      (`extraction/extract_courses`).
- [x] **M2 — Scheduling engine.** Deterministic, conflict-free,
      16–19-unit backtracking solver with branch-and-bound pruning
      (`scheduler/engine.py`); covered by unit tests
      (`tests/test_scheduler.py`).
- [x] **M3 — Telegram flow.** `/start` → PDF upload → unit
      confirmation → schedule image → free-form chat loop
      (`bot/handlers.py`, `run.py`).
- [x] **M4 — LLM conversation loop.** Claude interprets Persian
      modification requests into structured actions
      (`llm/client.py`, `llm/prompts.py`); the scheduler re-solves
      after every applied action.
- [x] **M5 — Schedule rendering.** Weekly grid PNG with Persian text
      shaping/bidi (`render/schedule_image.py`).

## Not yet done

- [ ] **M6 — Extract unit counts directly from the PDF**, if the
      source timetable turns out to encode them somewhere the current
      geometry-based parser doesn't look — would remove the manual
      "what units is each course worth" step entirely.
- [ ] **M7 — Automated tests against real (anonymized) timetable
      PDFs**, beyond the current synthetic-data scheduler tests —
      exercising `extract_courses.py` itself and the full
      upload→schedule pipeline.
- [ ] **M8 — Section-alternative UX.** Let a student ask "which other
      sections of this course exist?" and pick a specific one, rather
      than only accepting/excluding a course by name.
- [ ] **M9 — Category/prerequisite business rules.** Nothing currently
      enforces "must include a Major requirement", prerequisite
      chains, or degree-audit constraints; only unit range + no
      conflicts is enforced. Would need a rules module + likely
      integration with an actual degree-audit data source.
- [ ] **M10 — Scale beyond one process.** `bot/storage.py`'s SQLite
      file works for a single bot process; a real deployment across
      multiple workers would need a shared database (e.g. Postgres)
      and, if the semester's course count grows large, an ILP solver
      (e.g. `pulp`/`OR-Tools`) instead of the current backtracking
      search.
- [ ] **M11 — Deployment.** Currently long-polling only (`run.py`).
      Add a webhook mode + process manager / container for production
      hosting, plus structured logging and basic rate limiting per
      chat.
- [ ] **M12 — Multi-semester history.** Let a student re-upload next
      semester's PDF without losing a record of past semesters, and
      let the assistant reference completed courses when suggesting a
      schedule.

## Known limitations (see README.md for details)

- Unit counts come from the student, not the PDF (M6 above).
- Single-process session storage (M10 above).
- Backtracking solver, not an ILP solver (fine at normal semester
  scale; M10 above).
- No prerequisite/degree-audit rules enforced (M9 above).
