"""Sanity tests for the scheduling engine. Pure stdlib -- no external
services or packages required to run these."""
import unittest

from scheduler.engine import group_raw_courses, solve_schedule


def make_record(name, day, start, end, category="Major requirements", section="1", instructor="Dr. X"):
    return {
        "name": name,
        "days": [day],
        "startTime": start,
        "endTime": end,
        "examDate": None,
        "type": category,
        "trackName": None,
        "instructor": instructor,
        "section": section,
        "sourceContext": f"{name} {section}",
        "confidence": 0.95,
        "missingFields": [],
    }


class SchedulerTests(unittest.TestCase):
    def test_picks_conflict_free_combination_in_unit_range(self):
        raw = [
            make_record("Course A", "Saturday", "08:00", "10:00"),
            make_record("Course B", "Sunday", "08:00", "10:00"),
            make_record("Course C", "Saturday", "08:00", "10:00"),  # conflicts with A
            make_record("Course D", "Monday", "10:00", "12:00"),
            make_record("Course E", "Tuesday", "10:00", "12:00"),
            make_record("Course F", "Wednesday", "08:00", "10:00"),
        ]
        units_map = {
            "Course A": 4, "Course B": 4, "Course C": 4,
            "Course D": 4, "Course E": 4, "Course F": 3,
        }
        courses = group_raw_courses(raw, units_map)
        result = solve_schedule(courses, min_units=16, max_units=19)
        selected_names = {o.course_name for o in result.selected}

        self.assertFalse({"Course A", "Course C"} <= selected_names, "conflicting courses both selected")
        self.assertTrue(16 <= result.total_units <= 19, f"total_units={result.total_units}")

    def test_cannot_return_partial_required_selection(self):
        raw = [make_record("A", "Saturday", "08:00", "10:00"),
               make_record("B", "Saturday", "08:00", "10:00")]
        with self.assertRaises(ValueError):
            solve_schedule(group_raw_courses(raw, {"A": 3, "B": 3}),
                           min_units=3, max_units=3, must_include=["A", "B"])

    def test_unknown_required_course_is_rejected(self):
        with self.assertRaises(ValueError):
            solve_schedule([], must_include=["missing"])

    def test_merges_a_section_that_meets_on_two_different_days(self):
        raw = [
            make_record("Course G", "Saturday", "08:00", "10:00", section="2"),
            make_record("Course G", "Monday", "08:00", "10:00", section="2"),
        ]
        courses = group_raw_courses(raw, {"Course G": 3})
        self.assertEqual(len(courses), 1)
        self.assertEqual(len(courses[0].offerings), 1)
        self.assertEqual(len(courses[0].offerings[0].blocks), 2)

    def test_missing_units_is_excluded_with_a_warning(self):
        raw = [make_record("Course A", "Saturday", "08:00", "10:00")]
        courses = group_raw_courses(raw, units_map={})
        result = solve_schedule(courses)
        self.assertEqual(result.selected, [])
        self.assertTrue(any("unit count" in w for w in result.warnings))

    def test_must_include_and_must_exclude_are_respected(self):
        raw = [
            make_record("Course A", "Saturday", "08:00", "10:00"),
            make_record("Course B", "Sunday", "08:00", "10:00"),
            make_record("Course C", "Monday", "08:00", "10:00"),
        ]
        units_map = {"Course A": 4, "Course B": 4, "Course C": 8}
        courses = group_raw_courses(raw, units_map)
        result = solve_schedule(
            courses, min_units=16, max_units=19,
            must_include=["Course C"], must_exclude=["Course B"],
        )
        selected_names = {o.course_name for o in result.selected}
        self.assertIn("Course C", selected_names)
        self.assertNotIn("Course B", selected_names)


if __name__ == "__main__":
    unittest.main()
