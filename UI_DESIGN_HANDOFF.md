# UniPlan — UI/UX Design Handoff

## 1. Product summary

UniPlan is a weekly course-planning website for university students. Its main purpose is to help a student build a conflict-free semester schedule, understand how classes occupy the week, keep track of exams, and compare one backup course plan against another.

The product opens directly on the planner. There is no landing page, marketing page, or required sign-in step.

Students can:

- add courses manually;
- import course offerings from the university's fixed-format Persian timetable PDF;
- review and correct imported information before adding it;
- see courses placed proportionally on a weekly time grid;
- add one alternative course in the exact same slot as a Plan B;
- flip between Plan A and Plan B from the timetable;
- edit or remove any saved course;
- view all exams on a separate chronological timeline;
- export the weekly schedule and exam timeline together as PDF or PNG;
- use the website in light or dark mode;
- continue without an account using local browser storage; or
- sign in optionally to synchronize saved data.

The interface is bilingual in practice: most application controls are currently English, while course names, instructor names, track names, PDF content, and Persian calendar dates may be Persian. Mixed English/Persian content is therefore a normal state, not an edge case.

## 2. Intended users

The primary user is a university student planning a semester from a large list of available courses. The user may be:

- comparing several possible schedules;
- working from a Persian university timetable;
- using the site on a laptop while registration is open;
- checking the schedule later on a phone;
- signed in or completely anonymous; and
- entering course information in either Persian or English.

The experience should feel like a focused planning tool, not a general university portal or a marketing dashboard.

## 3. Information architecture

The product currently has three main full-page views and one profile dialog. These views live inside the same application shell rather than separate browser routes.

1. **My Week** — the default weekly schedule.
2. **Course Studio** — add, edit, review, and import courses.
3. **Exam Timeline** — chronological exam planning.
4. **Profile / Save Your Plan dialog** — optional sign-in and profile editing.

### Global application shell

On desktop, the application has:

- a narrow navigation rail on the left;
- the UniPlan logo at the top of the rail;
- three navigation actions: weekly schedule, add course, and exam timeline;
- a help icon at the bottom (the help flow is not implemented yet);
- a sticky top bar containing the logo/wordmark, theme switch, synchronization state or sign-in action, and profile avatar; and
- the active page filling the remaining space.

On smaller screens, the left navigation becomes a fixed bottom navigation bar. The top bar remains visible, but secondary actions may be simplified.

## 4. Core course data

Every saved course contains the following information:

| Field | Required | Notes |
| --- | --- | --- |
| Course name | Yes | Persian or English. |
| Instructor | No | Persian or English; imported from the PDF when available. |
| Start time | Yes | Between 07:00 and 18:00. |
| End time | Yes | Between 07:00 and 18:00 and later than the start time. |
| Class days | Yes | One or more of Saturday, Sunday, Monday, Tuesday, Wednesday. |
| Exam date | Yes before saving | Selected and displayed using the Persian calendar. |
| Exam time | Yes before saving | Uses the same bounded time-control pattern. |
| Course category | No | General, Major requirements, Track, or Elective courses. |
| Track name | No | Appears only when the category is Track; examples include Software, Hardware, and AI. |
| Card color | Yes, with a default | Blue, green/mint, amber, or rose. Users can override the suggested color. |

Imported drafts may additionally contain a section/group number, parser confidence, missing-field list, and source context. These are review aids and do not all need to appear on the final timetable card.

## 5. Page 1 — My Week

### Purpose

This is the default and most important view. It gives the student an immediate visual understanding of the current plan and provides fast access to adding, editing, removing, flipping, and exporting courses.

### Page header

The header contains:

- the title **My week**;
- total course count;
- Plan B count when alternatives exist;
- an **Export** menu; and
- a primary **New course** action.

Below the header is a compact overview area showing:

- total weekly class hours, counting a Plan A/Plan B slot once;
- whether the plan fits or how many backup plans exist; and
- the next exam, which opens the exam timeline when selected.

### Weekly schedule geometry

The schedule is a five-row horizontal timetable.

- Days run vertically from **Saturday** at the top to **Wednesday** at the bottom.
- Day names occupy a fixed column on the **right side** of the table.
- Time runs horizontally from **07:00 on the right** to **18:00 on the left**.
- Every full hour has a visible grid line.
- Every half hour has a quieter/dashed guide line.
- A course card's horizontal position represents its start and end time.
- A course card's width represents its real duration, including half-hour and irregular minute values.
- Rows should remain compact; the schedule should not feel vertically oversized.
- On narrow viewports, the schedule may scroll horizontally rather than destroying the time scale.

Text-only layout reference:

```text
18:00  17:00  16:00  ...  09:00  08:00  07:00  | DAY
------------------------------------------------------
        [course]             [course]             | Saturday
                             [course]             | Sunday
        [course]             [course]             | Monday
                             [course]             | Tuesday
                                                  | Wednesday
```

### Course cards

A normal course card should show, in this order:

1. course name;
2. instructor name, when available; and
3. optional track name plus class time.

The title is the strongest line, but it should not use unnecessarily heavy typography. Long names may wrap to two compact lines. The instructor and time are secondary but must remain legible.

Card color is user-selectable from four choices. Color must work in both light and dark themes and should not be used as the only way to communicate state.

Each card has edit and remove actions. These can become visible on hover/focus on desktop but must remain discoverable and usable on touch devices.

### Persian and RTL behavior

- Persian course and instructor text uses **XB Niloofar**.
- A Persian card is right-to-left as a whole, not only at the individual text-span level.
- Persian titles align to the right edge and use the full card width.
- Ellipsis or wrapping must behave correctly for RTL text.
- Times always remain left-to-right, for example `09:15–10:45`.
- Mixed Persian and English fragments must not reorder unexpectedly.

### Plan B behavior

A student may add one alternative course only when it uses the **exact same start time, end time, and complete set of weekdays** as an existing course. That alternative becomes Plan B.

- Only one card stack occupies the timetable slot; Plan A and Plan B must not appear as two colliding cards.
- At rest, the alternative is hidden behind the visible card.
- On hover/focus, the back card rotates slightly into view to signal that another plan exists.
- Clicking or pressing Enter/Space flips the stack with a smooth 3D animation.
- The visible face is labelled Plan A or Plan B.
- If the course appears on more than one weekday, flipping any occurrence flips every occurrence belonging to that same course slot. For example, flipping Saturday also flips Monday.
- Edit and remove actions belong to the currently visible course face and must not accidentally trigger the flip.

### Exam preview

Below the timetable is a compact exam strip showing up to four upcoming exams with:

- Persian short date;
- course name; and
- exam time.

It includes a **View timeline** action leading to the full Exam Timeline page.

### Export behavior

The Export menu contains:

- **PDF** — opens the browser print/save flow. The weekly timetable prints first, and the complete exam timeline is appended below it, normally beginning on a new page.
- **PNG** — downloads one generated image containing the weekly timetable followed by the exam timeline.

Exported output must preserve course colors, Persian text, instructor names, dates, and the right-to-left schedule direction.

## 6. Page 2 — Course Studio

### Purpose

This page handles all course creation and editing. It is deliberately a full page rather than a popup because it combines a detailed form with a potentially large imported-course library.

The same upper editor is reused for three states:

1. adding a blank course;
2. editing an existing course; and
3. reviewing one imported course draft.

Only one course is edited in the upper section at a time.

### Page header

The header contains:

- a back action to **My Week**;
- a contextual title: **Add a course**, **Edit course**, or **Review imported course**; and
- a **Blank course** action when the user is not editing an existing course.

### Course editor fields

The editor presents:

1. Course name.
2. Instructor name, optional.
3. Start time.
4. End time.
5. Weekday multi-select.
6. Persian exam date.
7. Exam time.
8. Category, optional.
9. Track name, conditionally shown when Track is selected.
10. Card color.
11. Validation, conflict, and persistence messages.
12. Primary **Add to schedule** or **Save changes** action.

### Time controls

Class and exam times use bounded selectors, not typing-only inputs.

- Hour options run from 07 through 18.
- Minute options run from 00 through 59.
- Selectors stop at their first and last values; they never loop from 59 to 00 or 18 back to 07.
- When hour 18 is selected, the only valid minute is 00.
- AM/PM is not displayed because the interface uses 24-hour time.

### Persian exam-date control

The exam date is entered using Persian year, month, and day selectors. Persian month names are shown. The control internally handles conversion, but the user should experience it as a Persian-calendar date picker.

If an imported course has no exam date, the editor clearly states that the date is missing and asks the student to complete it before saving.

### Validation and conflict rules

- A name, at least one class day, valid class times, and an exam date/time are required.
- Classes must stay between 07:00 and 18:00.
- The end must be later than the start.
- Adjacent courses are allowed. For example, `13:30–15:00` and `15:00–16:30` do not conflict.
- Partially overlapping courses are rejected.
- An exact match of all days and class times is accepted as Plan B.
- A slot may contain at most Plan A and Plan B; a third course in the same slot is rejected.
- Two courses may not have the same exam date and time. A clear error names the conflicting course, and the new/edited course is not saved.

### PDF import library

The lower section of this page is the imported-course library.

The user uploads the university's known, fixed-format PDF timetable. The current extractor:

- runs through a local/private Python document service;
- reads the PDF text layer and table geometry;
- repairs visually stored Persian RTL text;
- does not use OpenAI or another paid vision API;
- does not require an API key; and
- does not automatically add extracted courses to the schedule.

The page needs clear states for:

- no imported document;
- empty file-selection prompt;
- parsing in progress;
- parsing failure;
- parser warnings;
- successfully imported courses; and
- an imported draft selected for review.

Each imported draft card may show:

- category/color marker;
- confidence percentage;
- course name;
- Persian weekday combination;
- class time;
- instructor;
- section/group;
- number of fields needing review; and
- an action indicating that the draft can be opened.

Imported courses are grouped by the first weekday on which they occur and then sorted by start time. The groups appear in this order:

1. شنبه / Saturday;
2. یکشنبه / Sunday;
3. دوشنبه / Monday;
4. سه‌شنبه / Tuesday;
5. چهارشنبه / Wednesday; and
6. unknown day, if needed.

Therefore, a Saturday/Monday course appears in the Saturday group, while a Sunday/Tuesday course appears in the Sunday group.

Selecting a draft fills the upper editor with all extracted information. The student can correct or complete it, then explicitly add it to the schedule. After a selected draft is successfully added, it disappears from the pending imported list.

## 7. Page 3 — Exam Timeline

### Purpose

This page separates exam planning from weekly class planning. It answers: “What exams do I have, in what order, and how much time is between them?”

### Page header and overview

The header contains:

- a back action to My Week;
- the title **Exam timeline**;
- supporting text; and
- a **New course** action.

An overview row summarizes:

- total exam count;
- the next exam; and
- a conflict-free status.

### Timeline list

Exams are sorted chronologically, earliest first. Each timeline item contains:

- a color marker connected to a vertical timeline rail;
- Persian short date and Persian year;
- weekday;
- course category and optional track;
- course name;
- the weekdays on which the course meets;
- exam start time; and
- an Edit action that opens the Course Studio for that course.

Between entries, a small label communicates the number of days until the next exam, including **Same day** when appropriate.

The empty state explains that exams will appear after a course is added and provides an Add Course action.

## 8. Profile and persistence dialog

The round avatar in the upper-right corner opens the profile dialog. There is no separate account button in the left navigation.

### Guest state

The dialog explains that:

- the plan is already saved in the current browser; and
- sign-in is only needed to synchronize across devices.

It offers **Sign in with ChatGPT** and **Keep planning** actions.

Guest data is stored in the browser, including courses, the current form, imported drafts, selected draft, and relevant review state.

### Signed-in state

The dialog shows:

- avatar/initials;
- display name;
- email;
- editable display name;
- editable study focus or concentration; and
- sign-out action.

Signed-in course and profile data are stored in the application's database and loaded on future visits.

Sign-in must remain optional. The primary planning flow must never be hidden behind authentication.

## 9. Global interaction and state requirements

The redesigned interface should account for:

- empty timetable;
- populated timetable;
- normal course card;
- Plan A/Plan B card stack at rest, hover/focus, and flipped;
- edit/remove controls;
- success toast;
- dismissible error alert;
- form validation error;
- schedule conflict;
- exam conflict;
- saved locally state;
- synchronized state;
- light theme;
- dark theme;
- PDF-import empty, loading, warning, error, and success states;
- no exams; and
- populated exam timeline.

Keyboard users must be able to reach controls, flip Plan B cards with Enter/Space, and see an obvious focus style. Motion should respect reduced-motion preferences.

## 10. Typography and localization requirements

- Persian content uses the locally bundled **XB Niloofar** font.
- Persian direction and alignment are detected from the content, so a course changed from English to Persian immediately becomes RTL.
- Do not assume the entire application must share one direction. English navigation may remain LTR while individual Persian cards, fields, and dates are RTL.
- Controls containing only time values remain LTR.
- Avoid excessive bold typography. Hierarchy should come from size, spacing, color, and grouping as much as weight.
- Text inside timetable cards must remain readable at compact card heights.
- The design must tolerate long Persian course and instructor names without making the schedule unusably tall.

## 11. Responsive behavior

### Desktop

- Left navigation rail and sticky top bar.
- Overview cards in one row when space allows.
- Full timetable visible at a practical laptop width.
- Imported drafts can use a three-column grid.

### Tablet

- Reduced page padding.
- Overview sections may wrap to two columns.
- Imported drafts reduce to two columns.
- Timetable may horizontally scroll while preserving its time geometry.

### Mobile

- Navigation becomes a fixed bottom bar.
- Page actions stack or expand to full width.
- Course form becomes one column.
- Imported drafts become one column.
- Profile behaves like a bottom sheet/full-width modal.
- Exam timeline compresses its date and content columns without losing order.
- Timetable remains horizontally scrollable; cards should not be squeezed into unreadable widths.

## 12. Non-negotiable functional constraints

A visual redesign may change layout, spacing, component shape, iconography, palette, and information hierarchy, but it must preserve these behaviors:

- no landing page;
- direct access to the weekly planner;
- Saturday through Wednesday only;
- day labels on the right side of the timetable;
- 07:00 on the right and 18:00 on the left;
- full-hour and quieter half-hour grid guides;
- proportional course positioning and duration;
- correct Persian font and RTL behavior;
- optional instructor and category fields;
- conditional Track name;
- four selectable card colors;
- exact-slot Plan B support with synchronized flipping across weekdays;
- no partial class overlaps;
- adjacent class times allowed;
- no duplicate exam date/time;
- full course editing and removal;
- PDF import followed by explicit human review;
- imported-course weekday grouping;
- Persian calendar exam input and display;
- combined schedule-and-exam export to PDF and PNG;
- optional sign-in with browser-local planning for guests; and
- both light and dark themes.

## 13. Future product direction

Course categories and profile study focus are intentionally stored for a later recommendation feature. The planned direction is to collect possible courses and suggest a good schedule based on the student's concentration—such as AI, software engineering, or hardware engineering—while solving conflicts and prioritizing major requirements.

This recommendation system is not part of the current interface, but the redesign should avoid making category, track, and study-focus data feel disposable or impossible to extend.

## 14. Design goal

The ideal redesign should make a dense scheduling problem feel calm, trustworthy, and easy to scan. The timetable is the hero of the product. Decorative elements should support time comparison, Plan B discovery, bilingual readability, and quick decision-making rather than compete with them.
