const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_COURSES = 500;
const MAX_WARNINGS = 100;
const PARSER_TIMEOUT_MS = 35_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 6;
const DEFAULT_EXTRACTOR_URL = "http://127.0.0.1:8010/extract";
const PDF_CONTENT_TYPE = "application/pdf";
const ACTIVE_PDF_FEATURE = /\/(?:JavaScript|Launch|EmbeddedFile|RichMedia|XFA|AcroForm|OpenAction|AA|SubmitForm|ImportData)\b/i;

type RateEntry = { count: number; resetAt: number };
type ExtractedDocument = { courses?: unknown[]; warnings?: unknown[]; error?: unknown };

const rateLimitStore = new Map<string, RateEntry>();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-site uploads are not allowed.", 403);

  const rateLimit = consumeRateLimit(request);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many upload attempts. Wait a moment and try again." },
      { status: 429, headers: responseHeaders({ "Retry-After": String(rateLimit.retryAfter) }) },
    );
  }

  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== PDF_CONTENT_TYPE) {
    return jsonError("Only PDF timetable files are accepted.", 415);
  }

  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength === null) return jsonError("The upload size could not be verified.", 411);
  if (declaredLength === 0) return jsonError("Choose a timetable PDF to import.", 400);
  if (declaredLength > MAX_FILE_BYTES) return jsonError("The document must be smaller than 8 MB.", 413);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await readLimitedBody(request, MAX_FILE_BYTES);
  } catch (caught) {
    const tooLarge = caught instanceof UploadError && caught.status === 413;
    return jsonError(tooLarge ? "The document must be smaller than 8 MB." : "The upload could not be read safely.", tooLarge ? 413 : 400);
  }

  const validationError = validatePdf(pdfBytes);
  if (validationError) return jsonError(validationError, 415);

  const extractorUrl = process.env.COURSE_EXTRACTOR_URL || DEFAULT_EXTRACTOR_URL;
  const extractorToken = process.env.COURSE_EXTRACTOR_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PARSER_TIMEOUT_MS);

  try {
    const body = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
    const response = await fetch(extractorUrl, {
      method: "POST",
      headers: {
        "Content-Type": PDF_CONTENT_TYPE,
        "Content-Length": String(pdfBytes.byteLength),
        ...(extractorToken ? { Authorization: `Bearer ${extractorToken}` } : {}),
      },
      body,
      signal: controller.signal,
    });
    const resultText = await response.text();
    if (new TextEncoder().encode(resultText).byteLength > MAX_OUTPUT_BYTES) throw new Error("oversized response");

    let parsed: ExtractedDocument;
    try {
      parsed = JSON.parse(resultText) as ExtractedDocument;
    } catch {
      throw new Error("invalid response");
    }
    if (!response.ok || !Array.isArray(parsed.courses)) throw new Error("extraction rejected");

    const courses = parsed.courses.slice(0, MAX_COURSES).filter(isPlainRecord);
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.slice(0, MAX_WARNINGS).filter((warning): warning is string => typeof warning === "string" && warning.length <= 500)
      : [];
    return Response.json({ courses, warnings }, { headers: responseHeaders() });
  } catch (caught) {
    const timedOut = caught instanceof DOMException && caught.name === "AbortError";
    return jsonError(
      timedOut ? "The PDF took too long to inspect safely. Try a smaller document." : "The timetable could not be safely extracted.",
      422,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host).toLowerCase();
    return new URL(origin).host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function consumeRateLimit(request: Request): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const client = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",", 1)[0].trim() || "unknown";
  const current = rateLimitStore.get(client);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(client, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    if (rateLimitStore.size > 5_000) {
      for (const [key, entry] of rateLimitStore) if (entry.resetAt <= now) rateLimitStore.delete(key);
    }
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)) };
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readLimitedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  if (!request.body) throw new UploadError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new UploadError(413);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new UploadError(400);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function validatePdf(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 32) return "The selected file is not a valid PDF.";
  const decoder = new TextDecoder("latin1");
  const header = decoder.decode(bytes.subarray(0, Math.min(1_024, bytes.byteLength)));
  if (!/%PDF-[12]\.\d/.test(header)) return "The selected file is not a valid PDF.";
  const trailer = decoder.decode(bytes.subarray(Math.max(0, bytes.byteLength - 4_096)));
  if (!trailer.includes("%%EOF")) return "The PDF appears to be incomplete or damaged.";
  const source = decoder.decode(bytes);
  if (/\/Encrypt\b/i.test(source)) return "Encrypted or password-protected PDFs are not supported.";
  if (ACTIVE_PDF_FEATURE.test(source)) return "PDFs containing forms, scripts, attachments, or automatic actions are not accepted.";
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: responseHeaders() });
}

function responseHeaders(additional: Record<string, string> = {}): HeadersInit {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...additional };
}

class UploadError extends Error {
  constructor(readonly status: number) {
    super("Upload rejected");
  }
}
