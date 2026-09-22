# UniPlan

UniPlan is a self-hosted Next.js course-planning application with a private
Python service for extracting courses from timetable PDFs.

## Requirements

- Node.js 18.18 or newer
- Python 3.10 or newer
- `python3-venv`

## Local development

```bash
npm ci
npm run setup:extractor
npm run dev
```

The web app runs on Next.js and the extractor listens only on
`127.0.0.1:8010`. Copy `.env.example` to `.env` if you need to customize the
extractor URL or shared token.

## Production

```bash
npm ci
npm run build
npm prune --omit=dev
npm run setup:extractor
npm start -- -H 127.0.0.1 -p 3000
```

Put a reverse proxy such as Nginx in front of port 3000. The application does
not require Cloudflare Workers, D1, OpenAI Sites, or any other cloud proxy.
Plans are stored in the visitor's browser; PDF extraction is performed by the
private local Python service.

## Telegram bot and project layout

The repository root is the canonical integrated project:
- `app/`: website.
- `services/course_extractor/`: shared PDF parser and private website service.
- `bot/course-schedule-bot/`: Telegram bot using Aion's OpenAI-compatible API.
- `deploy/`: Nginx and systemd configuration, including `uniplan-bot.service`.

`newversion/`, `patches/`, backups and ZIP files are local snapshots, excluded from
Git, TypeScript and lint. Do not run or deploy those copies.
Both Python components use the root `.venv`. See
[bot setup, tests and deployment](bot/course-schedule-bot/README.md).

## Repository contents

Commit source code, dependency manifests and lockfiles, deployment templates,
fonts, and the reference PDFs used to review the course catalog. Dependencies
(`node_modules`, `.venv`), build output, caches, local `.env` credentials,
session databases, and integration archives are excluded. Install dependencies
from the manifests after cloning; never copy local environments to the server.

## Website exports for the bot

The PNG Export button and `POST /api/schedule/export` use the same canvas
renderer. The bot submits selected courses automatically after planning and
relays the returned PNG. No click or model-driven export decision is needed.
The endpoint remains private behind Nginx; the default bot URL is
`http://127.0.0.1:3000/api/schedule/export`.

After `npm ci`, install the browser used by the website process:

```bash
npm run setup:export
# Linux: install required OS libraries too, then install Chromium as the service user
sudo npx playwright install-deps chromium
sudo -u uniplan npx playwright install chromium
```

Playwright stores browsers per user: install as the account running Next.js,
or set the same `PLAYWRIGHT_BROWSERS_PATH` during installation and runtime.
If the download is unavailable and Chrome/Edge is already installed, use
`SCHEDULE_EXPORT_BROWSER_CHANNEL=chrome` or `msedge` in the website environment.
Browser binaries are not committed. A standalone Next.js deployment also needs
Playwright's runtime packages, the browser installation and `public/fonts`.
[Playwright browser setup](https://playwright.dev/docs/browsers) documents the
platform dependencies and supported installed-browser channels.

Generate a random token (for example `python -c "import secrets; print(secrets.token_urlsafe(32))"`)
and put the same `SCHEDULE_EXPORT_TOKEN` in the website `.env.local` and bot
`.env` (or both service environments). Keep it server-only. Start the website
before the bot and restart both after changing configuration. Bot startup
requires this token. If the website cannot render, the bot saves the plan and
responds with a retry instruction (`/export`); it never substitutes a local image.

```bash
npm run build
npm run test:export
```

The integration test launches a temporary local Next.js server and headless
browser. It checks authentication, validation, the Python bot HTTP client,
and byte-for-byte parity with the website PNG button. Install the bot Python
requirements first; set `BOT_PYTHON` if using an interpreter outside `.venv`.
Set `SCHEDULE_EXPORT_BROWSER_CHANNEL` in the test shell too when testing with
installed Chrome/Edge. The test writes a preview under ignored `outputs/`.
