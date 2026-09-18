# AI Workspace — Creative Model-Switcher Interface

A glassmorphic AI chat interface built for the Numbase Project 1 brief. Next.js
16 + TypeScript + Tailwind v4, with a live Gemini integration behind a
provider-neutral abstraction layer.

Desktop only for this version — mobile is deferred and is not part of the brief.

---

## Setup

```bash
npm install
cp .env.example .env.local     # then paste your key into .env.local
npm run dev                    # http://localhost:3000
```

Get a free Gemini key at <https://aistudio.google.com/apikey>. No billing is
required; the free tier is sufficient.

**Restart the dev server after editing `.env.local`** — Next caches environment
variables in the running process.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Server-side Gemini credential. Never sent to the browser. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.6-flash` (stable, free tier). |
| `OPENAI_API_KEY` | no | Reserved. No adapter ships yet — see "Adding a provider". |
| `ANTHROPIC_API_KEY` | no | Reserved. No adapter ships yet. |

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
    backgrounds.ts           7 backgrounds, 2 glass styles
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

38 tests, no network access and no model quota consumed:

- **Markdown** — safety (`javascript:` / `data:` links stripped, HTML never
  treated as markup) and streaming stability (every prefix of a fenced block
  parses without throwing).
- **Adapter contract** — error classification against *real recorded* Gemini 429
  and 503 payloads, quota parsing, registry shape, and a mock adapter proving a
  non-Gemini provider satisfies the same interface.
- **Storage** — round-trip, corrupt/future-version payloads left untouched,
  quota-full reporting, interrupted-reply restoration.
- **Conversations** — title derivation, recency grouping, draft handling.

Browser acceptance is driven through the Chrome DevTools Protocol with all model
traffic mocked at `window.fetch`. See `docs/requirements-audit.md` for the
requirement-by-requirement evidence.

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

## Limitations

- **One live provider.** Only Gemini is connected. Claude and GPT are visible,
  disabled, and cannot send. Enabling either needs a real key — adapters are
  deliberately not stubbed, because a stub would either fabricate replies or
  fail confusingly.
- **Free-tier quota.** `gemini-3.6-flash` allows 20 requests/day per project on
  the free tier. When exhausted the UI reports the limit, scope and Google's own
  retry delay.
- **Mobile deferred.** The sidebar is hidden below the `md` breakpoint.
- **Markdown subset.** Paragraphs, headings, lists, inline code, fenced code,
  links and blockquotes. No tables, images or footnotes.
- **History is local.** Per browser; not synced, not on the server.
