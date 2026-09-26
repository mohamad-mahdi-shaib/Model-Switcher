# Project technical guide — Model-Switcher (internal, for the project owner)

**Written:** 2026-09-21, at commit `5ee5f23edc99dbaf99757d3a3d4f41db7c53f824`. **Updated:** 2026-09-22, after the F1, F2, and F3–F9 fix passes (uncommitted at time of writing — see `docs/remaining-work-plan.md` for exact scope).
**Audience:** you, the project owner, for your own understanding.
**Status:** internal reference document. It is **not** a PDF-required deliverable and should not be bundled into the submission ZIP unless you decide later that it should be. See §18 at the end for exactly what is internal versus shareable.

This guide explains what the codebase actually does, in plain language, file by file and step by step. Everything in it is drawn from reading the current source code and the three existing audit documents (`requirements-audit.md`, `final-inventory.md`, `remaining-work-plan.md`) — nothing here is aspirational or describes a future state.

---

## 1. Project concept and user experience

This is a desktop web chat application, built to satisfy the Numbase "Creative Model-Switcher Interface" brief: a **glassmorphic** (frosted-glass-styled) AI chat UI where you can talk to either of two AI providers — **Google Gemini** or **OpenAI GPT** — and switch between them mid-conversation.

From the user's seat, sitting down at the app for the first time looks like this:

1. A single-page app opens showing a glass panel with a **welcome screen**: three suggested starter prompts, and a message box at the bottom.
2. A sidebar on the left lists past conversations (empty at first), grouped as Today / Yesterday / Previous.
3. A header at the top shows which AI provider is selected (Gemini by default), the exact model name it's using, and a button to change the background/glass appearance.
4. Typing a message and pressing Enter sends it. A message never appears in a "blue bubble" — the brief explicitly asked us to avoid that — instead the user's own text right-aligns with a subtle timestamp and a brief gold light traces its edge as it arrives.
5. The AI's reply streams in gradually: an avatar and a glass panel fade in, then the words themselves appear in small paced groups rather than all at once or one character at a time.
6. You can **Stop** a reply mid-stream, **Retry** a failed one, or **Copy** the finished answer (or just one code block from it).
7. Switching providers **mid-conversation** triggers a confirmation dialog, because the brief calls this "crucial" — switching silently would be misleading about which AI is now answering.
8. Everything persists: closing the tab and coming back (or hitting refresh) restores every saved conversation exactly as it was.

There is no user account, no login, no server-side database — everything is one browser, one machine, stored locally.

---

## 2. Complete folder and file structure

```
model-switcher/
├── src/
│   ├── app/                                  Next.js "App Router" — pages and API routes
│   │   ├── layout.tsx                        Root HTML shell, page <title>
│   │   ├── page.tsx                          The one page: renders <WorkspaceLayout />
│   │   ├── globals.css                       ~1,300 lines: all visual design, glass, motion
│   │   └── api/chat/
│   │       └── route.ts                      The ONE backend endpoint (GET + POST)
│   │
│   ├── components/
│   │   ├── icons.tsx                         Hand-drawn SVG icon components (no icon library)
│   │   └── workspace/
│   │       ├── WorkspaceLayout.tsx            The top-level screen; wires everything together
│   │       ├── ChatHeader.tsx                 Title, provider selector, model name, switch dialog
│   │       ├── ConversationSidebar.tsx        Left sidebar: history list, rename, delete
│   │       ├── BackgroundPicker.tsx           The "Change background" popover
│   │       ├── MessageList.tsx                The conversation transcript itself
│   │       ├── MessageComposer.tsx            The text box + Send/Stop button at the bottom
│   │       └── Markdown.tsx                   Turns parsed Markdown into React elements
│   │
│   ├── lib/                                   Code that runs in the BROWSER (client-side)
│   │   ├── providers.ts                       Which providers exist, from the browser's view
│   │   ├── chat.ts                            Shared message/error types, error copy
│   │   ├── conversations.ts                   Title-guessing, date grouping, draft filtering
│   │   ├── storage.ts                         Reads/writes localStorage
│   │   ├── use-conversations.ts               THE big hook: owns all chat state and streaming
│   │   ├── limits.ts                          Shared input/conversation length limits (client + server)
│   │   ├── backgrounds.ts                     Background/glass style definitions
│   │   ├── markdown.ts                        A small, custom Markdown parser
│   │   ├── reveal.ts                          Pure logic for pacing how text appears
│   │   ├── use-reveal.ts                      The React hook that runs reveal.ts on a timer
│   │   └── use-edge-glint.ts                  Pointer-tracking hook for the "Clear Glass" hover glow
│   │
│   └── server/providers/                      Code that runs ONLY on the SERVER (never shipped to the browser)
│       ├── types.ts                           The shared "ChatProvider" contract every adapter must follow
│       ├── registry.ts                        Maps a provider id string to its adapter
│       ├── gemini.ts                          Talks to Google's Gemini API
│       └── openai.ts                          Talks to OpenAI's API
│
├── public/backgrounds/                         Bundled local images (SVG artworks + one JPEG photo)
├── tests/                                       188 automated tests (Node's built-in test runner)
├── tests/browser/                               Committed real-browser acceptance harness (CDP), incl. a
│                                                  dedicated network-isolation negative test, run on demand
├── docs/                                        All audit/planning documentation, including this file
├── references/                                  The original project brief PDF and design references
├── package.json / package-lock.json             Dependencies (only 4 real runtime packages)
├── .env.example                                 Template for your own .env.local (no real keys)
├── .env.local                                   YOUR real API keys — never committed, never read here
└── .gitignore                                   Excludes .env*, node_modules, .next, etc.
```

**The most important split to understand:** `src/lib/` runs in the user's browser; `src/server/providers/` runs only on your machine (or wherever the app is deployed) and is never sent to the browser. That split is what keeps your API keys safe — see §10.

---

## 3. What the frontend does

### Page and layout structure

`src/app/page.tsx` is almost empty — it just renders `<WorkspaceLayout />`. `src/app/layout.tsx` is the outer HTML shell (sets the page `<title>` and loads `globals.css`). All real structure lives in **`WorkspaceLayout.tsx`**, which is the root of everything visible:

- It owns the currently selected **background** and **glass style** (plain React state — these are *not* saved to localStorage, so they reset to the defaults, Warm Studio + Glowy Glass, on every fresh page load).
- On mount, it does one `fetch("/api/chat")` (a `GET` request) to ask the server which providers are actually configured — this is the *only* network call this component makes on its own; it never talks to Gemini or OpenAI directly.
- It calls the `useConversations()` hook (see below) to get all the chat data and actions, and passes pieces of that down to the sidebar, header, message list and composer.
- The outermost `<div>` carries the current glass/background/provider choices as HTML `data-*` attributes (`data-glass`, `data-preset`, `data-provider`, `data-tone`) — this is how `globals.css` knows what to paint, entirely through CSS attribute selectors, with no inline style logic in the component.

### Sidebar

`ConversationSidebar.tsx`. A fixed-width glass panel, hidden below the `md` breakpoint (this app is desktop-only by design). It shows:
- An "AI Workspace" brand mark and a **New conversation** button.
- A warning banner if browser storage is unavailable, corrupt, or full (see §8).
- Conversations grouped into **Today / Yesterday / Previous** headings (computed by `groupByRecency()` in `conversations.ts`), newest first within each group.
- Each row supports **inline rename** (click the pencil icon, type, Enter to commit, Escape to cancel) and **two-step delete** (click the trash icon, a small "Delete '<title>'?" confirmation appears with Delete/Cancel buttons — nothing is ever deleted on a single click).

### Header and model selector

`ChatHeader.tsx`. Shows the conversation title, then on the right: a small pill-shaped radio group with one chip per provider ("Gemini" and "GPT"), and directly beneath it — right-aligned — the **exact model name** the active provider is actually configured to use (e.g. `gemini-3.6-flash` or `gpt-5.6-luna`), read live from the server's availability probe, never hardcoded. If the server hasn't answered yet it says "checking model…"; if a provider reports no model it honestly says "model unavailable" rather than guessing.

Clicking a different provider:
- If the conversation is empty (no messages sent yet), it switches instantly, no confirmation needed.
- If the conversation has already started, a **confirmation dialog** ("Switch to Gemini?" / "Switch to GPT?") appears, explaining that the whole conversation so far will be sent to the new provider and that older replies keep their original model's identity. Cancel or Escape backs out with nothing changed; confirming switches.
- While a message is currently streaming, the other provider's chip is disabled outright (can't be clicked, can't be tabbed to) — you can't switch mid-request.

### Background/glass picker

`BackgroundPicker.tsx`. A "Change background" button opens a popover with two sections: **8 backgrounds** (3 CSS-gradient "Ambient" presets plus 5 "Luxury" artworks, one of which — Luxury Salon — is a real bundled photograph, not a gradient) and **2 glass styles** ("Glowy Glass", the original frosted design, and "Clear Glass", a more open, lit-edge variant). Escape or an outside click closes it. This choice lives only in React state, so it resets on refresh — it is not part of what gets saved.

### Message list

`MessageList.tsx`. The scrollable transcript area. Handles:
- The **welcome state** when a conversation is empty (three clickable starter prompts that fill the composer without sending).
- A **setup state** telling you to add an API key if the current provider isn't configured.
- Each **user message**: right-aligned, no bubble, semibold text, a small sent-checkmark and timestamp.
- Each **assistant message**: an avatar, a glass-toned content area, Markdown rendering, and (once finished) **Copy response** plus a **Copy** button on every individual fenced code block.
- The **typing indicator**: three pulsing dots plus "<Provider> is responding", shown only while a request is in flight.
- The **error banner**: shown when a request fails, with a **Retry** button.
- "**Show full response**" — appears only while the word-by-word reveal is still catching up to what's actually been received; clicking it jumps straight to the full text.
- Auto-scroll to the latest message, with a "**Jump to latest**" floating button if you've scrolled up manually.

### Composer

`MessageComposer.tsx`. A single auto-growing textarea (up to 6 lines, then it scrolls) plus one button that is either **Send** (a sparkle icon, disabled while empty) or **Stop** (while a reply is streaming). Enter sends; Shift+Enter inserts a newline; typing while using an IME (for languages like Japanese/Korean) is not interrupted by Enter.

### Animations and reveal system

Two separate systems, easy to conflate but genuinely different:

1. **Entrance motion** (pure CSS, in `globals.css`) — plays once, when a message is first inserted:
   - A sent user message fades in over 1200ms with a small 6px upward drift (opacity + position only — no scale, no blur), plus a thin gold light that traces once around its edge.
   - An assistant reply arrives in three quick staggered stages: the avatar (420ms), then the glass panel (320ms, 60ms later), then the text itself.
   - A conversation restored from storage on page load never replays any of this — only genuinely new messages animate.
2. **Progressive text reveal** (`reveal.ts` + `use-reveal.ts`) — a *separate* system that paces how the assistant's *words* appear as they stream in, independent of the entrance animation above. See §12 for the full mechanics; the short version is that it releases 3–4 words every 300–350ms rather than showing everything at once, and each small group of words fades in over 900ms as it appears. **A defect found by an independent review, specific to code blocks — since fixed (F6):** a single line of code longer than that 3–4-word pacing budget used to be able to get stuck showing only the opening ` ``` ` fence for the rest of the entire answer, because the logic meant to reveal a whole code line at once kept re-checking the same position instead of looking ahead to where that line actually ends. Fixed, without touching the prose pacing numbers above at all — the fix is entirely local to how a fenced code block specifically is paced.

---

## 4. What the backend does

The entire backend is **one file**, `src/app/api/chat/route.ts`, plus the provider adapters it calls into. There is no separate server process, no database — this is a Next.js "API route" that runs as part of the same app.

### `GET /api/chat`

Called once by the frontend on load. Returns which providers are configured (a key is present) and what model each would use — booleans and strings only, **never a key value**. This lets the UI grey out / enable providers correctly before you've sent a single message.

### `POST /api/chat` — request validation

Receives `{ provider: "gemini" | "gpt", messages: [{role, content}, ...] }`. Before doing anything else it checks:
- Is `provider` a real, registered provider? (Unknown providers are rejected as `PROVIDER_DISABLED`.)
- Is that provider actually configured (has a key)? (`MISSING_KEY` if not.)
- Is `messages` a non-empty array, no longer than **50 messages**?
- Is every message under **16,000 characters**, with a valid role?
- Does the conversation end with a user message (not an assistant one)?

Anything that fails these checks gets a normalized JSON error response — never a raw exception — with an HTTP 400 or 403 status.

**A defect found by an independent code review — since fixed (F4).** Before this fix, that guarantee only held for well-formed input: a request body that was `null` rather than an object, a message entry that was `null`, or a provider id like `"constructor"`/`"__proto__"` (which JavaScript's own object model treats as inherited, always-present properties) each crashed with a raw, uncaught error instead of the normalized response above. Fixed by explicitly checking that the body and every message are real objects with the expected shape before reading anything off them, and by switching the provider lookup to a data structure (a `Map`) that has no inherited properties to accidentally match. Covered by 6 new automated tests driving the real route handler directly. Tracked as Milestone 4 in `docs/remaining-work-plan.md`, now marked done.

### Provider registry

`src/server/providers/registry.ts` is a small lookup table: `{ gemini: geminiProvider, gpt: openaiProvider }`. The route never knows anything vendor-specific — it asks the registry for "the adapter for this provider id" and calls the same three methods (`availability()`, `stream()`) on whichever one comes back. Adding a third provider later means: write one new adapter file implementing the shared `ChatProvider` interface, add one line here, and nothing else in the app needs to change.

### Gemini adapter

`src/server/providers/gemini.ts`. Uses Google's official `@google/genai` SDK. Maps the conversation's `user`/`assistant` roles to Gemini's own `user`/`model` roles, calls `generateContentStream()`, and yields each chunk's text back to the route. Default model: `gemini-3.6-flash` (overridable via the `GEMINI_MODEL` environment variable).

### OpenAI adapter

`src/server/providers/openai.ts`. Talks to OpenAI's Responses API directly over `fetch` (no SDK dependency) using Server-Sent Events (SSE) streaming. Default model: `gpt-5.6-luna` (overridable via `OPENAI_MODEL`), chosen as the most cost-efficient current text model. Requests are capped at 1,200 output tokens per answer, with the model's own internal "reasoning" step explicitly turned off — reasoning tokens would otherwise silently eat into that same cap before any visible text is produced.

**A defect found by an independent review — since fixed (F7).** SSE, the streaming format OpenAI's API uses, technically allows three different line-ending styles (a spec detail few implementations actually need to care about); this adapter's parser used to recognise only one of them, so a CRLF-delimited stream (not known to have ever actually happened, but valid per the spec) would have silently produced no output at all. Fixed by rewriting the low-level line-splitting logic to handle all three styles correctly, including the tricky case of a line ending split exactly across two network chunks. Covered by 5 new automated tests. Tracked as part of Milestone 7 in `docs/remaining-work-plan.md`, now marked done.

### Streaming

Both adapters expose the same shape to the route: an async stream of small text pieces ("deltas"). The route wraps whichever adapter it's using in one shared re-framing step that turns those deltas into the app's own wire format (see §6) — the route itself contains zero vendor-specific code.

### Retries and error handling

If the *very first* connection attempt to a provider fails in a way the adapter marks "retryable" (a temporary network hiccup, or the provider reporting it's momentarily overloaded), the route retries automatically, up to **3 attempts total**, with a short increasing delay between tries. Failures the adapter marks non-retryable — a bad API key, no billing credit, a malformed request — are never retried, because retrying those only wastes time and quota without any chance of succeeding. Every vendor-specific error (an HTTP 429, a particular JSON error code, etc.) is translated by the adapter into one shared, small vocabulary of error codes (`INVALID_KEY`, `RATE_LIMIT`, `INSUFFICIENT_CREDIT`, and so on) before it ever reaches the route or the browser.

---

## 5. How frontend and backend communicate

There is exactly one channel: the browser's `fetch()` calls to `/api/chat`. Nothing else — no WebSocket, no separate server, no third-party client-side SDK talking directly to Gemini or OpenAI. This is what the brief's "frontend stays clean while the backend handles the heavy lifting" line is asking for, and it's also why your API keys can never leak into the browser: the browser genuinely has no code path that could read them (see §10).

---

## 6. The normalized response contract

### Messages: `role` / `content`

Internally, every chat message — whether from the user or an assistant — is represented the same way: `{ role: "user" | "assistant", content: "the text" }`. This is what actually gets sent to `/api/chat`, and it's the shape both provider adapters translate *into* their own vendor-specific format and translate answers *back out of*. The app's own richer message objects (used in the browser) add a few more fields on top — an `id`, a `state` ("complete"/"interrupted"/"streaming"), and which `provider` produced it — but those extra fields are stripped before anything is sent to the server.

### Events: `delta` / `done` / `error`

Because an answer arrives gradually, a single request/response pair isn't enough — the server needs to send the browser small pieces of text as they arrive, not the whole answer at once. The wire format is **NDJSON** ("newline-delimited JSON"): one small JSON object per line, streamed as the response body. There are three kinds of line:
- `{"type":"delta","text":"..."}` — a piece of the answer has arrived; append it.
- `{"type":"done","outcome":"complete"|"truncated"|"unknown","reason":"..."}` — the stream has ended, and `outcome` says *why* (see below); `reason` is only present for a truncated answer, and is a plain-language phrase, never a raw vendor error code.
- `{"type":"error","code":"...","message":"...","info":{...}}` — something went wrong; whatever text arrived before this is kept, not discarded.

**`outcome` is a defect fix (F2), covered in detail in §8 below and `docs/requirements-audit.md` R14/R15.** Before that fix, `done` carried no information at all — the app inferred "the answer is complete" purely from the connection closing, which meant a genuinely complete answer, one cut off by a length limit, and one that simply dropped mid-stream were all indistinguishable on the wire. Now every provider adapter reports which of the three actually happened, honestly, as the very last thing it does before the stream ends.

### The PDF's `author`/`text` example, and how this design relates to it

The project brief includes one illustrative example (§6, Step 2 of the PDF, itself headed "Here are some tips"): *"Every response from your backend should look exactly the same: `{ "author": "assistant", "text": "Hello!" }`. This is called Normalization."* Two independent audits of this project (see `docs/requirements-audit.md` §0 and `docs/model-switcher-codex-review.md`) both read this the same way: the **principle** — every response has one consistent shape — is the actual requirement, and the specific field names `author`/`text` are an illustrative example (it's introduced with the word "Example:", inside a section titled "tips"), not a literal contract the code must match character-for-character.

This app follows the principle but not the exact field names: it uses `role`/`content` instead of `author`/`text`, and it uses a stream of small events instead of one whole-response object, because the interface genuinely streams — a single terminal `{author, text}` object has no way to express "here's part of the answer, more is coming," Stop, or a failure that happens partway through after some text was already shown. This is a disclosed, deliberate engineering decision, not an oversight, and it's flagged in the audit documents as something you may want to explicitly confirm you're comfortable with, precisely because the PDF itself never approved this specific substitution.

---

## 7. How context and conversation history work

Every time you send a message, the app does **not** send just that one message — it sends the **entire conversation so far** (every message in the currently active conversation, oldest to newest, capped at 50 total) to whichever provider is selected. This is what makes "remembers what was said 3 messages ago" work: there's no special memory system, the provider is simply re-shown the whole transcript on every single turn, and large language models naturally use everything in front of them to answer.

Conversations are strictly isolated from each other — switching to a different saved conversation and sending a message there only ever includes *that* conversation's own history, never anything from a sibling conversation.

**Input and conversation-length limits, and a defect found by an independent review — since fixed (F3).** The server refuses any single message over 16,000 characters, and any conversation whose history would exceed 50 messages — these numbers live in one shared place (`src/lib/limits.ts`) so the composer and the server can never quietly disagree about them. Before this fix, the *composer* had no length guard of its own: an over-limit draft would be sent anyway, rejected by the server, and then sit permanently in that conversation's history — poisoning every future send in the same conversation, including a brand-new, unrelated, perfectly short message, because the server checks the *whole* history on every request. Fixed: the composer now refuses an over-limit or already-full-conversation draft immediately, with the actual limit named in a small notice, and the draft itself is left exactly as typed so you can trim and resend rather than losing it. Reaching the 50-message cap shows that specific limit and offers a "Start new conversation" button rather than generic, unhelpful advice to "try rephrasing it." Separately, since Gemini has no length cap of its own (§4's OpenAI cap does not apply to it), a single very long Gemini answer already saved in history could previously cause the same permanent-poisoning problem from the *assistant* side. **This was first handled by trimming only the copy sent to the provider — and an independent follow-up review (Finding U1) correctly found that approach itself a problem:** a fact near the end of such a message could quietly never reach the provider on a later turn, with no indication anywhere in the interface that a shortened copy was what was actually sent. Fixed properly: a conversation carrying such a message can no longer be sent further *at all* — the same honest "you've hit a real limit, start a new conversation" treatment the 50-message cap already gets, with a matching notice and button, rather than a silent, partial workaround. Covered by 24 automated tests (16 originally, +8 for the U1 correction) plus a real-browser check. Tracked as Milestone 3 in `docs/remaining-work-plan.md`, now marked done.

---

## 8. How refresh persistence works with localStorage

`src/lib/storage.ts` reads and writes one `localStorage` key (`model-switcher:conversations`) holding a versioned JSON blob: `{ version: 1, conversations: [...], activeId: "..." }`. Each message in that blob may also carry `outcome` (`"complete"|"truncated"|"unknown"|"stopped"|"failed"`) and `outcomeReason` (a short plain-language string, only for `"truncated"`) — see below. On every page load, before anything else renders, the app tries to read and parse this key ("**hydration**" — see the glossary). If it parses successfully and matches the expected shape, those conversations replace the blank starting state. After that, any change — a new message, a title rename, a delete — gets saved back automatically, throttled to at most once every ~700ms so rapid streaming updates don't hammer the browser's storage on every single word.

A reply that was still streaming when the page was closed comes back on reload marked **"interrupted"**, never silently shown as if it had finished, and never left looking like it's still streaming forever.

**A defect found by an independent code review of this project — since fixed (F1).** If the saved data was corrupted or from an incompatible future version, or if the browser's storage was essentially full, the app's own automatic save used to be able to overwrite that data with an empty conversation list shortly after load, instead of safely leaving it alone. This is now fixed: the app checks, once, right after that very first read, whether it's safe to auto-save for the rest of this session — and if the read was corrupt, unrecognised, or genuinely unreadable, it simply never auto-saves again for as long as that session runs, leaving the original bytes exactly as they were. You can keep chatting normally in the meantime; it just won't be saved until you close the tab and come back with storage in a readable state again. Separately, the check for "is there room to save" no longer requires an extra trial write before reading — so if your storage is nearly full but still holds perfectly good history, that history now loads correctly instead of being mistaken for corrupted. Covered by 15 new automated tests plus a real-browser check with no real AI requests involved. Tracked as Milestone 1 in `docs/remaining-work-plan.md`, now marked done.

**A second defect found by the same review — also since fixed (F2).** Before this fix, the app decided whether an answer was "complete" purely by watching the network connection close — it never actually checked *why* the stream ended. That meant an answer cut off by OpenAI's or Gemini's own length limit, one dropped mid-stream by a network fault, and a genuinely finished answer all displayed identically as a normal, complete reply — silently hiding the fact that part of the answer might be missing. This is now fixed: every provider adapter reports one of three honest outcomes as the very last thing it sends (`"complete"`, `"truncated"` with a specific plain-language reason, or `"unknown"` for a bare dropped connection with no explanation at all), the server forwards that outcome, and the app stores it on the message itself (`outcome`/`outcomeReason` above) so it survives a refresh exactly as shown live. A mid-stream error arriving after some text had already come in is handled the same honest way — the partial text is kept, the message is marked interrupted immediately (not only after your next reload), and the existing error banner still appears. None of this affects a normal, fully-completed answer, and pressing Stop still behaves exactly as before. Covered by 47 new automated tests (against the real OpenAI adapter, a new real Gemini-adapter test suite, a new real API-route test suite, and the real conversation hook) plus a real-browser check across 6 scenarios, no real AI requests involved. Tracked as Milestone 2 in `docs/remaining-work-plan.md`, now marked done.

---

## 9. How model switching works, including the warning and provider identity

Covered functionally in §3 (Header) — the mechanics underneath: each **conversation** (not the app globally) remembers which provider it's using, stored as `providerId` on that conversation's record. Switching providers changes *that* conversation's setting for all *future* messages in it. Each individual **assistant message** additionally remembers, permanently, which provider actually generated it (`message.provider`) — so a conversation can contain, say, four Gemini answers followed by one GPT answer after a switch, and each one keeps showing the correct provider's visual accent color and label forever, even after the conversation's own "current" provider has moved on. This is what makes a mixed-provider transcript stay honest about who said what, exactly as the brief's "Model Identity" idea implies.

**A defect found by an independent review — since fixed (F5).** Retry itself always correctly re-sent to the provider that actually failed, internally — that part was never broken. But what the screen *displayed* while an error was showing, or while a retry was in flight, used to read whichever provider was *currently selected* in the chip UI instead — so failing on Gemini, then switching the selector to GPT without retrying, could make the error banner relabel itself "GPT rejected that API key" even though Gemini was still the provider Retry would actually contact. Fixed: the app now separately tracks "the provider this specific request actually targeted" and uses that for the error banner and the typing indicator, not the (possibly since-changed) selection. Separately, the "please add your key" setup screen used to always say "Gemini" regardless of which provider was actually missing its key; it now names the real one. Covered by a real-browser check, since this is purely about which value a component displays, not a decision with its own inputs/outputs to unit-test in isolation. Tracked as Milestone 5 in `docs/remaining-work-plan.md`, now marked done.

**A defect found by both independent reviews — since fixed (F8).** The switch-confirmation dialog (§3) declared itself a modal but didn't actually behave like one: repeatedly pressing Tab could walk keyboard focus straight out of the dialog and onto a provider chip behind it, and clicking to dismiss the dialog could, in the same click, also activate whatever background control happened to be under the pointer. Fixed: Tab now cycles only between the dialog's own two buttons; a full-screen invisible layer sits behind the dialog and catches any "outside" click before it can reach anything behind it; closing the dialog (by any means — Cancel, Escape, or confirming) returns keyboard focus to the exact chip that opened it. The dialog's visible design is unchanged. Verified in a real browser at both required screen sizes. Tracked as part of Milestone 7 in `docs/remaining-work-plan.md`, now marked done.

---

## 10. How API keys are read from environment variables and kept server-side

Your real keys live in `.env.local` at the project root (a file that is deliberately **git-ignored** — it will never be committed) as `GEMINI_API_KEY=...` and `OPENAI_API_KEY=...`. They are read with plain `process.env.GEMINI_API_KEY` / `process.env.OPENAI_API_KEY`, and **only inside** `src/server/providers/gemini.ts` and `openai.ts`. No file under `src/lib/` or `src/components/` ever reads `process.env` for anything key-related, and neither variable is prefixed `NEXT_PUBLIC_` — that prefix is the one thing in Next.js that would bundle a value into the code sent to browsers, so its absence here is what actually guarantees a key can never end up in a page source. This has been independently verified in prior audits by scanning the entire built browser bundle for the literal key values and finding none.

The one thing the *browser* ever learns is the `GET /api/chat` availability response: `{ providers: { gemini: { configured: true, model: "gemini-3.6-flash" }, ... } }` — booleans and model name strings only.

This document does not contain, quote, or reference either of your actual key values anywhere, and it was written without printing them at any point.

---

## 11. What each important React hook and component owns

| Hook / component | Owns |
| --- | --- |
| `useConversations()` (`use-conversations.ts`) | **Everything about chat state**: the full list of conversations, which one is active, hydration/load status, the current request status (idle/streaming/error), the actual network request and NDJSON parsing loop, Stop/Retry/Send, and scheduling saves to storage. This is the single largest and most central piece of logic in the app. |
| `useReveal()` (`use-reveal.ts`) | For one assistant message: how much of its text is currently "revealed" on screen, driven by a self-rescheduling timer using the pacing rules in `reveal.ts`. Never touches the actual saved content — purely a display-layer decision. |
| `useEdgeGlint()` (`use-edge-glint.ts`) | The pointer-tracking hover highlight on Clear Glass panels. Pure visual decoration; writes directly to a DOM element's style rather than triggering React re-renders, to stay smooth. |
| `WorkspaceLayout` | The screen's overall composition and the one-time provider-availability fetch. |
| `ChatHeader` | Provider selection UI, the switch-confirmation dialog, the model-name readout, background/glass picker mount point. |
| `ConversationSidebar` | Rendering, renaming and deleting the saved-conversation list. |
| `MessageList` | Rendering the transcript: welcome/setup states, each message, the typing indicator, the error banner. |
| `MessageComposer` | The text input and Send/Stop control only — it has no knowledge of conversations or providers beyond the callbacks it's given. |

---

## 12. Glass modes, backgrounds, visual identity, motion, typing indicator, Stop, Retry, Copy, Show Full Response

- **Glass modes.** Two CSS "materials" (`data-glass="classic"` = Glowy Glass, `data-glass="ultra"` = Clear Glass) that change how the frosted panels render — blur amount, border treatment, highlight style. Selected via the appearance picker; purely visual, no functional difference.
- **Backgrounds.** 8 presets (§3), selected the same way, driving both the page background image/gradient and — via a `data-tone` attribute ("light"/"dark") — which set of text-ink colors is used, so text always stays readable regardless of background.
- **Visual identity per provider.** One accent color per provider (a muted blue-grey for Gemini, a muted green for GPT), applied to that provider's avatar ring, its typing-indicator dots, and its selected chip — never anything drastic, matching the brief's own suggestion of "a color shift or a different glow."
- **Motion.** Covered in §3 — CSS keyframe animations that play once on insertion, never on restored history.
- **Typing indicator.** Three dots with a staggered pulse animation, shown only while a request is actually in flight, labelled with the responding provider's name.
- **Stop.** Aborts the in-flight network request immediately. Whatever text had already streamed in is kept and marked "interrupted" (with a small "Response interrupted." note), never discarded. A message can also end up "interrupted" for other honest reasons — cut short by a provider's own length limit, or a connection that dropped mid-answer — and each of those shows its own distinct, accurate note rather than reusing Stop's wording (§6, §8).
- **Retry.** Re-sends the last user message, but specifically to **the same provider the original attempt actually used** — even if you've since changed the selector to a different provider — so a retry can never silently answer from a different AI than the one that failed.
- **Copy.** Two separate buttons: "Copy response" copies the entire finished answer's text (via the browser clipboard API), and every individual fenced code block gets its own small "Copy" button for just that snippet.
- **Show Full Response.** Appears only while the word-by-word reveal (§3, §6) is still behind what's actually been received; clicking it immediately shows everything, skipping the remaining pacing.

---

## 13. The complete lifecycle of one user message

Step by step, from pressing Send to the final answer being stored:

1. **You type and press Enter** in `MessageComposer`. It calls `onSend(text)`, which is `useConversations()`'s `send()` function.
2. `send()` checks the text isn't empty and that no other request is currently in flight (this also prevents accidentally sending the same message twice).
3. Your message is immediately added to the active conversation's message list and shown on screen — this happens *before* any network request, so the UI feels instant. If this is the conversation's very first message, a title is guessed from it right away (`deriveTitle()` in `conversations.ts`).
4. `send()` kicks off `run()`, which builds the full message history for this conversation (§7), and does one `fetch("/api/chat", { method: "POST", body: {...} })`, tagged internally with a unique request id and the conversation id it belongs to.
5. The **server** (`route.ts`) receives it, validates it (§4), looks up the right adapter from the registry, and calls that adapter's `stream()` method — which is the point a real network request actually leaves your machine toward Gemini or OpenAI.
6. As the provider streams its answer back, the adapter yields small text pieces; the route re-wraps each one as an NDJSON `delta` line and sends it immediately (this is why answers appear to "type" in real time rather than arriving all at once).
7. Back in the browser, `use-conversations.ts` reads the response body as a stream, splits it line by line, and for every `delta` line appends that text onto a new assistant message (creating it on the very first delta, growing it on every one after).
8. Simultaneously, `useReveal()` (mounted for that specific message) is independently pacing how much of that *already-received* text is actually shown on screen at any instant (§3) — the received text and the displayed text are deliberately two different things, so Stop/Copy/storage always see the true full text even mid-reveal.
9. When the server sends `{"type":"done","outcome":...}`, the client's `settleRun()` looks at that outcome, not just at the fact that the stream ended: only `outcome:"complete"` marks the message "complete" (typing indicator disappears, Copy buttons become active). `outcome:"truncated"` or `"unknown"` instead marks it "interrupted" and shows a specific, accurate note explaining why (§6, §8) — the received text is never discarded either way.
10. Throughout this whole process, `use-conversations.ts` has been scheduling throttled saves to `localStorage` (§8) — so even a message still mid-stream will already be safely saved (marked "streaming") if you were to close the tab right then; on the next load it would come back correctly marked "interrupted" rather than lost or shown as complete.
11. If you'd pressed **Stop** at any point in steps 5–9, the request is aborted, whatever text had arrived stays, and the message is marked "interrupted" instead of "complete."
12. If the server had instead sent an `{"type":"error",...}` line at any point, the received text (if any) is kept, the message is marked "interrupted" immediately (not only on a later reload) if any text had already arrived, and an error banner with a Retry button always appears below the transcript either way, with the message's provider identity preserved so Retry knows exactly where to resend.

---

## 14. Tests, lint, build, mocked fixtures, and known limitations

**Current state, after the F1–F8 fixes (see §15):**

- `npm test` — **188 tests, all passing** (85 originally; +15 for F1; +47 for F2; +33 for F3–F9, including a small F2 follow-up; +8 for the U1–U6 follow-up correction, see §15), covering: error-classification logic for both providers, both providers' own SSE/streaming parsing and outcome classification (with a fake, intercepted transport — no real network; the Gemini adapter is now tested this way too, closing a gap that used to exist), the provider registry contract, the local Markdown parser (including deliberately hostile input like `javascript:` links), conversation title/grouping logic, the reveal-pacing math (including the F6 fenced-code fix), the shared input/conversation-limit logic behind F3, `localStorage` read/write round-tripping including the F1/F2 protections, the real API route's `POST`/`GET` handlers directly including F4's malformed-request handling, and the conversation hook's persistence-gating and stream-settlement decision logic (`persistIfAllowed`, `settleRun`) imported and tested directly as exported functions.
- `npm run lint` — clean, no warnings.
- `npm run build` — clean production build.
- **Mocked fixtures**: every browser-level UI check performed during development and audit work installed a stand-in for `window.fetch` *before* the page loaded, and explicitly verified that stand-in was actually active before sending anything — so none of that testing could ever have silently fallen through to a real Gemini or OpenAI request. The F3–F9 pass additionally blocks the real provider domains at Chrome's own network layer, as a backstop independent of that stand-in. A small number of genuine, deliberate live requests were made once, during the milestone where multi-provider support was first verified end-to-end (documented with exact attempt counts in `requirements-audit.md`).
- **On the distinction between test layers** (worth understanding precisely, since it's easy to overstate): the `persistIfAllowed`/`settleRun`/`validateDraft` tests above call exported pure functions directly — the same functions the real hook/composer call internally, not a reimplementation — but they do **not** mount anything inside an actual React component tree, because this project's test suite has no renderer/DOM available. That gap is covered instead by a separate, real-browser verification layer (Chrome via CDP, mocked chat, zero provider requests) that exercises the actual compiled app end to end; it caught at least one real regression during the F2 fix that the pure-function tests alone had missed (§15), which is precisely why that layer exists alongside the module tests rather than instead of them. As of this pass, that browser layer is itself committed to the repository (`tests/browser/`), not a private scratchpad script — F5 and F8 specifically have **no** pure-function unit test at all, by nature rather than oversight (provider attribution is which prop a component reads, not a decision function; focus/keyboard trapping is real DOM behaviour), so the real-browser layer is their only automated coverage. Neither layer is described elsewhere in this project's documentation as something it isn't.

**Known limitations, honestly, as currently documented:**
- Two independent code reviews of this project found a combined **9 confirmed defects**. All nine are now fixed (F1–F8, plus the T1 process gap of misleading test names).
- Automated test coverage: every application-level finding this project's documentation has ever tracked now has either a direct pure-function/route/adapter test or, where no such pure decision point exists (F5, F8), real-browser coverage instead. `use-reveal.ts`'s own React-hook wiring (as opposed to the pure `reveal.ts` logic it calls, which is tested) is still verified only by manual/source inspection and real-browser checks, the same disclosed gap as `useConversations` itself.
- This app is desktop-only by deliberate scope decision (see §16) and has never been deployed anywhere publicly.

---

## 15. Current confirmed issues from the independent audit

Summarized from `docs/model-switcher-codex-review.md` and `docs/remaining-work-plan.md`, where every one of these was independently re-verified against the actual current source code (not merely taken on trust):

| ID | Issue, in plain terms | Severity |
| --- | --- | --- |
| ~~F1~~ | ~~Under two specific conditions (corrupted saved data, or a near-full storage quota), the app's own automatic save could silently wipe out your real saved conversations shortly after loading the page.~~ **Fixed** — see §8. Confirmed by 15 new automated tests against the real code plus a real-browser check. | ~~High~~ **Done** |
| ~~F2~~ | ~~If an answer got cut short (hit a length limit, the connection dropped mid-answer, or the model itself truncated it) the app couldn't tell that apart from a normal, complete answer — it just showed it as finished.~~ **Fixed** — see §6, §8. Confirmed by 47 new automated tests against the real adapters/route/hook plus a real-browser check across 6 scenarios. A genuine regression (a mid-stream error after partial text silently dropping the error banner) was caught by that real-browser check and fixed before this was marked done — see `docs/final-inventory.md` §4 for the full account. | ~~Medium~~ **Done** |
| ~~F3~~ | ~~Sending one message that's too long gets "stuck" in the conversation and silently blocks every message you try to send afterward, even short unrelated ones, until you start a new conversation.~~ **Fixed** — see §7. Confirmed by 16 new automated tests plus a real-browser check. | ~~Medium~~ **Done** |
| ~~F4~~ | ~~A handful of deliberately malformed requests to the backend (not something a normal user would ever trigger by using the app) crash with a raw error instead of a proper, normalized error response.~~ **Fixed** — see §4. Confirmed by 6 new automated tests against the real route handler. | ~~Medium~~ **Done** |
| ~~F5~~ | ~~If a request fails on one provider and you then switch the selector to the other provider without retrying, the error message on screen can end up naming the wrong provider. Also, the "please add your key" setup screen always says "Gemini," even if it's actually OpenAI that's missing its key.~~ **Fixed** — see §9. Confirmed by a real-browser check. | ~~Medium~~ **Done** |
| ~~F6~~ | ~~A single very long line of code inside a streamed answer can get stuck showing only the opening of the code block for a long time, instead of appearing normally.~~ **Fixed** — see §3. Confirmed by 5 new automated tests plus a real-browser check. | ~~Medium~~ **Done** |
| ~~F7~~ | ~~A rare network-formatting variant of streaming (CRLF line endings) isn't currently handled by the OpenAI connection code.~~ **Fixed** — see §4. Confirmed by 5 new automated tests. | ~~Low~~ **Done** |
| ~~F8~~ | ~~The "switch provider?" confirmation popup doesn't fully trap keyboard focus inside itself while open.~~ **Fixed** — see §9. Confirmed by a real-browser check. | ~~Low~~ **Done** |
| — | ~~Key rotation.~~ Both real API keys were pasted into chat transcripts during setup earlier in this project. Nothing was ever committed to Git. **Settled** — the owner has decided to keep the current keys rather than rotate them; what's actually verified, by the secret scan run against every packaged ZIP, is that they stay excluded from every deliverable. | **Settled, not a remaining item** |

None of F1–F8 required touching the approved visual design, glass materials, backgrounds, entrance motion, or gold-orbit effect — every one of them was a logic-level fix.

**A further six issues, found by an independent follow-up review of this project's own packaged archive, in plain terms — all now fixed:**

| ID | Issue, in plain terms | Severity |
| --- | --- | --- |
| ~~U1~~ | ~~The F3 fix for an oversized *historical* message (§3) had it silently shortened for the AI only, on every send — a fact near the end could quietly never reach the model, with nothing on screen saying so.~~ **Fixed** — that conversation is now honestly blocked from sending further at all, with the same "start a new conversation" notice the message-count cap already shows. | Medium |
| ~~U2~~ | ~~A safety net added alongside F3 could delete your own just-sent question when the server rejected it, and then Retry would resend an earlier, already-answered question instead.~~ **Fixed** — a failed send is never deleted; Retry now always targets the question that actually failed. | Medium |
| ~~U3~~ | ~~This project's own claim that the browser test harness was "fail-closed" was not accurate — it blocked the AI providers' own domains, but this app's browser side never talks to them directly, only to this app's own server.~~ **Fixed, and the documentation corrected** — the harness now blocks any attempt to reach this app's own `/api/chat` at the network level, proven by a dedicated test that runs with no mock at all. | Medium |
| ~~U4~~ | ~~The F6 code-reveal fix (§3) could still show a long code line cut off mid-line in one specific window: after the AI had finished answering but while the on-screen reveal was still catching up.~~ **Fixed.** | Medium |
| ~~U5~~ | ~~Two smaller issues with the switch-confirmation dialog: (a) the test harness's simulated Shift+Tab was never actually sending Shift, so that check wasn't really proving anything; (b) the dialog's click-blocking overlay didn't reach the sidebar, only the main chat panel.~~ **Fixed, both.** | Low |
| ~~U6~~ | ~~The packaged ZIP used Windows-style path separators, which broke opening it with a standard cross-platform tool.~~ **Fixed** — rebuilt with a tool that always writes the portable form. | Low (packaging) |

None of U1–U6 required touching the approved visual design either. Full detail, evidence and file references: `docs/requirements-audit.md` §C2 item 14, and the addendum at the end of `docs/remaining-work-plan.md`.

**One further issue, in plain terms, found by a second independent verification pass — now fixed:** the U5 fix above made the dialog's background overlay reach the whole screen, but the dialog's own two buttons ("Cancel" and "Switch model") could still be silently intercepted by that same overlay — clicking "Switch model" for real closed the dialog without actually switching providers, because the click landed on the invisible overlay instead of the button underneath it. **Fixed** by making the overlay and the dialog part of the same layer, instead of the dialog staying nested one level deeper than the overlay it needed to sit above. Confirmed with real, simulated mouse clicks (not just "is the button present on screen") in both approved glass looks. See `docs/requirements-audit.md` §C2 item 14's U5 entry for the full technical record.

---

## 16. Remaining milestones before desktop submission

From `docs/remaining-work-plan.md`, in the order they should be done:

1. ~~Fix F1~~ (persistence data loss) — **done**. See §8 and §15.
2. ~~Fix F2~~ (correct terminal states for complete/partial/interrupted/failed streams) — **done**. See §6, §8 and §15.
3. ~~Fix F3~~ (input and conversation-length limits) — **done**. See §7 and §15.
4. ~~Fix F4~~ (proper validation and normalized error responses for malformed requests) — **done**. See §4 and §15.
5. ~~Fix F5~~ (correct provider attribution in error messages and the setup screen) — **done**. See §9 and §15.
6. ~~Fix F6~~ (code-block reveal no longer stalls) — **done**. See §3 and §15.
7. ~~Fix F7 and F8 together~~ (SSE line-ending handling; keyboard focus trap on the switch dialog) — **done**. See §4, §9 and §15.
8. **Update the audit documents and add regression tests** for everything fixed above — **done, this pass, except the final ZIP rebuild and checksum**, deliberately not performed as part of this pass (see `docs/remaining-work-plan.md` Milestone 8).

Key rotation is settled, not a remaining step: the owner has decided to keep the current keys rather than rotate them (see §15).

**All seven code milestones (1–7) are done, plus the documentation milestone (8) except its final ZIP-rebuild step.** None of them required redesigning anything already visually approved. F1 through F3–F9 added 15, 47 and 33 tests respectively, and the U1–U6 follow-up correction (§15) added 8 more, without touching any of that either — 188 tests pass now, up from 85. The second-pass U5 correction (§15) added no new unit tests (it's DOM stacking/hit-testing behaviour, not a decision function) but grew the real-browser suite to 46/46 per viewport plus a dedicated 16/16 dual-glass-mode regression.

---

## 17. Glossary

- **Frontend** — the part of the app that runs in your web browser: the visible page, the buttons, the animations. In this project, everything under `src/components/` and `src/lib/`.
- **Backend** — the part that runs on the server (your machine, while developing) rather than the browser: the code that actually holds your API keys and talks to Gemini/OpenAI. In this project, `src/app/api/chat/route.ts` and everything under `src/server/`.
- **API route** — in Next.js, a backend endpoint defined by a special file (here, `route.ts`) instead of a separate server framework like Express. It behaves like a normal web server endpoint but lives inside the same project.
- **Adapter** — a small piece of code whose only job is translating between one specific outside service's particular format and this app's own shared, simplified format. `gemini.ts` and `openai.ts` are adapters: the rest of the app never has to know Gemini's or OpenAI's actual request/response shapes.
- **Registry** — a simple lookup table mapping a short id (`"gemini"`, `"gpt"`) to the actual adapter code that handles it, so the rest of the app can say "use whichever provider was requested" without an if/else chain naming every vendor by hand.
- **Streaming** — sending a response gradually, in pieces, as it becomes available, rather than waiting for the entire answer to be ready and sending it all at once. This is why an AI reply appears to "type" rather than popping in fully formed.
- **SSE (Server-Sent Events)** — a standard, one-way streaming format used by OpenAI's API to send pieces of an answer over a single HTTP connection. This app's OpenAI adapter reads and parses this format directly.
- **NDJSON (Newline-Delimited JSON)** — the format this app's *own* backend uses to stream events to the browser: one small, complete JSON object per line. Simpler than SSE, and this app controls both ends of it.
- **Normalization** — making many different things look the same shape, so the rest of the code doesn't need to know or care which one it's actually dealing with. Here: no matter which AI provider answered, or whether it failed, the browser always receives the exact same small vocabulary of message and event shapes.
- **localStorage** — a simple, built-in browser feature that lets a website save small amounts of text data on your own computer, which is still there the next time you visit that site — even after closing the browser. This is how conversations survive a refresh, with no server-side database involved.
- **Hydration** — the moment, right when the page first loads, that the app reads whatever was previously saved in `localStorage` and uses it to fill in the starting state, instead of starting completely blank. (This word has a second, unrelated meaning in some React documentation about matching server- and client-rendered HTML; this project's own code and docs always use it in the "reading saved data on load" sense described here.)
- **Persistence** — the general idea of data surviving beyond the current moment/session — in this app, specifically "surviving a page refresh," accomplished via localStorage.

---

## 18. Sequence diagram: one message, start to finish

```mermaid
sequenceDiagram
    actor User
    participant Frontend as Frontend<br/>(browser)
    participant Route as /api/chat<br/>(server)
    participant Registry as Provider Registry
    participant Adapter as Gemini/OpenAI<br/>Adapter
    participant ProviderAPI as Provider API<br/>(Google / OpenAI)
    participant Storage as Stored Conversation<br/>(localStorage)

    User->>Frontend: Types message, presses Enter
    Frontend->>Frontend: Show message immediately<br/>(optimistic update)
    Frontend->>Route: POST /api/chat<br/>{ provider, messages }
    Route->>Route: Validate request<br/>(shape, length, limits)
    Route->>Registry: getProvider(providerId)
    Registry-->>Route: matching adapter
    Route->>Adapter: stream(messages)
    Adapter->>ProviderAPI: Real network request
    ProviderAPI-->>Adapter: Streamed answer, piece by piece
    Adapter-->>Route: Normalized text pieces
    Route-->>Frontend: NDJSON: {delta}, {delta}, ... {done, outcome}
    Frontend->>Frontend: Append each delta live;<br/>pace the on-screen reveal
    Frontend->>Storage: Throttled save while streaming
    Frontend->>Frontend: settleRun(outcome):<br/>"complete" only if outcome says so,<br/>else "interrupted" + accurate notice
    Frontend->>Storage: Final save
    Frontend-->>User: Finished (or honestly-partial)<br/>answer shown, Copy/Retry available
```

---

## What I should understand as the project owner

- **Architecturally, this project is small and deliberately simple**: one Next.js app, one backend endpoint, two provider adapters, no database, no user accounts. That simplicity is a strength for a brief like this — it's easy to reason about end to end, and every one of the 16 explicit requirements in the PDF maps to a specific, findable file.
- **The split between `src/lib/` (browser) and `src/server/providers/` (server-only) is the entire reason your API keys are safe.** As long as no new code ever reads `process.env` outside `src/server/`, and nothing is ever prefixed `NEXT_PUBLIC_`, this property holds automatically — it's been independently verified by scanning the actual built browser bundle, not just assumed from the folder layout.
- **`use-conversations.ts` is the single most important file to understand** if you want to trace any bug related to chat behavior, streaming, or persistence — nearly everything routes through it.
- **Every confirmed defect is now fixed** — F1 (persistence data loss) and F2 (wrong terminal state on incomplete/broken streams) were the two most serious, fixed first; F3–F8 followed in one continuous pass, plus the T1 test-naming gap; U1–U6 and the U5 second-pass correction (§15) came from two further independent reviews of this project's own packaged archive. See §3, §4, §6, §7, §8, §9 and §15. What remains is a genuinely unproven live-only concern and one UI-addition decision (§6 below) — key rotation and the two substitution items are settled, not remaining work (§0/§6 in the audit docs).
- **Two of the PDF's specific examples were deliberately not followed literally** — the exact model "GPT-4" (superseded by a current model, disclosed everywhere), and the exact `{author, text}` field names (the streaming design needs different field names and an event stream, not one object). Both are disclosed decisions, and the owner has since accepted both — no sign-off is pending.

## What remains before final delivery

1. ~~Fix F1~~ (persistence data loss) — **done**, with 15 new regression tests and a real-browser confirmation.
2. ~~Fix F2~~ (wrong terminal state on incomplete/broken streams) — **done**, with 47 new regression tests and a real-browser confirmation across 6 scenarios.
3. ~~Fix F3–F8~~ (six further confirmed defects, plus a small F2 follow-up and the T1 test-naming gap) — **done**, with 33 new regression tests and a real-browser confirmation across 52 checks at both required screen sizes.
4. ~~Add regression tests for everything fixed, so these specific bugs can't quietly come back.~~ **Done for all of F1–F8, U1–U6, and the U5 second-pass correction.**
5. ~~Rotate both API keys.~~ **Settled:** the owner has decided to keep the current keys; excluded from every deliverable, verified by the secret scan run against each packaged ZIP.
6. ~~Re-run the full secret scan, rebuild the submission ZIP, record its checksum.~~ **Done, repeatedly** — once per fix pass; see `review-baseline-updated.txt` alongside the current archive for the latest figures.
7. ~~Decide on the two disclosed "not literally what the PDF's example showed" points.~~ **Settled: both accepted** by the owner — no sign-off pending.
8. Decide whether F1's fix needs a "start fresh" recovery control added to the UI later — right now, corrupt/unreadable storage safely blocks saving for the rest of that session, but there's no button anywhere to deliberately clear it and start over. Still open; unaffected by this pass.

Full detail and acceptance criteria for every item above are in `docs/remaining-work-plan.md`.

## What is internal documentation and what may be shared with the company

**Internal only — written for you, not meant to represent the project's final polish, and should not be included in the submission package as-is:**
- This file (`docs/project-technical-guide.md`).
- `docs/model-switcher-codex-review.md`, `docs/remaining-work-plan.md`, and `docs/submission-checklist.md` — these are working audit/planning documents, full of "here's what's still broken" language that's useful for you to manage the work but not how you'd want to present the finished project.

**Reasonable to share, as evidence of process and thoroughness, if the company would find that valuable:**
- `docs/requirements-audit.md` and `docs/final-inventory.md` — these are already written as formal audits against the actual PDF brief, requirement by requirement, and could reasonably accompany a submission if you want to demonstrate rigor.
- `README.md` — already written for an external reader (setup instructions, architecture overview, asset credits) and is a normal, expected part of a project handoff.

**Never share:** `.env.local`, its contents, or either actual API key value, in any form, anywhere. This document was written without ever printing or quoting either key.
