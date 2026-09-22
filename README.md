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
