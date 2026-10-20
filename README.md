# AI Workspace — Creative Model-Switcher Interface

A glassmorphic AI chat interface built for the Numbase Project 1 brief. Next.js
16 + TypeScript + Tailwind v4, with Gemini and OpenAI behind a provider-neutral
abstraction layer.

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
| `GEMINI_API_KEY` | for Gemini | Server-side Gemini credential. Never sent to the browser. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.6-flash` (stable, free tier). |
| `OPENAI_API_KEY` | for OpenAI | Server-side OpenAI credential. Requires a funded account. |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.6-luna`, the cost-optimised tier. See "Which OpenAI model" below before overriding it. |
| `OPENROUTER_API_KEY` | for DeepSeek V3.1 and all image generation | One key serves the OpenRouter chat model and the image model. Create one at <https://openrouter.ai/keys>; it needs credit, as no image-generation model is free. |
| `OPENROUTER_IMAGE_MODEL` | no | Defaults to `google/gemini-2.5-flash-image`. |
| `OPENROUTER_SITE_URL` / `OPENROUTER_SITE_NAME` | no | Optional attribution headers for OpenRouter's public rankings. Not secrets. |
| `BLOB_READ_WRITE_TOKEN` | no | Vercel Blob. When set, generated images are stored and the conversation keeps a short URL instead of inline base64. Without it the app still works; images live in the browser only. |

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
    api/chat/route.ts        provider-neutral endpoint: validate -> dispatch -> NDJSON
    page.tsx, layout.tsx
  server/providers/          SERVER ONLY
    types.ts                 ChatProvider contract, ProviderError
    gemini.ts                the only file importing @google/genai
    openai.ts                the only file that knows the OpenAI wire format
    registry.ts              id -> adapter dispatch
  components/workspace/
    WorkspaceLayout.tsx      state container + composition root (owns ALL state)
    AppShell.tsx             the layout itself: header / sidebar / main slots
    AppHeader.tsx            global header: sidebar toggle, brand, title, Settings
    ConversationSidebar.tsx  side navigation: search, New chat, history, drawer
    MessageList.tsx          the transcript (its own scroll region)
    MessageComposer.tsx      the sticky composer at the bottom of main
    ProviderMenu.tsx         provider switcher + switch confirmation dialog
    SettingsPanel.tsx        the one Settings overlay (Appearance lives here)
    Markdown.tsx, AttachmentTray.tsx
  lib/
    chat.ts                  shared contract (server + client)
    use-conversations.ts     conversation + streaming state machine
    storage.ts               versioned localStorage persistence
    conversations.ts         title derivation, recency grouping
    markdown.ts              safe Markdown -> AST
    providers.ts             client provider registry + identity
    backgrounds.ts           2 wallpapers, 1 glass style, ambient orb data
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

199 tests, no network access and no model quota consumed:

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
```

All six pass against the current build (274 checks total). See `docs/requirements-audit.md` for the requirement-by-requirement
evidence.

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
| `deepseek/deepseek-chat-v3.1` | OpenRouter | no (text only) | no |
| `google/gemini-2.5-flash-image` | OpenRouter (generation only) | yes | **yes** |

**The two vision models are the two direct integrations.** Both were verified
on production against a real screenshot for image description, OCR and
two-image comparison — different vendors, different APIs, different keys, so
"two distinct vision models" means two genuinely independent ones.

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
  links and blockquotes. No tables, images or footnotes.
- **History is local.** Per browser; not synced, not on the server.
