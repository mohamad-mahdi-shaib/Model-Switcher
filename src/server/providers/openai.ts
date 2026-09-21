import type { ChatErrorCode, ChatErrorInfo, WireMessage } from "@/lib/chat";
import {
  ProviderError,
  type ChatProvider,
  type ProviderDelta,
} from "@/server/providers/types";

/**
 * OpenAI adapter. The ONLY place the OpenAI wire format is known.
 *
 * Uses the Responses API over plain `fetch` rather than the official SDK: the
 * surface needed here is one streaming POST, and the project has so far added
 * no dependency it did not need. Nothing outside this file learns the endpoint,
 * the event names or the error vocabulary.
 *
 * Chosen from the current documentation on 2026-09-21, not from memory:
 *   - Model: gpt-5.6-luna, the cost-optimised tier at $0.20/$1.20 per MTok,
 *     against $2/$12 for Terra and $10/$50 for Astra. Cheapest current text
 *     model, and the docs describe it as intended for "cost-sensitive,
 *     high-volume workloads".
 *     https://developers.openai.com/api/docs/models
 *   - Streaming: POST /v1/responses with `stream: true`, which emits semantic
 *     SSE events; incremental text arrives as `response.output_text.delta`
 *     with the text in `delta`.
 *     https://developers.openai.com/api/docs/guides/streaming-responses
 *   - Errors: https://developers.openai.com/api/docs/guides/error-codes
 *
 * No endpoint was contacted to discover or verify any of this.
 */

const DEFAULT_MODEL = "gpt-5.6-luna";
const ENDPOINT = "https://api.openai.com/v1/responses";

function model(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Billing exhaustion, as distinct from a temporary rate limit.
 *
 * Both arrive as HTTP 429, which is the trap: retrying a rate limit is
 * reasonable, retrying an unfunded account is not -- it will never succeed and
 * only delays telling the user the real problem. The documented discriminator
 * is `error.code`, with `error.type: insufficient_quota` as the broader form.
 */
const BILLING_CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_quota",
]);

export type OpenAiErrorBody = {
  error?: { message?: string; type?: string; code?: string; param?: string };
};

export type Classified = { code: ChatErrorCode; retryable: boolean };

/** Maps an OpenAI HTTP failure onto the shared error vocabulary. */
export function classifyOpenAi(status: number, body: OpenAiErrorBody | null): Classified {
  const type = String(body?.error?.type ?? "").toLowerCase();
  const code = String(body?.error?.code ?? "").toLowerCase();

  if (status === 429) {
    // Billing first: an unfunded account reports 429 exactly like a throttle.
    if (BILLING_CODES.has(code) || BILLING_CODES.has(type) || type === "insufficient_quota") {
      return { code: "INSUFFICIENT_CREDIT", retryable: false };
    }
    return { code: "RATE_LIMIT", retryable: false };
  }
  if (status === 401 || status === 403) return { code: "INVALID_KEY", retryable: false };
  if (status === 503 || code === "server_is_overloaded" || type === "service_unavailable_error") {
    return { code: "MODEL_BUSY", retryable: true };
  }
  if (status >= 500) return { code: "UPSTREAM", retryable: true };
  if (status === 400 || status === 404 || status === 422) {
    return { code: "BAD_REQUEST", retryable: false };
  }
  return { code: "UPSTREAM", retryable: false };
}

/** Transport faults carry no HTTP status; blaming the provider would be wrong. */
function isNetworkError(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("enotfound") ||
    text.includes("socket hang up") ||
    text.includes("network")
  );
}

/** Retry-After, when the provider supplies one. Never invented. */
export function parseRetryAfter(headers: Headers | undefined): ChatErrorInfo | undefined {
  const raw = headers?.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return { retryAfterSeconds: Math.ceil(seconds) };
}

/**
 * Splits an SSE byte stream into the JSON payloads of its `data:` lines.
 *
 * Only `data:` is read. The `event:` line repeats the `type` already present
 * inside the JSON, and relying on the body alone keeps this robust to an event
 * name changing shape.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; a partial tail waits for more.
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            yield JSON.parse(payload) as Record<string, unknown>;
          } catch {
            // A truncated or non-JSON data line is skipped rather than
            // discarding everything already delivered.
          }
        }
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed.
    }
  }
}

/** Reads an error body without ever surfacing raw provider text to the user. */
async function readErrorBody(response: Response): Promise<OpenAiErrorBody | null> {
  try {
    return (await response.json()) as OpenAiErrorBody;
  } catch {
    return null;
  }
}

export const openaiProvider: ChatProvider = {
  id: "gpt",
  label: "GPT",
  capabilities: { streaming: true, multiTurn: true, cancellation: true },

  availability() {
    const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
    return {
      configured,
      model: model(),
      // "configured" means a key is present on the server. It does NOT mean the
      // key is valid, or that the account has credit; neither can be known
      // without spending a request.
      reason: configured ? undefined : "OPENAI_API_KEY is not set.",
    };
  },

  async stream(
    messages: readonly WireMessage[],
    signal: AbortSignal,
  ): Promise<AsyncIterable<ProviderDelta>> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new ProviderError("MISSING_KEY");

    // The whole conversation goes on every turn; that is what makes follow-ups
    // resolve against earlier context. Roles map straight across.
    const input = messages.map((m) => ({ role: m.role, content: m.content }));

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: model(), input, stream: true }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new ProviderError("ABORTED");
      throw new ProviderError(isNetworkError(error) ? "NETWORK" : "UPSTREAM", {
        retryable: true,
        cause: error,
      });
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      const { code, retryable } = classifyOpenAi(response.status, body);
      throw new ProviderError(code, {
        info: code === "RATE_LIMIT" ? parseRetryAfter(response.headers) : undefined,
        retryable,
        // `cause` stays server-side for logging; the route only ever forwards
        // the code, never provider text.
        cause: new Error(`openai ${response.status}`),
      });
    }
    if (!response.body) {
      throw new ProviderError("UPSTREAM", { retryable: true });
    }

    const stream = response.body;
    return (async function* () {
      try {
        for await (const event of parseSse(stream, signal)) {
          if (signal.aborted) return;
          const type = String(event.type ?? "");

          if (type === "response.output_text.delta") {
            const text = event.delta;
            if (typeof text === "string" && text) yield { text };
            continue;
          }
          if (type === "response.completed") return;
          if (type === "error" || type === "response.failed") {
            // A fault raised partway through, after text may already have been
            // delivered. NDJSON lets the route report it without discarding
            // what arrived.
            const detail = (event.error ?? event.response) as OpenAiErrorBody["error"] &
              { code?: string; type?: string };
            const { code, retryable } = classifyOpenAi(
              500,
              detail ? { error: detail } : null,
            );
            throw new ProviderError(code, { retryable });
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(isNetworkError(error) ? "NETWORK" : "UPSTREAM", {
          retryable: true,
          cause: error,
        });
      }
    })();
  },
};
