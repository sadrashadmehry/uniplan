"""Client for the website's `POST /api/schedule/export` endpoint.

The website owns what a rendered schedule looks like (see
`app/api/schedule/export/route.tsx` at the repository root); the bot's job
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

    Callers should treat this as recoverable -- e.g. fall back to a local
    renderer -- rather than letting it propagate to the user as a crash.
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
    timeout: float = 20.0,
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
            body = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise WebsiteExportError(f"Website returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise WebsiteExportError(f"Could not reach the website: {error.reason}") from error
    except TimeoutError as error:
        raise WebsiteExportError("The website took too long to respond.") from error

    if "image/" not in content_type:
        raise WebsiteExportError(f"Website did not return an image (Content-Type: {content_type!r}).")
    if not body:
        raise WebsiteExportError("Website returned an empty image.")
    return body
