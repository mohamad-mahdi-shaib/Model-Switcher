# AI Workspace — Creative Model-Switcher Interface

A glassmorphic AI chat interface built for the Numbase Project 1 brief. Next.js
16 + TypeScript + Tailwind v4, with Gemini and OpenAI behind a provider-neutral
abstraction layer.

**Both providers are now verified against their live APIs.** An end-to-end
acceptance run on 2026-09-21 streamed real answers from GPT and Gemini in one
conversation, carried context across providers, and survived a refresh. See
"Provider status" below.

Desktop only for this version — mobile is out of scope for this submission. This is a scope decision, not something the brief asked for or deferred; the brief never mentions mobile at all.

---

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
| `GEMINI_API_KEY` | for Gemini | Server-side Gemini credential. Never sent to the browser. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.6-flash` (stable, free tier). |
| `OPENAI_API_KEY` | for GPT | Server-side OpenAI credential. Requires a funded account. |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.6-luna`, the cost-optimised tier. See "Which OpenAI model" below before overriding it. |

A provider is offered in the UI only when an adapter exists **and** the server
reports its key present. "Configured" means exactly that: a key is present. It
does not mean the key is valid, or that the account has credit — neither can be
known without spending a request.

## Provider status

| Provider | Adapter | Key | Verified |
| --- | --- | --- | --- |
| Gemini | ships | `GEMINI_API_KEY` | **against the live API** |
| GPT | ships | `OPENAI_API_KEY` | **against the live API** — real streamed answers, real token usage |

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
a superseded model. The selector therefore says **GPT** — the vendor, which is
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
npm run dev     # dev server
npm run build   # production build (type-checks)
npm run lint    # eslint
npm test        # unit + adapter contract tests (no network, no quota)
```

---

## Architecture

```
src/
  app/
    api/chat/route.ts        provider-neutral endpoint: validate -> dispatch -> NDJSON
    page.tsx, layout.tsx
  server/providers/          SERVER ONLY
    types.ts                 ChatProvider contract, ProviderError
    gemini.ts                the only file importing @google/genai
    openai.ts                the only file that knows the OpenAI wire format
    registry.ts              id -> adapter dispatch
  components/workspace/      WorkspaceLayout, ChatHeader, ConversationSidebar,
                             MessageList, MessageComposer, Markdown, BackgroundPicker
  lib/
    chat.ts                  shared contract (server + client)
    use-conversations.ts     conversation + streaming state machine
    storage.ts               versioned localStorage persistence
    conversations.ts         title derivation, recency grouping
    markdown.ts              safe Markdown -> AST
    providers.ts             client provider registry + identity
    backgrounds.ts           8 backgrounds, 2 glass styles
    limits.ts                shared input/conversation length limits (client + server)
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

188 tests, no network access and no model quota consumed:

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

Real-browser acceptance is driven through the Chrome DevTools Protocol, with
all model traffic mocked at `window.fetch` and the real provider domains
additionally blocked at Chrome's own network layer as a fail-closed backstop.
The harness is committed at `tests/browser/` (see its own `README.md`) rather
than kept in a private scratchpad, and is run on demand, separately from
`npm test`. See `docs/requirements-audit.md` for the requirement-by-requirement
evidence.

---

## Adding another provider

The route never names a vendor, so a new provider is an adapter plus a registry
line.

1. Create `src/server/providers/<name>.ts` exporting a `ChatProvider`:

```ts
export const myProvider: ChatProvider = {
  id: "gpt",
  label: "GPT",
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

## Backgrounds

Eight presets in two collections. Seven are local SVG artwork or CSS gradients.
One, **Luxury Salon**, is a photograph.

| | |
| --- | --- |
| File | `public/backgrounds/luxury-salon.jpg` (2000x1335, ~284 KB) |
| Source | [Chairs in a meeting room (Unsplash)](https://commons.wikimedia.org/wiki/File:Chairs_in_a_meeting_room_(Unsplash).jpg) on Wikimedia Commons |
| Original | <https://unsplash.com/photos/DEdM9Vs6s8w> |
| Licence | **CC0 1.0** - Creative Commons Zero, Public Domain Dedication. No attribution required; credited here anyway. |

The file is **bundled locally and never hotlinked**, so no request leaves the
origin at runtime. Two adjustments were made to the source, both recorded in
`makeasset` notes and disclosed here rather than passed off as the original
frame:

1. A small printed card carrying a logo sat on the table. It is patched out
   with a slice of the same wall, because the background must carry no text or
   logos.
2. A gamma lift, a small wash toward warm white and slight desaturation. The
   raw frame has a deep orange-brown floor across its lower half; dark ink over
   it measured **2.81:1**, under the 4.5:1 floor. Lifting the shadows fixes that
   and moves the frame toward the warm white palette the preset is for. After
   the pass the same text measures **5.07:1**, with the room still clearly
   readable through the panels.

Clear Glass + Luxury Salon reuses the Pearl Studio material rules rather than
restating them: each selector gained a second preset, so there is one place to
tune the material and no competing override. Glowy Glass keeps its own.

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
- **Mobile out of scope.** The sidebar is hidden below the `md` breakpoint. Not something the brief asked for or planned around — it simply never mentions mobile.
- **Input and conversation limits.** Messages over 16,000 characters are refused client-side before they ever enter history, with the actual limit named; a conversation reaching 50 messages surfaces the real cap and offers a working path to a new conversation.
- **Markdown subset.** Paragraphs, headings, lists, inline code, fenced code,
  links and blockquotes. No tables, images or footnotes.
- **History is local.** Per browser; not synced, not on the server.
