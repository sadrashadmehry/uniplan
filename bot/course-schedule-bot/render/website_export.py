"""Client for the website's `POST /api/schedule/export` endpoint.

The website owns what a rendered schedule looks like (see
`app/api/schedule/export/route.ts` at the repository root); the bot's job
is only to plan the schedule (see `scheduler.engine`) and hand the result
to the website for rendering. This module does the handing-off: it turns a
solved schedule into the website's request shape, calls it over HTTP, and
returns the PNG bytes it sends back.

Deliberately stdlib-only (`urllib.request`) so this module needs no new
dependency and can be imported and unit-tested without network access.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from scheduler.models import SectionOffering


class WebsiteExportError(Exception):
    """Raised when the website could not produce an exported schedule image.

    Keep the plan and let the user retry; never substitute a different renderer.
    """


def _selection_to_payload(selection: list[SectionOffering], total_units: int | None) -> dict[str, Any]:
    return {
        "totalUnits": total_units,
        "courses": [
            {
                "name": offering.course_name,
                "courseCode": offering.course_code,
                "category": offering.category,
                "instructor": offering.instructor,
                "section": offering.section_id,
                "blocks": [{"day": b.day, "start": b.start, "end": b.end} for b in offering.blocks],
            }
            for offering in selection
        ],
    }


def fetch_exported_schedule(
    selection: list[SectionOffering],
    total_units: int | None,
    base_url: str,
    token: str,
    timeout: float = 35.0,
) -> bytes:
    """POST the selected schedule to the website and return PNG bytes.

    Raises WebsiteExportError on any failure (network error, timeout,
    non-200 response, or a response that isn't actually an image) so the
    caller can decide how to degrade gracefully.
    """
    if not selection:
        raise WebsiteExportError("Nothing to export: the selection is empty.")
    if not base_url or not token:
        raise WebsiteExportError("Website export is not configured (missing URL or token).")

    payload = json.dumps(_selection_to_payload(selection, total_units)).encode("utf-8")
    request = urllib.request.Request(
        base_url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "Accept": "image/png",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            body = response.read(10 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        detail = error.read(500).decode("utf-8", errors="replace")
        raise WebsiteExportError(f"Website returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise WebsiteExportError(f"Could not reach the website: {error.reason}") from error
    except TimeoutError as error:
        raise WebsiteExportError("The website took too long to respond.") from error

    if content_type.split(";", 1)[0].strip().lower() != "image/png":
        raise WebsiteExportError(f"Website did not return an image (Content-Type: {content_type!r}).")
    if len(body) > 10 * 1024 * 1024 or not body.startswith(b"\x89PNG\r\n\x1a\n"):
        raise WebsiteExportError("Website returned invalid or oversized PNG data.")
    return body
