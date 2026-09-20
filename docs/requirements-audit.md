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
- **Status: Complete** *(was Missing, then Complete-but-imperceptible — retuned in milestone 6)*
- **Code:** `globals.css` `@keyframes user-enter` / `reveal-streak` / `avatar-in` / `surface-in` / `content-in`; `MessageList.tsx` baseline set + `key={activeId}` in `WorkspaceLayout.tsx`.
- **Does:** A sent user message resolves into the panel: opacity 0→1, 18px rise, scale 0.975→1 and a 4px blur clearing, over 700ms on `cubic-bezier(0.5, 0.35, 0.25, 1)`, with no overshoot of any kind. One thin specular streak crosses the sent row once, right to left, over 1000ms after a 200ms delay, and leaves nothing behind. The assistant arrives in three soft stages: avatar (8px, 0.92→1, 2px blur, 520ms), the glass pane 180ms behind it (12px, 0.992→1, 2px blur, 740ms), and the answer itself 350ms behind it (6px, 1.5px blur, 650ms). Rows appended after mount animate once; a restored history does not, because ids present at mount are excluded.
- **Evidence:**
  - [MOCKED] **Why the previous version was not perceptible**, measured by pausing the live animation and seeking it to fixed times. The old `240ms cubic-bezier(0.16, 1, 0.3, 1)` is an expo-out and front-loads its progress — vertical travel remaining was `12px → 3.85 → 0.78 → −0.36` at `0 / 40 / 80 / 120ms`, i.e. spent inside ~80ms, with the declared remainder moving the row under 1.2px. The class itself was correctly applied the whole time; the curve and distance were the defect.
  - [MOCKED] The 700ms entrance measures `18px → 15.69 → 11.68 → 5.79 → 2.30 → 0.80 → 0` at `0 / 100 / 200 / 300 / 400 / 500 / 700ms`, opacity `0 → 0.13 → 0.35 → 0.68 → 0.87`, blur `4 → 3.49 → 2.59 → 1.29 → 0.51px`. Lengthening the duration alone would not have been enough: on the previous curve 89% of the travel was over by 300ms, so the message sat still for the rest. This curve still has a third of its travel left at 300ms. It never passes its resting position (`minY = 0`, `maxScale = 1`), so there is no bounce or spring.
  - [MOCKED] Assistant arrival seeked from t=0: avatar `opacity 0, scale 0.85` → `1.0` by 320ms; sheet `opacity 0, y 16px, scale 0.985, blur 3px`, still held at t=80 by its 140ms delay, at rest by 690ms, `minY = 0`.
  - [MOCKED] Specular streak: `iterationCount 1`, 820ms after a 150ms delay, 42.3% of the message width, 2.5px tall, `pointer-events: none`, `aria-hidden="true"`. Opacity across its active phase `0 → 1.00 → 1.00 → 0.40 → 0.04 → 0` while travelling `x 23.3px → −109.3px`: right to left, fully gone at the end, no permanent line.
  - [MOCKED] Streaming: text grew 41→99 chars while `animationstart` events stayed at **10→10**; each entrance fired exactly once (`user-enter 1, reveal-streak 1, avatar-in 1, surface-in 1, content-in 1`).
  - [MOCKED] Switching conversations and a hard refresh both report `{running: [], enterClasses: 0, sweeps: 0}`; a message sent after restore still animates.
  - [MOCKED] Reduced motion: `animationName = "rm-fade"`, `transform: none`, `filter: none`, sweep `display: none`.
- **Gap:** None.
- **Test:** Send a message → the text rises, scales and de-blurs over about half a second, and one thin streak crosses the sent row. Refresh → nothing animates. Send again → it animates.
- **Note:** Two earlier mistakes, both caught by measurement rather than by eye. First, a class added shortly after mount started the animation on *every* restored row at once. Second, the replacement curve was assumed to be visible because its declared duration was 240ms; seeking it proved the motion was over in 80ms. Curve selection is now backed by the comparison table recorded in `globals.css`.

### R3 — Typing / responding indicator
- **PDF:** §2 — "**How does the 'typing indicator' look?**"
- **Status: Complete** *(was Partial — static text; dots refined in milestone 6)*
- **Code:** `MessageList.tsx` `TypingIndicator`; `globals.css` `@keyframes typing-dot`, `.typing-dots`, `.typing-row`.
- **Does:** Three 6px glass beads — accent-tinted fill with a lit top edge, rather than flat dots — travelling 4px vertically and pulsing `0.3 → 1.0` on a 1.4s cycle staggered by 0.18s, beside a `role="status"` label. The whole row fades in on `indicator-in` so it does not pop. The avatar sits at the same offset as the assistant row's, so the first token swaps the dots for the answer without the identity moving. Static under `prefers-reduced-motion`.
- **Evidence:**
  - [MOCKED] `{count: 3, anim: "typing-dot", dur: "1.4s", size: "6px", delays: ["0s", "0.18s", "0.36s"]}`, label `"Gemini is responding"`.
  - [MOCKED] Seeked dot curve: `opacity 0.30 / y 0px` at 0ms → `0.84 / −3.09px` at 300ms → `1.00 / −4px` at 450ms → back to `0.30 / 0px` by 900ms.
  - [MOCKED] The beads now hand over to the answer rather than vanishing: on the first token the slot plays a 220ms fade while its grid row collapses `1fr → 0fr`, measured `opacity 1 → 0, height 32px → 0px`, with the assistant row's top shifting **0.0px** across the whole handoff.
  - [MOCKED] Reduced motion: dot `animationName = "none"`.
- **Gap:** None.
- **Test:** Send a message; before the first token, three moving beads and the text "Gemini is responding" appear, and they vanish as the answer lands.

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
- **Status: Complete** *(the user bubble was removed in milestone 7)*
- **Code:** `MessageList.tsx` `UserMessage` vs `AssistantMessage`; `globals.css` `.assistant-surface`.
- **Does:** Differs on four axes, not two.
  - **Shape** — the user message has no container at all: it reads directly on the main glass panel, right-aligned on a capped measure. The answer is an open sheet with an asymmetric `6px 16px 16px 16px` radius, the corner nearest the avatar cut back.
  - **Icon** — the answer carries an accented provider avatar; the user message carries none.
  - **Surface** — the answer is the only message carrying a surface, and it is an outline rather than a card: no fill, no backdrop-filter and no shadow, just a graded 1px ring (lit top-left, soft sides, darker lower-right) with two short specular hits, one of them provider-accented. The user message has no surface at all, so the approved panel is never doubled up with a second glass box.
  - **Typography** — user 13.5px at weight 600, with a sent row beneath it (`<time>` plus a labelled delivery mark); answer muted 12.5px with rich Markdown.
- **Evidence:**
  - [MOCKED] Every element of the user message reports `backgroundColor: rgba(0,0,0,0)`, `backgroundImage: none`, `boxShadow: none`, `backdropFilter: none`, `border-width: 0px` and `border-radius: 0px`, and both `::before` and `::after` resolve to `content: none` — so Clear Glass's edge ring and inner rim, which attach to `.glass-btn`, went with it. No `.glass-btn` remains anywhere in the transcript.
  - [MOCKED] Identity without a box: `text-align: right`, `font-weight: 600`, measure capped at 500.25px, and a sent row reading e.g. `05:54` with `datetime="2026-09-20T02:54:45.932Z"` plus a screen-reader-only “Sent”.
  - [MOCKED] The assistant pane adds nothing to its own centre. Capturing the pane, then removing only its `background` and edge ring and capturing again, the interior mean luminance moves by **0.00 / 0.32 / 0.00 / 0.00** across Glowy×Clear and Warm Studio×Smoky Obsidian, while the same toggle moves the edge band by 2.4–4.7 — so the centre is measurably transparent and the measurement is not a no-op. Edge brightness is deliberately uneven: brightest top-left vs lower-right reads `249 vs 173`, `242 vs 170`, `218 vs 105`, `202 vs 100`.
  - [MOCKED] All four combinations driven through the real appearance picker at 1366×768: Glowy/Clear × Warm Studio/Smoky Obsidian. Screenshots `look-*.png`.
  - [MOCKED] Shared glass panel compared before and after a message exists in each combination: background, shadow, radius, border, backdrop-filter and box all byte-identical. No residual `filter` is left on a settled bubble (`filter: none`), which is why the entrance uses `backwards` fill rather than `forwards`.
- **Gap:** None.
- **Test:** Ignore alignment; the two must differ in ≥2 of {shape, icon, surface, typography} — they differ in all four.

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
| 3 | New messages animate once; restored do not | ✅ | [MOCKED] `animationstart` 8→8 across a stream; each entrance fires exactly once; switch + hard refresh both `{running:[], enterEls:0, streaks:0}` |
| 4 | Typing indicator animates + accessible text | ✅ | [MOCKED] 3 beads, `anim:"typing-dot"` 1.4s staggered 0.18s, `"Gemini is responding"`; never shown with the answer |
| 5 | User/AI distinct beyond alignment | ✅ | [MOCKED] neither message is a card: user has no surface, assistant is a graded 1px ring with a measured centre contribution of 0.00–0.32 luminance; distinct by alignment, measure, weight 600, avatar and a sent row |
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
