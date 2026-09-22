# Website-rendered schedule export — patch notes

This archive contains **only the files that are new or changed**, at the
same relative paths as your repository root. Copy them over your existing
tree (they overwrite in place; nothing else is touched) and follow
*Deploying this* below.

## What changed and why

Until now, the bot rendered its own schedule image with Pillow
(`render/schedule_image.py`) — plain and not worth polishing further. The
website already defines what a schedule should look like, so the pipeline
now works like this:

1. **The bot still does all the planning.** `scheduler/engine.py` is
   unchanged in its logic — it's still the only thing that decides which
   courses/sections make a conflict-free, 16–19-unit schedule. The model
   never touches this; it only turns chat into actions
   (`exclude_course`, `lock_course`, ...), exactly as before.
2. **The bot no longer draws the picture.** After planning, it now POSTs
   the selected courses/sections as JSON to a new endpoint,
   `POST /api/schedule/export`, and sends back whatever image that
   endpoint returns (`bot/course-schedule-bot/render/website_export.py`).
3. **The website renders the image**, in the site's own visual style —
   the "My Week" geometry (5 rows, Saturday→Wednesday, 07:00→18:00
   right-to-left) and the site's actual card colors, using the same
   `public/fonts/xb-niloofar.ttf` brand font
   (`app/api/schedule/export/route.tsx`).
4. **If the website call fails or isn't configured**, the bot falls back
   to its old local Pillow renderer instead of sending nothing, and tells
   the student a plainer version was shown.

### Why `next/og` instead of a headless browser or `node-canvas`

Your site's own "Export → PNG" button (`SchedulePlanner.tsx`) draws
straight to a browser `<canvas>`, which can't run on the server without a
real browser or a native `canvas` module. I used Next's bundled
`next/og` (`ImageResponse`, built on Satori) instead: it needs **one new
pure-JS dependency** (`bidi-shaper`, see below), no native compilation,
no headless browser, and it's the idiomatic Next.js way to generate an
image from data in a route handler. The trade-off is that this is a
**fresh renderer styled to match your design tokens**, not a literal port
of `exportPng()`'s canvas-drawing code — if you ever want pixel-for-pixel
parity with that function, porting it to `node-canvas` (which supports
Cairo/Pango text shaping natively) is the documented alternative, at the
cost of a native dependency.

### Why `bidi-shaper`

Satori doesn't shape Arabic-script text itself (no letter joining, no
bidi reordering) — same limitation Pillow had, which is why the bot's
old renderer needed `arabic_reshaper` + `python-bidi`. `bidi-shaper` is
the npm equivalent for exactly this "custom rasterizer" situation: it
pre-shapes and reorders Persian text before handing it to `next/og`.
Zero runtime dependencies, ~15 kB. **Please give the exported image a
visual check after deploying** — this is a different text pipeline than
your site's own DOM-rendered "My Week" view or the bot's old fallback,
and I couldn't render it myself to confirm pixel-for-pixel.

## New request contract

`POST /api/schedule/export` — bot-only (see *Security* below):

```json
{
  "totalUnits": 18,
  "courses": [
    {
      "name": "برنامه سازی پیشرفته",
      "courseCode": "40123",
      "category": "Major requirements",
      "instructor": "دکتر ...",
      "section": "1",
      "blocks": [{ "day": "Saturday", "start": "08:00", "end": "10:00" }]
    }
  ]
}
```

Returns `image/png` bytes on success, or `{"error": "..."}` JSON on
failure (400/401/429/500/503 — see the route for exact cases).

## Security

This route has **no reason to be public** — nothing on the website's own
frontend calls it (yet; see *Possible follow-up* below). Two layers:

1. **Nginx blocks it outright** (`deploy/uniplan.nginx.conf`): a new
   `location = /api/schedule/export { deny all; return 404; }` sits
   before the general proxy block. The bot reaches it directly over
   `127.0.0.1:3000`, bypassing Nginx entirely, since your deploy already
   runs the bot and the site on the same host.
2. **A shared bearer token**, `SCHEDULE_EXPORT_TOKEN` (same value in both
   apps' env), checked with `crypto.timingSafeEqual`. This is defense in
   depth, in case the Nginx rule is ever missing or bypassed — not the
   primary guard.
3. A small in-memory rate limiter on top (20 req/min per IP), mirroring
   the pattern already in `import-courses/route.ts`.

Also validated: course/day/time shapes, array/string length bounds — see
`validateBody()` in the route.

## Deploying this

**Website side:**
```bash
npm install                      # picks up the new bidi-shaper dependency
```
Add to your env (`.env` locally, or wherever `/etc/uniplan.env`-equivalent
lives in production):
```
SCHEDULE_EXPORT_TOKEN=<a random secret>
```
Reload Nginx so the new `location` block takes effect:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Bot side** — add the same token to `bot/course-schedule-bot/.env` (or
`/etc/uniplan-bot.env` in production):
```
SCHEDULE_EXPORT_URL=http://127.0.0.1:3000/api/schedule/export   # default; fine for same-host deploys
SCHEDULE_EXPORT_TOKEN=<the same random secret>
```
Then restart the bot. **If you leave `SCHEDULE_EXPORT_TOKEN` blank, the
bot behaves exactly as before** (local Pillow rendering) — this is an
opt-in change, nothing breaks if you don't set it yet.

## Testing

I could run the pure-Python/stdlib pieces in my own sandbox (no network,
no `node`/`telegram`/`openai` packages available there):

```powershell
Push-Location bot/course-schedule-bot
..\..\.venv\Scripts\python.exe -m unittest discover -s tests -v   # 19 tests: 6 pre-existing scheduler
Pop-Location                                                       # + 6 new website_export + 2 new
                                                                    # bot-integration + 5 pre-existing
```
`test_scheduler.py` and the new `test_website_export.py` (6 tests) I ran
directly and they pass. `test_bot.py`'s two new tests
(`test_website_export_used_when_configured`,
`test_website_export_failure_falls_back_to_local_render`) I wrote against
the same mocking patterns as your existing tests there, but couldn't
execute myself (needs `python-telegram-bot`/`openai` installed) — worth
running once in your environment before you trust them.

The TypeScript route I couldn't `npm run build` (no network access to
install `next`/`bidi-shaper` in my sandbox), so I hand-verified it with
`tsc --strict` against stub type declarations for the missing packages
and got a clean pass — but please still run `npm run build` yourself
before deploying.

## Possible follow-up (not done here, scope was the bot pipeline)

Your design doc mentions the website itself wants a PNG/PDF export. If
you'd like the site's own "Export" button to use this same endpoint
instead of (or alongside) its client-side canvas version someday, it
would need same-origin browser requests allowed too (currently
bot-token-only) and the Nginx block removed for that path.
