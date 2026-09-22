import unittest

from catalog import enrich_course, load_catalog
from extract_courses import make_course, TimeSlot


class CatalogTests(unittest.TestCase):
    def test_spacing_and_arabic_letters_match(self):
        course = enrich_course({"name": "برنامهسازی پیشرفت ه"})
        self.assertEqual((course["name"], course["units"]), ("برنامه سازی پیشرفته", 3))
        self.assertEqual(course["prerequisites"], ["مبانی کامپیوتر و برنامه سازی"])
        self.assertEqual(course["corequisites"], ["کارگاه برنامه سازی پیشرفته"])
        self.assertEqual(course["catalogSource"]["page"], 15)
        self.assertEqual(enrich_course({"name": "شبكهها ی كامپيوتر ی"})["courseCode"], "CE305")

    def test_aliases_and_numbered_courses(self):
        self.assertEqual(enrich_course({"name": "داده ساختارها و الگوریتم ها"})["courseCode"], "CE203")
        self.assertEqual(enrich_course({"name": "مهندسی نرم افزار۲"})["courseCode"], "CE331")
        self.assertEqual(enrich_course({"name": "مهندسی نرم افزار1"})["courseCode"], "CE307")
        self.assertIsNone(enrich_course({"name": "مهندسی نرم افزار"})["units"])

    def test_no_fuzzy_unit_assignments_or_lab_lecture_confusion(self):
        for name in ["کاربینی", "تدریس یار مدارهای منطقی", "مقدمه ای بر رباتیک", "درس ناشناخته"]:
            course = enrich_course({"name": name})
            self.assertIsNone(course["units"])
            self.assertIsNone(course["prerequisites"])
            self.assertIn("units", course["missingFields"])
        self.assertEqual(enrich_course({"name": "مدارهای منطقی"})["units"], 3)
        self.assertEqual(enrich_course({"name": "آزمایشگاه مدارهای منطقی"})["units"], 1)

    def test_verified_unit_totals_and_requirements(self):
        document, _ = load_catalog()
        courses = document["courses"]
        self.assertEqual(sum(c["units"] for c in courses if 15 <= c["sourcePage"] <= 17), 55)
        self.assertEqual(sum(c["units"] for c in courses if c["sourcePage"] == 14), 20)
        self.assertEqual(len({c["name"] for c in courses}), len(courses))
        self.assertEqual(enrich_course({"name": "روش پژوهش و ارائه"})["units"], 2)
        self.assertEqual(enrich_course({"name": "روش پژوهش و ارائه"})["requirementNotes"], "نیمسال 5 و بالاتر")
        self.assertIsNone(enrich_course({"name": "زبان فارسی"})["prerequisites"])

    def test_raw_extraction_metadata_survives(self):
        raw = make_course("برنامهسازی پیشرفت ه گ2(د. عامری) (40)", "Saturday", "Major requirements", TimeSlot(0, 1, "08:00", "10:00"))
        course = enrich_course(raw)
        self.assertEqual(course["rawName"], "برنامهسازی پیشرفت ه")
        self.assertEqual(course["section"], "2")
        self.assertEqual(course["days"], ["Saturday"])
        self.assertEqual(course["sourceContext"], raw["sourceContext"])


if __name__ == "__main__":
    unittest.main()
