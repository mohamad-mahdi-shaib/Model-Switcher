import { GoogleGenAI, type Content } from "@google/genai";
import type {
  ChatErrorCode,
  ChatErrorInfo,
  StreamEvent,
  WireMessage,
} from "@/lib/chat";

/**
 * Server-only Gemini bridge.
 *
 * GEMINI_API_KEY is read here and nowhere else. It is never imported into a
 * client component and never prefixed NEXT_PUBLIC_, so it cannot reach the
 * browser bundle. Responses are streamed back as NDJSON.
 *
 * Verified against the official docs and live calls on 2026-09-18: the SDK is
 * @google/genai. Model choice was settled empirically, not from the docs alone:
 *   - gemini-2.5-flash  -> 404, "no longer available to new users"
 *   - gemini-3.8-flash  -> frequent 503 "high demand"; 55-150s when it did work
 *   - gemini-3.6-flash  -> Google's own recommended replacement; 6-16s
 * so 3.6-flash is the default. The stateless
 * models.generateContentStream call is used rather than the newer Interactions
 * API, because conversation state lives in the client for this milestone and is
 * sent in full on every turn.
 */

export const runtime = "nodejs";
// Never cache a chat completion.
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gemini-3.6-flash";
const MAX_MESSAGES = 50;
const MAX_CHARS = 16_000;

function errorResponse(
  code: ChatErrorCode,
  status: number,
  detail?: string,
  info?: ChatErrorInfo,
) {
  return Response.json({ code, detail, info }, { status });
}

/**
 * Pulls the quota facts out of a Google 429.
 *
 * The payload is a JSON string whose `message` contains another JSON document,
 * so the useful parts (RetryInfo, QuotaFailure) need a second parse. Worth the
 * effort: quotaId is the only reliable way to tell a per-minute throttle from a
 * per-day cap, and the two need completely different advice.
 */
function parseQuota(error: unknown): ChatErrorInfo | undefined {
  const raw = String((error as { message?: string })?.message ?? "");
  if (!raw) return undefined;

  let text = raw;
  try {
    const outer = JSON.parse(raw) as { error?: { message?: string } };
    if (outer?.error?.message) text = outer.error.message;
  } catch {
    // Not wrapped; fall through and scan the raw text.
  }

  const info: ChatErrorInfo = {};

  // RetryInfo: "retryDelay": "45s", or "Please retry in 45.9068s."
  const delay =
    text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ??
    text.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (delay) info.retryAfterSeconds = Math.ceil(Number(delay[1]));

  const quotaId = text.match(/"quotaId"\s*:\s*"([^"]+)"/);
  if (quotaId) info.quotaId = quotaId[1];

  const quotaValue = text.match(/"quotaValue"\s*:\s*"?(\d+)"?/);
  if (quotaValue) info.quotaValue = Number(quotaValue[1]);

  const model = text.match(/"model"\s*:\s*"([^"]+)"/);
  if (model) info.quotaModel = model[1];

  const id = info.quotaId ?? "";
  info.quotaScope =
    info.quotaValue === 0
      ? "zero"
      : /PerDay/i.test(id)
        ? "day"
        : /PerMinute/i.test(id)
          ? "minute"
          : "unknown";

  return Object.keys(info).length ? info : undefined;
}

/**
 * Server-side diagnostics. Logs the upstream failure so a misconfiguration is
 * debuggable from the terminal. Never logs the API key.
 */
function logUpstream(where: string, error: unknown) {
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? String(error);
  console.error("[chat] upstream failure", { where, status, message });
}

/** Maps an SDK failure onto our error vocabulary. */
function classify(error: unknown): ChatErrorCode {
  const status = (error as { status?: number })?.status;
  const text = String(
    (error as { message?: string })?.message ?? error,
  ).toLowerCase();

  // A transport failure reaching Google carries no HTTP status. Reporting it
  // as an upstream fault would blame Gemini for a connectivity problem and
  // point the user at the wrong fix.
  if (
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("enotfound") ||
    text.includes("socket hang up") ||
    text.includes("network")
  ) {
    return "NETWORK";
  }

  // Message text is inspected BEFORE status: Gemini answers an invalid API key
  // with HTTP 400, which would otherwise be reported as a malformed request.
  if (
    text.includes("api key not valid") ||
    text.includes("api_key_invalid") ||
    text.includes("invalid api key")
  ) {
    return "INVALID_KEY";
  }
  if (
    text.includes("resource_exhausted") ||
    text.includes("quota") ||
    text.includes("rate limit")
  ) {
    return "RATE_LIMIT";
  }
  if (text.includes("api key") || text.includes("unauthenticated")) {
    return "INVALID_KEY";
  }

  // Google-side capacity, not our request and not the user's fault.
  if (
    status === 503 ||
    text.includes("unavailable") ||
    text.includes("high demand") ||
    text.includes("overloaded")
  ) {
    return "MODEL_BUSY";
  }
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "INVALID_KEY";
  if (status === 400 || status === 404) return "BAD_REQUEST";
  return "UPSTREAM";
}

/**
 * Lets the UI show the setup state on load instead of waiting for a failed
 * send. Reports only whether a key is present -- never any part of its value.
 */
export async function GET() {
  return Response.json(
    {
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: { provider?: string; messages?: WireMessage[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse("BAD_REQUEST", 400, "Body was not valid JSON.");
  }

  // Second enforcement point for disabled providers, checked before anything
  // else so a disabled provider is refused as disabled -- never mislabelled as
  // a configuration problem, and never dependent on configuration to be safe.
  if (body.provider !== "gemini") {
    return errorResponse("PROVIDER_DISABLED", 403);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return errorResponse("MISSING_KEY", 503);

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse("BAD_REQUEST", 400, "No messages supplied.");
  }
  if (messages.length > MAX_MESSAGES) {
    return errorResponse("BAD_REQUEST", 400, "Conversation is too long.");
  }
  if (
    messages.some(
      (m) =>
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        m.content.length > MAX_CHARS,
    )
  ) {
    return errorResponse("BAD_REQUEST", 400, "A message was malformed.");
  }
  if (messages.at(-1)?.role !== "user") {
    return errorResponse("BAD_REQUEST", 400, "Last message must be the user's.");
  }

  // Gemini expects 'model' for assistant turns. Sending the whole history is
  // what makes follow-up questions resolve against earlier context.
  const contents: Content[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  // Transient failures are common here: Google returns 503 "high demand" under
  // load, and the transport itself can drop. Both are worth one or two quick
  // retries. Auth, quota and malformed-request failures are NOT retried --
  // repeating them would just burn quota and delay the real error.
  const RETRYABLE = new Set<ChatErrorCode>(["MODEL_BUSY", "NETWORK"]);
  let stream: AsyncGenerator<{ text?: string }> | undefined;
  let lastCode: ChatErrorCode = "UPSTREAM";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      stream = await ai.models.generateContentStream({
        model,
        contents,
        config: { abortSignal: request.signal },
      });
      break;
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      lastCode = classify(error);
      logUpstream(`generateContentStream attempt ${attempt + 1}`, error);
      if (!RETRYABLE.has(lastCode) || attempt === 2) {
        // Thrown before any bytes were written, so a real status code is still
        // available to the client.
        return errorResponse(lastCode, 502, undefined, parseQuota(error));
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  if (!stream) return errorResponse(lastCode, 502);

  const encoder = new TextEncoder();
  const send = (event: StreamEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (request.signal.aborted) break;
          const text = chunk.text;
          if (text) controller.enqueue(send({ type: "delta", text }));
        }
        controller.enqueue(send({ type: "done" }));
      } catch (error) {
        if (request.signal.aborted) {
          // The user pressed Stop; not an error worth reporting.
        } else {
          logUpstream("stream", error);
          const code = classify(error);
          controller.enqueue(
            send({
              type: "error",
              code,
              message: String(code),
              info: parseQuota(error),
            }),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
