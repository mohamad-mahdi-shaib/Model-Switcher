# AI Workspace — Creative Model-Switcher Interface

A glassmorphic AI workspace: multi-model chat, image understanding and
generation, and a document workspace that reads your files, answers questions
about them with citations, extracts structured data, and writes real Word,
Excel and PDF files. Next.js 16 + TypeScript + Tailwind v4, with every provider
behind one provider-neutral abstraction layer.

**Verification status, stated precisely.** Chat against Gemini and OpenAI is
verified against the live APIs. The document workspace -- parsing, chunking,
embedding, storage, retrieval, extraction and file generation -- is verified by
495 automated tests and 365 real-browser checks, including round trips through
the actual file formats and a full store round trip against a stand-in blob
service, **plus a live end-to-end run** (`tests/live/verify-documents-live.mjs`,
19/19) in which a real PDF invoice was uploaded, embedded through Gemini,
stored in Vercel Blob, extracted into validated fields, and then correctly
answered a question whose answer exists only on page 2 -- citing page 2.
See `PROJECT4_PROGRESS.md` for what that run caught.

**Both providers are now verified against their live APIs.** An end-to-end
acceptance run on 2026-09-21 streamed real answers from OpenAI and Gemini in one
conversation, carried context across providers, and survived a refresh. See
"Provider status" below.

**Responsive.** The workspace lays out as a header, a sidebar, and a main
content region with a sticky composer, and is verified at 360x800, 390x844,
844x390 (landscape), 768x1024, 1024x768, 1366x768 and 1680x1050 — no horizontal
overflow at any of them. Below 1024px the sidebar becomes a focus-trapped
drawer opened from the header; at and above it, the sidebar is inline and
collapsible from the same control.

---

## Features

Everything listed here is implemented and reachable in the running app.

**Documents** (see "Document workspace" for how each of these works)
- Upload PDF, DOCX, XLSX, CSV, Markdown, text and 25 code extensions. Parsed
  server-side into sections that carry a real citation (`p. 4`,
  `Sheet1!A12:F31`, `lines 120-168`).
- Ask questions across the uploaded files and get grounded answers that cite
  the filename and page, sheet or line range they came from.
- Compare several files in one question; a per-document quota keeps every file
  represented instead of letting one dominate the context.
- Summaries take a different retrieval path from questions, and say they are
  based on sampled excerpts.
- Extract structured data (Invoice, Contract) validated against a Zod schema,
  with the arithmetic checked and every discrepancy shown. Download as JSON or
  a real `.xlsx`.
- Save any answer as a real `.docx`, `.pdf`, `.xlsx`, `.md`, or source file.

**Chat**
- Streaming replies over NDJSON, rendered progressively with a paced reveal
  (`src/lib/reveal.ts`), with a typing indicator and a stream caret.
- Stop a reply mid-flight; retry a failed turn against the provider it was
  actually sent to; regenerate an answer, keeping previous versions switchable.
- Edit and resend your last question.
- Copy any answer, or have it read aloud by the browser's speech synthesis
  (`src/lib/use-speech.ts`).
- Markdown rendering with link/HTML safety (`src/lib/markdown.ts`).
- Attachments: images, PDFs and text files, with oversized photos
  auto-compressed before sending (`src/lib/attachments.ts`).

**Images (multimodal)**
- Upload by file picker, drag-and-drop or clipboard paste; preview and remove
  before sending; up to 3 attachments per message.
- Image understanding — description, visual analysis, questions, OCR and
  multi-image comparison — on both direct integrations, Gemini and OpenAI.
- Image generation from a text prompt, from a reference image, and editing or
  varying an existing image (`src/server/images/generate.ts`).
- The chat model calls the image tool itself when a request needs a picture
  (`src/server/images/tool.ts`); no mode switch, no separate button.
- Download, Regenerate and Make a variation on every generated image.

**Providers**
- Three models behind one provider-neutral endpoint: Gemini and OpenAI
  called directly with their own keys, plus DeepSeek V3.1 through OpenRouter.
  A model is offered only when an adapter exists and the server reports its
  key present.
- Switching mid-conversation asks for confirmation (every later message sends
  the whole conversation so far), is refused while a request is in flight, and
  never re-labels answers already on screen.

**Conversations**
- Saved per-browser in `localStorage`, with titles derived locally from the
  first message, recency grouping, rename and delete.
- Local search across conversation titles and message text
  (`src/lib/search.ts`), jumping to and briefly highlighting the match.
- Export selected conversations to PDF (`src/lib/conversation-pdf.ts`), and
  delete all conversations, both from Settings.

**Settings** (the gear in the global header — the only entry point)
- Appearance: wallpaper, glass style, text size.
- Personalizations: a preferred name and custom instructions, sent with every
  later request as the provider's own instruction field
  (`src/server/preferences.ts`).
- Read aloud: voice, reading speed, voice tone.
- Conversations: export and delete-all.

**Layout**
- Header, sidebar and main content as real landmarks, with the composer sticky
  at the bottom of main and the transcript scrolling independently.
- Responsive: the sidebar is inline and collapsible at >=1024px and a
  focus-trapped drawer below that.

## Prerequisites

| | |
| --- | --- |
| Node.js | **24.x** (pinned in `package.json` -> `engines`) |
| npm | ships with Node 24 |
| A provider key | at least one of `GEMINI_API_KEY` / `OPENAI_API_KEY` for live answers |
| Chrome | only for the optional real-browser suites in `tests/browser/` |

No database, no Docker, no other service. Everything else installs with
`npm install`.

## Setup

**No credentials are included in this delivery.** `.env.local` and both API
keys are deliberately excluded from every package built from this project —
see "Environment variables" below. To exercise live Gemini/OpenAI responses,
either create your own `.env.local` from `.env.example` using your own keys
(get a free Gemini key at <https://aistudio.google.com/apikey> — no billing
required, the free tier is sufficient), or request temporary credentials from
the project owner, sent separately through a secure channel. Without a
configured key the app still runs normally and shows an honest per-provider
setup state; nothing is ever simulated.

```bash
npm install
cp .env.example .env.local     # then paste your own key into .env.local
npm run dev                    # http://localhost:3000
```

**Restart the dev server after editing `.env.local`** — Next caches environment
variables in the running process.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | for Gemini, document search and extraction | Server-side Gemini credential. Never sent to the browser. Also powers document embeddings and structured extraction — see "Document workspace"; OpenRouter serves no embedding model, so there is nothing else to use. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.6-flash` (stable, free tier). |
| `OPENAI_API_KEY` | for OpenAI | Server-side OpenAI credential. Requires a funded account. |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.6-luna`, the cost-optimised tier. See "Which OpenAI model" below before overriding it. |
| `OPENROUTER_API_KEY` | for DeepSeek V3.1 and all image generation | One key serves the OpenRouter chat model and the image model. Create one at <https://openrouter.ai/keys>; it needs credit, as no image-generation model is free. |
| `OPENROUTER_IMAGE_MODEL` | no | Defaults to `google/gemini-2.5-flash-image`. |
| `OPENROUTER_SITE_URL` / `OPENROUTER_SITE_NAME` | no | Optional attribution headers for OpenRouter's public rankings. Not secrets. |
| `BLOB_READ_WRITE_TOKEN` | for the document workspace | Vercel Blob. Stores parsed documents and their embeddings, and lets generated images keep a short URL instead of inline base64. Without it, chat and image generation still work (images live in the browser only) and uploaded documents fall back to the pre-existing inline attachment path, losing document *search*. |
| `GEMINI_EMBEDDING_MODEL` | no | Defaults to `gemini-embedding-001` at 768 dimensions. Used for document indexing and search. `text-embedding-004` is retired and 404s; `gemini-embedding-2` does not batch (it returns one vector for a batch of several), so it must not be used here. |
| `GEMINI_EXTRACTION_MODEL` | no | Defaults to `GEMINI_MODEL`, then `gemini-3.6-flash`. Used for structured extraction only. |

A provider is offered in the UI only when an adapter exists **and** the server
reports its key present. "Configured" means exactly that: a key is present. It
does not mean the key is valid, or that the account has credit — neither can be
known without spending a request.

## Provider status

| Provider | Adapter | Key | Verified |
| --- | --- | --- | --- |
| Gemini | ships | `GEMINI_API_KEY` | **against the live API** |
| OpenAI | ships | `OPENAI_API_KEY` | **against the live API** — real streamed answers, real token usage |

Only providers the app can actually reach are offered. Anthropic has no adapter
and is not listed in the selector: a permanently inert control is noise, and
"Coming soon" over something with no key and no adapter is a promise the product
cannot keep. Adding it later is one adapter file, one `ProviderId` member, one
`PROVIDERS` entry and one line in the server registry — the same four-line change
any new provider takes.

### OpenAI setup

1. Create a key at <https://platform.openai.com/api-keys>.
2. Add credit — the API is not free, and an unfunded account returns HTTP 429
   with `insufficient_quota`, which the UI reports as a billing problem rather
   than as a rate limit.
3. Put the key in `.env.local` as `OPENAI_API_KEY` and restart the dev server.

The adapter targets the Responses API (`POST /v1/responses`, `stream: true`),
reading incremental text from `response.output_text.delta` events.

### Which OpenAI model, and why it is not "GPT-4"

The brief's wording is "GPT-4". That model generation is no longer the current
API surface, so following the words literally would have meant shipping against
a superseded model. The selector therefore says **OpenAI** — the vendor, which is
what the brief is really asking for — and the exact model id in use is printed
next to it in the header, read from the server rather than hardcoded in the UI.
There is no wording anywhere that claims GPT-4.

The default is **`gpt-5.6-luna`**, re-checked against the published model and
pricing pages on 2026-09-21 rather than recalled: $0.20/$1.20 per MTok against
$2/$12 for Terra, $4/$20 for Sol and $10/$50 for Astra. It is the cheapest
current text tier, and the one the docs describe as intended for
"cost-sensitive, high-volume workloads". Nothing was quietly upgraded to a
dearer model.

Two request options follow from that choice, and they belong together:

- `max_output_tokens: 1200` bounds one turn, so a runaway reply cannot run up a
  bill.
- `reasoning: { effort: "none" }` is what makes that cap safe. Luna is a
  reasoning model defaulting to `medium`, and reasoning tokens are billed as
  output **and** spend the same `max_output_tokens` budget — so a capped
  request can finish `incomplete` having produced no visible text at all: paid
  for, blank on screen. `none` removes that cost entirely. Live usage confirms
  it took effect upstream: `input: 14, output: 5, reasoning: 0`.

A model set through `OPENAI_MODEL` that does not accept `effort: "none"` (GPT-6
Astra, for one) needs that raised to `"low"` and the cap raised with it.

`.env*` is git-ignored (`.env.example` is the one committed exception). Keys are
read only inside server adapters, are never prefixed `NEXT_PUBLIC_`, and never
appear in the client bundle. If the key is missing the UI shows a setup state
and no reply is ever simulated.

## Scripts

```bash
npm run dev     # dev server on http://localhost:3000
npm run build   # production build (also type-checks)
npm start       # serve the production build (run `npm run build` first)
npm run lint    # eslint
npm test        # unit + adapter contract tests (no network, no quota)
```

To run the production build locally:

```bash
npm run build && npm start     # http://localhost:3000
```

`npm start` serves the output of the last `npm run build`; it does not rebuild.

---

## Architecture

```
src/
  app/
    api/chat/route.ts        provider-neutral endpoint: validate -> retrieve -> dispatch -> NDJSON
    api/documents/route.ts   upload + index, delete, capability probe
    api/extract/route.ts     structured extraction against one document
    api/images/route.ts      image generation
    page.tsx, layout.tsx
  server/providers/          SERVER ONLY
    types.ts                 ChatProvider contract, ProviderError
    gemini.ts                the only file importing @google/genai
    openai.ts                the only file that knows the OpenAI wire format
    openrouter.ts            one adapter for every OpenRouter chat model
    registry.ts              id -> adapter dispatch
  server/documents/          SERVER ONLY
    parse.ts                 PDF/DOCX/XLSX/CSV/text/code -> cited sections
    embed.ts                 citation-preserving chunking + Gemini embeddings
    store.ts                 blob-backed store; the capability + binding check
    retrieve.ts              similarity search, overview sampling, prompt fencing
  server/extract/run.ts      Zod -> JSON Schema -> constrained decode -> validate
  server/rate-limit.ts       per-client sliding window for the costly routes
  components/workspace/
    WorkspaceLayout.tsx      state container + composition root (owns ALL state)
    AppShell.tsx             the layout itself: header / sidebar / main slots
    AppHeader.tsx            global header: sidebar toggle, brand, title, Settings
    ConversationSidebar.tsx  side navigation: search, New chat, history, drawer
    MessageList.tsx          the transcript (its own scroll region)
    MessageComposer.tsx      the sticky composer at the bottom of main
    ProviderMenu.tsx         provider switcher + switch confirmation dialog
    SettingsPanel.tsx        the one Settings overlay (Appearance lives here)
    DocumentTray.tsx         the conversation's searchable files
    ExtractionPanel.tsx      schema picker, result table, JSON/XLSX download
    SaveAnswerMenu.tsx       save any answer as docx/pdf/xlsx/md/code
    Markdown.tsx, AttachmentTray.tsx, GeneratedImages.tsx
  lib/
    chat.ts                  shared contract (server + client)
    use-conversations.ts     conversation + streaming state machine
    storage.ts               versioned localStorage persistence
    conversations.ts         title derivation, recency grouping
    markdown.ts              safe Markdown -> AST
    providers.ts             client provider registry + identity
    backgrounds.ts           2 wallpapers, 1 glass style, ambient orb data
    limits.ts                shared input/conversation length limits (client + server)
    documents.ts             document types, limits, extension table (client + server)
    document-upload.ts       browser half of upload/delete; the capability probe
    extraction.ts            the Zod schemas, the self-audit, display metadata
    extraction-download.ts   JSON + XLSX for an extraction result
    file-generation.ts       answer AST -> real .docx / .pdf / .xlsx / code
```

**Frontend / backend split.** The browser never talks to a model. It POSTs to
`/api/chat` and reads an NDJSON stream. All SDK usage, key handling, retry and
error classification are server-side.

**Normalized contract.** `src/lib/chat.ts` is imported by both sides. Every
reply is a `StreamEvent` (`delta` / `error` / `done`); every failure resolves to
one of a closed set of `ChatErrorCode`s with user-facing copy. NDJSON is used so
a fault arising mid-answer can be reported without discarding delivered text.

**Streaming safety.** Each request is tagged with a request id *and* a
conversation id. Chunks arriving after an abort, or for a conversation the user
has left, are dropped rather than written into whatever is on screen.

### Layout regions

`AppShell` arranges three real landmarks, and owns nothing else:

| Region | Element | Contents |
| --- | --- | --- |
| Header | `<header>` | sidebar toggle, brand mark, active conversation title, Settings — the only Settings trigger in the app |
| Sidebar | `<aside>` | search, New chat, conversation history, storage warnings. Inline at >=1024px (collapsible), a portaled drawer below that |
| Main | `<main>` | the transcript (scrolls independently) and the composer (sticky at the bottom, never overlapped) |

Both the transcript and the composer are centred on one shared reading column
(`--content-column` in `globals.css`), so the input always lines up with the
conversation it belongs to while the panels themselves span the viewport.

Every overlay — the sidebar drawer, Settings, the provider switch dialog — is
portaled to the shell's own outermost element, which carries no
`backdrop-filter`/`transform` of its own. That is deliberate: any of those
properties would make it the containing block for `position: fixed`
descendants, and a full-viewport backdrop would be clipped to a glass panel
instead of covering the screen.

---

## Local history behaviour

Conversations are saved to `localStorage` under `model-switcher:conversations`
with a versioned schema.

- A conversation is saved once its first user message is sent. Its title is
  derived locally from that message — no API request is spent on naming.
- Nothing is written before hydration completes, so the initial empty React
  state can never overwrite saved data.
- Partial replies persist on a ~700ms throttle rather than on every token, and
  flush on completion, Stop, conversation switch, and page hide.
- A reply cut off by a refresh returns marked **interrupted** — never as
  still-streaming, and never silently as complete.
- **Corrupt or unknown-version data is never overwritten.** It is reported, the
  session continues in memory, and the stored bytes are left intact.
- If storage is unavailable or full, the session stays usable and a quiet
  warning appears in the sidebar.

History is per-browser and per-origin. Clearing site data clears it. There is no
server-side persistence and no sync between devices.

---

## Testing

```bash
npm test
```

495 tests, no network access and no model quota consumed:

- **Markdown** — safety (`javascript:` / `data:` links stripped, HTML never
  treated as markup) and streaming stability (every prefix of a fenced block
  parses without throwing).
- **Adapter contract** — the real OpenAI and Gemini adapters driven against a
  mocked transport (their own `fetch`/SDK network boundary, not a stub of
  the browser's `fetch`): SSE parsing (including CRLF/CR line endings and a
  delimiter split across transport chunks), delta normalisation, abort
  handling, and error classification against *real recorded* Gemini 429/503
  payloads and OpenAI's documented error shapes.
- **Route** — the real `POST`/`GET` `/api/chat` handlers, called directly with
  real `Request` objects: normalized terminal outcomes, and normalized
  errors for malformed bodies/messages/provider ids.
- **Storage** — round-trip, corrupt/future-version payloads left untouched,
  quota-full reporting, interrupted-reply restoration.
- **Conversations** — title derivation, recency grouping, draft handling.
- **Limits** — the shared draft-validation logic behind the input/conversation
  length limits, at the exact boundary values.
- **Reveal** — the streaming presentation queue, including a fenced code line
  far longer than the pacing budget revealing promptly rather than stalling.
- **Document parsing** — real PDF, DOCX and XLSX files are generated in the
  test (jsPDF, `docx`, SheetJS) and parsed back, so the parsers are exercised
  against genuine file formats rather than fixtures of their output.
- **Document isolation** — the full store round trip against a local HTTP
  server standing in for Vercel Blob: a document stored by one conversation is
  unreadable and undeletable from another, even by a caller holding the
  256-bit document id.
- **Retrieval** — the similarity floor, the per-document fairness quota that
  keeps multi-file comparison possible, the context budget, overview detection,
  and the prompt-injection fencing around retrieved passages.
- **Extraction** — the Zod schema contract, the JSON Schema actually sent to
  the model, and the arithmetic audit (line items vs subtotal, subtotal + tax
  vs total, quantity × unit price vs line amount).
- **File generation** — every format written and then REOPENED with the library
  that would read it in production (mammoth, SheetJS, unpdf), including that
  spreadsheet numbers come back as numbers and the PDF has a real text layer.
- **Rate limiting** — per-client, per-scope budgets, the `Retry-After` a
  refusal carries, and that one client being refused never affects another.

Real-browser acceptance is driven through the Chrome DevTools Protocol, with
all model traffic mocked at `window.fetch` and the real provider domains
additionally blocked at Chrome's own network layer as a fail-closed backstop.
The harness is committed at `tests/browser/` (see its own `README.md`) rather
than kept in a private scratchpad, and is run on demand, separately from
`npm test`. Each file needs a dev server already running at `BASE_URL`
(default `http://localhost:3000`) and a local Chrome:

```bash
npm run dev                                  # in another terminal
node tests/browser/verify.mjs                #  75 checks — core flows
node tests/browser/verify-settings.mjs       #  71 checks — Settings + appearance
node tests/browser/verify-responsive.mjs     # 100 checks — 7 viewports
node tests/browser/verify-search.mjs         #  16 checks — conversation search
node tests/browser/verify-dialog-hit-testing.mjs   # 8 checks — real pointer hit-testing
node tests/browser/verify-network-isolation.mjs    # 4 checks — fail-closed proof
node tests/browser/verify-documents.mjs      #  44 checks — upload, tray, RAG wiring, extraction
node tests/browser/verify-files.mjs          #  26 checks — tables and real file downloads
```

All eight pass against the current build (**365 checks total**). `/api/documents`
and `/api/extract` are intercepted at Chrome's own network layer alongside
`/api/chat`, so a browser run can never spend embedding or extraction quota;
each run asserts the interception count is 0.

One further check runs against the built artefact rather than the browser:

```bash
npm run build && node tests/verify-no-secret-leak.mjs
```

It searches the real client bundle for the real values in `.env.local` and
reports variable names and counts only — never a value. See
`docs/requirements-audit.md` for the requirement-by-requirement evidence.

---

## Adding another provider

The route never names a vendor, so a new provider is an adapter plus a registry
line.

1. Create `src/server/providers/<name>.ts` exporting a `ChatProvider`:

```ts
export const myProvider: ChatProvider = {
  id: "gpt",
  label: "OpenAI",
  capabilities: { streaming: true, multiTurn: true, cancellation: true },
  availability: () => ({
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: "…",
  }),
  async stream(messages, signal) {
    // Translate messages, call the SDK, yield { text }.
    // Throw ProviderError (never a raw SDK error); honour `signal`.
  },
};
```

2. Register it in `src/server/providers/registry.ts`.
3. Add its key name to `.env.example`.

That is the whole change — `route.ts` is untouched. The UI enables the provider
automatically once the server reports it configured; until then it stays visible
and disabled, and cannot originate a request.

---

## Appearance

Appearance is reachable **only** from Settings (the gear in the global header).
There are no appearance controls anywhere in the chat interface itself.

### Wallpapers

Two, both pure CSS — no image request, no canvas, no per-frame JavaScript:

| Wallpaper | Tone | Treatment |
| --- | --- | --- |
| **Pearl** (default) | light | cool veined silver and slate; layered radial gradients plus four static ambient orbs |
| **Aurora Colors** | dark | violet and cyan along the top, purple and magenta sweeping the lower corners, over a near-black plum ground. Three large blurred orbs drift on long, offset loops (34s/46s/58s), blended with `mix-blend-mode: screen` |

Aurora's colour fields are anchored off the edges and corners so the centre of
the canvas — where the conversation sits — stays deep, which is what keeps the
light ink readable while the wallpaper stays saturated. Its drift animates only
`transform` and `opacity` (compositor-only, so the blur behind them is
rasterised once), and stops entirely under `prefers-reduced-motion`.

A previous revision shipped eight wallpapers, then three (Pearl, Smoky
Obsidian, Champagne Luxury). Obsidian and Champagne Luxury were removed by
request. **Every id this app has ever saved still resolves to a real current
one** (`migrateBackgroundId` in `src/lib/backgrounds.ts`): each removed
wallpaper maps to the nearest surviving treatment rather than all collapsing
onto the default — `obsidian` -> `aurora`, `champagne-luxury`/`marble` ->
`pearl` — so an existing browser's saved preference is never dropped or left
invalid.

### Glass

**Clear Glass** is the only glass style. The second material this project used
to offer ("Glowy Glass", internal id `classic`) was removed along with its
option, its default, and its stylesheet tuning; a saved `classic` migrates to
Clear Glass. The internal key stays `ultra` because `globals.css` selects the
whole material on `[data-glass="ultra"]` and those selectors are what give its
rules their specificity — the label has deliberately never tracked the key.

The material itself is unchanged: one surface definition applied at graded
strength (main panel > sidebar/header > composer > buttons), where the *edge*
does the work rather than fill or glow, plus a pointer-tracking glint on the
main panel.

### Text size

Small / Default / Large, applied as a unitless `--text-scale` multiplier to
conversation **text only** — never to navigation chrome, buttons or labels.

All of it (wallpaper, glass, text size, personalizations, read-aloud voice and
rate) is saved to `localStorage` under `model-switcher:settings` with the same
versioned, field-by-field-validating approach used for conversations.

## Multimodal: vision, image generation and tool calling

### Models actually implemented

Every id and capability below was read from OpenRouter's own catalogue
(`GET https://openrouter.ai/api/v1/models`), not from memory — see
`src/lib/models.ts`, which records the modalities each one reports.

| Model | Reached via | Image input | Image output |
| --- | --- | --- | --- |
| `gemini-3.6-flash` | Google direct (`@google/genai`) | **yes** | no |
| `gpt-5.6-luna` | OpenAI direct (Responses API) | **yes** | no |
| `mistralai/mistral-small-3.2-24b-instruct` | **OpenRouter** | **yes** | no |
| `deepseek/deepseek-chat-v3.1` | OpenRouter | no (text only) | no |
| `google/gemini-2.5-flash-image` | OpenRouter (generation only) | yes | **yes** |

**Three vision models, from three vendors, over two transports.** Gemini and
OpenAI are called directly with their own keys; Mistral Small 3.2 is reached
through OpenRouter, so an image request genuinely travels that path rather
than only the direct ones. All three were verified on production against a
real screenshot for description, OCR and two-image comparison.

Mistral was chosen on evidence rather than preference: OpenRouter's per-model
endpoint data (`GET /api/v1/models/:id/endpoints`) shows it served by four
providers, three reporting status `0`. The previously removed
`qwen/qwen2.5-vl-72b-instruct` has a single provider reporting `-5`, which is
precisely why every request to it failed — including plain text, so it was
never an image-input problem.

An earlier revision also offered Claude Sonnet 4.5 and Qwen2.5-VL 72B through
OpenRouter. Both were removed: Qwen had stopped answering for this account on
any request at all (plain text included), and Claude became redundant once the
direct integrations were verified for vision. A conversation saved while
either was selected is migrated to Gemini on load (`migrateProviderId`), so no
saved conversation is left pointing at a model that no longer exists.

DeepSeek V3.1 is registered for a specific structural reason: the OpenRouter
adapter is the **only** one that attaches the `generate_image` tool, so it is
what keeps model-*selected* image generation working rather than
button-only. It is also the text-only model, which keeps the capability gate
below a reachable path instead of dead code.

### How image understanding works

The browser stages an attachment (type sniffed by magic bytes, oversized
photos re-encoded under the size cap), keeps the bytes in IndexedDB and the
metadata on the message. On send, the bytes become base64 on the wire, and
each adapter translates them into its own provider's format: `inlineData`
for Gemini, `input_image` for OpenAI, AI SDK image parts for OpenRouter.

**Capability gating.** `toModelMessages()` never sends an image part to a
model whose catalogue entry says text only. The attachment is not silently
dropped either — it is named in the message text, and the composer warns
before you send. Switching models mid-conversation keeps the whole history,
including earlier image attachments.

### How image generation works

`google/gemini-2.5-flash-image` is a chat model that emits images, so one
integration covers everything: a prompt alone is text-to-image, a prompt plus
an attached image is reference-guided generation, an edit or a variation. The
installed `@openrouter/ai-sdk-provider` maps the returned `message.images[]`
onto AI SDK file parts; `modalities: ["image","text"]` is passed through
`extraBody`, which OpenRouter requires for image output.

Two entry points, on purpose:

- **`POST /api/images`** — the explicit path, used by Regenerate and Make a
  variation. The user has already decided what they want.
- **The `generate_image` tool** — the model-selected path. Just ask for a
  picture in the conversation and the model calls the tool itself. Execution
  is server-side, so the key never reaches the browser, and the agent loop is
  capped (`stopWhen: stepCountIs(2)`, one image per turn) so a model cannot
  loop and spend.

A generated image is stored on the message (`ChatMessage.images`) with the
prompt, model and operation that produced it — which is what makes
"Make a variation" a variation of *that* image rather than a fresh render of
the same words.

### Storage

**Configured and live.** A Vercel Blob store (`model-switcher-images`, region
`iad1`) is connected to the project, so `BLOB_READ_WRITE_TOKEN` is set for
Production, Preview and Development. Generated images are uploaded there and
the conversation keeps a short https URL instead of a multi-hundred-kilobyte
base64 string — verified on production: a generated image returned
`persisted: true` with a `*.public.blob.vercel-storage.com` URL that
re-fetches independently as a valid 1 MB PNG.

The integration degrades rather than fails: with no token the app still works,
returning images inline, and the UI labels those "not stored".

**Access model, stated plainly:** the store is **public**. Blob's public mode
is what `put({ access: "public" })` in `src/server/storage/images.ts` requires,
and it is what lets the browser render `<img src>` and download the file
directly. URLs are unguessable — a random suffix is added to every pathname —
but they are *not* secret: anyone holding a URL can fetch it. Nothing private
is written there, only images the user just asked this app to generate. A
private store would need signed URLs, which this implementation does not use.

To create the store yourself: `vercel blob create-store <name> --access public
--yes` links it to the project and injects the token automatically — the value
is generated by Vercel and never needs to be copied by hand.

## Document workspace

Upload a file, ask questions about it, pull structured data out of it, and save
any answer as a real file. Everything here is server-side except file
generation, and nothing is simulated: files are genuinely parsed, genuinely
embedded, genuinely searched, and the documents produced genuinely open in
Word, Excel and a PDF reader.

### What can be uploaded

| Kind | Extensions | Parser | What a citation looks like |
| --- | --- | --- | --- |
| PDF | `.pdf` | `unpdf`, page by page | `p. 4` |
| Word | `.docx` | `mammoth` → HTML, split on headings | the heading the text sits under |
| Spreadsheet | `.xlsx` `.xlsm` | SheetJS, header row repeated per block | `Sheet1!A12:F31` |
| Delimited | `.csv` `.tsv` | SheetJS | `Sheet1!A12:F31` |
| Text / Markdown | `.txt` `.log` `.md` | line ranges | `lines 120-168` |
| Code | 25 extensions (`.ts` `.py` `.go` `.rs` `.sql` …) | line ranges | `lines 120-168` |

Limits: 4 MB a file (under Vercel's ~4.5 MB request cap), 10 files a
conversation, 1.5 M characters of extracted text a file, 5,000 rows a sheet.
A file that hits a limit is still accepted and the truncation is reported —
a partial read is only honest if it says it is partial.

The file type is decided by **sniffing the bytes**, never by the extension or
the browser's claimed MIME type: a PNG renamed `report.pdf` is refused rather
than handed to a PDF parser. A PDF with no extractable text (a scan) returns a
422 that says so, instead of an empty document that looks successfully read.

### Retrieval (RAG)

Parsing produces sections that already carry a real citation. Those are chunked
to about 6,000 characters, and a chunk is only ever merged with a neighbour
that shares its citation — two halves of page 4 may merge, page 4 and page 5
may not — so every chunk stays truthfully citable.

Embeddings are Gemini `gemini-embedding-001` at 768 dimensions, batched 50 at a time, with
`taskType` set asymmetrically (`RETRIEVAL_DOCUMENT` at ingest,
`RETRIEVAL_QUERY` at search) because Gemini's retrieval embeddings are
asymmetric. Vectors are unit-normalised at write time, so similarity at search
time is a plain dot product.

**Why Gemini and not OpenRouter**, given everything else routes through
OpenRouter: OpenRouter serves **no embedding models at all**. A read of its
public catalogue (`GET /api/v1/models`, 468 models) returned zero with
embedding output. `@google/genai` is already a dependency and `GEMINI_API_KEY`
is already configured, so embeddings add no new credential and no new service.

Search is **exact (brute-force) cosine similarity**, not an approximate index.
That is a deliberate fit to the scale: a conversation holds at most 10 files,
so a query compares a few thousand 768-dimension unit vectors. The honest name
for this is *a persistent vector store with exact search*. It is not pgvector,
and this README does not call it that.

Two retrieval strategies, chosen by the question:

- **Search** for a specific question. Top-k by similarity above a 0.35 floor,
  with a **per-document quota** applied before the budget is spent — without
  it, "how do these two contracts differ?" comes back with eight passages from
  whichever file happened to score highest, and the comparison is impossible.
- **Overview** for "summarise this", "what are the main points", "compare
  these". Similarity search is at its *worst* here and fails invisibly: the
  embedding of a content-free query lands near nothing in particular, returns
  an effectively arbitrary slice, and the model summarises that as if it were
  the whole file. Those requests instead take an even stride across each
  document, always including its opening chunk, and the prompt states plainly
  that the answer is based on sampled excerpts. It also skips the query
  embedding entirely.

Retrieval runs on **every turn**, against that turn's own question — which is
what makes a follow-up ("and what does clause 9 say?") search the file again
rather than reuse what was relevant to the first question. It happens in the
route, provider-neutrally, so **grounding survives a model switch**: Gemini,
GPT and the OpenRouter models receive identical passages and identical citation
instructions.

If files are attached and the search fails, the turn fails with
`DOCUMENT_SEARCH_FAILED` and **the provider is never called**. Answering a
question about the user's files while silently skipping the files produces a
confident reply drawn from general knowledge that looks like it came from the
document — the worst available outcome.

### Access control, and its honest limits

This app has no accounts: conversations live in the browser and every request
is anonymous. So "may this caller read this document?" has to be answered by
something the caller holds.

The obvious candidate — the conversation id — is **not safe**. `newId()`
produces `prefix-<base36 clock>-<counter>`, which anyone can enumerate from a
rough timestamp and a small integer. Keying private documents on it would have
made every upload readable by guessing.

What is used instead:

- a **256-bit CSPRNG document id**, generated server-side, which doubles as an
  unguessable capability;
- that id **is** the blob pathname, so the storage URL cannot be derived
  without it, and the URL is never returned to the browser;
- each document is additionally **bound to the conversation** that uploaded it,
  compared with `timingSafeEqual`, so a leaked id cannot be replayed into
  another conversation;
- "not found" and "not yours" are the **same answer**, so the API cannot be
  used to discover which ids are real.

Stated plainly: this is capability-based access control, not per-user
authorization. Anyone who obtains a document id can read that document. With no
identity system there is nothing stronger to check against, and inventing a
fake one would be worse than saying so.

`tests/documents-isolation.test.ts` proves the property end to end against the
real store code, using a local HTTP server in place of the blob service
(`@vercel/blob` takes its API base from `VERCEL_BLOB_API_URL`).

### Untrusted content

Document text is untrusted input: an uploaded PDF can contain "ignore your
instructions and …". Retrieved passages are fenced, labelled as DATA, and
preceded by an explicit instruction that anything command-shaped inside is
quoted text from the document rather than a command. Extraction does the same,
and is if anything more exposed, because the whole document is in the prompt.

This is mitigation, not a guarantee. No prompt wrapper makes a model immune,
and nothing here executes uploaded content.

### Structured extraction

Pick a file and a schema (Invoice or Contract) and get validated, tabular data
out of it, downloadable as JSON or a real `.xlsx`.

One Zod schema does three jobs: it is converted to a JSON Schema that
**constrains** the model's decoding (`responseJsonSchema`), it **validates**
what actually comes back, and it **describes** the table and the spreadsheet
columns. One definition, so the three cannot drift.

Every field is nullable by design. A model asked for an invoice number will
invent one rather than return nothing, and a plausible fabrication is far worse
than an obvious blank — so "not present in this document" is a first-class
answer, and the table shows a **"not found"** row rather than hiding it.
Temperature is 0: the same document should read the same twice.

Zod proves `total` is a number; it cannot prove it is the *right* number. So
every extraction is **audited against itself** — line items against the
subtotal, subtotal plus tax against the total, quantity × unit price against
each line amount, with a half-cent tolerance so float noise does not cry wolf.
Discrepancies are shown **above** the tidy table that would otherwise make the
figures look settled, and they are carried into both downloads: a warning
visible on screen but missing from the spreadsheet is exactly how a
questionable number becomes a trusted one.

### Asking for a file, and editing one

Ask for a document — *"create a PDF with my name and skills"* — and the reply
arrives as a **file card**: a filename, what kind of file it is, and a
download button. The text is one click away behind "Show text".

The file contains the DOCUMENT, not the conversation around it. The model is
asked to fence the document between markers, which gives this app an exact
boundary rather than a hope that it will not editorialise; when the fence is
ignored, a short conversational opener or closer is trimmed instead. Without
that, "Sure, here is your PDF:" ends up inside the PDF — which is exactly
what used to happen.

**Editing** an uploaded file needs no separate feature, because it is
retrieval and generation composed: the file is already in context through RAG,
the model writes the revised version, and that becomes the new file. Verified
live — an uploaded agreement, asked for 30 days' notice instead of 60 and Net
30 instead of Net 45, came back with both edits applied, the untouched clauses
preserved, and the original cited.

Markers never render in the transcript, and never reach a saved file.

### Saving an answer as a real file

Any settled answer also offers **Save as**: Word, PDF, Excel, JSON, Markdown,
or a code file with the language's real extension. That exports **that
message** and is deliberately kept distinct from generating a document: a
reply opening "Here's how that works" keeps its first line when saved.

"Real" means reopenable. Word headings are Word headings, lists are real lists
that renumber, tables are real tables; spreadsheet numbers are numeric cells
(`"1,250.50"` becomes `1250.5`, so a column can actually be summed); the PDF
carries a genuine text layer. Each format is tested by writing it and parsing
it back with the library that would read it in production — mammoth, SheetJS,
unpdf. A renamed `.txt` passes a download button, a byte-length check and a
MIME-type check; it fails the moment Word opens it.

The structure comes from the **same markdown parser that renders the answer on
screen**, so the file matches what was displayed. Markdown tables were added to
that parser for this — a table is the shape "compare these two contracts"
produces, and the shape worth exporting.

Generation is entirely client-side: no upload, no storage, no cost. The heavy
libraries are dynamically imported, so they are fetched only when someone
actually saves something.

One honest limitation: jsPDF's built-in fonts are WinAnsi-encoded, so Arabic,
CJK and Cyrillic cannot be rendered. Rather than producing quietly mangled
output, **PDF is disabled for those answers with the reason shown**, pointing
at Word, which handles Unicode natively. (The separate conversation export
chose the opposite trade — rasterising via html2canvas — because it has to
handle Arabic and does not need a text layer.)

### Rate limiting

All four routes apply a per-client sliding window before reading the request
body, so a refused request costs nothing: 60/minute for chat, 12 per 5 minutes
for uploads, 20 per 5 minutes for extraction, 12 per 5 minutes for images.

What this is, plainly: an **in-memory** limiter held in whichever instance
serves the request. On Vercel that means per instance, and it resets on a cold
start. It is a speed bump against runaway clients, retry storms and casual
abuse of an unauthenticated endpoint — **not a security boundary**. The honest
alternative is a shared store (Upstash, Redis), deliberately not added here: it
would introduce a service, a credential and a failure mode for a single-user
portfolio app, and pretending an in-memory counter is a distributed limiter
would be worse than stating what it is.

---

## Switching providers

Switching is silent while a conversation is empty — there is no context to
carry. Once a message exists, changing provider opens a confirmation explaining
that **every later message sends the whole conversation so far** to the new
provider, and that replies already on screen keep their original model. Cancel,
Escape and clicking outside all leave the provider unchanged.

Switching is refused outright while a request is in flight, to pointer and
keyboard alike: the turn has already left for one provider, and changing the
selection underneath it would misattribute the answer.

Each assistant message records the provider that produced it, so switching does
not retroactively re-label earlier answers. A failed turn retries to the
provider it was originally sent to rather than being silently rerouted.

## Deploying to Vercel

The app is a standard Next.js App Router project with one dynamic route
(`/api/chat`); no adapter, custom server or build configuration is needed.

**Environment variables must be set in the Vercel project, not in the repo.**
`.env.local` is git-ignored and never uploaded, so a deployment with no
variables configured will build and serve normally but report every provider as
not configured. Add, for each environment you want working (Production,
Preview, Development):

| Name | Required | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | for Gemini | server-side only |
| `OPENAI_API_KEY` | for OpenAI | server-side only |
| `GEMINI_MODEL` | no | overrides the `gemini-3.6-flash` default |
| `OPENAI_MODEL` | no | overrides the `gpt-5.6-luna` default |

None of them may be renamed to `NEXT_PUBLIC_*`: that prefix is what makes a
variable part of the browser bundle, and these are credentials.

Two ways to deploy:

1. **Git integration (recommended).** Connect the GitHub repository to a Vercel
   project and set the Production Branch to `main`. Every push to that branch
   then builds and promotes automatically.
2. **CLI.** From the project root, with the Vercel CLI installed and logged in:

   ```bash
   npx vercel        # preview deployment
   npx vercel --prod # promote to the production URL
   ```

   The link lives in `.vercel/project.json`, which is git-ignored — a CLI
   deployment publishes whatever is in the working directory at that moment,
   **not** whatever is committed. If the deployed site looks out of date, check
   which of the two paths above is actually in use before re-deploying: a
   project with no Git integration never updates on a push.

Redeploy after changing an environment variable — Vercel injects them at build
time, so an existing deployment keeps the values it was built with.

## Limitations

- **Live verification is one pass, not a soak test.** Both providers answered
  for real on 2026-09-21 across 7 upstream attempts. That proves the keys, the
  model ids, the live SSE shapes and the cross-provider context path. It does
  not exercise the live *error* paths: `INVALID_KEY`, `INSUFFICIENT_CREDIT`,
  `RATE_LIMIT` and `MODEL_BUSY` are still verified only against mocked upstream
  responses, because provoking them for real means damaging the account or
  waiting for a genuine outage.
- **One live retry was observed.** A Gemini attempt failed with a transport
  `NETWORK` fault and the route's retry policy recovered it on the next attempt.
  Real, and handled — but it means a single user-visible turn can cost more than
  one upstream attempt.
- **Claude is not connected.** No adapter ships — deliberately not stubbed,
  because a stub would either fabricate replies or fail confusingly — and as of
  this revision it is no longer shown in the selector at all.
- **Free-tier quota.** `gemini-3.6-flash` allows 20 requests/day per project on
  the free tier. When exhausted the UI reports the limit, scope and Google's own
  retry delay.
- **Image generation costs money.** No OpenRouter model emits images for
  free — 17 `:free` models exist and none of them have image output — so
  `OPENROUTER_API_KEY` must belong to an account with credit. Without credit
  the app reports `INSUFFICIENT_CREDIT` honestly rather than failing obscurely.
- **`OPENROUTER_API_KEY` is set for Production only** in the Vercel project,
  so preview deployments report the OpenRouter model and image generation as
  not configured. Add it to Preview as well if you need it there.
- **Generated images are not persisted server-side by default.** Without
  `BLOB_READ_WRITE_TOKEN` they are returned inline and live only in that
  browser's conversation; the UI labels them "not stored".
- **One image per turn.** The tool refuses a second generation inside the same
  message, deliberately, as a cost guard.
- **Reference images come from the current turn.** The tool can edit or vary an
  image attached to the message being sent; varying an image generated earlier
  goes through the Make a variation button rather than the model.
- **Live verification covers the main paths, not every path.** Upload,
  embedding, storage, retrieval, multi-file comparison, summaries and Invoice
  extraction have all been run against the live services, locally and in
  production. What has NOT: the Contract extraction schema has never been run
  against a model; no document near the 4 MB / 1.5 M character ceilings has
  been uploaded; and the live error paths (invalid key, exhausted quota) are
  still only verified against mocked responses, since provoking them for real
  means damaging the account.
- **A mid-stream failure cannot be retried.** The route retries an upstream
  failure that happens before the first token, but once streaming has begun
  tokens are already on screen and there is nothing to retry into: the answer
  stops where it stopped and an error notice appears. Observed twice against
  live Gemini (an extraction overload, and a chat stream that died 19.9 s in);
  neither was rate limiting, and both succeeded when retried by hand. Retrying
  is left to the user, via the existing Retry control.
- **Document access control is capability-based, not per-user.** Anyone who
  obtains a document id can read that document. There are no accounts to check
  against; see "Access control, and its honest limits".
- **Rate limiting is in-memory.** Per instance, reset by a cold start. A speed
  bump, not a security boundary.
- **The per-conversation file cap is enforced client-side.** The server has no
  list of a conversation's documents to count, so the 10-file limit is a UI
  limit; the upload rate limit (12 per 5 minutes) is what actually bounds
  server-side cost.
- **Extraction reads the first ~120,000 characters.** A longer document is
  still extracted, and the result says it was read only in part.
- **PDF export cannot render non-Latin scripts.** jsPDF's built-in fonts are
  WinAnsi, so for Arabic, CJK or Cyrillic answers the PDF option is disabled
  with the reason shown and Word is offered instead.
- **Scanned PDFs are detected, not OCR'd.** A PDF with no text layer is
  reported as having no extractable text rather than silently indexed empty.
  There is no OCR in this app.
- **Retrieval quality is not benchmarked.** The similarity floor (0.35), top-k
  (8) and chunk size (~6,000 characters) are reasoned defaults, not values
  tuned against a labelled evaluation set.
- **History is per-browser.** Conversations live in `localStorage` only — there
  is no account, no server-side persistence and no sync between devices or
  browsers. Clearing site data clears them. Settings behave the same way.
- **Export is one-way.** Conversations export to a readable PDF; there is no
  import path back.
- **Read aloud depends on the device.** It uses the browser's own speech
  synthesis, so available voices (including for Arabic) vary by platform, and
  it is unavailable where the browser provides none.
- **Mobile out of scope.** The sidebar is hidden below the `md` breakpoint. Not something the brief asked for or planned around — it simply never mentions mobile.
- **Input and conversation limits.** Messages over 16,000 characters are refused client-side before they ever enter history, with the actual limit named; a conversation reaching 50 messages surfaces the real cap and offers a working path to a new conversation.
- **Markdown subset.** Paragraphs, headings, lists, inline code, fenced code,
  links, blockquotes and GitHub-style pipe tables. No images or footnotes.
- **History is local.** Per browser; not synced, not on the server.
