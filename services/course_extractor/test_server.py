from __future__ import annotations

import sys
import unittest
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch


SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from server import RequestError, extract_with_limits, parse_content_length, validate_pdf


def large_result_worker(path, result_queue):
    result_queue.put({"ok": True, "result": {"courses": [{"sourceContext": "x" * 131072}]}})


def minimal_pdf(extra: bytes = b"") -> bytes:
    return b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n" + extra + b"\ntrailer\n<<>>\n%%EOF\n"


class UploadValidationTests(unittest.TestCase):
    def test_large_worker_response_does_not_deadlock(self):
        with patch("server.extract_worker", large_result_worker), patch("server.PARSER_TIMEOUT_SECONDS", 5):
            result = extract_with_limits(Path("unused.pdf"))
        self.assertEqual(len(result["courses"][0]["sourceContext"]), 131072)

    def test_accepts_inert_pdf_envelope(self) -> None:
        validate_pdf(minimal_pdf())

    def test_rejects_spoofed_file(self) -> None:
        with self.assertRaises(RequestError) as caught:
            validate_pdf(b"not a pdf at all" * 4)
        self.assertEqual(caught.exception.status, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)

    def test_rejects_incomplete_pdf(self) -> None:
        with self.assertRaises(RequestError):
            validate_pdf(b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")

    def test_rejects_active_content(self) -> None:
        with self.assertRaises(RequestError):
            validate_pdf(minimal_pdf(b"<< /OpenAction 2 0 R /JavaScript true >>"))

    def test_rejects_encrypted_pdf(self) -> None:
        with self.assertRaises(RequestError):
            validate_pdf(minimal_pdf(b"<< /Encrypt 2 0 R >>"))

    def test_content_length_is_strict(self) -> None:
        self.assertEqual(parse_content_length("123"), 123)
        self.assertIsNone(parse_content_length(None))
        self.assertIsNone(parse_content_length("-1"))
        self.assertIsNone(parse_content_length("1.5"))


if __name__ == "__main__":
    unittest.main()
