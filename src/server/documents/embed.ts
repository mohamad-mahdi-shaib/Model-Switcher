import { GoogleGenAI } from "@google/genai";
import type { DocumentSection } from "@/lib/documents";
import { withRetry } from "@/server/retry";

/**
 * Project 4: chunking and embeddings.
 *
 * WHY GOOGLE AND NOT OPENROUTER. The rest of this project routes models
 * through OpenRouter, so that was the first choice -- but OpenRouter serves
 * **no embedding models at all**: a read of its public catalogue
 * (`GET /api/v1/models`, 468 models) returned zero with embedding output,
 * and the `@openrouter/ai-sdk-provider` `textEmbeddingModel()` method
 * therefore has nothing to call. `@google/genai` is already a dependency and
 * `GEMINI_API_KEY` is already configured, so embeddings add **no new
 * credential and no new service**.
 */

const KEY_ENV = "GEMINI_API_KEY";

/**
 * The embedding model.
 *
 * `text-embedding-004` was the original default and is GONE: a live upload
 * returned 404 "not found for API version v1beta, or is not supported for
 * embedContent". Asking the API what it actually serves
 * (`GET /v1beta/models`) returned exactly three models with `embedContent`
 * support -- `gemini-embedding-001`, `gemini-embedding-2` and
 * `gemini-embedding-2-preview`.
 *
 * `gemini-embedding-001` is chosen because it is the one that BATCHES. Asked
 * for two texts in one call, it returns two vectors; `gemini-embedding-2`
 * returns one, silently dropping the rest. That would have mis-aligned every
 * chunk with its neighbour's vector -- the batch-length check below is what
 * turns that into a loud failure instead, and it is why the check exists.
 */
export function embeddingModelId(): string {
  return process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";
}

/**
 * Vector width requested from the model.
 *
 * `gemini-embedding-001` returns 3,072 dimensions by default. Every vector is
 * stored in the document's blob and read back on every search, so the default
 * would quadruple both the stored size and the per-query parse cost for no
 * measurable retrieval benefit at this scale. 768 is what the previous model
 * produced, and Google documents that a reduced output must be re-normalised
 * -- which `normalise()` already does at write time, for its own reasons.
 */
const OUTPUT_DIMENSIONS = 768;

export function embeddingsConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]?.trim());
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/* ------------------------------------------------------------ chunking -- */

/**
 * Upper bound on a chunk, in characters.
 *
 * The embedding model accepts about 2,048 tokens; at the usual ~4 characters
 * per token that is roughly 8,000 characters. 6,000 leaves headroom for
 * token-dense content (tab-separated spreadsheet rows, minified code) where
 * the ratio is far worse than 4:1.
 */
const MAX_CHUNK_CHARS = 6_000;

/** Below this, a section is merged with its neighbour rather than embedded alone. */
const MIN_CHUNK_CHARS = 200;

export type Chunk = { ref: string; text: string };

/**
 * Turns parser sections into embedding-sized chunks.
 *
 * Sections already carry real structure, so this only fixes the two ways a
 * section can be the wrong size: too long to embed, or so short that its
 * embedding is noise. Crucially, merging only happens between sections that
 * share a citation target -- two halves of page 4 may merge, page 4 and page
 * 5 may not -- because a merged chunk must still be truthfully citable.
 */
export function chunkSections(sections: readonly DocumentSection[]): Chunk[] {
  const chunks: Chunk[] = [];
  let pending: { ref: string; parts: string[]; length: number } | null = null;

  const flush = () => {
    if (!pending) return;
    const text = pending.parts.join("\n").trim();
    if (text.length > 0) chunks.push({ ref: pending.ref, text });
    pending = null;
  };

  for (const section of sections) {
    // Too long: split on paragraph boundaries, keeping the section's own ref
    // on every piece so each remains citable.
    if (section.text.length > MAX_CHUNK_CHARS) {
      flush();
      let buffer: string[] = [];
      let length = 0;
      for (const paragraph of section.text.split(/\n{2,}/)) {
        // A single paragraph longer than the cap is hard-split; nothing else
        // can be done, and it is better than dropping it.
        const pieces =
          paragraph.length > MAX_CHUNK_CHARS
            ? (paragraph.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK_CHARS}}`, "g")) ?? [])
            : [paragraph];
        for (const piece of pieces) {
          if (length + piece.length > MAX_CHUNK_CHARS && buffer.length > 0) {
            chunks.push({ ref: section.ref, text: buffer.join("\n\n").trim() });
            buffer = [];
            length = 0;
          }
          buffer.push(piece);
          length += piece.length;
        }
      }
      if (buffer.length > 0) chunks.push({ ref: section.ref, text: buffer.join("\n\n").trim() });
      continue;
    }

    // Short: merge forward, but only while the citation stays truthful.
    if (pending && pending.ref === section.ref && pending.length + section.text.length <= MAX_CHUNK_CHARS) {
      pending.parts.push(section.text);
      pending.length += section.text.length;
      if (pending.length >= MIN_CHUNK_CHARS) flush();
      continue;
    }

    flush();
    if (section.text.length < MIN_CHUNK_CHARS) {
      pending = { ref: section.ref, parts: [section.text], length: section.text.length };
    } else {
      chunks.push({ ref: section.ref, text: section.text });
    }
  }
  flush();
  return chunks;
}

/* ---------------------------------------------------------- embeddings -- */

/** Requests per batch. Keeps a single call well inside payload limits. */
const BATCH_SIZE = 50;

/** Attempts per batch, including the first. Matches the extraction path. */
const EMBED_MAX_ATTEMPTS = 3;

/** Delay before the first retry; each later wait doubles it. */
const EMBED_BASE_DELAY_MS = 600;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Failures no amount of repeating will fix: a rejected key, an exhausted
 * quota, a request the service refuses to accept.
 */
function isPermanent(message: string): boolean {
  return (
    /(401|403)|api[_ ]?key|permission[_ ]?denied|unauthenticated/i.test(message) ||
    /429|quota|rate[_ ]?limit|resource[_ ]?exhausted/i.test(message) ||
    /(400|404)|invalid[_ ]?argument|not found|unsupported/i.test(message)
  );
}

function client(): GoogleGenAI {
  const apiKey = process.env[KEY_ENV]?.trim();
  if (!apiKey) {
    throw new EmbeddingError(
      "Document search is not configured on this server (GEMINI_API_KEY is required for embeddings).",
    );
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Unit-normalises a vector so cosine similarity reduces to a dot product.
 *
 * Done once at write time rather than on every search: with N chunks and one
 * query, normalising at ingest turns each later comparison into N multiply-
 * adds instead of N square roots.
 */
function normalise(values: number[]): number[] {
  let sum = 0;
  for (const value of values) sum += value * value;
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return values;
  return values.map((value) => value / length);
}

/**
 * Embeds text.
 *
 * `taskType` is not decoration: Gemini's retrieval embeddings are asymmetric,
 * and labelling documents as RETRIEVAL_DOCUMENT and questions as
 * RETRIEVAL_QUERY measurably improves matching over embedding both the same
 * way.
 */
export async function embedTexts(
  texts: readonly string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = client();
  const model = embeddingModelId();
  const out: number[][] = [];

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);

    /**
     * Each batch gets up to EMBED_MAX_ATTEMPTS tries.
     *
     * An upload that dies on one network blip is an upload the user simply
     * cannot make, and a document that will not index cannot be questioned
     * or extracted from -- so the whole feature inherits the flakiness of a
     * single HTTP call. Observed live: `fetch failed` (a dropped TLS
     * connection, no status code) killing an otherwise healthy upload.
     *
     * Only transient classes go round again. A rejected key or an exhausted
     * quota is raised immediately, because repeating it cannot help.
     */
    let response;
    try {
      response = await withRetry(
        () =>
          ai.models.embedContent({
            model,
            contents: batch as string[],
            config: { taskType, outputDimensionality: OUTPUT_DIMENSIONS },
          }),
        {
          attempts: EMBED_MAX_ATTEMPTS,
          baseDelayMs: EMBED_BASE_DELAY_MS,
          shouldRetry: (error) => !isPermanent(messageOf(error)),
          onFailure: (error, attempt) => {
            // The provider's own words, server-side only. No credential
            // appears in a provider error body.
            console.error("[embed] provider call failed", {
              model,
              batch: batch.length,
              attempt,
              of: EMBED_MAX_ATTEMPTS,
              permanent: isPermanent(messageOf(error)),
              message: messageOf(error),
            });
          },
        },
      );
    } catch (error) {
      const message = messageOf(error);
      if (/quota|rate|429|resource[_ ]?exhausted/i.test(message)) {
        throw new EmbeddingError(
          "The embedding service is rate limited right now. Wait a moment and try the upload again.",
        );
      }
      if (/api[_ ]?key|permission|401|403|unauthenticated/i.test(message)) {
        throw new EmbeddingError("The embedding service rejected this server's credentials.");
      }
      if (/(400|404)|invalid[_ ]?argument|not found|unsupported/i.test(message)) {
        throw new EmbeddingError(
          "The embedding service rejected the request — the configured embedding model may not be available.",
        );
      }
      throw new EmbeddingError(
        `The document could not be indexed: the embedding service failed ${EMBED_MAX_ATTEMPTS} times. This is usually temporary — try the upload again.`,
      );
    }

    const embeddings = response.embeddings ?? [];
    // Not defensive paranoia: `gemini-embedding-2` really does return one
    // vector for a batch of two. Without this, chunk 2 would silently inherit
    // chunk 1's vector and every later search would be subtly wrong.
    if (embeddings.length !== batch.length) {
      throw new EmbeddingError(
        `The embedding service returned ${embeddings.length} vectors for ${batch.length} texts.`,
      );
    }
    for (const embedding of embeddings) {
      const values = embedding.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw new EmbeddingError("The embedding service returned an empty vector.");
      }
      out.push(normalise(values));
    }
  }
  return out;
}

/** Dot product of two unit vectors == cosine similarity. */
export function similarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += a[i] * b[i];
  return total;
}
