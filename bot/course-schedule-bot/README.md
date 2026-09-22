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
