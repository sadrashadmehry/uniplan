import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getD1 } from "../../../db/runtime";

type ProfileRow = { display_name: string; major_focus: string };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to load your profile." }, { status: 401 });
  await ensureSchema();
  const profile = await getD1().prepare(
    "SELECT display_name, major_focus FROM profiles WHERE user_id = ?"
  ).bind(user.userId).first<ProfileRow>();
  return Response.json({
    profile: profile ? { displayName: profile.display_name, majorFocus: profile.major_focus } : null,
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to save your profile." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, 80) : user.displayName;
  const majorFocus = typeof body.majorFocus === "string" ? body.majorFocus.trim().slice(0, 120) : "";
  await ensureSchema();
  await getD1().prepare(`INSERT INTO profiles (user_id, display_name, major_focus, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, major_focus = excluded.major_focus, updated_at = excluded.updated_at`
  ).bind(user.userId, displayName, majorFocus, new Date().toISOString()).run();
  return Response.json({ profile: { displayName, majorFocus } });
}
