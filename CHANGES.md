# Unified website schedule export

The website PNG button and authenticated bot endpoint now call one canvas
renderer: `app/schedule-export.mjs`. The previous next/og imitation and bot
Pillow fallback have been removed. The server uses Playwright Chromium to run
the same drawing code, including Persian text shaping and font loading.

Planning is independent of rendering: Aion provides structured preferences,
the solver validates/picks sections, and application code always requests the
website image. `/export` retries after an outage without calling Aion.

See README for required Chromium setup and shared-token configuration.
`npm run test:export` verifies a real Python solver/client request and compares
the returned PNG byte-for-byte with the website button's actual download.

## Complete model responses

The default completion budget is now 2048 tokens with reasoning enabled (`low`
on supported Aion models). Compact input and bounded history remain. A single
bounded recovery request handles truncated or invalid structured output, with
at least 4096 and at most 8192 tokens. No actions from the failed attempt are
applied. Metadata-only rejection logs distinguish truncation from invalid JSON.
See the bot README for environment migration and maximum per-message cost.
Website rendering still runs entirely outside the model.
