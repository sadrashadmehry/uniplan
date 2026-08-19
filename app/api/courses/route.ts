import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getD1 } from "../../../db/runtime";

type CourseRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  days: string;
  exam_date: string;
  type: string;
  track_name: string;
};

const VALID_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
const VALID_TYPES = ["", "General", "Major requirements", "Track", "Elective courses"];

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to load saved courses." }, { status: 401 });
  await ensureSchema();
  const result = await getD1().prepare(
    "SELECT id, name, start_time, end_time, days, exam_date, type, track_name FROM courses WHERE user_id = ? ORDER BY created_at ASC"
  ).bind(user.userId).all<CourseRow>();
  return Response.json({ courses: (result.results ?? []).map(toCourse) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to save this course." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const startTime = typeof body.startTime === "string" ? body.startTime : "";
  const endTime = typeof body.endTime === "string" ? body.endTime : "";
  const examDate = typeof body.examDate === "string" ? body.examDate : "";
  const type = typeof body.type === "string" && VALID_TYPES.includes(body.type) ? body.type : "";
  const trackName = type === "Track" && typeof body.trackName === "string" ? body.trackName.trim().slice(0, 80) : "";
  const days = Array.isArray(body.days) ? body.days.filter((day): day is string => typeof day === "string" && VALID_DAYS.includes(day)) : [];

  if (!name || !validTime(startTime) || !validTime(endTime) || !examDate || !days.length) {
    return Response.json({ error: "Complete the course name, class time, weekday, and exam time." }, { status: 400 });
  }
  if (timeNumber(startTime) < 7 || timeNumber(endTime) > 18 || timeNumber(endTime) <= timeNumber(startTime)) {
    return Response.json({ error: "Class time must sit between 07:00 and 18:00." }, { status: 400 });
  }

  await ensureSchema();
  const db = getD1();
  const existing = await db.prepare(
    "SELECT id, name, start_time, end_time, days, exam_date, type, track_name FROM courses WHERE user_id = ?"
  ).bind(user.userId).all<CourseRow>();
  const courses = (existing.results ?? []).map(toCourse);
  const overlap = courses.find((course: ReturnType<typeof toCourse>) =>
    course.days.some((day: string) => days.includes(day)) &&
    timeNumber(startTime) < timeNumber(course.endTime) &&
    timeNumber(endTime) > timeNumber(course.startTime)
  );
  if (overlap) return Response.json({ error: `Schedule conflict with ${overlap.name}. Adjacent classes are allowed, but these times overlap.` }, { status: 409 });
  const examConflict = courses.find((course: ReturnType<typeof toCourse>) => course.examDate.slice(0, 16) === examDate.slice(0, 16));
  if (examConflict) return Response.json({ error: `Exam conflict with ${examConflict.name}. The course wasn’t added.` }, { status: 409 });

  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO courses (id, user_id, name, start_time, end_time, days, exam_date, type, track_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, user.userId, name, startTime, endTime, JSON.stringify(days), examDate, type, trackName, new Date().toISOString()).run();
  return Response.json({ course: { id, name, startTime, endTime, days, examDate, type, trackName } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to change saved courses." }, { status: 401 });
  const body = await request.json() as { id?: unknown };
  if (typeof body.id !== "string") return Response.json({ error: "A course id is required." }, { status: 400 });
  await ensureSchema();
  await getD1().prepare("DELETE FROM courses WHERE id = ? AND user_id = ?").bind(body.id, user.userId).run();
  return Response.json({ ok: true });
}

function toCourse(row: CourseRow) {
  let days: string[] = [];
  try { days = JSON.parse(row.days); } catch { days = []; }
  return { id: row.id, name: row.name, startTime: row.start_time, endTime: row.end_time, days, examDate: row.exam_date, type: row.type, trackName: row.track_name || "" };
}
function validTime(value: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function timeNumber(value: string) { const [hours, minutes] = value.split(":").map(Number); return hours + minutes / 60; }
