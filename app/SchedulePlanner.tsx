"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Day = "Saturday" | "Sunday" | "Monday" | "Tuesday" | "Wednesday";
type CourseType = "" | "General" | "Major requirements" | "Track" | "Elective courses";
type User = { displayName: string; email: string } | null;
type Course = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  days: Day[];
  examDate: string;
  type: CourseType;
};

const DAYS: Day[] = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 7);
const TYPES: CourseType[] = ["General", "Major requirements", "Track", "Elective courses"];
const EMPTY_FORM: Omit<Course, "id"> = {
  name: "",
  startTime: "09:00",
  endTime: "10:30",
  days: [],
  examDate: "",
  type: "",
};
const DEMO_COURSES: Course[] = [
  { id: "demo-ap", name: "Advanced Programming", startTime: "13:30", endTime: "15:00", days: ["Saturday", "Monday"], examDate: "2026-12-22T09:00", type: "Major requirements" },
  { id: "demo-algo", name: "Algorithms", startTime: "15:00", endTime: "16:30", days: ["Saturday", "Monday"], examDate: "2026-12-28T09:00", type: "Major requirements" },
  { id: "demo-linear", name: "Linear Algebra", startTime: "09:00", endTime: "10:30", days: ["Sunday", "Tuesday"], examDate: "2027-01-03T13:30", type: "General" },
  { id: "demo-net", name: "Computer Networks", startTime: "11:00", endTime: "13:00", days: ["Wednesday"], examDate: "2027-01-08T11:00", type: "Track" },
  { id: "demo-ai", name: "AI Foundations", startTime: "14:00", endTime: "16:00", days: ["Tuesday"], examDate: "2027-01-11T08:30", type: "Elective courses" },
];

export function SchedulePlanner({ user }: { user: User }) {
  const [courses, setCourses] = useState<Course[]>(DEMO_COURSES);
  const [form, setForm] = useState(EMPTY_FORM);
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileName, setProfileName] = useState(user?.displayName ?? "");
  const [majorFocus, setMajorFocus] = useState("");
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("uniplan-theme");
    const nextTheme = savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/courses").then((response) => response.json()),
      fetch("/api/profile").then((response) => response.json()),
    ]).then(([courseData, profileData]) => {
      if (Array.isArray(courseData.courses)) setCourses(courseData.courses);
      if (profileData.profile) {
        setProfileName(profileData.profile.displayName || user.displayName);
        setMajorFocus(profileData.profile.majorFocus || "");
      }
    }).catch(() => setError("We couldn’t sync your saved plan. Your current view is still available."));
  }, [user]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) setExportOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const totalHours = useMemo(() => courses.reduce((total, course) => (
    total + (timeNumber(course.endTime) - timeNumber(course.startTime)) * course.days.length
  ), 0), [courses]);

  const nextExam = useMemo(() => [...courses]
    .filter((course) => course.examDate)
    .sort((a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime())[0], [courses]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("uniplan-theme", next);
  }

  function openCourseForm() {
    setForm(EMPTY_FORM);
    setError("");
    setAddOpen(true);
  }

  function toggleDay(day: Day) {
    setForm((current) => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day],
    }));
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    setError("");
    const validationError = validateCourse(form, courses);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    const optimistic: Course = { ...form, id: crypto.randomUUID() };
    try {
      if (user) {
        const response = await fetch("/api/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The course could not be saved.");
        setCourses((current) => [...current, data.course]);
      } else {
        setCourses((current) => [...current, optimistic]);
      }
      setAddOpen(false);
      setNotice(user ? "Course added and synced to your account." : "Course added to this planning session.");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The course could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCourse(course: Course) {
    if (user && !course.id.startsWith("demo-")) {
      const response = await fetch("/api/courses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: course.id }),
      });
      if (!response.ok) {
        setError("We couldn’t remove that course. Please try again.");
        return;
      }
    }
    setCourses((current) => current.filter((item) => item.id !== course.id));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: profileName, majorFocus }),
      });
      if (!response.ok) throw new Error();
      setProfileOpen(false);
      setNotice("Profile preferences saved.");
      window.setTimeout(() => setNotice(""), 3000);
    } catch {
      setError("We couldn’t save your profile preferences.");
    } finally {
      setSaving(false);
    }
  }

  function exportPng() {
    setExportOpen(false);
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = 1400 * scale;
    canvas.height = 760 * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = "#f4f6fb";
    context.fillRect(0, 0, 1400, 760);
    context.fillStyle = "#111a30";
    context.font = "700 34px Arial";
    context.fillText("UniPlan · Weekly schedule", 48, 60);
    context.fillStyle = "#6d7589";
    context.font = "16px Arial";
    context.fillText("Saturday to Wednesday · 07:00–18:00", 48, 90);
    const x = 50, y = 145, gridWidth = 1190, dayWidth = 120, rowHeight = 105;
    context.strokeStyle = "#dfe5ef";
    context.lineWidth = 1;
    for (let index = 0; index < HOURS.length; index += 1) {
      const lineX = x + (index / 11) * gridWidth;
      context.beginPath(); context.moveTo(lineX, y); context.lineTo(lineX, y + rowHeight * 5); context.stroke();
      context.fillStyle = "#737b8f"; context.font = "12px Arial";
      context.fillText(`${String(HOURS[index]).padStart(2, "0")}:00`, lineX - 17, y - 16);
    }
    DAYS.forEach((day, dayIndex) => {
      const rowY = y + dayIndex * rowHeight;
      context.beginPath(); context.moveTo(x, rowY); context.lineTo(x + gridWidth + dayWidth, rowY); context.stroke();
      context.fillStyle = "#202a40"; context.font = "700 15px Arial";
      context.fillText(day, x + gridWidth + 20, rowY + 56);
      courses.filter((course) => course.days.includes(day)).forEach((course) => {
        const blockX = x + ((timeNumber(course.startTime) - 7) / 11) * gridWidth;
        const blockWidth = ((timeNumber(course.endTime) - timeNumber(course.startTime)) / 11) * gridWidth;
        context.fillStyle = exportColor(course.type);
        roundedRect(context, blockX + 3, rowY + 14, Math.max(blockWidth - 6, 25), 76, 12);
        context.fill();
        context.fillStyle = "#ffffff"; context.font = "700 13px Arial";
        context.fillText(trimCanvasText(context, course.name, blockWidth - 24), blockX + 15, rowY + 45);
        context.font = "11px Arial";
        context.fillText(`${course.startTime}–${course.endTime}`, blockX + 15, rowY + 68);
      });
    });
    const link = document.createElement("a");
    link.download = "uniplan-weekly-schedule.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <main className="app-shell">
      <aside className="side-rail" aria-label="Main navigation">
        <div className="brand-mark">U</div>
        <nav>
          <button className="rail-button active" aria-label="Weekly schedule"><span>▦</span><small>Plan</small></button>
          <button className="rail-button" aria-label="Courses" onClick={openCourseForm}><span>◇</span><small>Add</small></button>
          <button className="rail-button" aria-label="Exams"><span>⌁</span><small>Exams</small></button>
        </nav>
        <button className="rail-button help" aria-label="Help"><span>?</span><small>Help</small></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup"><div className="mini-logo">U</div><span>UniPlan</span></div>
          <div className="top-actions">
            <button className="icon-button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={toggleTheme}>{theme === "light" ? "☾" : "☼"}</button>
            {user ? <span className="sync-state"><i /> Synced</span> : <a className="signin-button" href="/signin-with-chatgpt?return_to=%2F">Sign in to save</a>}
            <button className="avatar" aria-label="Edit profile" onClick={() => setProfileOpen(true)}>{initials(profileName || user?.email || "Guest")}</button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">Semester planner · {courses.length} {courses.length === 1 ? "course" : "courses"}</p>
              <h1>My weekly plan</h1>
              <p>Build a conflict-free week before registration day.</p>
            </div>
            <div className="heading-actions">
              <div className="export-wrap" ref={exportMenuRef}>
                <button className="secondary-button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen}>⇩&nbsp; Print / export <span>⌄</span></button>
                {exportOpen && <div className="export-menu"><button onClick={() => { setExportOpen(false); window.print(); }}><span>PDF</span><div><strong>Save as PDF</strong><small>Opens print preview</small></div></button><button onClick={exportPng}><span>PNG</span><div><strong>Download PNG</strong><small>High-resolution image</small></div></button></div>}
              </div>
              <button className="primary-button" onClick={openCourseForm}>＋ Add course</button>
            </div>
          </div>

          {error && !addOpen && <div className="alert error-alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}

          <div className="insight-row">
            <article className="insight-card"><span className="insight-icon blue">◫</span><div><strong>{formatHours(totalHours)}</strong><span>class hours each week</span></div></article>
            <article className="insight-card"><span className="insight-icon mint">✓</span><div><strong>Conflict-free</strong><span>Adjacent classes fit perfectly</span></div></article>
            <article className="next-exam">
              {nextExam ? <><span className="exam-date"><b>{new Date(nextExam.examDate).getDate()}</b><small>{new Date(nextExam.examDate).toLocaleString("en", { month: "short" }).toUpperCase()}</small></span><div><small>NEXT EXAM</small><strong>{nextExam.name} · {formatExamTime(nextExam.examDate)}</strong></div><span>→</span></> : <><span className="exam-date"><b>—</b><small>EXAM</small></span><div><small>NEXT EXAM</small><strong>No exams planned yet</strong></div></>}
            </article>
          </div>

          <section className="schedule-card" aria-label="Weekly course schedule">
            <div className="schedule-toolbar">
              <div><h2>Weekly schedule</h2><p>Saturday to Wednesday · 07:00–18:00 · half-hour friendly</p></div>
              <div className="legend"><span><i className="dot blue-dot" /> Major</span><span><i className="dot mint-dot" /> General</span><span><i className="dot amber-dot" /> Track</span><span><i className="dot rose-dot" /> Elective</span></div>
            </div>
            <div className="schedule-scroll">
              <div className="schedule-grid">
                <div className="time-row">
                  {HOURS.map((hour, index) => <span key={hour} style={{ left: `${(index / 11) * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}
                  <b className="day-column-title">DAY</b>
                </div>
                {DAYS.map((day) => (
                  <div className="day-row" key={day}>
                    <div className="hour-lines">{HOURS.map((hour) => <i key={hour} />)}</div>
                    {courses.filter((course) => course.days.includes(day)).map((course) => (
                      <article className={`course-block ${tone(course.type)}`} key={course.id} style={{ left: `${((timeNumber(course.startTime) - 7) / 11) * 100}%`, width: `${((timeNumber(course.endTime) - timeNumber(course.startTime)) / 11) * 100}%` }} title={`${course.name}, ${course.startTime} to ${course.endTime}`}>
                        <button className="remove-course" onClick={() => removeCourse(course)} aria-label={`Remove ${course.name}`}>×</button>
                        <strong>{course.name}</strong><span>{course.startTime}–{course.endTime}</span>
                      </article>
                    ))}
                    <strong className="day-name">{day}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="schedule-footer"><span><i className="pulse" /> All clear — no overlaps</span><button onClick={openCourseForm}>＋ Add another course</button></div>
          </section>

          <section className="exam-strip">
            <div><span className="section-icon">⌁</span><div><h2>Exam runway</h2><p>Every assessment at a glance.</p></div></div>
            <div className="exam-list">
              {courses.slice().sort((a, b) => a.examDate.localeCompare(b.examDate)).slice(0, 4).map((course) => (
                <article key={course.id}><span className={`exam-chip ${tone(course.type)}`}>{new Date(course.examDate).toLocaleString("en", { month: "short", day: "numeric" })}</span><div><strong>{course.name}</strong><small>{formatExamTime(course.examDate)}</small></div></article>
              ))}
              {!courses.length && <p className="empty-note">Your exams will appear here after you add a course.</p>}
            </div>
          </section>
        </div>
      </section>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="course-modal-title">
            <div className="modal-header"><div><p>NEW COURSE</p><h2 id="course-modal-title">Place it in your week</h2></div><button onClick={() => setAddOpen(false)} aria-label="Close">×</button></div>
            <form onSubmit={saveCourse}>
              <label className="field full"><span>Course name</span><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Advanced Programming" /></label>
              <div className="form-grid">
                <label className="field"><span>Starts</span><input required type="time" min="07:00" max="17:30" step="1800" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></label>
                <label className="field"><span>Ends</span><input required type="time" min="07:30" max="18:00" step="1800" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></label>
              </div>
              <fieldset className="day-picker"><legend>Days of the week</legend><div>{DAYS.map((day) => <button type="button" className={form.days.includes(day) ? "selected" : ""} onClick={() => toggleDay(day)} key={day}>{day.slice(0, 3)}</button>)}</div></fieldset>
              <label className="field full"><span>Exam date & time</span><input required type="datetime-local" value={form.examDate} onChange={(event) => setForm({ ...form, examDate: event.target.value })} /></label>
              <label className="field full"><span>Course type <i>optional</i></span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CourseType })}><option value="">Not specified</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              {error && <div className="inline-error" role="alert"><b>!</b><span>{error}</span></div>}
              {!user && <p className="guest-note">You can plan as a guest. Sign in whenever you want this schedule saved to your account.</p>}
              <button className="submit-button" disabled={saving}>{saving ? "Saving…" : "Add to my schedule"} <span>→</span></button>
            </form>
          </section>
        </div>
      )}

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="modal-header"><div><p>PROFILE</p><h2 id="profile-title">{user ? "Your planning profile" : "Save your UniPlan"}</h2></div><button onClick={() => setProfileOpen(false)} aria-label="Close">×</button></div>
            {user ? <form onSubmit={saveProfile}><div className="profile-hero"><span>{initials(profileName || user.email)}</span><div><strong>{profileName || user.displayName}</strong><small>{user.email}</small></div></div><label className="field full"><span>Display name</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label className="field full"><span>Concentration / major focus</span><input value={majorFocus} onChange={(event) => setMajorFocus(event.target.value)} placeholder="e.g. Artificial Intelligence" /></label><p className="guest-note">This focus will help personalize future plan suggestions.</p><button className="submit-button" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button><a className="signout-link" href="/signout-with-chatgpt?return_to=%2F">Sign out</a></form> : <div className="signin-panel"><div className="signin-orb">U</div><p>Keep your courses and profile available on every visit. Guest planning remains fully available.</p><a className="submit-button" href="/signin-with-chatgpt?return_to=%2F">Sign in with ChatGPT <span>→</span></a><button onClick={() => setProfileOpen(false)}>Continue as guest</button></div>}
          </section>
        </div>
      )}
    </main>
  );
}

function validateCourse(form: Omit<Course, "id">, courses: Course[]) {
  if (!form.name.trim()) return "Give the course a name.";
  if (!form.days.length) return "Choose at least one weekday.";
  const start = timeNumber(form.startTime), end = timeNumber(form.endTime);
  if (start < 7 || end > 18 || end <= start) return "Class time must sit between 07:00 and 18:00, with the end after the start.";
  const overlapping = courses.find((course) =>
    course.days.some((day) => form.days.includes(day)) &&
    start < timeNumber(course.endTime) &&
    end > timeNumber(course.startTime)
  );
  if (overlapping) return `Schedule conflict with ${overlapping.name}. Adjacent classes are okay, but these times overlap.`;
  const examConflict = courses.find((course) => normalizeDate(course.examDate) === normalizeDate(form.examDate));
  if (examConflict) return `Exam conflict with ${examConflict.name} on ${formatExamDate(form.examDate)}. This course wasn’t added.`;
  return "";
}

function timeNumber(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours + minutes / 60;
}
function tone(type: CourseType) {
  if (type === "General") return "mint";
  if (type === "Major requirements") return "blue";
  if (type === "Track") return "amber";
  if (type === "Elective courses") return "rose";
  return "violet";
}
function exportColor(type: CourseType) {
  return type === "General" ? "#168565" : type === "Track" ? "#b77716" : type === "Elective courses" ? "#c64768" : type === "Major requirements" ? "#315eea" : "#7952c9";
}
function normalizeDate(value: string) { return value.slice(0, 16); }
function formatExamDate(value: string) { return new Date(value).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function formatExamTime(value: string) { return new Date(value).toLocaleString("en", { hour: "2-digit", minute: "2-digit" }); }
function formatHours(value: number) { return `${Number.isInteger(value) ? value : value.toFixed(1)}h`; }
function initials(value: string) { return value.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "G"; }
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath(); context.roundRect(x, y, width, height, radius);
}
function trimCanvasText(context: CanvasRenderingContext2D, value: string, width: number) {
  if (context.measureText(value).width <= width) return value;
  let trimmed = value;
  while (trimmed.length && context.measureText(`${trimmed}…`).width > width) trimmed = trimmed.slice(0, -1);
  return `${trimmed}…`;
}
