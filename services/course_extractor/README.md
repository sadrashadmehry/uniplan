# Local course timetable extractor

This service parses the university's fixed, text-based Persian timetable PDF.
It uses the PDF text layer and cell geometry; it does not call an external API
and does not require an API key.

## Server setup

Create the project-local Python environment and install every required package:

```bash
npm run setup:extractor
```

The command works on Windows and Linux. The equivalent manual setup is:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r services/course_extractor/requirements.txt
```

Start the private extraction service:

```bash
python3 services/course_extractor/server.py
```

During local development, `npm run dev` checks the dependencies and then starts
both the website and this Python service. It automatically uses `.venv` when present, or the
`COURSE_EXTRACTOR_PYTHON` value from `.env` / `.env.local`. The separate command
above is mainly useful for debugging the extractor by itself.

It listens on `127.0.0.1:8010` by default. The website forwards uploaded PDFs
to this local address, so the service is not exposed to the public internet and
does not need an external API key. Set `COURSE_EXTRACTOR_TOKEN` in both processes
if you want an additional shared secret. The upload boundary accepts only raw
`application/pdf` bodies up to 8 MB, verifies the PDF structure, and rejects
encrypted or active-content documents. Each accepted file is written outside
the webroot under a random, owner-only temporary name, parsed in a resource-
limited child process, and deleted immediately afterward.

For production, run the service under `systemd`, Supervisor, or Docker and keep
it bound to `127.0.0.1`. Point the website at it with:

```bash
COURSE_EXTRACTOR_URL=http://127.0.0.1:8010/extract
```

## Manual check

```bash
python3 services/course_extractor/extract_courses.py timetable.pdf
```

Run the focused parser tests with:

```bash
python3 -m unittest discover services/course_extractor
```

## Reviewed curriculum catalog

`course_catalog.json` is the runtime source of course names, units,
prerequisites and corequisites. Its 101 named courses were transcribed and
visually checked against tables on PDF pages 13-23 of
`reference/ممهور_شده_مهندسی_کامپیوتر.pdf` (document
`AUT-CEIT-UG-PR-95-001V06`). The summary `ref_for_courses.pdf` contains
semester suggestions, not the complete catalog. Generic elective placeholders
are not courses and were not added. The main-course tables take precedence
over potentially different course descriptions later in the document.

The PDF text layer corrupts digits (e.g. printed 3 and 1 can both extract as
9), so do not regenerate unit counts blindly. The reviewed core and basic
unit totals are checked against 55 and 20 respectively. General-course
requirements are null because that table does not supply prerequisite columns.
Semester restrictions are retained in `requirementNotes`.

Matching normalizes Unicode, Arabic/Persian letters, digit variants, spacing
and half-spaces. It then requires an exact catalog name or an explicit alias.
Common timetable names such as برنامه سازی پیشرفته and داده ساختارها و
الگوریتم ها are mapped explicitly. Fuzzy candidates are suggestions only:
lab courses, numbered courses, teaching-assistant sessions, and unknown
courses never inherit a nearby course's credits automatically.

The response preserves `sourceContext` and `rawName`, and adds `units`,
`courseCode`, `prerequisites`, `corequisites`, `requirementNotes`,
`catalogSource`, `catalogMatch` and `catalogSuggestions`. Unknown units are
null and listed in `missingFields` and response warnings.
The website retains metadata when saving to browser storage. The bot uses
known units immediately and skips unmatched offerings, without asking for
unit counts. Requirements are metadata, not eligibility checks: no transcript
or completed-course history is available.

To update the catalog, check the source page visually, edit its JSON entry
(or add an explicit alias), and rerun the parser and bot tests. Restart the
extractor and bot after changes (catalog loaded once per process). Deploy the
JSON alongside the Python files; runtime uploads do not reread reference PDFs.
