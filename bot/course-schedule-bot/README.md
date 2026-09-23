# UniPlan Telegram bot

This is the canonical bot directory. The root website and this bot share
`services/course_extractor/extract_courses.py`. `newversion/` and ZIP files
are historical snapshots, not a second application to run or deploy.

## Local setup (PowerShell, from the repository root)

```powershell
python -m venv .venv # only if .venv does not exist
.\.venv\Scripts\python.exe -m pip install -r bot/course-schedule-bot/requirements.txt
Copy-Item bot/course-schedule-bot/.env.example bot/course-schedule-bot/.env # only if .env does not exist
```

Edit the bot's `.env`: set `TELEGRAM_BOT_TOKEN`, `AION_API_KEY`, and an exact
`AION_MODEL` available to your Aion account. Old `ANTHROPIC_*` settings are
not used. The API endpoint is `https://api.aionlabs.ai/v1`.
Set `SCHEDULE_EXPORT_TOKEN` to the same secret as the website. The website
must be running and its Chromium browser installed (see the root README).
Paths are relative to this bot directory regardless of the working directory.

```powershell
.\.venv\Scripts\python.exe bot/course-schedule-bot/run.py --check
.\.venv\Scripts\python.exe bot/course-schedule-bot/run.py
```

`--check` validates local configuration, imports and SQLite
initialization. It does not validate remote credentials or send messages.
Run just one polling process per bot token. In Telegram: `/start`, upload a
text timetable PDF, then request course changes. Course names and units come
from the shared reviewed curriculum catalog. Unmatched offerings are listed
and excluded from automatic scheduling; users are not asked for unit counts.
Prerequisites/corequisites are recorded but cannot establish eligibility
without the student's completed-course history.
Supported changes: include, exclude, lock/unlock, change units, regenerate.
Day avoidance and specific section selection are not implemented.
The bot always requests the website PNG after planning and sends it through
Telegram. If rendering fails, the plan is saved; `/export` retries from the
same constraints without calling Aion. There is no separate local renderer.

## Offline tests

```powershell
Push-Location bot/course-schedule-bot
..\..\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
.\.venv\Scripts\python.exe -m unittest discover -s services/course_extractor -v
```

## Linux deployment

Deploy the root project to `/opt/uniplan`, including `public/fonts` and
`services/course_extractor`. Install the bot requirements into its `.venv`.
Create the `uniplan` service user if it does not already exist.
Copy `.env.example` to `/etc/uniplan-bot.env`, fill in real credentials, and
set `DATABASE_PATH=/var/lib/uniplan-bot/sessions.db`, and restrict it to root
(`chmod 600`). Do not deploy your local `.env`, `.venv`,
`node_modules`, database, ZIP archives or `newversion` directory.

```bash
sudo cp deploy/uniplan-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now uniplan-bot
sudo systemctl status uniplan-bot
sudo journalctl -u uniplan-bot -n 50
```

The service keeps sessions in `/var/lib/uniplan-bot/sessions.db` and needs
outbound HTTPS to Telegram and Aion; no public inbound bot port is needed.
Stop local polling before starting the server. Back up the session database
before upgrades. Rotate any Telegram token previously placed in an example
file through BotFather; archives may still contain that old token.

## Model token budget

Aion returns short Persian text and validated course actions. The local solver
selects a conflict-free schedule; code exports it through the website. Initial
PDF scheduling and `/export` make no model calls.

Defaults: `AION_MAX_OUTPUT_TOKENS=2048` and `AION_REASONING_EFFORT=low`
for Aion 2.0/3.0/3.0 Mini. Other model IDs omit the effort option.
Reasoning and visible output share this token budget. Aion treats
low/medium/high/max as reasoning enabled, not separate thinking budgets.
See [Aion API reference](https://api.aionlabs.ai/docs/api-reference/).

A truncated, empty, malformed or schema-invalid answer receives one fresh
recovery call with twice the configured cap (minimum 4096, maximum 8192).
Only a complete validated response is applied. There is no guarantee that a
provider will always return valid JSON; after both attempts fail, the saved
schedule stays unchanged and the user gets a retry message. Server logs show
failure category, finish reason and completion usage without chat text or keys.
The default maximum generated-token allowance is 2048 + 4096 across both
attempts; unused allowance is not consumed. Valid first responses cost one call.

**Upgrading from the 512-token settings:** update existing bot `.env` values to
`AION_MAX_OUTPUT_TOKENS=2048` and `AION_REASONING_EFFORT=low`, or remove these
keys to use defaults, then restart the bot. Pulling code does not overwrite
local `.env` values. If logs still show `length`, increase the first cap (up to
8192) based on observed usage. Never expose your API key in logs or reports.

Requests use deduplicated course metadata, compact JSON, current constraints,
and at most four previous messages within 3000 UTF-8 bytes. User messages over
1500 characters and assembled input over 24000 UTF-8 bytes are rejected before
billing; the byte guard is not an exact token count. No catalog is silently
truncated. Malformed or length-limited responses never change the schedule.
Automatic SDK retries are disabled to avoid repeating potentially billed calls.
Restart the bot after changing environment settings. These are per-request
limits, not an account-wide spending limit.
