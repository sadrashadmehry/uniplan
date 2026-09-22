"""Offline tests for render.website_export. Mocks urllib -- no network
access is needed or used."""
import io
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from render.website_export import WebsiteExportError, _selection_to_payload, fetch_exported_schedule
from scheduler.engine import group_raw_courses
from test_scheduler import make_record


def _offering(name: str = "Course A"):
    record = make_record(name, "Saturday", "08:00", "10:00")
    record["courseCode"] = "40123"
    courses = group_raw_courses([record], {name: 3})
    return courses[0].offerings[0]


class PayloadTests(unittest.TestCase):
    def test_payload_shape(self):
        payload = _selection_to_payload([_offering()], 18)
        self.assertEqual(payload["totalUnits"], 18)
        self.assertEqual(len(payload["courses"]), 1)
        course = payload["courses"][0]
        self.assertEqual(course["name"], "Course A")
        self.assertEqual(course["courseCode"], "40123")
        self.assertEqual(course["blocks"], [{"day": "Saturday", "start": "08:00", "end": "10:00"}])


class FetchExportedScheduleTests(unittest.TestCase):
    def test_empty_selection_raises_without_network(self):
        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([], 18, "http://127.0.0.1:3000/api/schedule/export", "token")

    def test_missing_config_raises_without_network(self):
        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([_offering()], 18, "", "token")
        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([_offering()], 18, "http://127.0.0.1:3000/api/schedule/export", "")

    @patch("render.website_export.urllib.request.urlopen")
    def test_successful_fetch_returns_png_bytes_and_sends_bearer_token(self, mock_urlopen):
        response = MagicMock()
        response.headers = {"Content-Type": "image/png"}
        response.read.return_value = b"\x89PNG\r\n\x1a\n"
        response.__enter__.return_value = response
        mock_urlopen.return_value = response

        result = fetch_exported_schedule(
            [_offering()], 18, "http://127.0.0.1:3000/api/schedule/export", "secret",
        )

        self.assertEqual(result, b"\x89PNG\r\n\x1a\n")
        sent_request = mock_urlopen.call_args[0][0]
        self.assertEqual(sent_request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(sent_request.full_url, "http://127.0.0.1:3000/api/schedule/export")

    @patch("render.website_export.urllib.request.urlopen")
    def test_non_image_response_raises(self, mock_urlopen):
        response = MagicMock()
        response.headers = {"Content-Type": "application/json"}
        response.read.return_value = b"{}"
        response.__enter__.return_value = response
        mock_urlopen.return_value = response

        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([_offering()], 18, "http://127.0.0.1:3000/api/schedule/export", "secret")

    @patch("render.website_export.urllib.request.urlopen")
    def test_rejects_fake_png_body(self, mock_urlopen):
        response = MagicMock()
        response.headers = {"Content-Type": "image/png"}
        response.read.return_value = b"not a PNG"
        response.__enter__.return_value = response
        mock_urlopen.return_value = response
        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([_offering()], 3, "http://127.0.0.1:3000/api/schedule/export", "secret")

    @patch("render.website_export.urllib.request.urlopen")
    def test_http_error_raises_website_export_error(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            "http://127.0.0.1:3000/api/schedule/export", 401, "Unauthorized",
            hdrs=None, fp=io.BytesIO(b"bad token"),
        )
        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([_offering()], 18, "http://127.0.0.1:3000/api/schedule/export", "wrong")

    @patch("render.website_export.urllib.request.urlopen")
    def test_connection_error_raises_website_export_error(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.URLError("connection refused")
        with self.assertRaises(WebsiteExportError):
            fetch_exported_schedule([_offering()], 18, "http://127.0.0.1:3000/api/schedule/export", "secret")


if __name__ == "__main__":
    unittest.main()
