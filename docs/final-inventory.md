# Final inventory and submission audit

**Project:** Numbase Group | Project 1: Creative Model-Switcher Interface
**Audited:** 2026-09-21
**Baseline commit:** `c10e4cb` (model-label fix), on `b20fa9e` (live provider acceptance)
**Working tree at audit start:** clean except three untracked files in `references/`
(`IMG_3827.jpeg`, `IMG_3830.jpeg`, `Project 1_ Model-Switcher AI Interface .pdf`). All
three were left untouched.
**Git remote:** none configured.

**Source of truth:** `references/Project 1_ Model-Switcher AI Interface .pdf`, 2 pages,
read in full this pass by decoding the PDF content streams and resolving each subset
font's `/ToUnicode` CMap. Every quotation below is from that extraction. **No previous
completion report was used as proof of anything.**

---

## 0. How to read the evidence labels

| Label | Means |
| --- | --- |
| **Source** | Code read at the cited path and line this pass. |
| **Unit** | `npm test` — 85 tests, no network. |
| **Mocked browser** | Headless Chrome on a throwaway profile against the dev server, with `window.fetch` stubbed for `/api/chat` and the stub *asserted installed* before any send. No request reaches a provider. |
| **Recorded live** | A real provider exchange from the acceptance run earlier on 2026-09-21. Saved evidence exists (dev-server log with per-request timings and token usage, plus screenshots) but lives in this session's scratchpad, **outside the repository**. Not re-run this pass. |
| **Reported** | Asserted by an earlier narrative report with no saved artefact. Treated as unverified. |

Two rules applied throughout:

- A frontend mock is **never** treated as evidence that a provider adapter works. Adapter
  behaviour is evidenced separately, by tests that intercept the adapter's own `fetch`.
- HTTP 200 is **never** treated as proof of generation. Every live row was checked against
  the answer text actually rendered on screen.

### Classification of the PDF's own statements

The PDF mixes binding requirements with encouragement. Section 6 is explicitly headed
*"Your Success Roadmap (Here are some tips)"*, which makes its Steps 1–3 tips by the
document's own framing — including the normalization example. The matrix records that
tension rather than smoothing it over.

- **Requirement** — stated as something the app must do (all of §5, plus §3's stated result).
- **Suggestion** — offered as a technique, tool or example (§4's tools, §6's steps, the
  literal JSON shape, Google Stitch / v0.dev, Framer Motion / GSAP, the stack choice).
- **Inferred expectation** — not phrased as an instruction but presupposed by one
  (e.g. a typing indicator must exist for §2 to ask how it looks).

---

## 1. Requirement matrix

### R1 — Premium, creative UI

- **PDF:** p.1 §1 — *"Your goal is to create a professional AI chat interface that looks and feels like a **premium product**."* p.1 §2 — *"Forget the basic 'blue bubble' chat apps you see everywhere. We want you to focus on **Creative UI/UX**."*
- **Classification:** Requirement (§1 goal), reinforced by §2.
- **Status: Complete**
- **Code:** `src/app/globals.css` (1287 lines); `src/components/workspace/*`; `src/lib/backgrounds.ts:40-108` (8 backgrounds), `:131-144` (2 glass styles).
- **Does:** Two full glass materials (Glowy, Clear), eight backgrounds across Neutral and Luxury collections, per-tone ink, pointer-reactive edge glint, an ambient orb layer. No blue bubbles anywhere; the user message has no bubble at all.
- **Evidence:** Mocked browser — picker exposes 8 backgrounds + 2 glass styles, all applying; background reads through panel centres at r=0.957–0.995 with tonal spread sd 14.7–42.5. Source.
- **Gap:** None.
- **Acceptance check:** Open at 1366×768, cycle all 8 backgrounds and both glass styles; the room/artwork stays visible through the panel and text stays legible on every one.

### R2 — Message entrance motion

- **PDF:** p.1 §2 — *"**Fluid Motion:** Think about how messages appear. Do they slide? Do they fade?"*
- **Classification:** Inferred expectation (posed as questions, but §2 is the stated focus).
- **Status: Complete**
- **Code:** `globals.css` `@keyframes user-enter` / `assistant-enter` / `reveal-run` / `gold-orbit-sweep`; `MessageList.tsx:53` `UserMessage`, `:111` `AssistantMessage`, `:66` fresh-only gating.
- **Does:** A sent user message resolves over 1200ms: opacity, an 18px rise, a slight scale and a clearing blur, on a curve that still has travel left at 300ms. A gold light traces the message perimeter once. The assistant arrives in three staged parts (avatar, pane, answer). Restored history animates nothing — ids present at mount are excluded.
- **Evidence:** Mocked browser — `{"orbit":1,"userEnter":1}` per fresh turn; restored history `orbits=0 runs=0`; entrance fires exactly once per row while streaming continues.
- **Gap:** None.
- **Acceptance check:** Send a message and watch at normal speed; refresh and confirm nothing re-animates.

### R3 — Typing / responding indicator

- **PDF:** p.1 §2 — *"How does the '**typing indicator**' look?"*
- **Classification:** Inferred expectation (the question presupposes one exists).
- **Status: Complete**
- **Code:** `MessageList.tsx:248` `TypingIndicator`, rendered at `:455`.
- **Does:** A provider-tinted three-dot indicator labelled "<Provider> is responding", shown while a turn is in flight and replaced by the answer.
- **Evidence:** Mocked browser — present during an in-flight turn (control state C), absent once complete (state D). Source.
- **Gap:** None.
- **Acceptance check:** Send a message; the indicator appears within a second and is named for the active provider.

### R4 — Subtle visual identity between models

- **PDF:** p.1 §2 — *"**Model Identity:** Can you make the UI change subtly when I switch between GPT-4 and Gemini? (e.g., a color shift or a different glow)."*
- **Classification:** Inferred expectation (phrased as an invitation).
- **Status: Complete**
- **Code:** `src/lib/providers.ts:32-42` (`accent` per provider); `WorkspaceLayout.tsx` `data-provider` on the root; `MessageList.tsx:147` `data-msg-provider` per message; `globals.css` `.provider-avatar`, `.provider-chip-active`, `--glint-color`.
- **Does:** One `--accent` token per provider drives the avatar rim, the active chip, the typing dots and the glint. Scoped per message, so switching provider does not re-tint answers already on screen.
- **Evidence:** Mocked browser — after switching, the earlier answer keeps `#6f7f9b` (Gemini) while the workspace root is `#4f8c72` (GPT). Recorded live — attribution `[gpt,gpt,gpt,gpt,gemini]` in one transcript.
- **Gap:** None. The shift is deliberately subtle, which is what the PDF asked for.
- **Acceptance check:** Switch provider mid-conversation; the new accent applies to new answers only.

### R5 — User/AI distinction beyond alignment

- **PDF:** p.2 §5.1 — *"**Creative Bubbles:** Distinguish between User and AI with more than just alignment. Use icons, distinct shapes, or unique typography."*
- **Classification:** Requirement.
- **Status: Complete**
- **Code:** `MessageList.tsx:53-83` (user), `:111-180` (assistant).
- **Does:** Distinguished on three of the named axes, not one. **Typography:** the user message is 13.5px **semibold**, right-aligned, with no panel; the assistant body is regular weight with full markdown. **Icons:** the assistant has a circular glass avatar carrying `BotIcon`; the user line carries a `CheckIcon` sent-marker and a timestamp. **Shape:** the assistant's avatar rim is tinted by the provider accent; the user message is a bare text block with a gold perimeter light on arrival.
- **Evidence:** Source (read this pass). Mocked browser screenshots at both sizes.
- **Gap:** None. Note the user bubble was deliberately removed — the distinction does not depend on it.
- **Acceptance check:** Screenshot one user and one assistant message; cover the alignment and they are still trivially distinguishable.

### R6 — Prominent, stylish model selector

- **PDF:** p.2 §5.1 — *"**Model Switcher:** A prominent, stylish selector."*
- **Classification:** Requirement.
- **Status: Complete** (model readout fixed this pass — see §3)
- **Code:** `ChatHeader.tsx:174` `role="radiogroup"`, `:137` `modelLabel`, `:229-245` the model readout.
- **Does:** A glass pill radiogroup top-right offering only providers the app can reach. Beneath it, right-aligned, the **actual model id** for the selected provider, read from the server probe. Availability is decided server-side, so a provider without a key cannot be chosen.
- **Evidence:** Mocked browser — chips `["Gemini","GPT"]`, no Claude control; selecting a provider issues zero requests. Model readout measured at 11.5px/500 weight, contrast **7.83** at 1366×768 and **7.92** at 1680×1050, 5px directly beneath the group.
- **Gap:** None.
- **Acceptance check:** At 1366×768, read the model name without hovering, zooming or opening DevTools; switch provider and it changes.

### R7 — Model lock OR warning after a chat starts

- **PDF:** p.2 §5.1 — *"**Crucial:** Once a chat starts, lock the model or show a creative warning before switching."*
- **Classification:** Requirement (the PDF marks it "Crucial").
- **Status: Complete**
- **Code:** `ChatHeader.tsx:35` `SwitchDialog`, `:258` its mount; `requestSwitch` guards.
- **Does:** Before any message exists, switching is silent. Once a user message exists, switching opens a labelled `role="dialog"` with `aria-modal="true"` explaining that the whole conversation so far will be sent onward and that replies already on screen keep their original model. Cancel, Escape and outside-click all abandon. Switching is refused outright while a request is in flight, including to the keyboard.
- **Evidence:** Mocked browser — dialog labelled, focus lands on confirm, Cancel/Escape preserve the provider, in-flight chip is `disabled`, `aria-disabled="true"` and not focusable. **Recorded live** — after four GPT turns the dialog appeared, Cancel kept `gpt`/`gpt-5.6-luna`, confirm moved to `gemini`/`gemini-3.6-flash`.
- **Gap:** Minor, non-blocking: the dialog sets `aria-modal="true"` but does not trap Tab or mark the background inert, so the chips behind it stay in the tab order. Reported, not fixed (outside this pass's authorised scope).
- **Acceptance check:** Send a message, click the other provider, press Tab repeatedly — confirm the warning is unmissable; then Cancel and confirm nothing changed.

### R8 — Designed welcome / empty state

- **PDF:** p.2 §5.1 — *"**Empty State:** Design a beautiful 'Welcome' screen. Don't leave it blank give it personality!"*
- **Classification:** Requirement.
- **Status: Complete**
- **Code:** `MessageList.tsx` welcome branch; three prompt buttons.
- **Does:** A composed welcome panel with three starter prompts that populate the composer when clicked.
- **Evidence:** Mocked browser — control state A lists the three prompt buttons; screenshots at both sizes.
- **Gap:** None.
- **Acceptance check:** Open a new conversation; the panel is never blank and a starter prompt fills the composer.

### R9 — Usable sidebar history

- **PDF:** p.2 §5.2 — *"**History:** A sidebar that saves your past chats."*
- **Classification:** Requirement.
- **Status: Complete**
- **Code:** `ConversationSidebar.tsx` (236 lines) — `:67`/`:130` rename, `:138` delete, `:85-97` inline delete confirmation; `use-conversations.ts:323` send, `:358` stop, `:364` retry.
- **Does:** Lists saved conversations, titled from the first user message. Each row has Rename (inline edit) and Delete (inline two-step confirm naming the conversation). New conversation button. Deleting the active conversation moves selection somewhere safe rather than leaving nothing selected.
- **Evidence:** Mocked browser — control states C–F show `New conversation`, `Rename <title>`, `Delete <title>` per row. Source. Unit.
- **Gap:** None.
- **Acceptance check:** Create two conversations, rename one, delete the other, confirm selection lands somewhere sensible.

### R10 — Persistence after refresh

- **PDF:** p.2 §5.2 — *"These **must stay there even if I refresh the page**."*
- **Classification:** Requirement (emphatic).
- **Status: Complete**
- **Code:** `src/lib/storage.ts:20` key `model-switcher:conversations`, `:21` version 1, `:93` load, `:146` save; `use-conversations.ts` hydrate/throttled persist/flush.
- **Does:** Versioned `localStorage`. Writes are blocked until hydration completes, so an initial empty state cannot overwrite saved data. Flushed on completion, Stop, switch, `visibilitychange` and `pagehide`. A reply cut off by a refresh returns as **interrupted**, never as still-streaming. Corrupt or unknown-version payloads are reported and **left byte-intact** rather than overwritten.
- **Evidence:** Unit — round-trip; malformed JSON → `corrupt` with bytes intact; version 99 → `corrupt`, untouched; `streaming` → `interrupted` with partial text kept; quota-full → `full`. Mocked browser — three conversations survive a hard refresh. **Recorded live** — after a mixed-provider conversation, a reload restored 5 answers, the provider, the model readout and attribution `[gpt,gpt,gpt,gpt,gemini]`.
- **Gap:** Local to one browser; no cross-device sync. The PDF asks only for survival across refresh.
- **Acceptance check:** Send two messages, hard-refresh; transcript, sidebar entry, provider and model readout all persist.

### R11 — Context from three earlier messages

- **PDF:** p.2 §5.2 — *"**Context:** Make sure the AI 'remembers' what was said **3 messages ago**."*
- **Classification:** Requirement.
- **Status: Complete**
- **Code:** `use-conversations.ts:204` sends `toWire(history)`; `route.ts:80` caps at 50 messages; `gemini.ts:154` maps to `Content[]`; `openai.ts` maps to Responses `input`.
- **Does:** Each turn sends that conversation's full history, from the active conversation only.
- **Evidence:** Unit / adapter — a 7-message history is forwarded in order with roles mapped, four user turns preserved. Mocked browser — sibling conversations never leak in. **Recorded live** — a fact planted in turn 1 ("my bicycle is named Perseus"), two unrelated turns, then turn 4 asked without repeating it: GPT answered **"Perseus"**. After switching, Gemini answered from the same transcript: *"Your bicycle is named Perseus, and the sum was 17 plus 24."*
- **Gap:** None.
- **Acceptance check:** State a fact, send three unrelated messages, ask about the fact.

### R12 — Frontend / backend separation

- **PDF:** p.1 §3 — *"What matters is the result: A unified system where the **frontend stays clean while the backend handles the 'heavy lifting'** of talking to different AIs."*
- **Classification:** Requirement (§3's stated result).
- **Status: Complete**
- **Code:** `src/app/api/chat/route.ts` (164 lines) — `:46` GET availability, `:59` POST; adapters under `src/server/providers/`.
- **Does:** The browser knows one endpoint and one wire format. No vendor SDK, model id, endpoint or vendor error vocabulary exists in any client module. Keys are read only inside server adapters and are never prefixed `NEXT_PUBLIC_`.
- **Evidence:** Source. Unit — a client-bundle scan asserts no key material. Mocked browser — the client never addresses a vendor host.
- **Gap:** None.
- **Acceptance check:** `grep -r "googleapis\|openai.com" src/app src/components src/lib` returns nothing.

### R13 — Provider abstraction layer

- **PDF:** p.2 §4 — *"**For Logic:** Use LLMs to help you write the '**Provider Abstraction Layer**', the part of the code that makes sure your app works the same whether it's using Gemini or GPT-4."*
- **Classification:** Split. *Using an LLM to write it* is a Suggestion; *the layer existing* is an inferred expectation, and is effectively required by §3's "unified system".
- **Status: Complete**
- **Code:** `src/server/providers/types.ts` (`ChatProvider`, `ProviderError`, capabilities); `registry.ts:25` dispatch; `gemini.ts`, `openai.ts`.
- **Does:** Everything vendor-specific lives behind one interface. The route knows only that interface. Adding a provider is one adapter file, one `ProviderId` member, one `PROVIDERS` entry and one registry line.
- **Evidence:** Source. Unit — contract tests over the registry; `getProvider("claude")` → `null`.
- **Gap:** None.
- **Acceptance check:** Read `route.ts` end to end and find no vendor name.

### R14 — Normalized responses and errors

- **PDF:** p.2 §6 Step 2 — *"**Example:** Every response from your backend should look exactly the same: `{ "author": "assistant", "text": "Hello!" }`. This is called **Normalization**."*
- **Classification:** **Suggestion** by the document's own framing — §6 is headed *"(Here are some tips)"* and the shape is introduced with "Example:". The *principle* of normalization is stated firmly; the *literal shape* is illustrative.
- **Status: Complete in principle — deviates from the literal example shape**
- **Code:** `src/lib/chat.ts` (`ChatMessage`, `StreamEvent`, `ChatErrorCode`, `ERROR_COPY`); `route.ts` NDJSON framing.
- **Does:** Every provider is normalised to one shape. Messages are `{ role, content, state, provider }`; the stream is NDJSON of `{type:"delta"|"error"|"done"}`; every vendor failure collapses into one closed error vocabulary with user-facing copy that names the provider that actually failed.
- **Deviation, stated plainly:** the field names are `role`/`content`, not `author`/`text`, and the transport is a token stream rather than one whole-response object. The reason is that the interface streams; a single terminal object cannot express partial delivery, Stop, or a mid-stream failure after text has already been shown. **The PDF did not approve this substitution** — it is our engineering judgement against an illustrative example, and the owner should confirm it is acceptable.
- **Evidence:** Source. Unit — error-vocabulary and stream-framing tests.
- **Gap:** The deviation above. Trivially reversible if the reviewer wants the literal shape: it would mean giving up streaming.
- **Acceptance check:** Force an error on each provider and confirm both produce the same normalised code and copy.

### R15 — Actual multi-provider operation

- **PDF:** p.1 §2 — *"when I switch between **GPT-4 and Gemini**"*; p.2 §4 — *"whether it's using **Gemini or GPT-4**"*.
- **Classification:** Requirement (two providers must really work).
- **Status: Complete — live-verified on both**
- **Code:** `registry.ts:25`; `gemini.ts:18` default `gemini-3.6-flash`; `openai.ts` default `gpt-5.6-luna`, `:45` `MAX_OUTPUT_TOKENS`, `:61` `REASONING_EFFORT`.
- **Does:** Two real adapters, each streaming, each cancellable, each mapping the full conversation.
- **On the PDF's "GPT-4" wording:** the brief says GPT-4. That model generation is not the current API surface, so the app ships **`gpt-5.6-luna`**, verified against the published model and pricing pages on 2026-09-21 as the cheapest current text tier. The selector names the vendor ("GPT") and prints the exact model id beside it; no UI text claims GPT-4. **The PDF did not explicitly approve this substitution.** It is a judgement call, disclosed here and in the README, and the owner should confirm it.
- **Evidence:** Adapter-mock — SSE parsing across chunk boundaries, delta normalisation, abort, and the full error map (401→INVALID_KEY, 429-billing→INSUFFICIENT_CREDIT non-retryable, 429-throttle→RATE_LIMIT with Retry-After, 503→MODEL_BUSY, 5xx→UPSTREAM, 400/404→BAD_REQUEST). **Recorded live** — four GPT answers (`"noted"`, `"41"`, `"Red"`, `"Perseus"`) and one Gemini answer in one conversation, each read from the rendered transcript, not from a status code. Real usage logged: `{ model: 'gpt-5.6-luna', input: 14, output: 5, reasoning: 0 }`.
- **Gap:** **Live error paths remain unproven.** `INVALID_KEY`, `INSUFFICIENT_CREDIT`, `RATE_LIMIT` and `MODEL_BUSY` are adapter-mock only; provoking them for real means damaging the account or waiting for an outage.
- **Acceptance check:** One prompt to each provider in the same conversation, two genuine replies, header model id matching what the adapter sent.

### R16 — Server-side env keys and Git exclusion

- **PDF:** p.2 §6 Step 3 — *"**The Golden Rule:** Never put your API keys in your code. Use a `.env` file. **If we see a key on GitHub, it's a security breach!**"*
- **Classification:** Requirement. (It sits inside the "tips" section but is phrased as a rule and names the failure as a breach.)
- **Status: Complete in the repository — one operational risk outstanding**
- **Code:** `.gitignore` `.env*` with `!.env.example`; keys read only via `process.env` inside `gemini.ts` / `openai.ts`; `openai.ts` `availability()` returns booleans and a model name, never a key.
- **Does:** `.env.local` is git-ignored and untracked. `.env.example` ships with empty key values and real model defaults only.
- **Evidence this pass:**
  - Pattern scan over **all 62 tracked files** for `sk-…` / `AIza…` / assigned `*_KEY=` values — **0 findings**.
  - Pattern scan over **every blob in every commit in history** — **0 findings**.
  - `git check-ignore` confirms `.env.local` ignored; `git ls-files` confirms it untracked.
  - Adapter test asserts the key travels only in the `Authorization` header and never in the request body.
- **Gap:** **Both live keys were pasted into chat transcripts during setup.** Nothing is committed, but a key that has been pasted should be treated as disclosed. This is the one true submission blocker.
- **Acceptance check:** `git ls-files | grep -c '^\.env$'` is 0; a fresh clone runs only after the user creates their own `.env.local`.

---

## 2. Architecture and feature inventory

### Routes

| Route | Kind | Purpose |
| --- | --- | --- |
| `/` | Static | The whole application; one client workspace. |
| `/api/chat` **GET** | Dynamic | Availability probe. Returns `{providers:{id:{configured,model,reason?}}}` — booleans and model names, never a key. `Cache-Control: no-store`. |
| `/api/chat` **POST** | Dynamic | One chat turn. Validates, dispatches through the registry, re-frames the adapter's deltas as NDJSON. |

### Major components

| File | Lines | Role |
| --- | --- | --- |
| `WorkspaceLayout.tsx` | 170 | Shell. Owns background/glass/picker state, runs the availability probe, composes header, sidebar, list, composer. |
| `ChatHeader.tsx` | 271 | Title, provider radiogroup, **model readout**, background picker mount, switch-confirmation dialog. |
| `ConversationSidebar.tsx` | 236 | Saved conversations, rename, two-step delete, new conversation. |
| `MessageList.tsx` | 485 | Welcome state, user and assistant messages, typing indicator, error banner with Retry, Copy. |
| `MessageComposer.tsx` | 116 | Textarea, Send, Stop, disabled reasons. |
| `BackgroundPicker.tsx` | 221 | 8 backgrounds + 2 glass styles. |
| `Markdown.tsx` / `lib/markdown.ts` | 250 / 224 | Hand-rolled markdown subset with per-block Copy for code. |

### State ownership and streaming flow

`useConversations` (`src/lib/use-conversations.ts`, 485 lines) owns everything conversational: the list, the active id, hydration, chat status, error state and the in-flight run. One flow:

1. `send()` appends the user message, derives the title on the first turn, and calls `run()`.
2. `run()` POSTs `{provider, messages: toWire(history)}` with an `AbortController`.
3. The NDJSON reader appends `delta` text to the reply message, held in `streaming` state.
4. `done` → `complete` (`:288-293`). A mid-stream `error` → the banner, preserving text already delivered. `AbortError` (Stop, switch, unmount) → `interrupted`.
5. Every in-flight run is tagged with a request id **and** a conversation id, so a chunk arriving after an abort or after the user has navigated away is dropped rather than leaking into whatever is on screen.

### Conversation storage

Versioned `localStorage` under `model-switcher:conversations`, schema version 1. Structural validation rejects the whole payload on anything unexpected and reports `corrupt` **without touching the bytes**. `streaming` is rewritten to `interrupted` on load. Statuses: `ok` / `unavailable` / `corrupt` / `full`. Provider attribution is stored per message, and messages saved before attribution existed still load (the field is optional).

### Provider registry and adapters

| | Gemini | OpenAI |
| --- | --- | --- |
| Default model | `gemini-3.6-flash` | `gpt-5.6-luna` |
| Override | `GEMINI_MODEL` | `OPENAI_MODEL` |
| Transport | streaming generate-content | `POST /v1/responses`, `stream:true`, SSE |
| Context mapping | `role: assistant→"model"`, else `"user"` | roles pass straight through |
| **Output cap** | **none set** | `max_output_tokens: 1200` |
| Reasoning | n/a | `reasoning.effort: "none"` (verified upstream: `reasoning: 0`) |

### Error handling, Retry, Stop, output limits

- Retryability is decided by the **adapter**, never the route. `route.ts:104` retries up to 3 attempts, but only for errors the adapter marked retryable. Auth, billing, rate-limit and malformed-request failures are never retried.
- One user-visible turn can therefore cost up to 3 upstream attempts. This is not theoretical — the live run recorded one `NETWORK` transport failure absorbed by a retry.
- **Stop** aborts the fetch, keeps the partial text and marks it `interrupted`, which renders *"Response interrupted."* (`MessageList.tsx:163`).
- **Retry** re-sends to the provider the failed turn originally used — never silently rerouted.
- Error copy names the provider that actually failed and the env var to fix.

### Output-limit path — inspected as asked

**Finding: a response truncated by the output cap is presented as an ordinary completed answer. It is not disclosed.**

Traced this pass:

1. `openai.ts:302` — `response.incomplete` (the documented signal that `max_output_tokens` was exhausted) returns from the generator cleanly, deliberately keeping the text already delivered.
2. `route.ts` — the `for await` ends normally, so it enqueues `{type:"done"}`. There is **no event in the wire contract** for "finished early".
3. `use-conversations.ts:288-293` — `done` sets the message `state: "complete"`.
4. `MessageList.tsx:163` — the *"Response interrupted."* line renders only for `state === "interrupted"`.

So the disclosure mechanism exists and is used for Stop, but truncation does not reach it. A capped answer ends mid-sentence with a Copy button and no indication anything is missing. At 1200 tokens this will be rare, and it was introduced in the previous milestone; it is a correctness-of-honesty gap, not a crash. **Reported, not fixed** — fixing it is a wire-contract change (a `truncated` flag on `done`, or reusing `interrupted`) and is outside this pass's authorised scope.

Gemini sets no output cap at all, so it cannot truncate this way — but that asymmetry is itself undocumented.

### Visual presentation queue vs canonical content

`use-reveal.ts` (184 lines) keeps two indices apart: the **canonical** received content (the single source of truth, used by Copy, persistence and history) and the **revealed** prefix shown on screen. Words are released in small groups on a timer; `reveal.ts` refuses to cut inside a half-arrived `[link](…)`, `` `code` `` or `**bold**`, and snaps around fenced blocks. Stop and `interrupted` call `showAll()` immediately, and a **"Show full response"** control appears when the queue is behind. `prefers-reduced-motion` bypasses pacing entirely. Copy always returns the canonical text, including anything still queued.

### Backgrounds, glass, motion, reduced motion

8 backgrounds (7 generated SVG + 1 bundled CC0 photograph, `public/backgrounds/luxury-salon.jpg`, served locally, never hotlinked), 2 glass styles, default Warm Studio + Glowy Glass. Four `prefers-reduced-motion` blocks in `globals.css`; under reduced motion the glint is `display:none`, zero animations run, and the pane renders fully drawn.

### Optional extras (ours — not substitutes for any PDF requirement)

Background/glass picker · gold perimeter orbit on send · progressive word reveal · Copy response and per-code-block Copy · Stop · Retry · rename/delete with confirmation · interrupted-state disclosure · storage corruption safety · per-message provider attribution · availability probe · `INSUFFICIENT_CREDIT` separated from `RATE_LIMIT` · server-side token-usage logging.

---

## 3. Visible-control inventory

Enumerated from the live DOM in each state (mocked, 1366×768).

| State | Control | Status |
| --- | --- | --- |
| Welcome | New conversation | working |
| | Gemini / GPT radio | working (Gemini checked by default) |
| | Change background | working |
| | 3 starter prompts | working — fill the composer |
| | Message textarea | working |
| | Send message | **disabled** until text is entered |
| Picker open | Close appearance picker | working |
| | 8 background radios | working |
| | 2 glass-style radios | working |
| In flight | Rename / Delete per conversation | working |
| | other provider chip | **disabled** — "cannot switch while a response is in progress", not focusable |
| | Stop generating | working |
| Completed answer | Copy response | working — returns canonical text |
| | Copy code (per fenced block) | working |
| | markdown links | working |
| Reveal behind | Show full response | working |
| Switch dialog | Cancel / Switch model | working; focus lands on Switch model |
| Error | Retry | working — re-sends to the same provider |
| No model reported | model readout | shows *"model unavailable"* (italic, `data-model-known="false"`) |

**No placeholder, decorative-only or dead controls were found.** Every visible control does something. The only permanently-inert control the app used to have — the disabled Claude chip — was removed in `b20fa9e`.

---

## 4. Verification performed this pass

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm test` | **85/85** |
| `npm run build` | clean; 3 routes |
| `tsc --noEmit` | clean |
| Model-label measurement, 1366×768 + 1680×1050 | before/after captured, 12 screenshots |
| Provider / motion / persistence suite (`verify13`) | **25/25** |
| Glass, contrast, reduced motion, frame cost (`verify14`) | **8/8** |
| Control inventory across 5 UI states | captured |
| Secret scan, tracked files | 0 findings |
| Secret scan, full git history | 0 findings |

**Dimensions tested:** 1366×768 and 1680×1050 at device scale 1, desktop only.

**Provider requests made by this audit: zero.** Every browser check installed the fetch stub via `Page.addScriptToEvaluateOnNewDocument` and asserted it installed before sending anything; a missing stub throws rather than falling through to a provider. Chrome ran on a throwaway profile each time, so the owner's own saved conversations were never touched.

### Limitations

1. **Live results are cited, not re-verified.** R11, R15, R7 and R10's live rows come from the acceptance run earlier on 2026-09-21. The saved evidence (dev-server log with timings and token usage, plus screenshots) is in this session's scratchpad, **not in the repository** — it will not survive into the submission unless deliberately exported.
2. **`backdrop-filter` does not composite in the headless capture environment.** Screenshots understate the real glass. Identical across both glass modes, so no comparison relied on it.
3. **The contrast figures are per-region**, each measured against the background actually behind that text, not against a page average.
4. **Two upstream requests occurred that this audit did not initiate.** The dev-server log now shows 8 POSTs where my own runs account for 6, and a second usage line (`input: 3265, output: 142`) with a conversation far longer than any prompt I sent. They fall between my runs, and all my runs were stub-asserted. The most likely explanation is manual use of the dev server that was left running for review. Flagged for accurate cost accounting rather than absorbed: the observable total on this server is **9 upstream attempts**, of which **7 were mine**.

---

## 5. Missing work, most important first

| # | Item | Severity | Notes |
| --- | --- | --- | --- |
| 1 | **Rotate both API keys** | **Blocker** | Pasted into transcripts during setup. Nothing is committed and history is clean, but treat them as disclosed. Rotate before any handoff. |
| 2 | **Truncated answers are not disclosed** | Medium | §2 above. A capped reply reads as complete. Fix is a `truncated` signal on `done`, or reuse `interrupted`. |
| 3 | **Live error paths unproven** | Medium | `INVALID_KEY`, `INSUFFICIENT_CREDIT`, `RATE_LIMIT`, `MODEL_BUSY` are adapter-mock only. Cannot be proven without damaging the account. |
| 4 | **Live evidence lives outside the repo** | Medium | If the reviewer wants proof of live operation, export the log excerpt and screenshots into `docs/evidence/` deliberately. |
| 5 | **Normalization shape deviates from the PDF example** | Low–Medium | `role`/`content` + NDJSON vs `{author,text}`. Owner decision (§6). |
| 6 | **Switch dialog does not trap focus** | Low | `aria-modal="true"` without `inert` on the background. |
| 7 | **5 unused Next.js starter assets** | Low | `public/{file,globe,next,vercel,window}.svg`, referenced nowhere in `src/`. |
| 8 | **Gemini has no output cap** | Low | OpenAI caps at 1200 tokens; Gemini is uncapped. Asymmetric and undocumented. |
| 9 | **Mobile** | Out of scope | Owner decision: desktop only. |

---

## 6. Decisions needed from the owner / supervisor

1. **The GPT-4 substitution.** The PDF says "GPT-4"; the app ships `gpt-5.6-luna` and displays that id. The PDF never approved this. Confirm it is acceptable, or say which model to configure instead.
2. **The normalization shape.** The PDF's example is `{"author":"assistant","text":"Hello!"}`; we ship `role`/`content` with an NDJSON token stream because the interface streams. Confirm, or ask for the literal shape (which costs streaming).
3. **Truncation disclosure** — fix now, or accept and document?
4. **Live evidence** — should it be exported into the repository for the reviewer?
5. **Reference material** — `references/DESIGN.md`, `code.html`, `screen.png` are tracked (~1.4 MB). Ship them or strip them?
6. **Submission channel** — see §7; the PDF does not specify one.

---

## 7. Delivery checklist

### Does the PDF specify a submission method?

**No.** Both pages were read in full. There is **no** mention of a deadline, a ZIP, a repository to push to, an email address, a form, or deployment. The only occurrence of "GitHub" is in the security rule — *"If we see a key on GitHub, it's a security breach!"* — which implies a reviewer may look at a repository but does **not** state a required channel.

**Consequence: there is no requirement anywhere in the PDF to deploy a public website.** ZIP and/or GitHub, per the owner's standing decision, is a reasonable reading — but it is the owner's decision, not the PDF's instruction. Worth confirming with whoever set the task.

### Must be included

- [x] All 62 tracked files: `src/`, `public/backgrounds/`, `docs/`, `README.md`, `package.json`, `package-lock.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig`, `.gitignore`, `.env.example`, `tests/`.
- [x] `package-lock.json` present (252 KB) — reproducible install.
- [x] `.env.example` with **empty** key values and model defaults.
- [x] README setup instructions, provider status, and the "Which OpenAI model, and why it is not GPT-4" section.
- [x] Asset credit: Luxury Salon photograph, CC0 1.0, source and original linked in README.
- [x] `public/backgrounds/luxury-salon.jpg` — bundled locally, never hotlinked.
- [x] Tests runnable with `npm test`.

### Must be excluded

- [x] `.env.local` — git-ignored, untracked, **verified this pass**.
- [x] `node_modules/`, `.next/`, `build/`, `out/`, `coverage/` — all ignored.
- [x] Log files — `npm-debug.log*` etc. ignored; the dev-server log lives outside the repo.
- [x] Personal browser data — never in the repo; tests used throwaway Chrome profiles.
- [x] Temporary test artefacts — the entire verification harness lives in a session scratchpad, deliberately never committed.
- [ ] **Decide:** `references/` tracked files (~1.4 MB of design reference).
- [ ] **Decide:** the 5 unused starter SVGs.

**If packaging a ZIP, build it from `git archive`** rather than copying the folder — copying will sweep in `node_modules/`, `.next/` and `.env.local`.

### GitHub handoff

- **No remote is configured** (`git remote -v` is empty). Nothing has ever been pushed.
- Branch `main`, 16 commits, clean history, **no secrets in any blob in any commit** (verified this pass).
- Still needed: create the remote, **rotate the keys first**, push, and confirm `.env.local` is absent from the pushed tree.

---

## 8. Submission-readiness verdict

**Not ready to submit today. One blocker, and it is not a code defect.**

What is genuinely done: all sixteen requirement rows above are Complete, two of them with real live provider evidence rather than mocks. The build, lint and 85 tests are clean. No secret appears in any tracked file or in any commit in history. Every visible control does something.

What holds it back:

1. **Both API keys must be rotated** before the project is shown to anyone. This is the only item that would turn a good submission into the exact failure the PDF calls a security breach. It is an operational task, not a code change.
2. **Truncated answers present as complete** (§2). Small, real, and a two-line fix once the owner decides the wire contract.
3. **Two substitutions need the owner's explicit blessing** — the model (`gpt-5.6-luna` for "GPT-4") and the response shape. Both are defensible and both are disclosed; neither was approved by the PDF, and an auditor should not grant that approval on the owner's behalf.

No completion percentage is offered. The requirement matrix above is the honest unit of measurement, and three of the items in §5 remain open.
