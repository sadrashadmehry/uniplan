import { env } from "cloudflare:workers";

export function getD1() {
  if (!env.DB) throw new Error("The UniPlan database is unavailable.");
  return env.DB;
}

export async function ensureSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      major_focus TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      days TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id)"),
  ]);
  await db.prepare("PRAGMA optimize").run();
}
