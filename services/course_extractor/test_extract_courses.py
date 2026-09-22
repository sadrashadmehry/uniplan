import unittest

from extract_courses import (
    TimeSlot,
    clean_course_name,
    explicit_or_slot_time,
    repair_visual_line,
)


class CourseExtractorTests(unittest.TestCase):
    def test_repairs_visual_persian_and_keeps_ascii_groups(self) -> None:
        source = ")50()یلنیز .د( 2گ یزاسه مانرب و رتویپماک ینابم"
        self.assertEqual(
            repair_visual_line(source),
            "مبانی کامپیوتر و برنامه سازی گ2 (د. زینلی) (50)",
        )

    def test_extracts_clean_name_before_section_and_instructor(self) -> None:
        record = "داده ساختارها و الگوریتم ها گ2(د. عامری) (40)"
        self.assertEqual(clean_course_name(record), "داده ساختارها و الگوریتم ها")

    def test_explicit_time_overrides_column_time(self) -> None:
        slot = TimeSlot(0, 100, "13:30", "15:00")
        self.assertEqual(
            explicit_or_slot_time("مهارت های نرم شغلی (13:00-15:00) (40)", slot),
            ("13:00", "15:00"),
        )


if __name__ == "__main__":
    unittest.main()
