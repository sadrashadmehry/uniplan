import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { render as shapeText } from "bidi-shaper";

// This endpoint is called by the Telegram bot (server-to-server, same host)
// after it has already picked a conflict-free set of course sections. It
// renders that selection as a PNG in the site's own visual style so the bot
// never has to maintain its own renderer. It is not meant to be reachable
// from the public internet -- see deploy/uniplan.nginx.conf, which returns
// 404 for this path before it ever reaches Next.js. The Authorization check
// below is defense in depth, not the primary boundary.
export const runtime = "nodejs";

const MAX_COURSES = 24;
const MAX_BLOCKS_PER_COURSE = 10;
const MAX_STRING_LENGTH = 200;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 20;

const DAY_ORDER = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"] as const;
type Day = (typeof DAY_ORDER)[number];
const DAY_LABELS_FA: Record<Day, string> = {
  Saturday: "شنبه",
  Sunday: "یک‌شنبه",
  Monday: "دوشنبه",
  Tuesday: "سه‌شنبه",
  Wednesday: "چهارشنبه",
};

const GRID_START_MINUTES = 7 * 60;
const GRID_END_MINUTES = 18 * 60;
const GRID_TOTAL_MINUTES = GRID_END_MINUTES - GRID_START_MINUTES;

const CANVAS_WIDTH = 1560;
const CANVAS_HEIGHT = 800;
const SIDE_PADDING = 32;
const HEADER_HEIGHT = 90;
const HOUR_ROW_HEIGHT = 30;
const DAY_COLUMN_WIDTH = 110;
const ROW_HEIGHT = 104;
const FOOTER_HEIGHT = 40;

// The site's own light-mode "course card" colors (app/globals.css), cycled
// per course so back-to-back classes on the same day stay visually distinct.
const PALETTE = [
  { bg: "#eaf0ff", text: "#234fd8" },
  { bg: "#e3f7ef", text: "#117e5c" },
  { bg: "#fff1d3", text: "#a66b10" },
  { bg: "#ffe9ef", text: "#bb3e5e" },
] as const;

interface Block {
  day: Day;
  start: string;
  end: string;
}

interface CourseInput {
  name: string;
  courseCode: string | null;
  category: string | null;
  instructor: string | null;
  section: string | null;
  blocks: Block[];
}

interface ValidatedBody {
  courses: CourseInput[];
  totalUnits: number | null;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request): Promise<Response> {
  const authError = checkAuthorization(request);
  if (authError) return authError;

  const rate = consumeRateLimit(request);
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many export requests. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }

  const validated = validateBody(rawBody);
  if ("error" in validated) return jsonError(validated.error, 400);
  if (validated.courses.length === 0) return jsonError("No courses were provided to export.", 400);

  let fontData: Buffer;
  try {
    fontData = await readFile(path.join(process.cwd(), "public", "fonts", "xb-niloofar.ttf"));
  } catch {
    return jsonError("The Persian font asset is missing on the server.", 500);
  }

  const logoDataUrl = await readLogoAsDataUrl();

  try {
    const image = new ImageResponse(
      buildScheduleElement(validated.courses, validated.totalUnits, logoDataUrl),
      {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        fonts: [{ name: "Niloofar", data: fontData, style: "normal", weight: 400 }],
      },
    );
    image.headers.set("Cache-Control", "no-store");
    return image;
  } catch (caught) {
    console.error("schedule export render failed", caught);
    return jsonError("The schedule image could not be rendered.", 500);
  }
}

async function readLogoAsDataUrl(): Promise<string | null> {
  try {
    const logo = await readFile(path.join(process.cwd(), "public", "uniplan-logo.png"));
    return `data:image/png;base64,${logo.toString("base64")}`;
  } catch {
    return null; // the logo is a nice-to-have, never fatal
  }
}

function checkAuthorization(request: Request): Response | null {
  const expected = process.env.SCHEDULE_EXPORT_TOKEN || "";
  if (!expected) return jsonError("Schedule export is not configured on this server.", 503);
  const header = request.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqualStrings(provided, expected)) return jsonError("Unauthorized.", 401);
  return null;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferB, bufferB); // keep timing comparable to the equal-length path
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function consumeRateLimit(request: Request): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const client =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    "unknown";
  const current = rateLimitStore.get(client);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(client, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    if (rateLimitStore.size > 1_000) {
      for (const [key, entry] of rateLimitStore) if (entry.resetAt <= now) rateLimitStore.delete(key);
    }
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= RATE_LIMIT_REQUESTS) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateBody(body: unknown): ValidatedBody | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Expected a JSON object." };
  const record = body as Record<string, unknown>;

  if (!Array.isArray(record.courses)) return { error: '"courses" must be an array.' };
  if (record.courses.length > MAX_COURSES) return { error: `No more than ${MAX_COURSES} courses are accepted.` };

  const courses: CourseInput[] = [];
  for (const rawCourse of record.courses) {
    if (typeof rawCourse !== "object" || rawCourse === null) return { error: "Each course must be an object." };
    const c = rawCourse as Record<string, unknown>;

    const name = typeof c.name === "string" ? c.name.trim().slice(0, MAX_STRING_LENGTH) : "";
    if (!name) return { error: 'Each course needs a non-empty "name".' };

    if (!Array.isArray(c.blocks) || c.blocks.length === 0) {
      return { error: `Course "${name}" needs a non-empty "blocks" array.` };
    }
    if (c.blocks.length > MAX_BLOCKS_PER_COURSE) {
      return { error: `Course "${name}" has too many meeting blocks.` };
    }

    const blocks: Block[] = [];
    for (const rawBlock of c.blocks) {
      if (typeof rawBlock !== "object" || rawBlock === null) return { error: `Invalid meeting block for "${name}".` };
      const b = rawBlock as Record<string, unknown>;
      const day = typeof b.day === "string" ? b.day : "";
      if (!DAY_ORDER.includes(day as Day)) return { error: `Unsupported day "${day}" for "${name}".` };
      const start = typeof b.start === "string" ? b.start : "";
      const end = typeof b.end === "string" ? b.end : "";
      if (!isValidTime(start) || !isValidTime(end) || start >= end) {
        return { error: `Invalid time range for "${name}".` };
      }
      blocks.push({ day: day as Day, start, end });
    }

    courses.push({
      name,
      courseCode: typeof c.courseCode === "string" ? c.courseCode.slice(0, 40) : null,
      category: typeof c.category === "string" ? c.category.slice(0, 60) : null,
      instructor: typeof c.instructor === "string" ? c.instructor.slice(0, MAX_STRING_LENGTH) : null,
      section: typeof c.section === "string" ? c.section.slice(0, 20) : null,
      blocks,
    });
  }

  const totalUnits =
    typeof record.totalUnits === "number" && Number.isFinite(record.totalUnits)
      ? Math.round(record.totalUnits)
      : null;

  return { courses, totalUnits };
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Percent offset from the RIGHT edge of the grid (07:00) -- the grid reads
 * right-to-left, matching the site's own "My Week" geometry. */
function xPercentFromRight(time: string): number {
  const minutes = clamp(minutesOfDay(time), GRID_START_MINUTES, GRID_END_MINUTES) - GRID_START_MINUTES;
  return (minutes / GRID_TOTAL_MINUTES) * 100;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function buildScheduleElement(courses: CourseInput[], totalUnits: number | null, logoDataUrl: string | null) {
  const gridAreaWidth = CANVAS_WIDTH - SIDE_PADDING * 2 - DAY_COLUMN_WIDTH;
  const hours = Array.from({ length: 12 }, (_, index) => 7 + index); // 07:00..18:00

  return (
    <div
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#f5f7fb",
        padding: SIDE_PADDING,
        fontFamily: "Niloofar",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row-reverse",
          alignItems: "center",
          justifyContent: "space-between",
          height: HEADER_HEIGHT - SIDE_PADDING,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: 14 }}>
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUrl} width={48} height={48} style={{ borderRadius: 12 }} alt="" />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#111a30" }}>
              {shapeText("برنامه‌ی هفتگی پیشنهادی")}
            </div>
            <div style={{ display: "flex", fontSize: 15, color: "#687187" }}>{shapeText("ساخته‌شده در UniPlan")}</div>
          </div>
        </div>
        {totalUnits !== null ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "8px 22px",
              borderRadius: 14,
              backgroundColor: "#eaf0ff",
            }}
          >
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#234fd8" }}>{totalUnits}</div>
            <div style={{ display: "flex", fontSize: 13, color: "#234fd8" }}>{shapeText("واحد")}</div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "row-reverse", height: HOUR_ROW_HEIGHT }}>
        <div style={{ width: DAY_COLUMN_WIDTH, display: "flex" }} />
        <div style={{ width: gridAreaWidth, position: "relative", display: "flex" }}>
          {hours.map((hour) => (
            <div
              key={hour}
              style={{
                position: "absolute",
                display: "flex",
                right: `${xPercentFromRight(hourLabel(hour))}%`,
                transform: hour === 7 ? undefined : hour === 18 ? "translateX(100%)" : "translateX(50%)",
                fontSize: 13,
                color: "#687187",
              }}
            >
              {hourLabel(hour)}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid #e1e7f0",
        }}
      >
        {DAY_ORDER.map((day, dayIndex) => (
          <div
            key={day}
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              height: ROW_HEIGHT,
              backgroundColor: dayIndex % 2 === 0 ? "#ffffff" : "#fbfcff",
              borderTop: dayIndex === 0 ? "none" : "1px solid #e1e7f0",
            }}
          >
            <div
              style={{
                width: DAY_COLUMN_WIDTH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                fontWeight: 700,
                color: "#111a30",
                backgroundColor: "#eef2f9",
              }}
            >
              {shapeText(DAY_LABELS_FA[day])}
            </div>
            <div style={{ width: gridAreaWidth, position: "relative", display: "flex" }}>
              {hours.map((hour) => (
                <div
                  key={hour}
                  style={{
                    position: "absolute",
                    display: "flex",
                    top: 0,
                    bottom: 0,
                    width: 1,
                    right: `${xPercentFromRight(hourLabel(hour))}%`,
                    backgroundColor: "#e1e7f0",
                  }}
                />
              ))}
              {courses.flatMap((course, courseIndex) =>
                course.blocks
                  .filter((block) => block.day === day)
                  .map((block, blockIndex) => {
                    const right = xPercentFromRight(block.start);
                    const width = Math.max(xPercentFromRight(block.end) - right, 2);
                    const color = PALETTE[courseIndex % PALETTE.length];
                    return (
                      <div
                        key={`${courseIndex}-${blockIndex}`}
                        style={{
                          position: "absolute",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          top: 8,
                          bottom: 8,
                          right: `${right}%`,
                          width: `${width}%`,
                          backgroundColor: color.bg,
                          color: color.text,
                          borderRadius: 10,
                          padding: "0 10px",
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ display: "flex", fontSize: 15, fontWeight: 700 }}>{shapeText(course.name)}</div>
                        {course.instructor ? (
                          <div style={{ display: "flex", fontSize: 12, opacity: 0.85 }}>
                            {shapeText(course.instructor)}
                          </div>
                        ) : null}
                      </div>
                    );
                  }),
              )}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          height: FOOTER_HEIGHT,
          fontSize: 13,
          color: "#a1aac0",
        }}
      >
        {shapeText("این برنامه به‌صورت خودکار توسط ربات تلگرام UniPlan ساخته شده است")}
      </div>
    </div>
  );
}
