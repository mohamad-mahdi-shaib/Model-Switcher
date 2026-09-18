import { GoogleGenAI, type Content } from "@google/genai";
import type { ChatErrorCode, StreamEvent, WireMessage } from "@/lib/chat";

/**
 * Server-only Gemini bridge.
 *
 * GEMINI_API_KEY is read here and nowhere else. It is never imported into a
 * client component and never prefixed NEXT_PUBLIC_, so it cannot reach the
 * browser bundle. Responses are streamed back as NDJSON.
 *
 * Verified against the official docs on 2026-09-18: the SDK is @google/genai,
 * and gemini-3.8-flash is stable with a free tier. The stateless
 * models.generateContentStream call is used rather than the newer Interactions
 * API, because conversation state lives in the client for this milestone and is
 * sent in full on every turn.
 */

export const runtime = "nodejs";
// Never cache a chat completion.
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_MESSAGES = 50;
const MAX_CHARS = 16_000;

function errorResponse(code: ChatErrorCode, status: number, detail?: string) {
  return Response.json({ code, detail }, { status });
}

/** Maps an SDK failure onto our error vocabulary. */
function classify(error: unknown): ChatErrorCode {
  const status = (error as { status?: number })?.status;
  const text = String(
    (error as { message?: string })?.message ?? error,
  ).toLowerCase();

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

  let stream: AsyncGenerator<{ text?: string }>;
  try {
    stream = await ai.models.generateContentStream({
      model,
      contents,
      config: { abortSignal: request.signal },
    });
  } catch (error) {
    // Thrown before any bytes were written, so a real status code is still
    // available to the client.
    return errorResponse(classify(error), 502);
  }

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
          const code = classify(error);
          controller.enqueue(
            send({ type: "error", code, message: String(code) }),
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
