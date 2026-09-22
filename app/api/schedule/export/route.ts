import { readFile } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { chromium } from "playwright";
import { renderSchedulePng } from "../../../schedule-export.mjs";

export const runtime = "nodejs";
const MAX_COURSES = 24;
const MAX_BLOCKS_PER_COURSE = 10;
const MAX_STRING_LENGTH = 200;
const MAX_BODY_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 20;
const DAY_ORDER = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"] as const;
type Day = (typeof DAY_ORDER)[number];
interface Block { day: Day; start: string; end: string }
interface CourseInput {
  name: string;
  courseCode: string | null;
  category: string | null;
  instructor: string | null;
  section: string | null;
  blocks: Block[];
}
interface ValidatedBody { courses: CourseInput[]; totalUnits: number | null }
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
// ponytail: two browsers per server process; use a job queue if export traffic grows.
let activeExports = 0;

export async function POST(request: Request): Promise<Response> {
  const authError = checkAuthorization(request);
  if (authError) return authError;
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return jsonError("Content-Type must be application/json.", 415);
  }
  const rate = consumeRateLimit(request);
  if (!rate.allowed || activeExports >= 2) {
    return Response.json({ error: "Export busy. Retry shortly." }, {
      status: 429, headers: { "Retry-After": String(rate.retryAfter || 5), "Cache-Control": "no-store" },
    });
  }
  let rawBody: unknown;
  try {
    if (!request.body) return jsonError("Expected JSON body.", 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return jsonError("Export request too large.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    rawBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return jsonError("The request body must be valid JSON.", 400); }
  const validated = validateBody(rawBody);
  if ("error" in validated) return jsonError(validated.error, 400);
  if (!validated.courses.length) return jsonError("No courses were provided to export.", 400);
  const meetings = validated.courses.flatMap((course) => course.blocks);
  if (meetings.some((block, i) => meetings.slice(i + 1).some((other) =>
    block.day === other.day && block.start < other.end && other.start < block.end))) {
    return jsonError("The selected schedule contains overlapping meetings.", 400);
  }
  // Recheck after reading the body; concurrent requests may have acquired slots.
  if (activeExports >= 2) return jsonError("Export busy. Retry shortly.", 429);
  activeExports += 1;
  let browser;
  let deadline;
  try {
    const font = await readFile(path.join(process.cwd(), "public/fonts/xb-niloofar.ttf"));
    browser = await chromium.launch({
      headless: true, timeout: 10_000,
      channel: process.env.SCHEDULE_EXPORT_BROWSER_CHANNEL || undefined,
    });
    const currentBrowser = browser;
    deadline = setTimeout(() => { void currentBrowser.close().catch(() => {}); }, 15_000);
    const page = await browser.newPage();
    // No navigation, cookies, user HTML, or outbound requests: draw validated text only.
    await page.route("**/*", (route) => route.abort());
    const courseGroups = validated.courses.flatMap((course) => course.blocks.map((block) => ({
      courses: [{
        name: course.name, instructor: course.instructor || "", days: [block.day],
        startTime: block.start, endTime: block.end, trackName: "",
        color: course.category === "General" ? "mint" : course.category === "Track" ? "amber" : course.category === "Elective courses" ? "rose" : "blue",
      }],
    })));
    const dataUrl = await page.evaluate(renderSchedulePng, {
      courseGroups, exams: [], fontUrl: `data:font/ttf;base64,${font.toString("base64")}`,
    });
    const png = Buffer.from(dataUrl.split(",", 2)[1], "base64");
    return new Response(new Uint8Array(png), { headers: {
      "Content-Type": "image/png", "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="uniplan-schedule-and-exams.png"',
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Schedule export failed:", error instanceof Error ? error.name : "Error");
    return jsonError("Website export is unavailable. Check Chromium installation and retry.", 503);
  } finally {
    if (deadline) clearTimeout(deadline);
    await browser?.close().catch(() => {});
    activeExports -= 1;
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
      if (!isValidTime(start) || !isValidTime(end) || start >= end || start < "07:00" || end > "18:00") {
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

