"""Reviewed curriculum lookup. Fuzzy matches are suggestions, never unit assignments."""
import json
import re
import unicodedata
from difflib import get_close_matches
from functools import lru_cache
from pathlib import Path


def name_key(name: str) -> str:
    name = unicodedata.normalize("NFKC", name).translate(str.maketrans(
        "يكىۀأإؤ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "یکیهااو01234567890123456789"))
    return re.sub(r"[\s\u200c\u200dـ\u064b-\u065f]+", "", name)


@lru_cache(maxsize=1)
def load_catalog():
    document = json.loads(Path(__file__).with_name("course_catalog.json").read_text(encoding="utf-8"))
    index = {}
    for course in document["courses"]:
        for name in [course["name"], *course["aliases"]]:
            key = name_key(name)
            if key in index and index[key] is not course:
                raise ValueError(f"Ambiguous catalog alias: {name}")
            index[key] = course
    return document, index


def enrich_course(course: dict) -> dict:
    document, index = load_catalog()
    raw_name = course["name"]
    key = name_key(raw_name)
    match = index.get(key)
    metadata = dict(rawName=raw_name, units=None, courseCode=None,
                    prerequisites=None, corequisites=None, requirementNotes="",
                    catalogSource=None, catalogMatch="unmatched", catalogSuggestions=[])
    if match:
        metadata.update(name=match["name"], units=match["units"], courseCode=match["code"],
                        prerequisites=match["prerequisites"], corequisites=match["corequisites"],
                        requirementNotes=match["requirementNotes"], catalogMatch="matched",
                        catalogSource={"document": document["sourceDocument"], "page": match["sourcePage"]})
    else:
        metadata["catalogSuggestions"] = list(dict.fromkeys(
            index[k]["name"] for k in get_close_matches(key, index, n=3, cutoff=0.8)))
    missing = list(course.get("missingFields", []))
    if not match:
        missing.extend(["catalogMatch", "units"])
    return {**course, **metadata, "missingFields": missing}
