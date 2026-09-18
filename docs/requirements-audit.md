# Requirements audit — Numbase Project 1: Creative Model-Switcher Interface

**Audited against:** `references/Project 1_ Model-Switcher AI Interface .pdf` (read in full)
**Date:** 2026-09-19 · **Post-implementation** (milestones 3B, 3C-A, 3C-B, 4A, 4B)
**Method:** PDF re-read, code inspection, `npm test` (38 unit/contract tests), and a 32-check browser acceptance suite run at **1366×768 and 1680×1050**.

**Evidence labels**
- **[MOCKED]** — browser suite with all model traffic stubbed at `window.fetch`. No request reached Google; no quota consumed.
- **[UNIT]** — `npm test`. No network.
- **[LIVE]** — a real Gemini request. Exactly **one** was made this pass, to verify the refactored provider path.
- **Static** — code read, `grep`, `git` history.

---

## 0. Classification of PDF statements

**Explicit requirements** — §5 (5.1, 5.2); §3's stated result; §4's "Provider Abstraction Layer"; §6 Step 3 "Security First". §2's Creative Challenge bullets are explicit but qualitative ("Think about how messages appear", "Can you make the UI change subtly…").

**Suggestions, not binding** — Google Stitch / v0.dev, Framer Motion / GSAP, stack choice, the Glassmorphism moodboard, and the literal shape `{ "author": "assistant", "text": "Hello!" }` (introduced with "*Example:*").

**Our own additions** — listed in Appendix A, never counted toward a requirement.

---

## 1. Requirement matrix

### R1 — Premium, creative visual design
- **PDF:** §1 — "looks and feels like a **premium product**"; §2 — "Forget the basic 'blue bubble' chat apps… **Creative UI/UX**".
- **Status: Complete**
- **Code:** `src/app/globals.css` (~700 lines); `src/components/workspace/*`.
- **Does:** Two full glass materials (Glowy / Clear), seven backgrounds, per-tone ink, pointer-reactive edge glint. No default-blue bubbles.
- **Evidence:** [MOCKED] picker exposes **9 options = 7 backgrounds + 2 glass styles**; both named styles present. Screenshots `acc-welcome.png`, `acc-markdown.png` at both widths.
- **Gap:** None.
- **Test:** Open at 1366×768; confirm 7 backgrounds and 2 glass styles apply and the background reads through the panels.

### R2 — Message entrance motion
- **PDF:** §2 "Fluid Motion" — "**Think about how messages appear. Do they slide? Do they fade?**"
- **Status: Complete** *(was Missing)*
- **Code:** `globals.css` `@keyframes msg-enter` (fade + 8px rise, 240ms); `MessageList.tsx` baseline set + `key={activeId}` in `WorkspaceLayout.tsx:138`.
- **Does:** Rows appended after mount animate once. A restored history does not animate, because ids present at mount are excluded.
- **Evidence:** [MOCKED] new row `animationName = "msg-enter"`; after a hard refresh `{restoredRows: 11, animated: 0}`; a message sent after restore `{animated: 2, name: "msg-enter"}`.
- **Gap:** None.
- **Test:** Send a message → it animates. Refresh → nothing animates. Send again → it animates.
- **Note:** A first attempt gated this with a class added shortly after mount. That was wrong — adding the class later starts the animation on *every* restored row at once. Caught by the suite and replaced.

### R3 — Typing / responding indicator
- **PDF:** §2 — "**How does the 'typing indicator' look?**"
- **Status: Complete** *(was Partial — static text)*
- **Code:** `MessageList.tsx` `TypingIndicator`; `globals.css` `@keyframes typing-dot`, `.typing-dots`.
- **Does:** Three dots pulsing on a staggered delay, tinted by the provider accent, beside a `role="status"` label. Replaced by the reply on the first token. Static under `prefers-reduced-motion`.
- **Evidence:** [MOCKED] `{dots: true, anim: "typing-dot", label: "Gemini is responding"}`.
- **Gap:** None.
- **Test:** Send a message; before the first token, animated dots and the text "Gemini is responding" appear.

### R4 — Subtle visual identity per model
- **PDF:** §2 "Model Identity" — "**Can you make the UI change subtly when I switch between GPT-4 and Gemini?** (e.g., a color shift or a different glow)."
- **Status: Partial**
- **Code:** `data-provider` on the workspace root (`WorkspaceLayout.tsx:84`); `globals.css` `--accent` per provider and per tone; `.provider-avatar`, `.provider-chip-active`, `.typing-dots`, and the Clear Glass edge glint consume it.
- **Does:** A single restrained accent token drives the avatar rim, active chip, typing dots and glint. Panels, backgrounds and ink are untouched, so contrast is unchanged on all seven backgrounds. Dark tones use a lifted accent.
- **Evidence:** [MOCKED] `data-provider = "gemini"`, `--accent` resolves to `#6f7f9b`. All three provider accents are defined.
- **Gap:** **The change cannot be observed by switching**, because only one provider is live. The mechanism is complete and per-provider values exist; a reviewer cannot see it change until a second key exists (see R14).
- **Test:** With two providers live, switch and confirm `data-provider` and the computed `--accent` both change, with no shift in text contrast.

### R5 — User vs AI distinction beyond alignment
- **PDF:** §5.1 — "**more than just alignment. Use icons, distinct shapes, or unique typography.**"
- **Status: Complete**
- **Code:** `MessageList.tsx` `UserBubble` vs `AssistantMessage`.
- **Does:** Shape (user: `rounded-[22px]` glass capsule; AI: no container), icon (AI has an accented avatar; user none), typography (user `font-medium` 13px; AI muted 12.5px with rich Markdown).
- **Evidence:** [MOCKED] `{userShape: true, aiIcon: true}`.
- **Gap:** None.
- **Test:** Ignore alignment; the two must differ in ≥2 of {shape, icon, typography}.

### R6 — Prominent, stylish model selector
- **PDF:** §5.1 — "**A prominent, stylish selector.**"
- **Status: Partial**
- **Code:** `ChatHeader.tsx` — glass `role="radiogroup"`, top-right.
- **Does:** All three providers render; the active one is accented. Availability is decided by the **server** probe, so a provider without a key cannot be chosen.
- **Evidence:** [MOCKED] `[{Gemini, disabled:false, checked:true}, {Claude (Coming soon), disabled:true}, {GPT (Coming soon), disabled:true}]`.
- **Gap:** Still effectively one selectable option — see R14.
- **Test:** ≥2 providers selectable, each routing to its own adapter.

### R7 — Model lock OR warning before switching after a chat starts
- **PDF:** §5.1 — "**Crucial:** Once a chat starts, **lock the model or show a creative warning before switching.**"
- **Status: Complete (logic) / Unverified in production (needs 2 live providers)**
- **Code:** `ChatHeader.tsx` `SwitchDialog` + `requestSwitch`; `conversationStarted` passed from `WorkspaceLayout.tsx:123`.
- **Does:** Before any message exists, switching is silent (no context to carry). Once a user message exists, any switch to another *available* provider opens a glass `role="dialog"` explaining that the new model continues with existing context and may answer differently, with Cancel / Switch model. Cancel changes nothing. Escape and outside-click cancel. Focus moves to the confirm button.
- **Evidence:** Static code path; [MOCKED] disabled providers are unclickable so the dialog cannot be reached today. The gate is `requestSwitch`, which every chip click passes through.
- **Gap:** **Cannot be exercised end-to-end until a second provider is live.** The branch is written and reachable; it has not been observed firing.
- **Test:** With two live providers: send a message, click the other provider → dialog appears; Cancel leaves the provider unchanged; Confirm updates it. Switching must never happen silently.

### R8 — Designed welcome / empty state
- **PDF:** §5.1 — "**Design a beautiful 'Welcome' screen. Don't leave it blank give it personality!**"
- **Status: Complete** *(was Partial)*
- **Code:** `MessageList.tsx` `WelcomeState`.
- **Does:** Accented product mark, "Welcome to AI Workspace", a written line of personality, and three starter prompts as real buttons. Clicking one **fills the composer and focuses it — it never sends**.
- **Evidence:** [MOCKED] welcome text present; `3` starter buttons; after clicking one, composer holds the text and `window.__sent.length === 0`. Screenshot `acc-welcome.png`.
- **Gap:** None.
- **Test:** Empty state shows branding + 3 prompts; clicking one fills the composer without sending.

### R9 — Sidebar with usable past conversations
- **PDF:** §5.2 "History" — "**A sidebar that saves your past chats.**"
- **Status: Complete** *(was Missing)*
- **Code:** `ConversationSidebar.tsx`; `conversations.ts` `groupByRecency`; `use-conversations.ts`.
- **Does:** Real conversations grouped Today / Yesterday / Previous, newest first. Active row marked `aria-current`. Click restores the full transcript and its provider. Rename (inline, Enter/Escape) and delete (with inline confirmation) via compact controls that are keyboard reachable and revealed on hover or focus. Deleting the active conversation moves to another or to a fresh draft. All inert demo rows are gone (`sample-data.ts` deleted).
- **Evidence:** [MOCKED] three conversations listed and independently selectable; sidebar text shows real titles under `TODAY`.
- **Gap:** None.
- **Test:** Hold three conversations; all appear; clicking one restores it; rename and delete work by keyboard.

### R10 — Chat persistence across refresh
- **PDF:** §5.2 — "These **must stay there even if I refresh the page**."
- **Status: Complete** *(was Missing — this was the headline failure of the previous audit)*
- **Code:** `src/lib/storage.ts` (versioned schema, validation); `use-conversations.ts` (hydrate, throttled persist, flush).
- **Does:** Saved to `localStorage` under a versioned key. Writes are blocked until hydration completes, so initial empty state cannot overwrite saved data. Partial replies persist on a ~700ms throttle; flushed on completion, Stop, switch, `visibilitychange` and `pagehide`. A reply cut off by a refresh returns **interrupted**. Corrupt or unknown-version payloads are reported and **left untouched**.
- **Evidence:**
  - [MOCKED] three conversations created → **hard refresh** → all three still listed, active conversation restored ("Conversation ONE about apples"), transcript complete (5 user messages).
  - [UNIT] round-trip; malformed JSON → `corrupt` with bytes intact; version 99 → `corrupt`, untouched; `streaming` → `interrupted` with partial text preserved; quota-full → `full`; absent storage → `unavailable`.
- **Gap:** Local to one browser; no cross-device sync. The PDF asks only for survival across refresh.
- **Test:** Send two messages, hard-refresh (Ctrl+Shift+R); transcript and sidebar entry both persist.

### R11 — Context across at least three earlier messages
- **PDF:** §5.2 — "the AI '**remembers**' what was said **3 messages ago**."
- **Status: Complete**
- **Code:** `use-conversations.ts` `send`/`retry` build history from the **active conversation only**; `route.ts` validates; `gemini.ts` maps to `Content[]`.
- **Does:** Each turn sends that conversation's full history (cap 50).
- **Evidence:** [MOCKED] final request carried **7 messages**; contents contained only "apples" material — no "bridges" or "clouds" from sibling conversations. [LIVE, earlier session] Gemini resolved "its population" → "Tokyo: 14,040,732".
- **Gap:** None.
- **Test:** State a fact, send three unrelated messages, ask about the fact; the outgoing request still contains the original message.

### R12 — Frontend / backend separation
- **PDF:** §3 — "frontend stays clean while the **backend handles the 'heavy lifting'** of talking to different AIs."
- **Status: Complete**
- **Code:** `src/app/api/chat/route.ts`; `src/server/providers/*`.
- **Does:** The browser only POSTs to `/api/chat`. No AI SDK is imported into any client module; `@google/genai` appears solely in `server/providers/gemini.ts`.
- **Evidence:** Static — `grep` confirms the single import site. Build lists `/api/chat` as a dynamic server route.
- **Gap:** None.
- **Test:** `grep -r "@google/genai" src/components src/lib` returns nothing.

### R13 — Provider abstraction layer
- **PDF:** §4 — "write the '**Provider Abstraction Layer**'… makes sure your app works the same whether it's using **Gemini or GPT-4**."
- **Status: Complete** *(was Partial/weak)*
- **Code:** `server/providers/types.ts` (`ChatProvider`, `ProviderError`, capabilities, availability), `gemini.ts` (adapter), `registry.ts` (dispatch), `route.ts` (vendor-free).
- **Does:** The route validates, dispatches through the registry, and re-frames deltas as NDJSON. It contains **no SDK import, no model id, and no vendor error handling**. Retryability is decided by the adapter. Adding a provider = new adapter + one registry line.
- **Evidence:** [UNIT] registry shape; a **mock adapter** implementing `ChatProvider` streams and cancels through the same interface; adapters throw `ProviderError`, never raw SDK errors; only transient classes are retryable. [LIVE] one real Gemini call through the refactored path returned `{"type":"delta","text":"ok"}` then `{"type":"done"}` — the refactor did not break the real integration.
- **Gap:** None structurally. Proven generic by a mock, not yet by a second *live* vendor.
- **Test:** Add an adapter + registry entry; `route.ts` requires zero edits.

### R14 — Actual support for multiple AI providers
- **PDF:** §3 "different AIs"; §4 "Gemini or GPT-4"; §2 "switch between GPT-4 and Gemini".
- **Status: Missing — blocked on credentials**
- **Code:** `registry.ts` registers Gemini only. OpenAI/Anthropic adapters are deliberately **not** written.
- **Does:** Gemini works end to end. Claude and GPT are visible, labelled "Coming soon" with the reason, disabled, and cannot originate a request.
- **Evidence:** [MOCKED] clicking Claude and GPT produced **0** network requests; both `aria-disabled="true"`. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are unset (checked by name only).
- **Gap:** **A second provider key is required.** A stub adapter was rejected on purpose: it would either fabricate replies (dishonest) or fail confusingly.
- **Test:** Same prompt to two providers in separate conversations returns two genuine, different replies.

### R15 — Consistent normalized response and error contracts
- **PDF:** §6 Step 2 — "Every response from your backend should look exactly the same… **Normalization**."
- **Status: Complete**
- **Code:** `src/lib/chat.ts` — `StreamEvent`, `ChatMessage`, `WireMessage`, `MessageState`, an 11-value `ChatErrorCode` union and `ERROR_COPY`. Imported by both sides.
- **Does:** One module is the contract for server and client. Every failure class — missing key, invalid key, rate limit, model busy, network, empty reply, bad request, provider disabled, abort — resolves to the same closed set with user-facing copy. Adapters normalise vendor errors into `ProviderError`.
- **Evidence:** [UNIT] real recorded payloads classify correctly: `429 → RATE_LIMIT`, `503 → MODEL_BUSY`, transport → `NETWORK`, invalid key returned as HTTP 400 → `INVALID_KEY`.
- **Gap:** Shape is `{role, content}` rather than the PDF's illustrative `{author, text}` — that example is a suggestion, trivially renamable.
- **Test:** Force each error class; each yields a distinct code and message, with no raw provider text in the UI.

### R16 — Server-side env key handling and Git exclusion
- **PDF:** §6 Step 3 — "**Never put your API keys in your code. Use a `.env` file.**"
- **Status: Complete**
- **Code:** Keys read only in `server/providers/*.ts` via `process.env`. `.gitignore:34` `.env*`, `:36` `!.env.example`.
- **Does:** The key exists only in the server process. `GET /api/chat` reports `{configured, model}` — booleans and model names, never key material.
- **Evidence:** Static — `git ls-files` lists only `.env.example`; **no `.env`/`.env.local` blob in history** (`git rev-list --all --objects` scan). No `NEXT_PUBLIC_` in `src/`. [UNIT] `availability()` asserted not to contain a planted secret value.
- **Gap:** None in the repo.
- **⚠️ Advisory:** the working key was pasted into a chat transcript during setup. Rotate before submission.

---

## 2. Verification checklist (Milestone 5)

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Glass intact, both styles | ✅ | [MOCKED] both named styles in picker |
| 2 | Seven backgrounds present | ✅ | [MOCKED] 9 picker options = 7 + 2 |
| 3 | New messages animate once; restored do not | ✅ | [MOCKED] `{restoredRows:11, animated:0}`; new → `msg-enter` |
| 4 | Typing indicator animates + accessible text | ✅ | [MOCKED] `anim:"typing-dot"`, `"Gemini is responding"` |
| 5 | User/AI distinct beyond alignment | ✅ | [MOCKED] shape + icon |
| 6 | Welcome personality + working starters | ✅ | [MOCKED] 3 prompts fill composer, send nothing |
| 7 | Three conversations survive hard refresh | ✅ | [MOCKED] all three + active restored |
| 8 | ≥3 earlier messages in the selected conversation | ✅ | [MOCKED] 7 messages, no sibling content |
| 9 | Switching while streaming cannot leak | ✅ | [MOCKED] no foreign text; request aborted |
| 10 | Stop preserves partial text | ✅ | [MOCKED] 32→68→68 chars; marked interrupted |
| 11 | Retry does not duplicate | ✅ | [MOCKED] exactly one user message per send |
| 12 | Markdown incl. unfinished fences, links, lists, code | ✅ | [MOCKED] + [UNIT] every streaming prefix parses |
| 13 | Copy controls work | ✅ | [MOCKED] 8 copy controls present |
| 14 | Auto-scroll respects a reader | ✅ | [MOCKED] not yanked; Jump to latest works |
| 15 | Route uses the abstraction | ✅ | Static: no SDK/model id in `route.ts` |
| 16 | Unavailable providers cannot request | ✅ | [MOCKED] 0 requests after clicking both |
| 17 | Switching an active conversation is never silent | ⚠️ Logic complete, unexercised | Needs 2 live providers |
| 18 | Provider identity subtle + accessible | ⚠️ Mechanism complete, unobservable | Needs 2 live providers |
| 19 | Keys server-only, absent from bundle/history | ✅ | Static + [UNIT] |
| 20 | Error states honest and usable | ✅ | [UNIT] all classes; quota detail retained |
| 21 | Lint and production build pass | ✅ | `lint` 0, `build` 0, `test` 38/38 |

**Browser suite: 32/32 at 1366×768 and 32/32 at 1680×1050.**

---

## 3. Status summary

### A. Completed PDF requirements
R1 premium design · R2 entrance motion · R3 typing indicator · R5 user/AI distinction · R8 welcome state · R9 sidebar history · **R10 persistence across refresh** · R11 context depth · R12 frontend/backend split · **R13 provider abstraction** · R15 normalized contracts · R16 key security.

### B. Completed optional enhancements (ours, not required)
See Appendix A.

### C. Remaining blockers
1. **R14 — a second live provider.** Requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. This is the one outstanding *functional* requirement.
2. **R7 (verification) and R4 (observability)** are gated on the same credential. Both are implemented; neither can be demonstrated with one provider.
3. **Key rotation** before submission.

### Verdict
The two clusters that blocked the previous audit — **persistence/history** and **the abstraction layer** — are now complete and evidenced. What remains is a single external dependency: one more provider credential. With it, R14 closes and R7/R4 become demonstrable; without it, the architecture is finished but the "model-switcher" premise cannot be shown switching.

---

## Appendix A — Our additions (not PDF requirements)

| Feature | Note |
| --- | --- |
| Two glass materials, 7 backgrounds, appearance picker | Supports R1 |
| Token streaming, Stop, Retry | PDF never asks for streaming |
| Bounded transient retry, quota surfacing with countdown | Beyond brief |
| Rename / delete conversations, recency grouping | Beyond "saves your past chats" |
| Interrupted-reply state, corrupt-data protection | Robustness |
| Markdown rendering, copy controls, scroll anchoring | Readability |
| Setup state for a missing key | Supports R16 UX |
| 38 unit/contract tests + CDP acceptance suite | Engineering hygiene |
| Deferred mobile | **Our scope decision** — PDF never mentions mobile |

## Appendix B — Dependency decision

No Markdown library was added. `src/lib/markdown.ts` is a ~230-line parser producing a typed AST that the renderer turns into React elements — there is no HTML string and no `dangerouslySetInnerHTML`, so injection is impossible by construction. Reasons: the required subset is small and fixed; the parser must tolerate half-arrived syntax on every streamed token; and `react-markdown` + `remark-gfm` would have pulled ~30 transitive packages over a heavily throttled connection. Link schemes are allow-listed (`http`, `https`, `mailto`, relative, anchor); everything else keeps its text and loses its link. Covered by 9 unit tests including a character-by-character streaming sweep.
