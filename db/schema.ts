import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  majorFocus: text("major_focus").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  days: text("days").notNull(),
  examDate: text("exam_date").notNull(),
  type: text("type").notNull().default(""),
  trackName: text("track_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_courses_user_id").on(table.userId),
]);
