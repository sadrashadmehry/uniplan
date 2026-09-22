// Run after npm run build. Uses real HTTP, the website button, and Chromium.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { promisify } from "node:util";
import { chromium } from "playwright";

test("bot endpoint returns the website Export button's exact PNG", { timeout: 90_000 }, async (t) => {
  const port = 33000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  const token = "local-export-integration-test";
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, SCHEDULE_EXPORT_TOKEN: token }, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (data) => { logs = (logs + data).slice(-4000); });
  server.stderr.on("data", (data) => { logs = (logs + data).slice(-4000); });
  t.after(async () => {
    if (server.exitCode === null) { server.kill(); await once(server, "exit"); }
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    if (server.exitCode !== null) break;
    await delay(250);
  }
  assert.ok(ready, logs);
  const courses = [
    { name: "برنامه سازی پیشرفته", instructor: "دکتر عامری", category: "Major requirements", blocks: [
      { day: "Saturday", start: "08:00", end: "10:00" }, { day: "Monday", start: "08:00", end: "10:00" },
    ] },
    { name: "سیستم های عامل", instructor: "دکتر رضایی", category: "Track", blocks: [{ day: "Sunday", start: "10:30", end: "12:00" }] },
  ];
  const post = (body, authorization = `Bearer ${token}`) => fetch(`${origin}/api/schedule/export`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization }, body: JSON.stringify(body),
  });
  assert.equal((await post({ courses }, "Bearer wrong")).status, 401);
  assert.equal((await post({ courses: [] })).status, 400);
  assert.equal((await post({ courses: [{ ...courses[0], blocks: [{ day: "Saturday", start: "06:00", end: "08:00" }] }] })).status, 400);
  assert.equal((await post({ courses: [courses[0], courses[0]] })).status, 400);
  assert.equal((await post({ padding: "x".repeat(140000), courses })).status, 413);
  const response = await post({ courses, totalUnits: 6 });
  assert.equal(response.status, 200, logs + await (response.ok ? Promise.resolve("") : response.text()));
  assert.equal(response.headers.get("content-type"), "image/png");
  const serverPng = Buffer.from(await response.arrayBuffer());
  assert.equal(serverPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const python = process.env.BOT_PYTHON || (process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  const script = `
import json, sys
sys.path.insert(0, 'bot/course-schedule-bot')
from scheduler.engine import group_raw_courses, solve_schedule
from render.website_export import fetch_exported_schedule
courses = json.loads(sys.argv[1])
raw = [dict(name=c['name'], instructor=c['instructor'], type=c['category'], section='1',
            days=[b['day']], startTime=b['start'], endTime=b['end']) for c in courses for b in c['blocks']]
schedule = solve_schedule(group_raw_courses(raw, {c['name']: 3 for c in courses}), min_units=6, max_units=6)
sys.stdout.buffer.write(fetch_exported_schedule(schedule.selected, schedule.total_units, sys.argv[2], sys.argv[3]))
`;
  const { stdout: botPng } = await promisify(execFile)(python, ["-X", "utf8", "-c", script, JSON.stringify(courses), `${origin}/api/schedule/export`, token], {
    encoding: "buffer", maxBuffer: 10 * 1024 * 1024, windowsHide: true,
  });
  assert.deepEqual(botPng, serverPng, "Python bot must relay the website PNG unchanged");

  const browser = await chromium.launch({ channel: process.env.SCHEDULE_EXPORT_BROWSER_CHANNEL || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const websiteCourses = courses.flatMap((course, i) => course.blocks.map((block, j) => ({
    id: `${i}-${j}`, name: course.name, instructor: course.instructor, days: [block.day],
    startTime: block.start, endTime: block.end, examDate: "", type: course.category, trackName: "",
    color: course.category === "Track" ? "amber" : "blue",
  })));
  await page.addInitScript((items) => {
    localStorage.setItem("uniplan-guest-courses-v1", JSON.stringify({ version: 1, courses: items }));
  }, websiteCourses);
  await page.goto(origin);
  try {
    await page.getByText("برنامه سازی پیشرفته", { exact: true }).first().waitFor({ state: "attached", timeout: 10000 });
  } catch (error) {
    await mkdir("outputs", { recursive: true });
    await page.screenshot({ path: "outputs/export-test-failure.png", fullPage: true });
    throw new Error(`${error.message}\n${browserErrors.join("\n")}\n${await page.locator("body").innerText()}`);
  }
  await page.getByRole("button", { name: /Export/ }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download PNG/ }).click();
  const download = await downloadEvent;
  const buttonPng = await readFile(await download.path());
  assert.deepEqual(serverPng, buttonPng, "API and website button must use identical rendering");
  await mkdir("outputs", { recursive: true });
  await writeFile("outputs/website-bot-export.png", serverPng);
});
