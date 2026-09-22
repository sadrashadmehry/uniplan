/**
 * The one PNG renderer used by the website button and the server's Chromium.
 * Keep helpers inside this function so Playwright can serialize it unchanged.
 * @param {{courseGroups: {courses: {name: string, instructor: string, days: string[], startTime: string, endTime: string, color: string, trackName: string}[]}[], exams: {name: string, color: string, type: string, trackName: string, examDate: string, dateLabel: string, weekdayLabel: string}[], fontUrl?: string}} input
 * @returns {Promise<string>} PNG data URL
 */
export async function renderSchedulePng({ courseGroups, exams, fontUrl = "/fonts/xb-niloofar.ttf" }) {
  const font = new FontFace("XB Niloofar", `url(${fontUrl})`);
  document.fonts.add(await font.load());
  await document.fonts.ready;
  const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
  const HOURS = Array.from({ length: 12 }, (_, i) => i + 7);
  function timeNumber(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours + minutes / 60;
  }
  function hasPersian(value) { return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(value); }
  function exportColor(color) {
    return color === "mint" ? "#168565" : color === "amber" ? "#b77716" : color === "rose" ? "#c64768" : "#315eea";
  }
  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath(); context.roundRect(x, y, width, height, radius);
  }
  function trimCanvasText(context, value, width) {
    if (context.measureText(value).width <= width) return value;
    let trimmed = value;
    while (trimmed.length && context.measureText(`${trimmed}…`).width > width) trimmed = trimmed.slice(0, -1);
    return `${trimmed}…`;
  }
  const canvas = document.createElement("canvas");
  const scale = 2;
  const timelineStartY = 735;
  const timelineRows = Math.max(exams.length, 1);
  const logicalHeight = timelineStartY + 105 + timelineRows * 78 + 46;
  canvas.width = 1400 * scale;
  canvas.height = logicalHeight * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering unavailable");
  context.scale(scale, scale);
  context.fillStyle = "#f4f6fb";
  context.fillRect(0, 0, 1400, logicalHeight);
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
    courseGroups.filter((group) => group.courses[0].days.includes(day)).forEach((group) => {
      const course = group.courses[0];
      const alternative = group.courses[1];
      const blockX = x + ((18 - timeNumber(course.endTime)) / 11) * gridWidth;
      const blockWidth = ((timeNumber(course.endTime) - timeNumber(course.startTime)) / 11) * gridWidth;
      context.fillStyle = exportColor(course.color);
      roundedRect(context, blockX + 3, rowY + 14, Math.max(blockWidth - 6, 25), 76, 12);
      context.fill();
      const courseLabel = alternative ? `A ${course.name} / B ${alternative.name}` : course.name;
      const persianCourseLabel = hasPersian(courseLabel);
      context.fillStyle = "#ffffff";
      context.font = persianCourseLabel ? "400 17px 'XB Niloofar', serif" : "600 13px Arial";
      context.direction = persianCourseLabel ? "rtl" : "ltr";
      context.textAlign = persianCourseLabel ? "right" : "left";
      context.fillText(trimCanvasText(context, courseLabel, blockWidth - 24), persianCourseLabel ? blockX + blockWidth - 15 : blockX + 15, rowY + 45);
      if (course.instructor) {
        const persianInstructor = hasPersian(course.instructor);
        context.font = persianInstructor ? "400 14px 'XB Niloofar', serif" : "11px Arial";
        context.direction = persianInstructor ? "rtl" : "ltr";
        context.textAlign = persianInstructor ? "right" : "left";
        context.globalAlpha = .82;
        context.fillText(trimCanvasText(context, course.instructor, blockWidth - 24), persianInstructor ? blockX + blockWidth - 15 : blockX + 15, rowY + 64);
        context.globalAlpha = 1;
      }
      const courseMeta = `${course.trackName ? `${course.trackName} · ` : ""}${course.startTime}–${course.endTime}`;
      const persianMeta = hasPersian(course.trackName);
      context.font = persianMeta ? "400 14px 'XB Niloofar', serif" : "11px Arial";
      context.direction = persianMeta ? "rtl" : "ltr";
      context.textAlign = persianMeta ? "right" : "left";
      context.fillText(courseMeta, persianMeta ? blockX + blockWidth - 15 : blockX + 15, rowY + (course.instructor ? 82 : 68));
      context.direction = "ltr";
      context.textAlign = "left";
    });
  });
  
  context.fillStyle = "#111a30";
  context.font = "600 28px Arial";
  context.fillText("Exam timeline", 50, timelineStartY + 34);
  context.fillStyle = "#6d7589";
  context.font = "14px Arial";
  context.fillText(`${exams.length} ${exams.length === 1 ? "exam" : "exams"} · Persian calendar`, 50, timelineStartY + 59);
  
  const lineX = 82;
  const firstRowY = timelineStartY + 95;
  context.strokeStyle = "#d7deea";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(lineX, firstRowY + 18);
  context.lineTo(lineX, firstRowY + Math.max(0, timelineRows - 1) * 78 + 18);
  context.stroke();
  
  if (!exams.length) {
    context.fillStyle = "#eef2f9";
    roundedRect(context, 110, firstRowY - 8, 1240, 58, 14);
    context.fill();
    context.fillStyle = "#687187";
    context.font = "15px Arial";
    context.fillText("No exams scheduled yet.", 132, firstRowY + 27);
  }
  
  exams.forEach((course, index) => {
    const rowY = firstRowY + index * 78;
    context.fillStyle = exportColor(course.color);
    context.beginPath();
    context.arc(lineX, rowY + 18, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    roundedRect(context, 110, rowY - 8, 1240, 58, 14);
    context.fill();
    context.strokeStyle = "#dfe5ef";
    context.lineWidth = 1;
    context.stroke();
  
    const dateLabel = course.dateLabel;
    context.fillStyle = exportColor(course.color);
    context.font = "400 17px 'XB Niloofar', serif";
    context.direction = "rtl";
    context.textAlign = "right";
    context.fillText(dateLabel, 298, rowY + 17);
    context.fillStyle = "#687187";
    context.font = "12px Arial";
    context.direction = "ltr";
    context.textAlign = "left";
    context.fillText(course.weekdayLabel, 132, rowY + 36);
  
    const persianName = hasPersian(course.name);
    context.fillStyle = "#111a30";
    context.font = persianName ? "400 20px 'XB Niloofar', serif" : "600 16px Arial";
    context.direction = persianName ? "rtl" : "ltr";
    context.textAlign = persianName ? "right" : "left";
    context.fillText(trimCanvasText(context, course.name, 670), persianName ? 1055 : 340, rowY + 18);
    context.fillStyle = "#687187";
    context.font = "13px Arial";
    context.direction = "ltr";
    context.textAlign = "left";
    context.fillText(`${course.type || "Uncategorized"}${course.trackName ? ` · ${course.trackName}` : ""}`, 340, rowY + 39);
    context.fillStyle = exportColor(course.color);
    context.font = "600 16px Arial";
    context.fillText(course.examDate.slice(11, 16), 1248, rowY + 23);
  });
  context.direction = "ltr";
  context.textAlign = "left";
  return canvas.toDataURL("image/png");
}
