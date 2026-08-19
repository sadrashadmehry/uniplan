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
  trackName: string;
};

const DAYS: Day[] = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 7);
const PERSIAN_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const TYPES: CourseType[] = ["General", "Major requirements", "Track", "Elective courses"];
const EMPTY_FORM: Omit<Course, "id"> = {
  name: "",
  startTime: "09:00",
  endTime: "10:30",
  days: [],
  examDate: "",
  type: "",
  trackName: "",
};
const DEMO_COURSES: Course[] = [
  { id: "demo-ap", name: "Advanced Programming", startTime: "13:30", endTime: "15:00", days: ["Saturday", "Monday"], examDate: "2026-12-22T09:00", type: "Major requirements", trackName: "" },
  { id: "demo-algo", name: "Algorithms", startTime: "15:00", endTime: "16:30", days: ["Saturday", "Monday"], examDate: "2026-12-28T09:00", type: "Major requirements", trackName: "" },
  { id: "demo-linear", name: "Linear Algebra", startTime: "09:00", endTime: "10:30", days: ["Sunday", "Tuesday"], examDate: "2027-01-03T13:30", type: "General", trackName: "" },
  { id: "demo-net", name: "Computer Networks", startTime: "11:00", endTime: "13:00", days: ["Wednesday"], examDate: "2027-01-08T11:00", type: "Track", trackName: "Software" },
  { id: "demo-ai", name: "AI Foundations", startTime: "14:00", endTime: "16:00", days: ["Tuesday"], examDate: "2027-01-11T08:30", type: "Elective courses", trackName: "" },
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
    }).catch(() => setError("Your saved plan couldn’t be loaded. This view is still available."));
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
    setForm({ ...EMPTY_FORM, examDate: defaultExamDate() });
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
      setNotice(user ? "Course saved." : "Course added for this visit.");
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
        setError("That course couldn’t be removed. Please try again.");
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
      setNotice("Profile saved.");
      window.setTimeout(() => setNotice(""), 3000);
    } catch {
      setError("Your profile couldn’t be saved.");
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
    context.fillText("UniPlan · My week", 48, 60);
    context.fillStyle = "#6d7589";
    context.font = "16px Arial";
    context.fillText("Saturday to Wednesday · 07:00–18:00", 48, 90);
    const x = 50, y = 145, gridWidth = 1190, dayWidth = 120, rowHeight = 105;
    context.strokeStyle = "#dfe5ef";
    context.lineWidth = 1;
    for (let index = 0; index < HOURS.length; index += 1) {
      const lineX = x + ((11 - index) / 11) * gridWidth;
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
        const blockX = x + ((18 - timeNumber(course.endTime)) / 11) * gridWidth;
        const blockWidth = ((timeNumber(course.endTime) - timeNumber(course.startTime)) / 11) * gridWidth;
        context.fillStyle = exportColor(course.type);
        roundedRect(context, blockX + 3, rowY + 14, Math.max(blockWidth - 6, 25), 76, 12);
        context.fill();
        context.fillStyle = "#ffffff"; context.font = "700 13px Arial";
        context.fillText(trimCanvasText(context, course.name, blockWidth - 24), blockX + 15, rowY + 45);
        context.font = "11px Arial";
        context.fillText(`${course.trackName ? `${course.trackName} · ` : ""}${course.startTime}–${course.endTime}`, blockX + 15, rowY + 68);
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
          <button className="rail-button active" aria-label="Weekly schedule"><span>▦</span></button>
          <button className="rail-button" aria-label="Add course" onClick={openCourseForm}><span>＋</span></button>
          <button className="rail-button" aria-label="Exams"><span>⌁</span></button>
        </nav>
        <button className="rail-button help" aria-label="Help"><span>?</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup"><div className="mini-logo">U</div><span>UniPlan</span></div>
          <div className="top-actions">
            <button className="icon-button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={toggleTheme}>{theme === "light" ? "☾" : "☼"}</button>
            {user ? <span className="sync-state"><i /> Saved</span> : <a className="signin-button" href="/signin-with-chatgpt?return_to=%2F">Save my plan</a>}
            <button className="avatar" aria-label="Edit profile" onClick={() => setProfileOpen(true)}>{initials(profileName || user?.email || "Guest")}</button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <h1>My week</h1>
              <span className="heading-count">{courses.length} {courses.length === 1 ? "course" : "courses"}</span>
            </div>
            <div className="heading-actions">
              <div className="export-wrap" ref={exportMenuRef}>
                <button className="secondary-button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen}>⇩&nbsp; Export <span>⌄</span></button>
                {exportOpen && <div className="export-menu"><button onClick={() => { setExportOpen(false); window.print(); }}><span>PDF</span><strong>Save as PDF</strong></button><button onClick={exportPng}><span>PNG</span><strong>Download PNG</strong></button></div>}
              </div>
              <button className="primary-button" onClick={openCourseForm}>＋ New course</button>
            </div>
          </div>

          {error && !addOpen && <div className="alert error-alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}

          <div className="insight-row">
            <article className="insight-card"><span className="insight-icon blue">◫</span><div><strong>{formatHours(totalHours)}</strong><span>of class</span></div></article>
            <article className="insight-card"><span className="insight-icon mint">✓</span><div><strong>Everything fits</strong></div></article>
            <article className="next-exam">
              {nextExam ? <><span className="exam-date"><b>{formatPersianDateParts(nextExam.examDate).day}</b><small>{formatPersianDateParts(nextExam.examDate).month}</small></span><div><small>UP NEXT</small><strong>{nextExam.name} · {formatExamTime(nextExam.examDate)}</strong></div><span>→</span></> : <><span className="exam-date"><b>—</b><small>EXAM</small></span><div><strong>No exams scheduled</strong></div></>}
            </article>
          </div>

          <section className="schedule-card" aria-label="Weekly course schedule">
            <div className="schedule-toolbar">
              <div><h2>This week</h2><p>07:00–18:00</p></div>
              <div className="legend"><span><i className="dot blue-dot" /> Major</span><span><i className="dot mint-dot" /> General</span><span><i className="dot amber-dot" /> Track</span><span><i className="dot rose-dot" /> Elective</span></div>
            </div>
            <div className="schedule-scroll">
              <div className="schedule-grid">
                <div className="time-row">
                  {HOURS.map((hour, index) => <span key={hour} style={{ left: `${((11 - index) / 11) * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}
                  <b className="day-column-title">DAY</b>
                </div>
                {DAYS.map((day) => (
                  <div className="day-row" key={day}>
                    <div className="hour-lines">{Array.from({ length: 23 }, (_, index) => <i className={index % 2 ? "half-hour" : "full-hour"} style={{ left: `${(index / 22) * 100}%` }} key={index} />)}</div>
                    {courses.filter((course) => course.days.includes(day)).map((course) => (
                      <article className={`course-block ${tone(course.type)}`} key={course.id} style={{ left: `${((18 - timeNumber(course.endTime)) / 11) * 100}%`, width: `${((timeNumber(course.endTime) - timeNumber(course.startTime)) / 11) * 100}%` }} title={`${course.name}, ${course.startTime} to ${course.endTime}`}>
                        <button className="remove-course" onClick={() => removeCourse(course)} aria-label={`Remove ${course.name}`}>×</button>
                        <strong>{course.name}</strong><span>{course.trackName ? `${course.trackName} · ` : ""}{course.startTime}–{course.endTime}</span>
                      </article>
                    ))}
                    <strong className="day-name">{day}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="schedule-footer"><span><i className="pulse" /> Schedule looks clear</span><button onClick={openCourseForm}>＋ New course</button></div>
          </section>

          <section className="exam-strip">
            <div><span className="section-icon">⌁</span><div><h2>Exams</h2></div></div>
            <div className="exam-list">
              {courses.slice().sort((a, b) => a.examDate.localeCompare(b.examDate)).slice(0, 4).map((course) => (
                <article key={course.id}><span className={`exam-chip ${tone(course.type)}`}>{formatPersianShortDate(course.examDate)}</span><div><strong>{course.name}</strong><small>{formatExamTime(course.examDate)}</small></div></article>
              ))}
              {!courses.length && <p className="empty-note">Your exams will appear here after you add a course.</p>}
            </div>
          </section>
        </div>
      </section>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="course-modal-title">
            <div className="modal-header"><div><p>COURSE DETAILS</p><h2 id="course-modal-title">Add a course</h2></div><button onClick={() => setAddOpen(false)} aria-label="Close">×</button></div>
            <form onSubmit={saveCourse}>
              <label className="field full"><span>Course name</span><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Advanced Programming" /></label>
              <div className="form-grid">
                <BoundedTimeField label="Starts at" value={form.startTime} onChange={(startTime) => setForm({ ...form, startTime })} />
                <BoundedTimeField label="Ends at" value={form.endTime} onChange={(endTime) => setForm({ ...form, endTime })} />
              </div>
              <fieldset className="day-picker"><legend>Meets on</legend><div>{DAYS.map((day) => <button type="button" className={form.days.includes(day) ? "selected" : ""} onClick={() => toggleDay(day)} key={day}>{day.slice(0, 3)}</button>)}</div></fieldset>
              <PersianExamDateTime value={form.examDate} onChange={(examDate) => setForm({ ...form, examDate })} />
              <label className="field full"><span>Category <i>optional</i></span><select value={form.type} onChange={(event) => { const type = event.target.value as CourseType; setForm({ ...form, type, trackName: type === "Track" ? form.trackName : "" }); }}><option value="">Not specified</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              {form.type === "Track" && <label className="field full"><span>Track name <i>optional</i></span><input value={form.trackName} onChange={(event) => setForm({ ...form, trackName: event.target.value })} placeholder="e.g. Software, Hardware, AI" /></label>}
              {error && <div className="inline-error" role="alert"><b>!</b><span>{error}</span></div>}
              {!user && <p className="guest-note">You can keep planning without signing in.</p>}
              <button className="submit-button" disabled={saving}>{saving ? "Saving…" : "Add course"} <span>→</span></button>
            </form>
          </section>
        </div>
      )}

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="modal-header"><div><p>PROFILE</p><h2 id="profile-title">{user ? "Your profile" : "Save your plan"}</h2></div><button onClick={() => setProfileOpen(false)} aria-label="Close">×</button></div>
            {user ? <form onSubmit={saveProfile}><div className="profile-hero"><span>{initials(profileName || user.email)}</span><div><strong>{profileName || user.displayName}</strong><small>{user.email}</small></div></div><label className="field full"><span>Display name</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label className="field full"><span>Study focus</span><input value={majorFocus} onChange={(event) => setMajorFocus(event.target.value)} placeholder="e.g. Artificial Intelligence" /></label><p className="guest-note">This can shape future course suggestions.</p><button className="submit-button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button><a className="signout-link" href="/signout-with-chatgpt?return_to=%2F">Sign out</a></form> : <div className="signin-panel"><div className="signin-orb">U</div><p>Sign in to keep this plan available on your next visit.</p><a className="submit-button" href="/signin-with-chatgpt?return_to=%2F">Sign in with ChatGPT <span>→</span></a><button onClick={() => setProfileOpen(false)}>Keep planning</button></div>}
          </section>
        </div>
      )}
    </main>
  );
}

function BoundedTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [hourValue = "07", minuteValue = "00"] = value.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const minuteOptions = Array.from({ length: hour === 18 ? 1 : 60 }, (_, index) => index);

  function setHour(nextHour: number) {
    const nextMinute = nextHour === 18 ? 0 : minute;
    onChange(`${pad(nextHour)}:${pad(nextMinute)}`);
  }

  return (
    <div className="field time-field">
      <span>{label}</span>
      <div className="time-picker">
        <label><small>Hour</small><select aria-label={`${label} hour`} value={hour} onChange={(event) => setHour(Number(event.target.value))}>{HOURS.map((item) => <option key={item} value={item}>{pad(item)}</option>)}</select></label>
        <b>:</b>
        <label><small>Minute</small><select aria-label={`${label} minute`} value={hour === 18 ? 0 : minute} onChange={(event) => onChange(`${pad(hour)}:${pad(Number(event.target.value))}`)}>{minuteOptions.map((item) => <option key={item} value={item}>{pad(item)}</option>)}</select></label>
      </div>
    </div>
  );
}

function PersianExamDateTime({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const fallback = defaultExamDate();
  const [datePart, timePart = "09:00"] = (value || fallback).split("T");
  const [gy, gm, gd] = datePart.split("-").map(Number);
  const jalali = toJalaali(gy, gm, gd);
  const today = new Date();
  const currentJalali = toJalaali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const years = Array.from({ length: 8 }, (_, index) => currentJalali.jy - 1 + index);
  const days = Array.from({ length: daysInJalaliMonth(jalali.jy, jalali.jm) }, (_, index) => index + 1);

  function setDate(parts: Partial<JalaliDate>) {
    const jy = parts.jy ?? jalali.jy;
    const jm = parts.jm ?? jalali.jm;
    const jd = Math.min(parts.jd ?? jalali.jd, daysInJalaliMonth(jy, jm));
    const gregorian = toGregorian(jy, jm, jd);
    onChange(`${pad(gregorian.gy)}-${pad(gregorian.gm)}-${pad(gregorian.gd)}T${timePart}`);
  }

  return (
    <div className="persian-exam">
      <span>Exam date · Persian</span>
      <div className="persian-date-grid" dir="rtl">
        <label><small>سال</small><select aria-label="Persian exam year" value={jalali.jy} onChange={(event) => setDate({ jy: Number(event.target.value) })}>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><small>ماه</small><select aria-label="Persian exam month" value={jalali.jm} onChange={(event) => setDate({ jm: Number(event.target.value) })}>{PERSIAN_MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
        <label><small>روز</small><select aria-label="Persian exam day" value={jalali.jd} onChange={(event) => setDate({ jd: Number(event.target.value) })}>{days.map((day) => <option key={day}>{day}</option>)}</select></label>
      </div>
      <BoundedTimeField label="Exam time" value={timePart} onChange={(time) => onChange(`${datePart}T${time}`)} />
    </div>
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
function formatExamDate(value: string) { return `${formatPersianShortDate(value)} · ${formatExamTime(value)}`; }
function formatExamTime(value: string) { return value.slice(11, 16); }
function formatHours(value: number) { return `${Number.isInteger(value) ? value : value.toFixed(1)}h`; }
function initials(value: string) { return value.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "G"; }
function pad(value: number) { return String(value).padStart(2, "0"); }
function defaultExamDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  date.setHours(9, 0, 0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`;
}
function formatPersianDateParts(value: string) {
  const [gy, gm, gd] = value.slice(0, 10).split("-").map(Number);
  const date = toJalaali(gy, gm, gd);
  return { day: String(date.jd), month: PERSIAN_MONTHS[date.jm - 1] };
}
function formatPersianShortDate(value: string) {
  const parts = formatPersianDateParts(value);
  return `${parts.day} ${parts.month}`;
}
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath(); context.roundRect(x, y, width, height, radius);
}
function trimCanvasText(context: CanvasRenderingContext2D, value: string, width: number) {
  if (context.measureText(value).width <= width) return value;
  let trimmed = value;
  while (trimmed.length && context.measureText(`${trimmed}…`).width > width) trimmed = trimmed.slice(0, -1);
  return `${trimmed}…`;
}

type JalaliDate = { jy: number; jm: number; jd: number };
type GregorianDate = { gy: number; gm: number; gd: number };
const JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function intDiv(left: number, right: number) { return Math.trunc(left / right); }
function intMod(left: number, right: number) { return left - Math.trunc(left / right) * right; }

function jalaliCalendar(jy: number) {
  const gy = jy + 621;
  let leapJ = -14;
  let previous = JALALI_BREAKS[0];
  let jump = 0;
  let next = 0;
  if (jy < previous || jy >= JALALI_BREAKS[JALALI_BREAKS.length - 1]) throw new Error("Persian year is out of range.");
  for (let index = 1; index < JALALI_BREAKS.length; index += 1) {
    next = JALALI_BREAKS[index];
    jump = next - previous;
    if (jy < next) break;
    leapJ += intDiv(jump, 33) * 8 + intDiv(intMod(jump, 33), 4);
    previous = next;
  }
  let distance = jy - previous;
  leapJ += intDiv(distance, 33) * 8 + intDiv(intMod(distance, 33) + 3, 4);
  if (intMod(jump, 33) === 4 && jump - distance === 4) leapJ += 1;
  const leapG = intDiv(gy, 4) - intDiv((intDiv(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - distance < 6) distance = distance - jump + intDiv(jump + 4, 33) * 33;
  let leap = intMod(intMod(distance + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function gregorianDayNumber(gy: number, gm: number, gd: number) {
  let value = intDiv((gy + intDiv(gm - 8, 6) + 100100) * 1461, 4);
  value += intDiv(153 * intMod(gm + 9, 12) + 2, 5) + gd - 34840408;
  value -= intDiv(intDiv(gy + 100100 + intDiv(gm - 8, 6), 100) * 3, 4) - 752;
  return value;
}

function dayNumberToGregorian(dayNumber: number): GregorianDate {
  let value = 4 * dayNumber + 139361631;
  value += intDiv(intDiv(4 * dayNumber + 183187720, 146097) * 3, 4) * 4 - 3908;
  const part = intDiv(intMod(value, 1461), 4) * 5 + 308;
  const gd = intDiv(intMod(part, 153), 5) + 1;
  const gm = intMod(intDiv(part, 153), 12) + 1;
  const gy = intDiv(value, 1461) - 100100 + intDiv(8 - gm, 6);
  return { gy, gm, gd };
}

function toGregorian(jy: number, jm: number, jd: number): GregorianDate {
  const calendar = jalaliCalendar(jy);
  const firstFarvardin = gregorianDayNumber(calendar.gy, 3, calendar.march);
  return dayNumberToGregorian(firstFarvardin + (jm - 1) * 31 - intDiv(jm, 7) * (jm - 7) + jd - 1);
}

function toJalaali(gy: number, gm: number, gd: number): JalaliDate {
  const dayNumber = gregorianDayNumber(gy, gm, gd);
  let jy = gy - 621;
  const calendar = jalaliCalendar(jy);
  const firstFarvardin = gregorianDayNumber(gy, 3, calendar.march);
  let offset = dayNumber - firstFarvardin;
  if (offset >= 0) {
    if (offset <= 185) return { jy, jm: 1 + intDiv(offset, 31), jd: intMod(offset, 31) + 1 };
    offset -= 186;
  } else {
    jy -= 1;
    offset += 179;
    if (calendar.leap === 1) offset += 1;
  }
  return { jy, jm: 7 + intDiv(offset, 30), jd: intMod(offset, 30) + 1 };
}

function daysInJalaliMonth(jy: number, jm: number) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalaliCalendar(jy).leap === 0 ? 30 : 29;
}
