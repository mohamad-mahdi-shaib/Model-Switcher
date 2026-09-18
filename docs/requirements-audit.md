# Requirements audit — Numbase Project 1: Creative Model-Switcher Interface

**Audited against:** `references/Project 1_ Model-Switcher AI Interface .pdf` (2 pages, read in full)
**Repository state:** commit `90daafc`
**Date:** 2026-09-19
**Method:** PDF read end to end, then code inspection and live desktop inspection at 1366×768 via Chrome DevTools Protocol. Previous completion reports were **not** treated as evidence; every row below was re-verified against the code or the running app.

**No real model requests were made during this audit.** All chat traffic was mocked at `window.fetch`, returning a synthetic NDJSON stream. Evidence derived that way is labelled **[MOCKED]**. Evidence from earlier live sessions is labelled **[LIVE, earlier session]** and is only cited where a mock cannot prove the point.

---

## 0. How the PDF's statements were classified

The PDF mixes binding requirements with suggestions. This audit separates them, because failing a suggestion is not the same as failing a requirement.

**1. Explicit requirements** — §5 "Functional Requirements (The Core)" (5.1, 5.2); §3's stated result ("the frontend stays clean while the backend handles the 'heavy lifting' of talking to different AIs"); §4's "Provider Abstraction Layer"; §6 Step 3 "Security First — The Golden Rule". §2's "Creative Challenge" bullets are explicit expectations but phrased qualitatively ("Think about how messages appear", "Can you make the UI change subtly…"), so they are graded on whether the behaviour exists at all, not on taste.

**2. Suggested techniques / examples** — not binding: Google Stitch, v0.dev, Framer Motion, GSAP, Streamlit/FastAPI/React choice, the Glassmorphism moodboard prompt, and the literal contract shape `{ "author": "assistant", "text": "Hello!" }` (introduced with "*Example:*").

**3. Our own additions** — anything not traceable to the PDF. Listed separately in §3 and never counted toward a requirement.

---

## 1. Requirement-by-requirement matrix

### 1.1 Explicit requirements

---

#### R1 — Premium, creative visual design

- **PDF:** §1, p.1 — "create a professional AI chat interface that **looks and feels like a premium product**"; §2 — "Forget the basic 'blue bubble' chat apps… focus on **Creative UI/UX**".
- **Status: Complete**
- **Code:** `src/app/globals.css` (596 lines; `.optical-glass`, `.glass-btn`, `.glass-input-capsule`, `.glass-modal`, per-tone ink tokens, two full glass materials); `src/components/workspace/*`.
- **What it does:** Layered glassmorphism ported from the approved Stitch export, with two selectable materials (Glowy/Clear), seven backgrounds, per-tone ink contrast, and a pointer-reactive edge glint.
- **Evidence:** Screenshot `audit-empty.png` [MOCKED session, but design is static]. No blue-bubble defaults anywhere.
- **Gap:** None.
- **Acceptance test:** Open at 1366×768; confirm no default-blue bubbles and that glass surfaces show the background through them.

---

#### R2 — Message entrance motion

- **PDF:** §2 "Fluid Motion", p.1 — "**Think about how messages appear. Do they slide? Do they fade?**"
- **Status: Missing**
- **Code:** `src/app/globals.css` — `grep` for `@keyframes` / `animation:` returns **zero** message-related rules. The only motion is background cross-fade (line 37), glint opacity (391), scrim opacity (422), button hover (444), row hover (488), card hover (499).
- **What it does:** Messages appear instantly at full opacity with no transform.
- **Evidence:** [MOCKED] computed style of the newest message row: `{animationName:"none", transitionProperty:"all", opacity:"1", transform:"none"}`.
- **Gap:** No entrance animation of any kind for user or assistant messages.
- **Acceptance test:** Send a message; the new row must animate in (e.g. fade + translateY over ~200–300ms), and `getComputedStyle(row).animationName` must not be `none` during entry. Must respect `prefers-reduced-motion`.

---

#### R3 — Typing / responding indicator

- **PDF:** §2 "Fluid Motion", p.1 — "**How does the 'typing indicator' look?**"
- **Status: Partial**
- **Code:** `src/components/workspace/MessageList.tsx:242-250` — renders a bot avatar plus the static text `Thinking…` while `streaming && messages.at(-1)?.role === "user"`. Once tokens arrive it is replaced by a static caret span (`MessageList.tsx:49-54`).
- **What it does:** Shows a responding state, but it is **static text** — no animated dots, pulse, or shimmer.
- **Evidence:** Code path confirmed; state renders only in the window between send and first token.
- **Gap:** The indicator exists but is not "designed" motion — the PDF asks how it *looks*. No animation.
- **Acceptance test:** Send a message; before the first token, an animated indicator (e.g. three pulsing dots) must be visible and must animate, not merely display text.

---

#### R4 — Subtle visual identity change between models

- **PDF:** §2 "Model Identity", p.1 — "**Can you make the UI change subtly when I switch between GPT-4 and Gemini?** (e.g., a color shift or a different glow)."
- **Status: Missing**
- **Code:** No selector, token, or attribute anywhere keys off the active provider. `WorkspaceLayout.tsx:59-64` sets only `data-glass`, `data-preset`, `data-tone`. `provider` state exists (`WorkspaceLayout.tsx:26`) but is passed only to `ChatHeader` and `send()` — never to styling.
- **What it does:** The interface is pixel-identical regardless of which provider is selected.
- **Evidence:** [MOCKED] root dataset read live: `{"glass":"classic","preset":"warm","tone":"light"}` — no provider key.
- **Gap:** Entire feature absent. Also currently untestable by a reviewer, since only one provider can be selected (see R6/R14).
- **Acceptance test:** With two providers selectable, switching must change at least one visible property (accent/glow) within ~500ms, verifiable as a changed `data-provider` attribute plus a differing computed colour.

---

#### R5 — User vs AI distinction beyond alignment

- **PDF:** §5.1 "Creative Bubbles", p.2 — "**Distinguish between User and AI with more than just alignment. Use icons, distinct shapes, or unique typography.**"
- **Status: Complete**
- **Code:** `MessageList.tsx:21-30` (`UserBubble`) vs `:32-59` (`AssistantMessage`).
- **What it does:** Four independent differentiators beyond alignment — **shape** (user: `rounded-[22px]` capsule with `border-white/80`; AI: no container), **surface** (user sits on `glass-btn` glass; AI sits directly on the panel), **typography** (user `font-medium` at 13px; AI `glass-text-muted` at 12.5px), and **icon** (AI has a bot-avatar SVG; user has none).
- **Evidence:** [MOCKED] DOM probe: `{"userClasses":["glass-btn","rounded-[22px]","border","border-white/80","font-medium"],"userHasIcon":false,"aiHasAvatarIcon":true}`.
- **Gap:** None.
- **Acceptance test:** Screenshot one user and one AI message; with alignment ignored, they must differ in at least two of {shape, icon, typography}.

---

#### R6 — Prominent, stylish model selector

- **PDF:** §5.1 "Model Switcher", p.2 — "**A prominent, stylish selector.**"
- **Status: Partial**
- **Code:** `ChatHeader.tsx:45-91` — a glass `role="radiogroup"` pinned top-right of the chat panel, rendering all three providers.
- **What it does:** Visually prominent and styled consistently with the glass system. But **only Gemini is selectable**; Claude and GPT render `aria-disabled="true"` with a "Coming soon" label.
- **Evidence:** [MOCKED] `[{"label":"Gemini","checked":"true","ariaDisabled":"false"},{"label":"Claude (Coming soon)","checked":"false","ariaDisabled":"true"},{"label":"GPT (Coming soon)","checked":"false","ariaDisabled":"true"}]`.
- **Gap:** It is a selector that cannot currently switch anything. The PDF frames the whole project as a *model-switcher*, so a one-option switcher under-delivers the headline feature.
- **Acceptance test:** At least two providers selectable; selecting each updates the active provider and routes the next request to that provider.

---

#### R7 — Model locking OR warning before switching after a chat starts

- **PDF:** §5.1, p.2 — "**Crucial:** Once a chat starts, **lock the model or show a creative warning before switching.**" (The PDF marks this "Crucial".)
- **Status: Missing**
- **Code:** `grep` for `lock` / `warn` / `confirm` / `messages.length` across `ChatHeader.tsx` and `providers.ts` returns **nothing**. The selector's disabled state is a static capability flag (`providers.ts:22-36`), unrelated to whether a conversation is in progress.
- **What it does:** Nothing. There is no conversation-aware gating of any kind.
- **Evidence:** Code search; `ChatHeader` receives no message-count or conversation-state prop (`ChatHeader.tsx:14-22`).
- **Gap:** Full feature missing. The current single-provider state masks it but does not satisfy it — the requirement is about behaviour once a chat has started.
- **Acceptance test:** Start a chat, then attempt to switch provider. Either the control is locked with a visible reason, or a warning appears and switching only proceeds on confirmation. Must be verified with ≥2 providers enabled.

---

#### R8 — Designed welcome / empty state

- **PDF:** §5.1 "Empty State", p.2 — "**Design a beautiful 'Welcome' screen. Don't leave it blank give it personality!**"
- **Status: Partial**
- **Code:** `MessageList.tsx:61-76` (`EmptyState`).
- **What it does:** Centred sparkle icon in a glass circle, heading "Start a conversation", and one muted line of explanatory copy.
- **Evidence:** [MOCKED] `"Start a conversation\n\nAsk Gemini anything. Follow-up questions keep the context of this conversation."`; screenshot `audit-empty.png`.
- **Gap:** It is tidy but generic — no product name, no personality, no suggested prompts, no visual interest beyond one small icon. It reads as a competent placeholder rather than the "beautiful Welcome screen" with "personality" the PDF asks for.
- **Acceptance test:** Empty state shows a branded welcome plus at least 2–3 clickable starter prompts that populate the composer.

---

#### R9 — Sidebar with usable past conversations

- **PDF:** §5.2 "History", p.2 — "**A sidebar that saves your past chats.**"
- **Status: Missing**
- **Code:** `ConversationSidebar.tsx:60-105`. Two sections: "This session" shows only the *current* conversation title (`:63-79`); "Samples" renders `CONVERSATION_GROUPS` from `src/lib/sample-data.ts` as **non-interactive `<span>` elements** (`:88-100`) with a `DEMO` badge and `title="Demo placeholder… not a saved conversation"`.
- **What it does:** Lists one live conversation and six hardcoded, deliberately inert demo rows. There is no conversation list, no selection, no switching, no deletion.
- **Evidence:** [MOCKED] sidebar text: `"THIS SESSION … SAMPLES / Design demos. Not clickable, not stored. / TODAY / Project ideas DEMO …"`.
- **Gap:** No real conversation history exists. Only one conversation can exist at a time; "New conversation" (`use-chat.ts:181`) destroys the current one rather than archiving it.
- **Acceptance test:** Hold three separate conversations; all three appear in the sidebar; clicking one restores its full transcript; the active one is indicated.

---

#### R10 — Chat persistence across page refresh ⚠️ **SCOPE CORRECTION CONFIRMED**

- **PDF:** §5.2 "History", p.2 — "These **must stay there even if I refresh the page**."
- **Status: Missing**
- **Code:** `src/lib/use-chat.ts:17` — `useState<ChatMessage[]>` is the **only** store. `grep` for `localStorage` / `sessionStorage` / `indexedDB` / `cookie` across all of `src/` returns **zero matches**. There is no database, no persistence layer, and no server-side session.
- **What it does:** All conversation state lives in React memory for the lifetime of the page. A refresh, navigation, or crash discards everything.
- **Evidence:** [MOCKED] direct measurement — built a 4-message conversation, then reloaded:
  - storage keys before reload: `{"local":[],"session":[]}` (both empty)
  - user messages: **4 before reload → 0 after reload**
  - log after reload: `"Start a conversation…"` (back to empty state)
  - screenshot `audit-after-reload.png`
- **Gap:** This is a **direct failure of an explicit PDF requirement**, not a deferred nicety. The earlier in-memory design was described in `docs/design-decisions.md` as acceptable "for this step"; measured against the PDF it is not. Flagged here and **deliberately left unchanged** per the audit's inspection-only scope.
- **Acceptance test:** Send two messages, hard-refresh (Ctrl+Shift+R), and the full transcript plus its sidebar entry must still be present and selectable.

---

#### R11 — Context across at least three earlier messages

- **PDF:** §5.2 "Context", p.2 — "Make sure the AI '**remembers**' what was said **3 messages ago**."
- **Status: Complete**
- **Code:** `use-chat.ts:152-154` builds `history = [...messages, userMessage]` and sends the whole array; `chat.ts:toWire()` strips ids; `route.ts:215-218` maps every turn to Gemini `Content[]` with `role: assistant → "model"`. Cap is `MAX_MESSAGES = 50` (`route.ts:32`).
- **What it does:** Every turn transmits the complete conversation, so recall depth is bounded by 50 messages, far beyond 3.
- **Evidence:**
  - [MOCKED] 4-turn conversation; the final request carried `["user","assistant","user","assistant","user","assistant","user"]` — **7 messages**, with the oldest still intact: `"Turn one: my code word is ALPACA."` (6 messages back).
  - [LIVE, earlier session] Gemini resolved a pronoun across turns: asked "What is **its** population?" after a Tokyo answer → replied `"Tokyo: 14,040,732"` without being re-told the city.
- **Gap:** None for the stated depth. The live proof covered 1 turn back; the ≥3-turn proof is mock-based (it verifies what the client *sends*, which is the mechanism the requirement depends on).
- **Acceptance test:** State a fact, send three unrelated messages, then ask about the fact. The reply must use it, and the outgoing request must contain the original message.

---

#### R12 — Frontend / backend separation

- **PDF:** §3, p.1 — "A unified system where the **frontend stays clean while the backend handles the 'heavy lifting'** of talking to different AIs."
- **Status: Complete**
- **Code:** Server: `src/app/api/chat/route.ts` (294 lines, `runtime = "nodejs"`). Client: `src/lib/use-chat.ts` + `src/components/workspace/*`.
- **What it does:** The browser never talks to Google. It POSTs to `/api/chat` and reads an NDJSON stream. All SDK usage, model selection, key handling, retry, and error classification are server-side. No AI SDK is imported into any client module.
- **Evidence:** `@google/genai` is imported only at `route.ts:1`. Build output lists `/api/chat` as a dynamic server route.
- **Gap:** None.
- **Acceptance test:** `grep -r "@google/genai" src/components src/lib` returns nothing; the browser's network tab shows requests only to same-origin `/api/chat`.

---

#### R13 — Provider abstraction layer

- **PDF:** §4 "For Logic", p.1/p.2 — "write the '**Provider Abstraction Layer**', the part of the code that makes sure **your app works the same whether it's using Gemini or GPT-4**."
- **Status: Partial (weak)**
- **Code:** `src/lib/providers.ts` (44 lines) is a **display registry only** — `{id, label, enabled, note}`. It contains no request logic. `route.ts:185` hardcodes `if (body.provider !== "gemini") return 403`, and `route.ts:220` instantiates `new GoogleGenAI(...)` directly in the handler.
- **What it does:** Normalises how providers are *listed and gated*, but not how they are *called*. There is no interface, adapter, or dispatch table a second provider could implement; adding GPT-4 today means editing the route handler, not registering an adapter.
- **Evidence:** Full file read; no `interface`/`abstract`/strategy pattern present. The client-facing contract *is* provider-neutral, which is half the goal.
- **Gap:** The seam the PDF names does not exist. Needs a `ChatProvider` interface (e.g. `stream(messages, signal): AsyncIterable<Delta>`) with a Gemini adapter behind it and a registry the route dispatches through.
- **Acceptance test:** Adding a second provider requires only a new adapter file plus one registry entry — zero edits to `route.ts`'s request-handling body.

---

#### R14 — Actual support for multiple AI providers

- **PDF:** §3, p.1 — backend "talking to **different AIs**"; §4 — "whether it's using **Gemini or GPT-4**"; §2 — "when I switch between **GPT-4 and Gemini**".
- **Status: Missing**
- **Code:** One live provider. `providers.ts:23-35` marks Claude and GPT `enabled: false`; `route.ts:185` rejects every provider except `gemini` with `PROVIDER_DISABLED`.
- **What it does:** Gemini works end to end. Claude and GPT are visible, permanently disabled, and cannot produce a response — real or simulated (verified: clicking them fires zero network requests).
- **Evidence:** [MOCKED] selector probe (see R6); earlier verification showed `POST` with `provider: claude|gpt|bogus|omitted` → all `403 PROVIDER_DISABLED`.
- **Gap:** The project's central premise — switching between models — cannot be demonstrated. The PDF names GPT-4 specifically. Requires a second provider SDK, a second API key, and the R13 abstraction.
- **Acceptance test:** Send the same prompt to two providers in separate conversations and receive two genuine, different replies.

---

#### R15 — Consistent normalized response and error contracts

- **PDF:** §6 Step 2 "The 'Contract'", p.2 — "decide how your data will look… "*Example:* Every response from your backend should look exactly the same: `{ "author": "assistant", "text": "Hello!" }`. This is called **Normalization**."
- **Status: Complete** (normalization achieved; the literal shape is an *example*, classified as a suggestion)
- **Code:** `src/lib/chat.ts` defines the single shared contract: `StreamEvent = {type:"delta",text} | {type:"error",code,message,info?} | {type:"done"}`, plus `ChatMessage {id, role, content}`, `WireMessage {role, content}`, a closed `ChatErrorCode` union (10 codes), and `ERROR_COPY` mapping each to user-facing text. Imported by both server (`route.ts:2-7`) and client (`use-chat.ts:4-11`).
- **What it does:** One module is the contract for both sides. Every error path — HTTP failure, mid-stream failure, transport failure, abort, empty reply — resolves to the same closed code set. Streaming is NDJSON so a fault arising mid-answer is reported without discarding delivered text.
- **Evidence:** Offline replay of three real recorded upstream payloads produced `429→RATE_LIMIT`, `503→MODEL_BUSY`, `transport→NETWORK` — all correct.
- **Gap:** None against the requirement. Note the shape is `{role, content}`, not the PDF's illustrative `{author, text}` — trivially renamable if a reviewer wants literal conformance.
- **Acceptance test:** Force each error class; each yields a distinct code from the union and a distinct user-facing message, with no raw provider text leaking to the UI.

---

#### R16 — Server-side env-based API key handling and Git exclusion

- **PDF:** §6 Step 3 "Security First", p.2 — "**The Golden Rule: Never put your API keys in your code. Use a `.env` file. If we see a key on GitHub, it's a security breach!**"
- **Status: Complete**
- **Code:** `route.ts:189` — `process.env.GEMINI_API_KEY` is read in the route handler and nowhere else. No `NEXT_PUBLIC_` prefix anywhere in `src/`. `.gitignore:34` `.env*` with `:36` `!.env.example`. `.env.example` holds placeholders only.
- **What it does:** The key exists only in the server process. The GET probe at `route.ts:164-172` reports `{configured: boolean}` and never any part of the value.
- **Evidence:**
  - `git check-ignore -v .env.local` → `.gitignore:34:.env*`
  - `git ls-files` lists `.env.example` only; **no `.env`/`.env.local` blob exists anywhere in history** (full `rev-list --all --objects` scan).
  - Built client bundles contain the string `GEMINI_API_KEY` **only** inside setup-instruction copy; the key *value* is absent from `.next/static/**`.
- **Gap:** None.
- **Acceptance test:** `git log --all -p | grep -i "AIza\|AQ\."` returns nothing; the key value appears in no client bundle.
- **⚠️ Standing advisory:** the working key was pasted into a chat transcript during setup. Repo hygiene is clean, but that key should be rotated before submission.

---

### 1.2 Suggested techniques — not binding

| PDF suggestion | §/p. | Used? | Note |
|---|---|---|---|
| Google Stitch / v0.dev for UI generation | §4, p.1 | **Yes** | `references/code.html` is the Stitch export; ported to React. |
| Framer Motion / GSAP for animation | §4, p.1 | **No** | No animation library. Relevant to R2/R3, but CSS would satisfy those equally. |
| Glassmorphism moodboard | §6 Step 1, p.2 | **Yes** | The entire visual system is glassmorphic. |
| Literal `{author, text}` shape | §6 Step 2, p.2 | **No** | Normalized as `{role, content}`; see R15. |
| Stack choice (React/Next, Python, …) | §3, p.1 | **Yes** | Next.js 16 + TypeScript — explicitly permitted. |

---

## 2. Current architecture

### 2.1 Components

```
src/app/page.tsx                    server entry → renders WorkspaceLayout
src/app/layout.tsx                  root layout, system font stack
src/app/api/chat/route.ts           ⚙ SERVER — only place the key/SDK exist
src/components/workspace/
  WorkspaceLayout.tsx   client  owns ALL state; composes the panel
  ChatHeader.tsx        client  title, provider selector, picker mount
  ConversationSidebar.tsx client New conversation + demo rows
  MessageList.tsx       client  transcript, empty/setup/error/thinking states
  MessageComposer.tsx   client  textarea, Enter/Shift+Enter, Send/Stop
  BackgroundPicker.tsx  client  background + glass popover
src/components/icons.tsx            inlined Lucide paths (no CDN)
src/lib/
  chat.ts               shared contract (server + client)
  use-chat.ts           chat state machine
  providers.ts          provider display registry
  backgrounds.ts        7 backgrounds + 2 glass styles
  sample-data.ts        hardcoded demo sidebar rows
  use-edge-glint.ts     pointer glint (rAF, no React state)
```

### 2.2 State

All state is React `useState` in two places, with **no persistence**:

| State | Owner | Survives refresh? |
|---|---|---|
| `messages`, `status`, `error`, `errorInfo` | `useChat` (`use-chat.ts:16-22`) | **No** |
| `background`, `glass`, `pickerOpen`, `provider`, `configured` | `WorkspaceLayout.tsx:23-27` | **No** |

`abortRef` / `inFlightRef` are refs for cancellation and double-submit guarding.

### 2.3 Storage

**None.** No localStorage, sessionStorage, IndexedDB, cookies, file store, or database. Verified by code search and by live inspection (both web storages empty).

### 2.4 API

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | `GET` | `{configured: boolean, model: string}` — drives the setup state without leaking the key |
| `/api/chat` | `POST` | `{provider, messages[]}` → NDJSON stream of `StreamEvent` |

Server behaviour: provider gate → key check → payload validation (≤50 messages, ≤16k chars, last must be user) → map to Gemini `Content[]` → `generateContentStream` with `abortSignal` → up to 3 attempts, retrying **only** `MODEL_BUSY`/`NETWORK` with exponential backoff → stream deltas as NDJSON.

---

## 3. Visible controls inventory

### Working

| Control | Location | Behaviour |
|---|---|---|
| Composer textarea | `MessageComposer.tsx:44-66` | Enter sends, Shift+Enter newline, auto-grows to 6 rows, IME-safe |
| Send | `:83-94` | Disabled while empty or streaming |
| Stop | `:69-77` | Aborts via `AbortController`; keeps partial text |
| Retry | `MessageList.tsx:179-186` | Re-runs last user turn without duplicating it |
| New conversation | `ConversationSidebar.tsx:37-45` | Clears transcript to empty state |
| Change background | `BackgroundPicker.tsx:78-89` | Opens popover; Escape + outside-click close |
| 7 background presets | `BackgroundPicker.tsx` | Apply live |
| 2 glass styles | `BackgroundPicker.tsx` | Glowy / Clear apply live |
| Gemini provider chip | `ChatHeader.tsx:52-90` | Selected; routes requests |

### Disabled (intentional, labelled)

| Control | Why |
|---|---|
| Claude chip | `enabled:false`; `aria-disabled`, "Coming soon", tooltip "This provider is not connected yet." Fires no request. |
| GPT chip | Same. |

### Placeholder / inert

| Element | Note |
|---|---|
| 6 sample sidebar rows | Non-interactive `<span>`s, `DEMO` badge, "Not clickable, not stored." |
| Conversation title chevron | `ChatHeader.tsx:40-44` — decorative only (`opacity-40`), no dropdown |
| "This session" row | Reflects current title; not selectable |

---

## 4. Required missing work, by importance

1. **R10 — Chat persistence across refresh.** The only *explicitly mandated* requirement that is outright failing ("must stay there even if I refresh"). Blocker.
2. **R9 — Real conversation history in the sidebar.** Paired with R10; the PDF's §5.2 asks for both together. Currently only one conversation can exist. Blocker.
3. **R14 — A second live provider.** Without it the headline "Model-Switcher" premise is undemonstrable, and R4/R7 cannot even be exercised. Blocker.
4. **R7 — Model lock or switch warning.** Explicitly marked "**Crucial**" in the PDF. Depends on R14 to be meaningful.
5. **R13 — Real provider abstraction layer.** Named directly in §4; also the clean way to deliver R14.
6. **R4 — Per-model visual identity.** Explicit §2 challenge; cheap once R14 lands.
7. **R2 — Message entrance motion.** Explicit §2 challenge; self-contained CSS work.
8. **R3 — Animated typing indicator.** Upgrade the existing static "Thinking…".
9. **R8 — Richer welcome state.** Add personality and starter prompts.

---

## 5. Decisions and credentials needed from you

1. **Second provider — which, and a key.** OpenAI GPT-4 is named in the PDF, so it is the safest choice for R14/R13/R4/R7. Needs a paid OpenAI key (no free tier). Alternatives: Anthropic Claude, or a second Gemini model presented as a distinct "model" — the latter avoids cost but is a weaker reading of "different AIs". **Your call; I will not purchase or enable billing.**
2. **Persistence mechanism for R10.** `localStorage` is zero-infrastructure and satisfies "survives refresh" literally; a database survives across devices but adds setup. Recommend `localStorage` now, with the store isolated behind an interface so it can be swapped.
3. **Lock vs warn for R7.** The PDF permits either. Recommend a creative warning (more in the spirit of "creative") over a hard lock.
4. **Key rotation.** The active Gemini key was pasted into a chat transcript. Repo history is clean, but rotate before submission.
5. **Mobile.** Not mentioned anywhere in the PDF. Currently the sidebar is hidden below `md` and mobile is deferred. Confirm it stays out of scope.

---

## 6. Proposed remaining milestones

### M3 — Persistence and real history *(clears R10, R9)*
- Conversation store with `{id, title, createdAt, messages[]}`, persisted and hydrated on load.
- Sidebar lists real conversations grouped by recency; click restores; active one indicated; delete/rename available.
- "New conversation" archives rather than destroys.
- **Accept:** three conversations survive a hard refresh; each restores in full; switching between them preserves each transcript.

### M4 — Provider abstraction + second provider *(clears R13, R14)*
- `ChatProvider` interface; `GeminiProvider` adapter; registry dispatch in the route.
- Second provider added as an adapter with **no** edits to the route's request-handling body.
- **Accept:** same prompt to two providers yields two genuine replies; adding a third requires only a new adapter + registry entry.

### M5 — Switching safety + model identity *(clears R7, R4)*
- Switch after a chat starts triggers a styled warning with confirm/cancel (or a lock with a visible reason).
- `data-provider` on the workspace root drives an accent/glow shift per provider.
- **Accept:** switching mid-chat cannot silently change provider; each provider shows a visibly different accent.

### M6 — Motion and welcome polish *(clears R2, R3, R8)*
- Message entrance animation (fade + rise), honouring `prefers-reduced-motion`.
- Animated typing indicator.
- Welcome screen with branding and 2–3 starter prompts.
- **Accept:** new rows animate in; indicator animates before the first token; starter prompts populate the composer.

---

## 7. Submission-readiness verdict

**Not ready to submit.**

**Verified complete (8):** R1 premium design · R5 user/AI distinction · R11 context depth · R12 frontend/backend separation · R15 normalized contracts · R16 key security — plus solid partials on R6 selector and R3 responding state.

**Blockers (must fix before submission):**

- **B1 — R10 chat persistence.** Explicitly required in §5.2 and measurably failing: 4 messages → 0 after refresh, both web storages empty. A reviewer following the PDF will refresh the page; this is the most visible possible failure.
- **B2 — R9 usable sidebar history.** The sidebar's only real entry is the current chat; the rest are inert demo rows explicitly labelled "not stored". §5.2 asks for saved past chats.
- **B3 — R14 multiple providers.** A "Model-Switcher Interface" that cannot switch models does not demonstrate its own premise. §3 and §4 both assume ≥2.
- **B4 — R7 lock/warning.** The PDF marks this "**Crucial**" and it is entirely absent.

**Non-blocking but expected by the brief:** R13 (real abstraction layer), R4 (per-model identity), R2 (entrance motion), R3 (animated indicator), R8 (welcome personality).

**Honest framing:** the foundations the PDF cares about most structurally — clean frontend/backend split, a normalized contract, correct key handling, and working multi-turn context — are genuinely in place and verified. What is missing is concentrated in two clusters: **persistence/history** (§5.2) and **multi-provider switching** (§2/§3/§4/§5.1). Both are substantial features rather than polish, and neither can be waved through as "extra scope".

---

## Appendix A — Our additional features (not PDF requirements)

These were our own choices. **None substitutes for any requirement above.**

| Feature | Where | Note |
|---|---|---|
| Two glass materials (Glowy / Clear) | `globals.css`, `backgrounds.ts` | Supports R1; not requested |
| 7 backgrounds (3 gradient + 4 bundled SVG) | `public/backgrounds/`, `backgrounds.ts` | Supports R1; not requested |
| Appearance picker | `BackgroundPicker.tsx` | Not requested |
| Pointer-reactive edge glint | `use-edge-glint.ts` | Not requested |
| Token streaming | `route.ts`, `use-chat.ts` | Not requested; PDF never asks for streaming |
| Stop button | `MessageComposer.tsx` | Not requested |
| Retry without duplication | `use-chat.ts:169` | Not requested |
| Bounded transient retry + quota surfacing | `route.ts` | Not requested |
| Setup state for missing key | `MessageList.tsx:78-99` | Supports R16 UX |
| WCAG AA ink tokens, focus rings, ARIA roles | throughout | Not requested |
| Deferred mobile layout | sidebar hidden `<md` | **Our scope decision** — PDF never mentions mobile |

## Appendix B — Evidence provenance

- **[MOCKED]** — `scratchpad/audit.mjs` stubs `window.fetch` for `/api/chat`, returning synthetic NDJSON. No request reached Google. Used for: empty state, selector state, context depth, user/AI distinction, model identity, entrance motion, sidebar contents, persistence.
- **[LIVE, earlier session]** — cited only for R11's pronoun-resolution proof, which a mock cannot establish.
- **Static** — code reads, `grep`, `git check-ignore`, `git rev-list` history scan, built-bundle inspection.
- **No real model request was made during this audit.**
