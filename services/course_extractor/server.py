#!/usr/bin/env python3
"""Security boundary for the fixed-format university timetable parser."""

from __future__ import annotations

import json
import multiprocessing
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from extract_courses import extract_courses


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_RESULT_BYTES = 1024 * 1024
MAX_CONCURRENT_EXTRACTIONS = 2
PARSER_TIMEOUT_SECONDS = 30
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8010
PDF_HEADER = re.compile(br"%PDF-[12]\.[0-9]")
ACTIVE_PDF_FEATURE = re.compile(
    br"/(?:JavaScript|Launch|EmbeddedFile|RichMedia|XFA|AcroForm|OpenAction|AA|SubmitForm|ImportData)\b",
    re.IGNORECASE,
)
EXTRACTION_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_EXTRACTIONS)


class CourseExtractorHandler(BaseHTTPRequestHandler):
    server_version = "UniPlanExtractor"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        self.send_json(HTTPStatus.OK, {"status": "ok"})

    def do_POST(self) -> None:
        if self.path != "/extract":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        if not self.authorized():
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Unauthorized."})
            return
        if not EXTRACTION_SLOTS.acquire(blocking=False):
            self.send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {"error": "The extractor is busy. Try again shortly."},
                {"Retry-After": "15"},
            )
            return

        temporary_path: Path | None = None
        try:
            pdf_bytes = self.read_uploaded_pdf()
            validate_pdf(pdf_bytes)
            with tempfile.NamedTemporaryFile(prefix="uniplan-", delete=False) as temporary_file:
                temporary_path = Path(temporary_file.name)
                os.chmod(temporary_path, 0o600)
                temporary_file.write(pdf_bytes)
            result = extract_with_limits(temporary_path)
            self.send_json(HTTPStatus.OK, result)
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except ParserTimeout:
            self.send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "The PDF took too long to inspect safely."})
        except Exception as error:
            print(f"Extraction failed: {type(error).__name__}", flush=True)
            self.send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "The timetable could not be safely extracted."})
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            EXTRACTION_SLOTS.release()

    def authorized(self) -> bool:
        expected = os.environ.get("COURSE_EXTRACTOR_TOKEN", "")
        if expected:
            return self.headers.get("Authorization") == f"Bearer {expected}"
        return self.client_address[0] in {"127.0.0.1", "::1"}

    def read_uploaded_pdf(self) -> bytes:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/pdf":
            raise RequestError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Only PDF timetable files are accepted.")
        content_length = parse_content_length(self.headers.get("Content-Length"))
        if content_length is None:
            raise RequestError(HTTPStatus.LENGTH_REQUIRED, "The upload size could not be verified.")
        if content_length <= 0:
            raise RequestError(HTTPStatus.BAD_REQUEST, "Choose a timetable PDF to import.")
        if content_length > MAX_FILE_BYTES:
            raise RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "The document must be smaller than 8 MB.")

        payload = self.rfile.read(content_length)
        if len(payload) != content_length:
            raise RequestError(HTTPStatus.BAD_REQUEST, "The uploaded PDF was incomplete.")
        return payload

    def send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        additional_headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        for name, value in (additional_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def log_message(self, template: str, *args: Any) -> None:
        print(f"{self.client_address[0]} - {template % args}", flush=True)


def parse_content_length(value: str | None) -> int | None:
    if not value or not value.isdecimal():
        return None
    parsed = int(value)
    return parsed if parsed >= 0 else None


def validate_pdf(payload: bytes) -> None:
    if len(payload) < 32 or not PDF_HEADER.search(payload[:1024]):
        raise RequestError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "The selected file is not a valid PDF.")
    if b"%%EOF" not in payload[-4096:]:
        raise RequestError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "The PDF appears to be incomplete or damaged.")
    if re.search(br"/Encrypt\b", payload, re.IGNORECASE):
        raise RequestError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Encrypted or password-protected PDFs are not supported.")
    if ACTIVE_PDF_FEATURE.search(payload):
        raise RequestError(
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            "PDFs containing forms, scripts, attachments, or automatic actions are not accepted.",
        )


def extract_with_limits(path: Path) -> dict[str, Any]:
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(target=extract_worker, args=(str(path), result_queue), daemon=True)
    process.start()
    try:
        # Drain the pipe before joining: large results block the worker's queue feeder.
        outcome = result_queue.get(timeout=PARSER_TIMEOUT_SECONDS)
        process.join(2)
    except queue.Empty as error:
        if process.is_alive():
            raise ParserTimeout() from error
        raise RuntimeError("The parser exited without a result.") from error
    finally:
        if process.is_alive():
            process.terminate()
            process.join(2)
            if process.is_alive():
                process.kill()
                process.join(1)
        result_queue.close()

    if not isinstance(outcome, dict) or outcome.get("ok") is not True:
        raise RuntimeError("The parser rejected the document.")
    result = outcome.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("courses"), list):
        raise RuntimeError("The parser returned an invalid result.")
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RESULT_BYTES:
        raise RuntimeError("The parser result exceeded its safe limit.")
    result["courses"] = result["courses"][:500]
    warnings = result.get("warnings")
    result["warnings"] = warnings[:100] if isinstance(warnings, list) else []
    return result


def extract_worker(path: str, result_queue: Any) -> None:
    apply_resource_limits()
    sanitized_path: Path | None = None
    try:
        sanitized_path = reconstruct_pdf(Path(path))
        validate_pdf(sanitized_path.read_bytes())
        result_queue.put({"ok": True, "result": extract_courses(sanitized_path)})
    except BaseException:
        result_queue.put({"ok": False})
    finally:
        if sanitized_path is not None and sanitized_path != Path(path):
            sanitized_path.unlink(missing_ok=True)


def reconstruct_pdf(path: Path) -> Path:
    qpdf = shutil.which("qpdf")
    if not qpdf:
        if os.environ.get("REQUIRE_QPDF", "").lower() in {"1", "true", "yes"}:
            raise RuntimeError("The required PDF reconstruction tool is unavailable.")
        return path
    output_path = path.with_name(f"{path.name}.sanitized")
    completed = subprocess.run(
        [qpdf, "--no-warn", "--object-streams=disable", "--stream-data=uncompress", str(path), str(output_path)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=12,
        check=False,
    )
    if completed.returncode != 0 or not output_path.is_file():
        output_path.unlink(missing_ok=True)
        raise RuntimeError("PDF reconstruction failed.")
    return output_path


def apply_resource_limits() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ImportError, OSError, ValueError):
        pass


class RequestError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


class ParserTimeout(Exception):
    pass


def main() -> None:
    host = os.environ.get("COURSE_EXTRACTOR_HOST", DEFAULT_HOST)
    port = int(os.environ.get("COURSE_EXTRACTOR_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((host, port), CourseExtractorHandler)
    server.daemon_threads = True
    print(f"Course extractor listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
