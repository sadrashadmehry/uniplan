# Architecture

1. The shared extractor matches timetable offerings to the reviewed course
   catalog, including canonical names, unit counts and requirements.
2. Aion turns chat preferences into structured course actions. Python applies
   those actions and `scheduler.engine` picks conflict-free sections within
   the configured unit range, or returns warnings when the target is infeasible.
3. Every finalized selection is automatically POSTed to the website's
   `/api/schedule/export` with all courses, instructors, sections and meetings.
   Export is application control flow, never a model tool call or decision.
4. The website runs `app/schedule-export.mjs` in headless Chromium, the same
   renderer called by its PNG Export button. Persian shaping, colors, course
   cards and the exam timeline have one implementation. Uploaded timetables
   have no exam dates, so the bot export shows an empty exam timeline.
5. The bot relays returned PNG bytes to Telegram. On failure it retains the
   plan and offers `/export`, which reruns the deterministic selection from
   saved constraints and retries rendering without an Aion request.

SQLite stores each chat's catalog, preferences, history and current selection.
New uploads clear the previous state. Legacy AWAITING_UNITS sessions are still
supported; new uploads get verified units from the catalog automatically.

The website endpoint is token-protected and blocked at public Nginx ingress;
by default the bot calls it on loopback. It validates payload size, meeting
ranges and overlaps; allows two render processes per Next.js process; and
closes each browser after success, failure or its rendering deadline. Render
pages never navigate or make outbound requests. User text is canvas data,
not HTML or script. Browser installation belongs to the website deployment.
