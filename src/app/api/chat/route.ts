import type { ChatErrorCode, ChatErrorInfo, StreamEvent, WireMessage } from "@/lib/chat";
import { getProvider, providerAvailability } from "@/server/providers/registry";
import { ProviderError } from "@/server/providers/types";

/**
 * Provider-neutral chat endpoint.
 *
 * This file contains NO vendor SDK, no model ids, and no provider-specific
 * error handling. It validates the request, dispatches through the registry,
 * and re-frames whatever the adapter yields as NDJSON. Adding a provider needs
 * a new adapter plus a registry entry — nothing here changes.
 *
 * API keys are read inside adapters, server-side only. They are never imported
 * into a client module and never prefixed NEXT_PUBLIC_, so they cannot reach
 * the browser bundle.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 50;
const MAX_CHARS = 16_000;
const MAX_ATTEMPTS = 3;

function errorResponse(
  code: ChatErrorCode,
  status: number,
  detail?: string,
  info?: ChatErrorInfo,
) {
  return Response.json({ code, detail, info }, { status });
}

/** Server-side diagnostics. Never logs credentials. */
function logUpstream(where: string, error: unknown) {
  const code = error instanceof ProviderError ? error.code : undefined;
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? String(error);
  console.error("[chat] upstream failure", { where, code, status, message });
}

/**
 * Reports which providers are configured, so the UI can enable only the ones
 * that can actually answer. Returns booleans and model names — never a key.
 */
export async function GET() {
  const availability = providerAvailability();
  return Response.json(
    {
      providers: availability,
      // Retained for the existing setup state.
      configured: Boolean(availability.gemini?.configured),
      model: availability.gemini?.model ?? null,
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

  // Unknown or unregistered provider. Checked before configuration so a
  // disabled provider is refused as disabled, never mislabelled as a setup
  // problem, and never dependent on configuration to be safe.
  const provider = getProvider(String(body.provider ?? ""));
  if (!provider) return errorResponse("PROVIDER_DISABLED", 403);

  const availability = provider.availability();
  if (!availability.configured) return errorResponse("MISSING_KEY", 503);

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

  // Transient failures are common: capacity rejections and dropped transports.
  // Both are worth a couple of quick retries. Auth, quota and malformed-request
  // failures are never retried -- repeating them only burns quota and delays
  // the real error. Retryability is decided by the adapter, not here.
  let stream: AsyncIterable<{ text: string }> | undefined;
  let lastError: ProviderError = new ProviderError("UPSTREAM");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      stream = await provider.stream(messages, request.signal);
      break;
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      lastError =
        error instanceof ProviderError
          ? error
          : new ProviderError("UPSTREAM", { cause: error });
      logUpstream(`${provider.id} stream attempt ${attempt + 1}`, error);
      if (!lastError.retryable || attempt === MAX_ATTEMPTS - 1) {
        return errorResponse(lastError.code, 502, undefined, lastError.info);
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  if (!stream) return errorResponse(lastError.code, 502, undefined, lastError.info);

  const encoder = new TextEncoder();
  const send = (event: StreamEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of stream) {
          if (request.signal.aborted) break;
          if (delta.text) controller.enqueue(send({ type: "delta", text: delta.text }));
        }
        controller.enqueue(send({ type: "done" }));
      } catch (error) {
        if (!request.signal.aborted) {
          logUpstream(`${provider.id} mid-stream`, error);
          const pe =
            error instanceof ProviderError
              ? error
              : new ProviderError("UPSTREAM", { cause: error });
          controller.enqueue(
            send({
              type: "error",
              code: pe.code,
              message: pe.code,
              info: pe.info,
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
