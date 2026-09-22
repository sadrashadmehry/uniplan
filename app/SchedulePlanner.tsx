"use client";

import { renderSchedulePng } from "./schedule-export.mjs";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Day = "Saturday" | "Sunday" | "Monday" | "Tuesday" | "Wednesday";
type CourseType = "" | "General" | "Major requirements" | "Track" | "Elective courses";
type CourseColor = "blue" | "mint" | "amber" | "rose";
type User = { displayName: string; email: string } | null;
type Course = {
  id: string;
  name: string;
  instructor: string;
  startTime: string;
  endTime: string;
  days: Day[];
  examDate: string;
  type: CourseType;
  trackName: string;
  color: CourseColor;
  units?: number | null;
  prerequisites?: string[] | null;
  corequisites?: string[] | null;
  requirementNotes?: string;
};
type CourseForm = Omit<Course, "id">;
type CourseGroup = { key: string; courses: Course[] };
type ImportedCourseDraft = CourseForm & {
  id: string;
  section: string;
  sourceContext: string;
  confidence: number;
  missingFields: string[];
};
type GuestWorkspaceCache = {
  form: CourseForm;
  addOpen: boolean;
  editingCourseId: string | null;
  importedCourses: ImportedCourseDraft[];
  selectedDraftId: string | null;
  importWarnings: string[];
};

const DAYS: Day[] = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
const PERSIAN_DAYS: Record<Day, string> = { Saturday: "شنبه", Sunday: "یکشنبه", Monday: "دوشنبه", Tuesday: "سه‌شنبه", Wednesday: "چهارشنبه" };
const HOURS = Array.from({ length: 12 }, (_, index) => index + 7);
const PERSIAN_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const TYPES: CourseType[] = ["General", "Major requirements", "Track", "Elective courses"];
const CARD_COLORS: { value: CourseColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "mint", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
];
const GUEST_COURSES_CACHE_KEY = "uniplan-guest-courses-v1";
const GUEST_WORKSPACE_CACHE_KEY = "uniplan-guest-workspace-v1";
const BROWSER_CACHE_VERSION = 1;
const BRAND_LOGO_SRC = "/uniplan-logo.png";
const EMPTY_FORM: CourseForm = {
  name: "",
  instructor: "",
  startTime: "09:00",
  endTime: "10:30",
  days: [],
  examDate: "",
  type: "",
  trackName: "",
  color: "blue",
};
function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(4));
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("-");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readGuestCoursesCache(): Course[] | null {
  const cache = readBrowserCache(GUEST_COURSES_CACHE_KEY);
  if (!isRecord(cache) || cache.version !== BROWSER_CACHE_VERSION || !Array.isArray(cache.courses)) return null;
  const courses = cache.courses.slice(0, 300).map(parseCachedCourse).filter((course): course is Course => Boolean(course));
  if (courses.length !== cache.courses.length) return null;
  return courses.filter((course) => !course.id.startsWith("demo-"));
}

function readGuestWorkspaceCache(): GuestWorkspaceCache | null {
  const cache = readBrowserCache(GUEST_WORKSPACE_CACHE_KEY);
  if (!isRecord(cache) || cache.version !== BROWSER_CACHE_VERSION || !isRecord(cache.form)) return null;
  const form = parseCachedCourseForm(cache.form, false);
  const importedValues = Array.isArray(cache.importedCourses) ? cache.importedCourses.slice(0, 500) : [];
  const importedCourses = importedValues.map(parseCachedImportedCourse).filter((course): course is ImportedCourseDraft => Boolean(course));
  if (!form || importedCourses.length !== importedValues.length) return null;

  const editingCourseId = typeof cache.editingCourseId === "string" ? cache.editingCourseId : null;
  const selectedDraftCandidate = typeof cache.selectedDraftId === "string" ? cache.selectedDraftId : null;
  const selectedDraftId = selectedDraftCandidate && importedCourses.some((course) => course.id === selectedDraftCandidate)
    ? selectedDraftCandidate
    : null;
  const importWarnings = Array.isArray(cache.importWarnings)
    ? cache.importWarnings.slice(0, 100).filter((warning): warning is string => isSafeString(warning, 500))
    : [];

  return {
    form,
    addOpen: cache.addOpen === true,
    editingCourseId,
    importedCourses,
    selectedDraftId,
    importWarnings,
  };
}

function readBrowserCache(key: string): unknown {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function writeBrowserCache(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts. Planning still works in memory.
  }
}

function parseCachedCourse(value: unknown): Course | null {
  if (!isRecord(value) || !isSafeString(value.id, 200)) return null;
  const form = parseCachedCourseForm(value, false);
  return form ? { id: value.id, ...form } : null;
}

function parseCachedCourseForm(value: unknown, allowMissingTimes: boolean): CourseForm | null {
  if (!isRecord(value)) return null;
  const validTime = (time: unknown) => allowMissingTimes && time === "" || isScheduleTime(time);
  if (
    !isSafeString(value.name, 300) ||
    !validTime(value.startTime) ||
    !validTime(value.endTime) ||
    !Array.isArray(value.days) ||
    value.days.length > DAYS.length ||
    !value.days.every((day) => typeof day === "string" && DAYS.includes(day as Day)) ||
    !isSafeString(value.examDate, 80) ||
    typeof value.type !== "string" ||
    !(["", ...TYPES] as string[]).includes(value.type) ||
    !isSafeString(value.trackName, 200)
  ) return null;

  const type = value.type as CourseType;
  const color = typeof value.color === "string" && CARD_COLORS.some((option) => option.value === value.color)
    ? value.color as CourseColor
    : defaultColorForType(type);

  return {
    ...catalogFields(value),
    name: value.name,
    instructor: isSafeString(value.instructor, 300) ? value.instructor : "",
    startTime: value.startTime as string,
    endTime: value.endTime as string,
    days: [...new Set(value.days as Day[])],
    examDate: value.examDate,
    type,
    trackName: value.trackName,
    color,
  };
}

function parseCachedImportedCourse(value: unknown): ImportedCourseDraft | null {
  if (!isRecord(value) || !isSafeString(value.id, 200)) return null;
  const form = parseCachedCourseForm(value, true);
  if (
    !form ||
    !isSafeString(value.section, 100) ||
    !isSafeString(value.sourceContext, 2_000) ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    !Array.isArray(value.missingFields) ||
    value.missingFields.length > 30 ||
    !value.missingFields.every((field) => isSafeString(field, 100))
  ) return null;
  return {
    id: value.id,
    ...form,
    section: value.section,
    sourceContext: value.sourceContext,
    confidence: value.confidence,
    missingFields: value.missingFields as string[],
  };
}

function catalogFields(value: Record<string, unknown>) {
  const names = (items: unknown): string[] | null => Array.isArray(items) && items.length <= 30 && items.every((item) => isSafeString(item, 300)) ? items : null;
  return {
    units: typeof value.units === "number" && Number.isInteger(value.units) && value.units > 0 && value.units <= 24 ? value.units : null,
    prerequisites: names(value.prerequisites),
    corequisites: names(value.corequisites),
    requirementNotes: isSafeString(value.requirementNotes, 1000) ? value.requirementNotes : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength;
}

function isScheduleTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 7 && hour <= 18 && minute >= 0 && minute <= 59 && (hour !== 18 || minute === 0);
}

export function SchedulePlanner({ user }: { user: User }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [addOpen, setAddOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [importedCourses, setImportedCourses] = useState<ImportedCourseDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [flippedGroups, setFlippedGroups] = useState<string[]>([]);
  const [courseNameFocused, setCourseNameFocused] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileName, setProfileName] = useState(user?.displayName ?? "");
  const [majorFocus, setMajorFocus] = useState("");
  const [browserCacheReady, setBrowserCacheReady] = useState(false);
  const [currentTime] = useState(() => Date.now());
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("uniplan-theme");
    const nextTheme = savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    // Hydrate the persisted client preference after the server-rendered light theme.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    const cachedCourses = user ? null : readGuestCoursesCache();
    const cachedWorkspace = user ? null : readGuestWorkspaceCache();
    const frame = window.requestAnimationFrame(() => {
      if (cachedCourses) setCourses(cachedCourses);
      if (cachedWorkspace) {
        setForm(cachedWorkspace.form);
        setAddOpen(cachedWorkspace.addOpen);
        setEditingCourseId(cachedWorkspace.editingCourseId);
        setImportedCourses(cachedWorkspace.importedCourses);
        setSelectedDraftId(cachedWorkspace.selectedDraftId);
        setImportWarnings(cachedWorkspace.importWarnings);
      }
      setBrowserCacheReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [user]);

  useEffect(() => {
    if (user || !browserCacheReady) return;
    writeBrowserCache(GUEST_COURSES_CACHE_KEY, {
      version: BROWSER_CACHE_VERSION,
      courses,
    });
  }, [browserCacheReady, courses, user]);

  useEffect(() => {
    if (user || !browserCacheReady) return;
    writeBrowserCache(GUEST_WORKSPACE_CACHE_KEY, {
      version: BROWSER_CACHE_VERSION,
      form,
      addOpen,
      editingCourseId,
      importedCourses,
      selectedDraftId,
      importWarnings,
    });
  }, [addOpen, browserCacheReady, editingCourseId, form, importWarnings, importedCourses, selectedDraftId, user]);

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

  const courseGroups = useMemo(() => groupCourses(courses), [courses]);
  const planBCount = useMemo(() => courseGroups.filter((group) => group.courses.length > 1).length, [courseGroups]);
  const totalHours = useMemo(() => courseGroups.reduce((total, group) => {
    const course = group.courses[0];
    return total + (timeNumber(course.endTime) - timeNumber(course.startTime)) * course.days.length;
  }, 0), [courseGroups]);
  const exams = useMemo(() => sortedExamCourses(courses), [courses]);
  const importedCourseGroups = useMemo(() => groupImportedCourses(importedCourses), [importedCourses]);
  const courseNameSuggestions = useMemo(() => {
    const queryTerms = normalizeSearchText(form.name).split(" ").filter(Boolean);
    if (!queryTerms.length) return [];
    return importedCourses.filter((course) => {
      const searchableText = normalizeSearchText(`${course.name} ${course.instructor}`);
      return queryTerms.every((term) => searchableText.includes(term));
    });
  }, [form.name, importedCourses]);
  const nextExam = useMemo(() => exams.find((course) => new Date(course.examDate).getTime() >= currentTime) ?? exams[0], [currentTime, exams]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("uniplan-theme", next);
  }

  function openCourseForm() {
    setExamOpen(false);
    setForm({ ...EMPTY_FORM, examDate: defaultExamDate() });
    setEditingCourseId(null);
    setSelectedDraftId(null);
    setError("");
    setAddOpen(true);
  }

  function openEditForm(course: Course) {
    setExamOpen(false);
    setForm({ ...course, days: [...course.days] });
    setEditingCourseId(course.id);
    setSelectedDraftId(null);
    setError("");
    setAddOpen(true);
  }

  function closeCourseForm() {
    setAddOpen(false);
    setEditingCourseId(null);
    setSelectedDraftId(null);
    setError("");
  }

  function showSchedule() {
    setExamOpen(false);
    closeCourseForm();
  }

  function showExamTimeline() {
    setAddOpen(false);
    setEditingCourseId(null);
    setSelectedDraftId(null);
    setExamOpen(true);
    setError("");
  }

  function selectImportedCourse(course: ImportedCourseDraft) {
    setSelectedDraftId(course.id);
    setEditingCourseId(null);
    setForm({
      ...catalogFields(course),
      name: course.name,
      instructor: course.instructor,
      days: [...course.days],
      startTime: course.startTime || "09:00",
      endTime: course.endTime || "10:30",
      examDate: course.examDate,
      type: course.type,
      trackName: course.trackName,
      color: course.color,
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function importCourseDocument(event: ChangeEvent<HTMLInputElement>) {
    const document = event.target.files?.[0];
    event.target.value = "";
    if (!document) return;
    if (document.type !== "application/pdf" || !document.name.toLowerCase().endsWith(".pdf")) {
      setImportError("Choose a PDF timetable to import.");
      return;
    }
    if (document.size > 8 * 1024 * 1024) {
      setImportError("The document must be smaller than 8 MB.");
      return;
    }
    setImporting(true);
    setImportError("");
    setImportWarnings([]);
    try {
      const response = await fetch("/api/import-courses", {
        method: "POST",
        headers: { "Content-Type": "application/pdf", Accept: "application/json" },
        body: document,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The document could not be read.");
      const drafts: ImportedCourseDraft[] = (Array.isArray(data.courses) ? data.courses : []).map((course: Partial<ImportedCourseDraft>) => ({
        id: createClientId(),
        ...catalogFields(course),
        name: typeof course.name === "string" ? course.name : "",
        days: Array.isArray(course.days) ? course.days.filter((day): day is Day => DAYS.includes(day as Day)) : [],
        startTime: typeof course.startTime === "string" ? course.startTime : "",
        endTime: typeof course.endTime === "string" ? course.endTime : "",
        examDate: typeof course.examDate === "string" ? course.examDate : "",
        type: TYPES.includes(course.type as CourseType) ? course.type as CourseType : "",
        trackName: typeof course.trackName === "string" ? course.trackName : "",
        color: CARD_COLORS.some((option) => option.value === course.color)
          ? course.color as CourseColor
          : defaultColorForType(TYPES.includes(course.type as CourseType) ? course.type as CourseType : ""),
        instructor: typeof course.instructor === "string" ? course.instructor : "",
        section: typeof course.section === "string" ? course.section : "",
        sourceContext: typeof course.sourceContext === "string" ? course.sourceContext : "",
        confidence: typeof course.confidence === "number" ? course.confidence : 0,
        missingFields: Array.isArray(course.missingFields) ? course.missingFields.filter((field): field is string => typeof field === "string") : [],
      }));
      setImportedCourses(drafts);
      setImportWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      if (drafts[0]) selectImportedCourse(drafts[0]);
      else setImportError("No course rows were found. Try a sharper scan or a PDF with selectable text.");
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "The document could not be read.");
    } finally {
      setImporting(false);
    }
  }

  function toggleCard(groupKey: string) {
    setFlippedGroups((current) => current.includes(groupKey)
      ? current.filter((key) => key !== groupKey)
      : [...current, groupKey]);
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
    const validationError = validateCourse(form, courses, editingCourseId);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    const existingCourse = editingCourseId ? courses.find((course) => course.id === editingCourseId) : undefined;
    const optimistic: Course = { ...form, id: editingCourseId ?? createClientId() };
    const becomesPlanB = !editingCourseId && courses.some((course) => sameSlot(course, form));
    try {
      if (user && (!existingCourse || !existingCourse.id.startsWith("demo-"))) {
        const response = await fetch("/api/courses", {
          method: editingCourseId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingCourseId ? { ...form, id: editingCourseId } : form),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The course could not be saved.");
        setCourses((current) => editingCourseId
          ? current.map((course) => course.id === editingCourseId ? data.course : course)
          : [...current, data.course]);
      } else {
        setCourses((current) => editingCourseId
          ? current.map((course) => course.id === editingCourseId ? optimistic : course)
          : [...current, optimistic]);
      }
      const wasEditing = Boolean(editingCourseId);
      const savedDraftId = selectedDraftId;
      if (wasEditing) {
        closeCourseForm();
      } else {
        if (savedDraftId) setImportedCourses((current) => current.filter((course) => course.id !== savedDraftId));
        setSelectedDraftId(null);
        setEditingCourseId(null);
        setForm({ ...EMPTY_FORM, examDate: defaultExamDate() });
        setError("");
      }
      setNotice(wasEditing ? "Course updated." : becomesPlanB ? "Plan B added — click the card to flip." : user ? "Course saved." : "Course saved in this browser.");
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
    setNotice("Course removed.");
    window.setTimeout(() => setNotice(""), 2600);
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

  async function exportPng() {
    setExportOpen(false);
    try {
      const image = await renderSchedulePng({
        courseGroups,
        exams: exams.map((course) => ({ ...course, dateLabel: formatPersianFullDate(course.examDate), weekdayLabel: formatExamWeekday(course.examDate) })),
      });
      const link = document.createElement("a");
      link.download = "uniplan-schedule-and-exams.png";
      link.href = image;
      link.click();
    } catch {
      setError("The schedule image could not be exported. Please try again.");
    }
  }

  return (
    <main className="app-shell">
      <aside className="side-rail" aria-label="Main navigation">
        <div className="brand-mark"><BrandLogo /></div>
        <nav>
          <button className={`rail-button ${!addOpen && !examOpen ? "active" : ""}`} aria-label="Weekly schedule" onClick={showSchedule}><span>▦</span></button>
          <button className={`rail-button ${addOpen ? "active" : ""}`} aria-label="Add course" onClick={openCourseForm}><span>＋</span></button>
          <button className={`rail-button ${examOpen ? "active" : ""}`} aria-label="Exam timeline" onClick={showExamTimeline}><span>⌁</span></button>
        </nav>
        <button className="rail-button help" aria-label="Help"><span>?</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup"><div className="mini-logo"><BrandLogo /></div><span>UniPlan</span></div>
          <div className="top-actions">
            <button className="icon-button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={toggleTheme}>{theme === "light" ? "☾" : "☼"}</button>
            {user ? <span className="sync-state"><i /> Saved</span> : <span className="sync-state"><i /> Saved in this browser</span>}
            <button className="avatar" aria-label="Storage information" onClick={() => setProfileOpen(true)}>{initials(profileName || user?.email || "Guest")}</button>
          </div>
        </header>

        {addOpen ? (
          <div className="page-content course-page-content">
            <header className="course-page-heading">
              <button className="back-button" type="button" onClick={showSchedule}>← My week</button>
              <div>
                <p>COURSE STUDIO</p>
                <h1>{editingCourseId ? "Edit course" : selectedDraftId ? "Review imported course" : "Add a course"}</h1>
                <span>Build one clean course draft, then place it on your week.</span>
              </div>
              {!editingCourseId && <button className="secondary-button" type="button" onClick={openCourseForm}>＋ Blank course</button>}
            </header>

            {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}

            <section className="course-editor-card" aria-labelledby="course-editor-title">
              <div className="editor-card-header">
                <div>
                  <span className="editor-step">1</span>
                  <div>
                    <p>{editingCourseId ? "SCHEDULE COURSE" : selectedDraftId ? "DOCUMENT DRAFT" : "MANUAL COURSE"}</p>
                    <h2 id="course-editor-title">{form.name || "Course details"}</h2>
                  </div>
                </div>
                {selectedDraftId && <span className="review-pill">Review before adding</span>}
              </div>
              <form className="course-page-form" onSubmit={saveCourse}>
                <label className="field full course-name-field">
                  <span>Course name</span>
                  <input required role="combobox" autoComplete="off" {...languageProps(form.name)} value={form.name} onFocus={() => setCourseNameFocused(true)} onBlur={() => setCourseNameFocused(false)} onChange={(event) => { setForm({ ...form, name: event.target.value, ...catalogFields({}) }); setSelectedDraftId(null); }} placeholder="e.g. Advanced Programming" aria-autocomplete="list" aria-controls="imported-course-suggestions" aria-expanded={courseNameFocused && courseNameSuggestions.length > 0} />
                  {courseNameFocused && courseNameSuggestions.length > 0 && (
                    <div className="course-suggestions" id="imported-course-suggestions" role="listbox" aria-label="Imported course suggestions">
                      <div className="suggestion-heading"><span>✦</span><div><strong>Found in your PDF</strong><small>{courseNameSuggestions.length} smart {courseNameSuggestions.length === 1 ? "match" : "matches"}</small></div></div>
                      {courseNameSuggestions.map((course) => (
                        <button type="button" role="option" aria-selected={selectedDraftId === course.id} key={course.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { selectImportedCourse(course); setCourseNameFocused(false); }}>
                          <i className={`suggestion-swatch ${course.color}`} />
                          <span><strong {...languageProps(course.name)}>{course.name}</strong><small>{[course.instructor || course.type || "Imported course", course.section ? `Group ${course.section}` : "", course.startTime && course.endTime ? `${course.startTime}–${course.endTime}` : ""].filter(Boolean).join(" · ")}</small></span>
                          <b>Use draft →</b>
                        </button>
                      ))}
                    </div>
                  )}
                </label>
                <div className="full" aria-live="polite">
                  <p>{form.units == null ? "Units unknown" : `${form.units} units`}</p>
                  {form.prerequisites != null && <p dir="rtl" lang="fa">پیش نیاز: {form.prerequisites.join("، ") || "ندارد"}</p>}
                  {form.corequisites != null && <p dir="rtl" lang="fa">هم نیاز: {form.corequisites.join("، ") || "ندارد"}</p>}
                  {form.requirementNotes && <p dir="rtl" lang="fa">{form.requirementNotes}</p>}
                </div>
                <label className="field full"><span>Instructor <i>optional</i></span><input {...languageProps(form.instructor)} value={form.instructor} onChange={(event) => setForm({ ...form, instructor: event.target.value })} placeholder="e.g. Dr. Rahimi" /></label>
                <div className="form-grid full">
                  <BoundedTimeField label="Starts at" value={form.startTime} onChange={(startTime) => setForm({ ...form, startTime })} />
                  <BoundedTimeField label="Ends at" value={form.endTime} onChange={(endTime) => setForm({ ...form, endTime })} />
                </div>
                <fieldset className="day-picker full"><legend>Meets on</legend><div>{DAYS.map((day) => <button type="button" className={form.days.includes(day) ? "selected" : ""} onClick={() => toggleDay(day)} key={day}>{day.slice(0, 3)}</button>)}</div></fieldset>
                <div className="full"><PersianExamDateTime value={form.examDate} onChange={(examDate) => setForm({ ...form, examDate })} /></div>
                <label className="field full"><span>Category <i>optional</i></span><select value={form.type} onChange={(event) => { const type = event.target.value as CourseType; setForm({ ...form, type, trackName: type === "Track" ? form.trackName : "", color: defaultColorForType(type) }); }}><option value="">Not specified</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
                {form.type === "Track" && <label className="field full"><span>Track name <i>optional</i></span><input {...languageProps(form.trackName)} value={form.trackName} onChange={(event) => setForm({ ...form, trackName: event.target.value })} placeholder="e.g. Software, Hardware, AI" /></label>}
                <fieldset className="card-color-picker full"><legend>Card color</legend><div>{CARD_COLORS.map((option) => <button type="button" className={`${option.value} ${form.color === option.value ? "selected" : ""}`} aria-pressed={form.color === option.value} onClick={() => setForm({ ...form, color: option.value })} key={option.value}><i />{option.label}<span>{form.color === option.value ? "✓" : ""}</span></button>)}</div></fieldset>
                {courses.some((course) => course.id !== editingCourseId && sameSlot(course, form)) && <p className="plan-b-note full"><span>↻</span>This exact slot will become Plan B.</p>}
                {selectedDraftId && !form.examDate && <p className="completion-note full"><span>!</span>The source did not include an exam date. Complete it before adding this course.</p>}
                {error && <div className="inline-error full" role="alert"><b>!</b><span>{error}</span></div>}
                {!user && <p className="guest-note full">Saved automatically in this browser. Sign in only if you want to sync across devices.</p>}
                <button className="submit-button full" disabled={saving}>{saving ? "Saving…" : editingCourseId ? "Save changes" : "Add to schedule"} <span>→</span></button>
              </form>
            </section>

            {!editingCourseId && (
              <section className="import-library" aria-labelledby="imported-courses-title">
                <div className="import-head">
                  <div>
                    <span className="editor-step">2</span>
                    <div><p>DOCUMENT VISION</p><h2 id="imported-courses-title">Imported courses</h2></div>
                  </div>
                  <div className="import-actions">
                    {importedCourses.length > 0 && <button type="button" className="text-button" onClick={() => { setImportedCourses([]); setSelectedDraftId(null); setImportWarnings([]); }}>Clear</button>}
                    <button type="button" className="upload-button" onClick={() => importInputRef.current?.click()} disabled={importing}>{importing ? "Reading document…" : "↑ Import timetable PDF"}</button>
                    <input ref={importInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={importCourseDocument} />
                  </div>
                </div>
                {importing && <div className="import-progress" role="status"><i /><span>Reading tables, Persian text, days, and time columns…</span></div>}
                {importError && <div className="inline-error" role="alert"><b>!</b><span>{importError}</span></div>}
                {importWarnings.length > 0 && <div className="import-warnings"><strong>Review notes</strong>{importWarnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>}
                {importedCourses.length > 0 ? (
                  <div className="imported-day-groups">
                    {importedCourseGroups.map((group) => (
                      <section className="imported-day-group" key={group.day ?? "unknown"}>
                        <header><span lang="fa" dir="rtl">{group.day ? PERSIAN_DAYS[group.day] : "روز نامشخص"}</span><p>{group.courses.length} {group.courses.length === 1 ? "course" : "courses"}</p></header>
                        <div className="draft-grid">
                          {group.courses.map((course) => (
                            <button type="button" className={`draft-card ${selectedDraftId === course.id ? "selected" : ""}`} onClick={() => selectImportedCourse(course)} key={course.id} title={course.sourceContext}>
                              <span className="draft-card-top"><i className={`type-mark ${course.color}`} /><small>{course.type || "Uncategorized"}</small><b>{Math.round(course.confidence * 100)}%</b></span>
                              <strong {...languageProps(course.name || "Untitled course")}>{course.name || "Untitled course"}</strong>
                              <span className="draft-meta"><bdi className="persian-text" dir="rtl" lang="fa">{course.days.length ? formatPersianDays(course.days) : "روز نامشخص"}</bdi><i>·</i><bdi dir="ltr">{course.startTime && course.endTime ? `${course.startTime}–${course.endTime}` : "Time missing"}</bdi></span>
                              {(course.instructor || course.section) && <span className={`draft-source ${hasPersian(course.instructor) ? "persian-text" : ""}`} dir={hasPersian(course.instructor) ? "rtl" : "ltr"} lang={hasPersian(course.instructor) ? "fa" : "en"}>{course.instructor}{course.instructor && course.section ? " · " : ""}{course.section ? `Group ${course.section}` : ""}</span>}
                              <span className="draft-card-foot"><span>{course.units == null ? "Units unknown" : `${course.units} units`}</span><small>{course.missingFields.length ? `${course.missingFields.length} fields need review` : "Ready to review"}</small><b>Open →</b></span>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : !importing && !importError && (
                  <button type="button" className="empty-import" onClick={() => importInputRef.current?.click()}>
                    <span>⌁</span><strong>Drop in a course document</strong><small>We’ll turn each detected row into an editable draft.</small>
                  </button>
                )}
              </section>
            )}
          </div>
        ) : examOpen ? (
          <div className="page-content exams-page-content">
            <header className="course-page-heading exams-page-heading">
              <button className="back-button" type="button" onClick={showSchedule}>← My week</button>
              <div>
                <p>EXAM MAP</p>
                <h1>Exam timeline</h1>
                <span>Your exams in Persian-calendar order, all in one calm view.</span>
              </div>
              <button className="primary-button" type="button" onClick={openCourseForm}>＋ New course</button>
            </header>

            <div className="exam-overview">
              <article><span className="exam-overview-icon">⌁</span><div><small>TOTAL</small><strong>{exams.length} {exams.length === 1 ? "exam" : "exams"}</strong></div></article>
              <article className="exam-overview-next">
                {nextExam ? <><span className={`exam-overview-date ${nextExam.color}`}>{formatPersianShortDate(nextExam.examDate)}</span><div><small>UP NEXT</small><strong {...languageProps(nextExam.name)}>{nextExam.name}</strong><span dir="ltr">{formatExamWeekday(nextExam.examDate)} · {formatExamTime(nextExam.examDate)}</span></div></> : <div><small>UP NEXT</small><strong>No exam scheduled</strong></div>}
              </article>
              <article><span className="exam-overview-icon calm">✓</span><div><small>ORDER</small><strong>Conflict-free</strong></div></article>
            </div>

            <ExamTimeline courses={exams} onEdit={openEditForm} onAdd={openCourseForm} />
          </div>
        ) : (
        <div className="page-content">
          <div className="page-heading">
            <div>
              <h1>My week</h1>
              <span className="heading-count">{courses.length} {courses.length === 1 ? "course" : "courses"}{planBCount ? ` · ${planBCount} Plan B` : ""}</span>
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
            <article className="insight-card"><span className="insight-icon mint">✓</span><div><strong>{planBCount ? `${planBCount} backup ${planBCount === 1 ? "plan" : "plans"}` : "Everything fits"}</strong></div></article>
            <button type="button" className="next-exam" onClick={showExamTimeline}>
              {nextExam ? <><span className="exam-date"><b>{formatPersianDateParts(nextExam.examDate).day}</b><small>{formatPersianDateParts(nextExam.examDate).month}</small></span><div><small>UP NEXT</small><strong className="mixed-line"><bdi {...languageProps(nextExam.name)}>{nextExam.name}</bdi><span dir="ltr">· {formatExamTime(nextExam.examDate)}</span></strong></div><span>→</span></> : <><span className="exam-date"><b>—</b><small>EXAM</small></span><div><strong>No exams scheduled</strong></div></>}
            </button>
          </div>

          <section className="schedule-card" aria-label="Weekly course schedule">
            <div className="schedule-toolbar">
              <div><h2>This week</h2><p>07:00–18:00</p></div>
              <div className="legend"><span><i className="dot blue-dot" /> Blue</span><span><i className="dot mint-dot" /> Green</span><span><i className="dot amber-dot" /> Amber</span><span><i className="dot rose-dot" /> Rose</span></div>
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
                    {courseGroups.filter((group) => group.courses[0].days.includes(day)).map((group) => {
                      const primary = group.courses[0];
                      const alternative = group.courses[1];
                      const cardKey = `${day}:${group.key}`;
                      const isFlipped = flippedGroups.includes(group.key);
                      const cardLabel = alternative
                        ? `${primary.name}, Plan A. ${alternative.name}, Plan B. Click to flip.`
                        : `${primary.name}, ${primary.startTime} to ${primary.endTime}.`;
                      const cardStyle = { left: `${((18 - timeNumber(primary.endTime)) / 11) * 100}%`, width: `${((timeNumber(primary.endTime) - timeNumber(primary.startTime)) / 11) * 100}%` };
                      if (!alternative) {
                        return (
                          <article className="course-block static-course" key={cardKey} style={cardStyle} aria-label={cardLabel}>
                            <CourseCardFace course={primary} onEdit={openEditForm} onRemove={removeCourse} />
                          </article>
                        );
                      }
                      return (
                        <div
                          className={`course-block has-alternative stack-front-${primary.color} stack-back-${alternative.color} ${isFlipped ? "is-flipped" : ""}`}
                          key={cardKey}
                          style={cardStyle}
                          role="button"
                          tabIndex={0}
                          aria-label={cardLabel}
                          aria-pressed={isFlipped}
                          onClick={(event) => {
                            if ((event.target as Element).closest(".course-card-actions")) return;
                            toggleCard(group.key);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleCard(group.key);
                            }
                          }}
                        >
                          <div className="course-card-inner">
                            <CourseCardFace course={primary} label="PLAN A" flippable onEdit={openEditForm} onRemove={removeCourse} />
                            <CourseCardFace course={alternative} label="PLAN B" flippable back onEdit={openEditForm} onRemove={removeCourse} />
                          </div>
                        </div>
                      );
                    })}
                    <strong className="day-name">{day}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="schedule-footer"><span><i className="pulse" /> {planBCount ? "Click a Plan A card to flip" : "Schedule looks clear"}</span><button onClick={openCourseForm}>＋ New course</button></div>
          </section>

          <section className="exam-strip">
            <div><span className="section-icon">⌁</span><div><h2>Exams</h2><button type="button" className="exam-strip-link" onClick={showExamTimeline}>View timeline →</button></div></div>
            <div className="exam-list">
              {exams.slice(0, 4).map((course) => (
                <article key={course.id}><span className={`exam-chip ${course.color}`}>{formatPersianShortDate(course.examDate)}</span><div><strong {...languageProps(course.name)}>{course.name}</strong><small dir="ltr">{formatExamTime(course.examDate)}</small></div></article>
              ))}
              {!exams.length && <p className="empty-note">Your exams will appear here after you add an exam date.</p>}
            </div>
          </section>
          <ExamTimeline courses={exams} onEdit={openEditForm} onAdd={openCourseForm} exportOnly />
        </div>
        )}
      </section>

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="modal-header"><div><p>PROFILE</p><h2 id="profile-title">{user ? "Your profile" : "Save your plan"}</h2></div><button onClick={() => setProfileOpen(false)} aria-label="Close">×</button></div>
            {user ? <form onSubmit={saveProfile}><div className="profile-hero"><span>{initials(profileName || user.email)}</span><div><strong {...languageProps(profileName || user.displayName)}>{profileName || user.displayName}</strong><small>{user.email}</small></div></div><label className="field full"><span>Display name</span><input {...languageProps(profileName)} value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label className="field full"><span>Study focus</span><input {...languageProps(majorFocus)} value={majorFocus} onChange={(event) => setMajorFocus(event.target.value)} placeholder="e.g. Artificial Intelligence" /></label><p className="guest-note">This can shape future course suggestions.</p><button className="submit-button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></form> : <div className="signin-panel"><div className="signin-orb"><BrandLogo /></div><p>Your plan is stored locally in this browser on this device. No Cloudflare or third-party sign-in service sits between you and this server.</p><button className="submit-button" onClick={() => setProfileOpen(false)}>Keep planning <span>→</span></button></div>}
          </section>
        </div>
      )}
    </main>
  );
}

function ExamTimeline({ courses, onEdit, onAdd, exportOnly = false }: {
  courses: Course[];
  onEdit: (course: Course) => void;
  onAdd: () => void;
  exportOnly?: boolean;
}) {
  return (
    <section className={`exam-timeline-panel ${exportOnly ? "export-exam-timeline" : ""}`} aria-label="Exam timeline">
      <header className="exam-timeline-header">
        <div><span>⌁</span><div><p>CHRONOLOGICAL VIEW</p><h2>Exam timeline</h2></div></div>
        <p>{courses.length ? "Persian dates · earliest exam first" : "No exam dates yet"}</p>
      </header>

      {courses.length ? (
        <div className="exam-timeline-list">
          {courses.map((course, index) => {
            const gap = index ? examDayGap(courses[index - 1].examDate, course.examDate) : null;
            return (
              <article className="exam-timeline-row" key={course.id}>
                <div className="exam-timeline-rail"><i className={course.color} /></div>
                <div className="exam-timeline-date">
                  <strong>{formatPersianShortDate(course.examDate)}</strong>
                  <span>{formatPersianYear(course.examDate)}</span>
                  <small>{formatExamWeekday(course.examDate)}</small>
                </div>
                <div className="exam-timeline-card">
                  <div className="exam-timeline-copy">
                    <span className={`exam-category ${course.color}`}>{course.type || "Course"}{course.trackName ? ` · ${course.trackName}` : ""}</span>
                    <strong {...languageProps(course.name)}>{course.name}</strong>
                    <small>{course.days.join(" · ")} classes</small>
                  </div>
                  <div className="exam-timeline-time"><small>STARTS AT</small><strong dir="ltr">{formatExamTime(course.examDate)}</strong></div>
                  {!exportOnly && <button type="button" onClick={() => onEdit(course)} aria-label={`Edit ${course.name}`}>Edit</button>}
                </div>
                {gap !== null && <span className="exam-gap">{gap === 0 ? "Same day" : `${gap} ${gap === 1 ? "day" : "days"} later`}</span>}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-exam-timeline"><span>⌁</span><strong>No exams to map yet</strong><p>Add a course and its Persian exam date will appear here automatically.</p>{!exportOnly && <button type="button" className="primary-button" onClick={onAdd}>＋ Add a course</button>}</div>
      )}
    </section>
  );
}

function BrandLogo() {
  // A plain image keeps this user-replaceable asset independent of any host-side image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brand-logo-image" src={BRAND_LOGO_SRC} alt="" aria-hidden="true" />;
}

function CourseCardFace({ course, label = "", flippable = false, back = false, onEdit, onRemove }: {
  course: Course;
  label?: string;
  flippable?: boolean;
  back?: boolean;
  onEdit: (course: Course) => void;
  onRemove: (course: Course) => void | Promise<void>;
}) {
  const isPersian = hasPersian(course.name) || hasPersian(course.instructor) || hasPersian(course.trackName);
  return (
    <div className={`course-card-face ${back ? "course-card-back" : "course-card-front"} ${course.color} ${isPersian ? "persian-card" : ""}`} dir={isPersian ? "rtl" : "ltr"}>
      {label && <em className="plan-label">{label}{flippable && <span>↻</span>}</em>}
      <div className="course-card-copy">
        <strong {...languageProps(course.name)}>{course.name}</strong>
        {course.instructor && <small className="course-instructor" {...languageProps(course.instructor)}>{course.instructor}</small>}
        <span className={`course-meta ${isPersian ? "persian-meta" : ""}`}>
          {course.trackName && <><bdi {...languageProps(course.trackName)}>{course.trackName}</bdi><i aria-hidden="true">·</i></>}
          {course.units != null && <span dir="ltr">{course.units} units · </span>}
          <span dir="ltr">{course.startTime}–{course.endTime}</span>
        </span>
      </div>
      <CourseCardActions course={course} onEdit={onEdit} onRemove={onRemove} />
    </div>
  );
}

function CourseCardActions({ course, onEdit, onRemove }: {
  course: Course;
  onEdit: (course: Course) => void;
  onRemove: (course: Course) => void | Promise<void>;
}) {
  return (
    <div className="course-card-actions">
      <button type="button" onClick={() => onEdit(course)} aria-label={`Edit ${course.name}`}>✎</button>
      <button className="remove-course-button" type="button" onClick={() => void onRemove(course)} aria-label={`Remove ${course.name}`}>×</button>
    </div>
  );
}

function BoundedTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [hourValue = "07", minuteValue = "00"] = value.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const minuteOptions = hour === 18 ? [0] : [0, 15, 30, 45];
  const pickerMinute = minuteOptions.includes(minute) ? minute : 0;

  function setHour(nextHour: number) {
    const nextMinute = nextHour === 18 ? 0 : pickerMinute;
    onChange(`${pad(nextHour)}:${pad(nextMinute)}`);
  }

  return (
    <div className="field time-field">
      <span>{label}</span>
      <div className="time-picker">
        <label><small>Hour</small><select aria-label={`${label} hour`} value={hour} onChange={(event) => setHour(Number(event.target.value))}>{HOURS.map((item) => <option key={item} value={item}>{pad(item)}</option>)}</select></label>
        <b>:</b>
        <label><small>Minute</small><select aria-label={`${label} minute`} value={pickerMinute} onChange={(event) => onChange(`${pad(hour)}:${pad(Number(event.target.value))}`)}>{minuteOptions.map((item) => <option key={item} value={item}>{pad(item)}</option>)}</select></label>
      </div>
    </div>
  );
}

function PersianExamDateTime({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  if (!value) {
    return (
      <div className="persian-exam missing-exam">
        <span>Exam date · Persian</span>
        <div><strong>No exam date found</strong><small>Set it before adding this course to the schedule.</small></div>
        <button type="button" onClick={() => onChange(defaultExamDate())}>＋ Add exam date and time</button>
      </div>
    );
  }
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

function validateCourse(form: CourseForm, courses: Course[], editingCourseId: string | null = null) {
  if (!form.name.trim()) return "Give the course a name.";
  if (!form.days.length) return "Choose at least one weekday.";
  if (!form.examDate) return "Add the exam date and time before saving this course.";
  const start = timeNumber(form.startTime), end = timeNumber(form.endTime);
  if (start < 7 || end > 18 || end <= start) return "Class time must sit between 07:00 and 18:00, with the end after the start.";
  const otherCourses = courses.filter((course) => course.id !== editingCourseId);
  const exactSlotCourses = otherCourses.filter((course) => sameSlot(course, form));
  if (exactSlotCourses.length >= 2) return "This time already has Plan A and Plan B. Edit one of them before adding another backup.";
  const overlapping = otherCourses.find((course) =>
    !sameSlot(course, form) &&
    course.days.some((day) => form.days.includes(day)) &&
    start < timeNumber(course.endTime) &&
    end > timeNumber(course.startTime)
  );
  if (overlapping) return `Schedule conflict with ${overlapping.name}. Use the exact same days and time to make a Plan B; adjacent classes are also okay.`;
  const examConflict = otherCourses.find((course) => normalizeDate(course.examDate) === normalizeDate(form.examDate));
  if (examConflict) return `Exam conflict with ${examConflict.name} on ${formatExamDate(form.examDate)}. This course wasn’t saved.`;
  return "";
}

function groupCourses(courses: Course[]): CourseGroup[] {
  const groups = new Map<string, Course[]>();
  courses.forEach((course) => {
    const key = courseSlotKey(course);
    groups.set(key, [...(groups.get(key) ?? []), course]);
  });
  return [...groups.entries()].map(([key, groupedCourses]) => ({ key, courses: groupedCourses }));
}

function sameSlot(left: Course | CourseForm, right: Course | CourseForm) {
  return courseSlotKey(left) === courseSlotKey(right);
}

function courseSlotKey(course: Course | CourseForm) {
  const days = DAYS.filter((day) => course.days.includes(day)).join(",");
  return `${course.startTime}|${course.endTime}|${days}`;
}

function hasPersian(value: string) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(value);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[\u200C\u200D]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function languageProps(value: string): { className?: string; dir: "rtl" | "ltr"; lang: "fa" | "en" } {
  return hasPersian(value)
    ? { className: "persian-text", dir: "rtl", lang: "fa" }
    : { dir: "ltr", lang: "en" };
}

function timeNumber(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours + minutes / 60;
}
function defaultColorForType(type: CourseType): CourseColor {
  if (type === "General") return "mint";
  if (type === "Track") return "amber";
  if (type === "Elective courses") return "rose";
  return "blue";
}
function normalizeDate(value: string) { return value.slice(0, 16); }
function formatExamDate(value: string) { return `${formatPersianShortDate(value)} · ${formatExamTime(value)}`; }
function formatExamTime(value: string) { return value.slice(11, 16); }
function formatExamWeekday(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(year, month - 1, day));
}
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
function formatPersianYear(value: string) {
  const [gy, gm, gd] = value.slice(0, 10).split("-").map(Number);
  return String(toJalaali(gy, gm, gd).jy);
}
function formatPersianFullDate(value: string) {
  return `${formatPersianShortDate(value)} ${formatPersianYear(value)}`;
}
function sortedExamCourses(courses: Course[]) {
  return courses.filter((course) => course.examDate).slice().sort((left, right) => left.examDate.localeCompare(right.examDate));
}
function groupImportedCourses(courses: ImportedCourseDraft[]) {
  const groups = new Map<Day | null, ImportedCourseDraft[]>();
  courses.forEach((course) => {
    const firstDay = DAYS.find((day) => course.days.includes(day)) ?? null;
    groups.set(firstDay, [...(groups.get(firstDay) ?? []), course]);
  });
  const orderedKeys: (Day | null)[] = [...DAYS, null];
  return orderedKeys.flatMap((day) => {
    const groupedCourses = groups.get(day);
    if (!groupedCourses?.length) return [];
    return [{
      day,
      courses: groupedCourses.slice().sort((left, right) => left.startTime.localeCompare(right.startTime) || left.name.localeCompare(right.name, "fa")),
    }];
  });
}
function formatPersianDays(days: Day[]) {
  return DAYS.filter((day) => days.includes(day)).map((day) => PERSIAN_DAYS[day]).join(" / ");
}
function examDayGap(left: string, right: string) {
  const [leftYear, leftMonth, leftDay] = left.slice(0, 10).split("-").map(Number);
  const [rightYear, rightMonth, rightDay] = right.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(rightYear, rightMonth - 1, rightDay) - Date.UTC(leftYear, leftMonth - 1, leftDay)) / 86_400_000);
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
