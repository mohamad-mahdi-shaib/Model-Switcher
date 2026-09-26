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

> **Revision note (2026-09-21, later same day).** An independent code review
> (`docs/model-switcher-codex-review.md`) audited this project from the packaged ZIP
> and found nine confirmed defects this document had not caught, the most serious
> being a reproducible persistence data-loss bug (F1) that directly contradicts R10
> below as this document had previously stated it. It also caught two factual errors
> in this document's own R2 entry (wrong pixel/scale/blur figures) and R10's "left
> untouched" claim. Every one of its nine findings was independently re-verified
> against this source tree for this revision, by executing the real unmodified
> source where that was possible without installing a new dependency, and by
> deterministic source/logic trace otherwise. All nine held up; none were found
> incorrect. Corrections are marked inline below with **[CORRECTED]**. Full
> before/after detail is in `docs/requirements-audit.md` and the prioritised fix
> plan is in `docs/remaining-work-plan.md`.

> **Revision note (F1 fix pass).** F1 — the persistence data-loss bug named
> above as the most serious of the nine findings — **is now fixed.** Root
> cause and fix are in R10 (§1) below. Verified by 15 new regression tests
> against the real, unmodified `storage.ts` and `use-conversations.ts`
> modules (`tests/storage.test.ts` +7, new `tests/use-conversations.test.ts`
> +8; 100/100 suite total) and by a real-browser confirmation with mocked
> chat and zero provider requests (8/8). Nothing about the approved glass,
> backgrounds, motion, gold orbit, or reveal pacing changed. F2–F9 from the
> same review remain open — this pass was scoped to F1 only. See
> `docs/remaining-work-plan.md` Milestone 1, now marked done.

> **Revision note (F2 fix pass).** F2 — incomplete or broken streams
> settling into the wrong terminal state — **is now fixed.** Root cause and
> the normalized terminal contract are in R14/R15 (§1) below. A truncated
> OpenAI answer, a Gemini answer cut short by its own `finishReason`, a bare
> upstream EOF with no terminal event, and a mid-stream error after partial
> text had all been indistinguishable from a genuine full completion; each
> now carries a confirmed outcome (`"complete"|"truncated"|"unknown"`, plus
> `"stopped"|"failed"` on the client) through the adapter, the route, the
> client hook and storage, into an accurate notice on reload. Verified by 47
> new regression tests against the real, unmodified adapters, route and hook
> modules (`tests/openai.test.ts` +6, new `tests/gemini.test.ts` 9, new
> `tests/route.test.ts` 8, `tests/use-conversations.test.ts` +12, new
> `tests/chat.test.ts` 9, `tests/storage.test.ts` +3; 147/147 suite total)
> and by a real-browser confirmation with mocked chat and zero provider
> requests (9/9 across 6 scenarios). A genuine regression was caught and
> fixed during that browser verification — an early version of the fix
> correctly stopped a failed message from being stuck at `state:"streaming"`
> but silently dropped the pre-existing error banner and Retry button for a
> mid-stream failure that arrived after text had already streamed; this is
> disclosed under R14 evidence, not smoothed over. Nothing about the approved
> glass, backgrounds, motion, gold orbit, or reveal pacing changed; only the
> per-message status notice text changed, and only where the finding
> required it. See `docs/remaining-work-plan.md` Milestone 2, now marked done.

> **Revision note (F3–F9 fix pass, plus a small F2 follow-up).** F3–F8 — the
> remaining six confirmed defects from the independent review — **are now
> all fixed**, and the one T1 process gap (misleading test names) is closed.
> F3 (input/conversation limits): a new `src/lib/limits.ts` exports
> `validateDraft()`, shared by the composer and `send()`, refusing an
> over-limit or conversation-full draft before it ever touches history;
> `toWire()` originally capped any already-stored oversized message for the
> wire only -- **superseded by Finding U1 below, which removed this in
> favour of refusing to send at all.** F4
> (normalized validation): `route.ts` validates the parsed body and every
> message as non-null objects before dereferencing them; the provider
> registry moved to a `Map`, immune to `"__proto__"`/`"constructor"`
> prototype-chain lookups. F5 (provider attribution): `useConversations()`
> now exposes `requestProviderId`, used instead of the selected provider by
> `ErrorRow`/`TypingIndicator`; `SetupState` is parameterized on the actual
> provider instead of hardcoded to Gemini. F6 (code reveal): `reveal.ts`'s
> `nextBoundary()` now searches forward for a fenced code line's own newline
> instead of repeatedly snapping back to zero progress. F7 (SSE parsing):
> `openai.ts`'s `parseSse()` was rewritten around a proper CR/LF/CRLF line
> splitter, and multi-line `data:` fields are combined per spec. F8 (dialog
> focus trap): `ChatHeader.tsx`'s `SwitchDialog` now traps Tab/Shift+Tab,
> restores focus to the triggering chip, uses a full-viewport backdrop
> against click-through, and rechecks the in-flight guard at confirm time. A
> small follow-up correction to F2 itself was also made: Gemini's
> `FINISH_REASON_UNSPECIFIED` and any unrecognised finish-reason value now
> report `outcome:"unknown"` rather than being folded into the same
> `"truncated"` bucket as the SDK's own named `OTHER` catch-all. Verified by
> 33 new regression tests against the real, unmodified modules (new
> `tests/limits.test.ts` 12, `tests/chat.test.ts` +4, `tests/route.test.ts`
> +6, `tests/reveal.test.ts` +5, `tests/openai.test.ts` +5, `tests/gemini.test.ts`
> +1; 180/180 suite total) and by a real-browser confirmation with mocked
> chat and zero provider requests (26/26 at each of 1366×768 and 1680×1050,
> 52/52 total) — this pass's own harness is committed at `tests/browser/`,
> not scratchpad-only (Finding F9). Nothing about the approved glass,
> backgrounds, motion, gold orbit, or reveal pacing changed; F6's fix is
> local to the fenced-code branch only. See `docs/remaining-work-plan.md`
> Milestones 3–7, all now marked done.

> **Revision note (independent follow-up review of this pass's own archive).**
> A follow-up review of `model-switcher-review-updated.zip` (the F3–F9
> pass's own package) found six further real, confirmed defects introduced
> or left by that pass — **U1–U6, all now fixed** — plus one inaccurate
> claim in this document's own text (the "fail-closed" description of the
> browser harness, corrected where it appears below). U1: `toWire()`'s
> silent wire-only capping of an oversized historical message (above) is
> removed entirely; `validateDraft()`/`hasOversizedMessage()` now refuse to
> send at all, honestly, whenever history contains such a message. U2:
> `fail()`'s BAD_REQUEST handling used to delete the user's own just-sent
> message from history — discarding it entirely (the composer had already
> cleared its input) and leaving `retry()` resending the *previous*,
> already-answered question instead of the one that actually failed; now a
> failed send is never deleted, exactly like any other failure. U3: the
> browser harness's actual fail-closed guarantee is CDP `Fetch`-layer
> interception of this app's own `/api/chat*`, not merely blocking provider
> domains (which cannot catch a request that only ever needed to reach this
> app's own same-origin server) — proven by a new dedicated negative test,
> `tests/browser/verify-network-isolation.mjs`. U4: `reveal.ts`'s fenced-code
> line-boundary logic is no longer skipped once the stream has completed but
> the reveal is still draining a backlog — it could cut a code line mid-line
> in exactly that window. U5: the harness's `pressKey()` sent a `shiftKey`
> parameter `Input.dispatchKeyEvent` does not have (modifiers are a bit
> field), so a "Shift+Tab" reverse-focus test never actually sent Shift at
> all — fixed, and the dialog's modal backdrop (previously trapped inside
> whichever glass panel it rendered in, by that panel's own
> `backdrop-filter`) is now portaled to a common ancestor with neither
> property, so it genuinely covers the sidebar too. U6: the packaged ZIP used
> Windows backslash path separators, breaking extraction on a standard
> cross-platform tool — rebuilt with Python's `zipfile`, which always writes
> forward-slash entry names. 8 new regression tests (`tests/limits.test.ts`
> +6, `tests/reveal.test.ts` +2; `tests/chat.test.ts` rewritten to assert the
> opposite of its original F3-era claims, same count) plus a real-browser
> confirmation (40/40 at each viewport, including new U1/U2/U3 checks and a
> strengthened F8.3/F8.4b) and the dedicated negative test. See
> `docs/requirements-audit.md` §C2 item 14 for the full resolution record.

> **Revision note (U5 second-pass correction, `model-switcher-final-verification.md`).**
> A second independent verification pass re-derived U1–U6 from source (all six
> confirmed) and flagged one further real defect the first U5 fix had not
> fully closed: portaling the backdrop alone left the *dialog* nested inside
> the chat panel's own `section.optical-glass` stacking context, so the
> dialog's `z-50` never actually competed against the backdrop's `z-40`
> directly — a real dispatched pointer click (not a synthetic `.click()`,
> which cannot detect this) confirmed the consequence: clicking "Switch
> model" silently closed the dialog without switching, the backdrop's own
> click handler firing instead. **Now fixed:** the dialog is portaled
> alongside the backdrop as a true sibling under `<main>`, so both compare
> directly in one stacking order; its position is measured from its anchor
> element rather than assumed from CSS. Verified by `tests/browser/verify.mjs`
> (46/46 at each viewport, up from 40/40) and a new dedicated regression,
> `tests/browser/verify-dialog-hit-testing.mjs`, covering both approved glass
> modes explicitly (16/16). Also reconciled in this revision: the two items
> in §6 that were phrased as pending owner decisions (the model substitution,
> the normalization shape) are marked accepted/settled, key rotation is
> marked as a settled owner decision rather than an open blocker, and the
> GitHub-push language in §7 is corrected to reflect that no push was
> requested — final delivery is a ZIP. See §5, §6 and §7 below, and
> `docs/requirements-audit.md` §C2 item 14's U5 entry for the full technical
> record.

---

## 0. How to read the evidence labels

| Label | Means |
| --- | --- |
| **Source** | Code read at the cited path and line this pass. |
| **Unit** | `npm test` — 188 tests, no network. (85 at the original pass; +15 for the F1 fix, +47 for the F2 fix, +33 for the F3–F9 pass, +8 for the U1–U6 follow-up correction — see §4.) |
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
- **Does:** **[CORRECTED]** A sent user message resolves over 1200ms: opacity 0→1 and a `translateY` rise of **6px** (not 18px), on a curve chosen so most of the fade is still ahead of it at 300ms. Per the CSS's own comment, this is deliberately **opacity- and position-only — no scale, no blur, no overshoot, no decorative light on the message text itself**; the previous wording in this row ("an 18px rise, a slight scale and a clearing blur") described an earlier milestone's motion and was never updated after later refinement simplified it. A gold light separately traces the message perimeter once (`.gold-orbit`, its own element, not part of the text's own transform). The assistant arrives in three staged parts (avatar, pane, answer). Restored history animates nothing — ids present at mount are excluded.
- **Evidence:** Source — `globals.css` `@keyframes user-enter` (`from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); }`), confirmed against the file this revision. Mocked browser — `{"orbit":1,"userEnter":1}` per fresh turn; restored history `orbits=0 runs=0`; entrance fires exactly once per row while streaming continues.
- **Gap:** None on the motion itself. See F6 in `remaining-work-plan.md` for a related but distinct defect in the assistant answer's *code-block* reveal pacing (not the entrance animation this row covers), found by the same independent review.
- **Acceptance check:** Send a message and watch at normal speed; refresh and confirm nothing re-animates.

### R3 — Typing / responding indicator

- **PDF:** p.1 §2 — *"How does the '**typing indicator**' look?"*
- **Classification:** Inferred expectation (the question presupposes one exists).
- **Status: Complete**
- **Code:** `MessageList.tsx:248` `TypingIndicator`, rendered at `:455`, now using the `requestProvider` prop (`WorkspaceLayout.tsx`'s `requestProviderId ?? provider`, from the hook) rather than `active.providerId`.
- **Does:** A provider-tinted three-dot indicator labelled "<Provider> is responding", shown while a turn is in flight and replaced by the answer.
- **Evidence:** Mocked browser — present during an in-flight turn (control state C), absent once complete (state D). Source.
- **Gap:** **[FIXED, F5]** The label used to be driven by the *currently selected* provider, not necessarily the provider the in-flight request was actually sent to — a Retry after a failure resends to the originally-failed provider internally (`failedProviderRef`), but the indicator could show whichever provider was now selected instead. Fixed: `useConversations()` exposes `requestProviderId`, set alongside `failedProviderRef` at the start of every `run()`, and `TypingIndicator` reads that instead. Real-browser confirmation: mid-retry, after switching the selector to GPT, the indicator still reads "Gemini is responding" (scenario F5.3 in `tests/browser/verify.mjs`).
- **Acceptance check:** Send a message; the indicator appears within a second and is named for the active provider. Additionally: fail a turn on Gemini, switch the selector to GPT without retrying, click Retry — confirm the indicator (and, once it resolves, the answer's own identity) correctly reflects Gemini, not GPT.

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
- **Gap:** **[FIXED, F8]** The dialog set `aria-modal="true"` but did not trap Tab or mark the background inert, so the chips behind it stayed in the tab order, and clicking through the old outside-click-closes handler could also fire whatever background control was under the pointer. Fixed: a document-scoped keydown handler cycles Tab/Shift+Tab between the dialog's own two controls; a full-viewport backdrop absorbs outside clicks before they reach a background control, replacing the old pointerdown listener; focus returns to the triggering chip on Cancel/Escape/Confirm; the confirm handler rechecks the in-flight guard at the moment of confirmation. Real-browser confirmation, both viewports, 6/6 (scenarios F8.1–F8.6 in `tests/browser/verify.mjs`): the trap, the backdrop shadowing a background chip (via `elementFromPoint`), Escape, and focus restoration all hold.
- **Acceptance check:** Send a message, click the other provider, press Tab repeatedly — confirm the warning is unmissable and focus never leaves it; then Cancel and confirm nothing changed.

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
- **Status: [CORRECTED] Complete — F1 fixed this revision.** The ordinary refresh path works, and the two specific failure paths that used to lose data are now protected, evidenced below. History: an earlier revision claimed corrupt data was "left byte-intact," which was true of `storage.ts`'s own read call in isolation but **false at the application level**; a later revision downgraded this row to Partial on that finding; this revision fixes it.
- **Code:** `src/lib/storage.ts` `getStorage()`, `canAutoPersist()`, `loadConversations()` (no longer gated on a write probe), `saveConversations()` (property access now guarded); `use-conversations.ts` `autoPersistBlockedRef`, `persistIfAllowed()`, the hydration effect, `flush()`.
- **Does:** Versioned `localStorage`. Writes are blocked until hydration completes, so an initial empty state cannot overwrite saved data. Flushed on completion, Stop, switch, `visibilitychange` and `pagehide`. A reply cut off by a refresh returns as **interrupted**, never as still-streaming. Corrupt or unknown-version payloads are reported and **genuinely never auto-overwritten** — verified below, not merely asserted — and reading no longer needs write capacity, so valid history restores correctly even when the store has no room for a new write.
- **The fix, precisely:** two root causes, both in `storage.ts`. (1) `loadConversations()` used to gate reading on a write-then-remove capacity probe (`hasStorage()`), which needs strictly more headroom than the plain `getItem()` a read actually needs — a store with just enough room to replace its existing key but not enough for an extra probe key reported perfectly readable history as `unavailable`. Removed; reads now call `getItem()` directly. (2) Even a correctly-reported `corrupt`/`unavailable` status was never actually enforced anywhere — the hook's own throttled auto-save ran regardless ~700ms later. Fixed with `canAutoPersist(status)`, consulted exactly once at hydration and held in `autoPersistBlockedRef` for the session; `flush()` — the one function every trigger point (scheduled timer, `visibilitychange`, `pagehide`, unmount cleanup) funnels through — now refuses to call `saveConversations()` at all while that ref is set. A third, smaller fix per the review: `saveConversations()`'s own access to `window.localStorage` is now wrapped in the same try/catch as the read path, so a throwing property getter (`SecurityError`) can no longer escape uncaught.
- **Evidence:**
  - Unit — `tests/storage.test.ts`, 16 tests (7 new): round-trip; malformed JSON → `corrupt` with bytes intact, and never overwritten by a later automatic save; version 99 → `corrupt`, same; valid history readable and `canAutoPersist("ok") === true` even while every write throws `QuotaExceededError`; a `window.localStorage` property getter that throws `SecurityError` is caught for both load and save without crashing; `streaming` → `interrupted`.
  - Unit, against the real conversation hook module — `tests/use-conversations.test.ts`, 8 new tests, importing `persistIfAllowed()` directly from `@/lib/use-conversations` (the same function `flush()` calls, not a reimplementation): normal restoration and saving; corrupt JSON and a future schema version each block every subsequent save, simulated once per each of the four real trigger points (scheduled tick, visibilitychange, pagehide, unmount cleanup) with the underlying bytes checked unchanged after all four; valid history at simulated capacity stays readable and auto-persist stays on (distinguishing a legitimate `"full"` write failure from a deliberate `"blocked"` refusal); a throwing `SecurityError` getter handled without crashing. 100/100 total suite, 0 failures.
  - **Real-browser confirmation**, Chrome via CDP, mocked chat, zero provider requests: corrupt bytes survive 2.5s past the persist throttle and a real dispatched `visibilitychange` event; the sidebar shows the now-accurate banner; the composer stays usable throughout. A future-version payload is protected identically. Valid history is restored and its bytes stay exactly unchanged while every `setItem` call throws. A normal empty session still auto-saves exactly as before. 8/8 passed.
  - A genuine harness mistake was found and corrected during this verification, disclosed rather than absorbed: seeding corrupt data into an *already-loaded, healthy* page and then reloading is not the real scenario — that page's own live `pagehide` handler (correctly unblocked for its own healthy session) fires on navigation and can overwrite the externally-poked value before the new page ever loads, which looks identical to a data-loss bug but isn't one. The corrected method seeds via `Page.addScriptToEvaluateOnNewDocument`, present before the app's first-ever script runs.
  - **Recorded live** — after a mixed-provider conversation, a reload restored 5 answers, the provider, the model readout and attribution `[gpt,gpt,gpt,gpt,gemini]`. Ordinary path, from an earlier revision, unaffected by this fix.
- **Gap:** Local-browser-only persistence with no cross-device sync, which the PDF does not ask for. No UI action anywhere in the app clears `autoPersistBlockedRef` once set for a session — deliberately: nothing should discard unreadable storage without the user explicitly asking, and no such "start fresh" control exists yet.
- **Acceptance check:** Send two messages, hard-refresh; transcript, sidebar entry, provider and model readout all persist. Seed `localStorage` with corrupt JSON, or with a valid payload while the store is otherwise full, then load the app — the pre-existing bytes must be provably unchanged after the throttle window, a visibility change, and continued use.

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
- **Status: [CORRECTED] Complete in principle, and F2 fixed this revision — deviates from the literal example shape**
- **Code:** `src/lib/chat.ts` (`ChatMessage`, `StreamEvent`, `ChatErrorCode`, `ERROR_COPY`, `StreamOutcome`, `MessageOutcome`, `noticeForOutcome()`); `src/server/providers/types.ts` (`ProviderChunk`); `openai.ts`, `gemini.ts` (per-provider outcome classification); `route.ts` NDJSON framing (`done` now carries `outcome`/`reason`); `use-conversations.ts` (`settleRun()`, `applySettlement()`); `MessageList.tsx` (`noticeForOutcome()` rendering).
- **Does:** Every provider is normalised to one shape. Messages are `{ role, content, state, provider, outcome?, outcomeReason? }`; the stream is NDJSON of `{type:"delta"|"error"|"done"}`, and `done` now carries a confirmed terminal outcome (`"complete"|"truncated"|"unknown"`) rather than being inferred from the transport merely closing; every vendor failure collapses into one closed error vocabulary with user-facing copy that names the provider that actually failed.
- **Deviation, stated plainly:** the field names are `role`/`content`, not `author`/`text`, and the transport is a token stream rather than one whole-response object. The reason is that the interface streams; a single terminal object cannot express partial delivery, Stop, or a mid-stream failure after text has already been shown. **The PDF did not approve this substitution** — it is our engineering judgement against an illustrative example, and the owner should confirm it is acceptable.
- **The F2 fix, precisely:** the terminal signal was not actually normalised before this revision — the client inferred "complete" purely from the HTTP body closing, never from reading a `done` event's meaning, so a full answer, an OpenAI/Gemini truncation, and a bare dropped connection were wire-indistinguishable. Fixed with one small explicit contract carried through every layer: each adapter now yields an explicit `{type:"outcome", outcome, reason?}` chunk as the last thing it produces on any non-throwing end (OpenAI: `response.completed`→`"complete"`, `response.incomplete`→`"truncated"` with a reason read from `incomplete_details.reason`; Gemini: every `FinishReason` enum value classified via `classifyFinish()`, with `STOP` the *only* value that means `"complete"`, and no chunk ever carrying a finish reason falling back to `"unknown"`); the route forwards it as the `done` event's `outcome`/`reason`; the client's `settleRun()` turns that into one of `complete`/`interrupted`/`emptyReply`/`fail`/`noop`, applied by `applySettlement()`; `noticeForOutcome()` renders an accurate, specific notice only when the message is actually `interrupted`. A completed stream with no delta text at all is still explicitly reported `"complete"` with zero text, not silently dropped.
- **Evidence:** Source. Unit — error-vocabulary and stream-framing tests, plus (new for F2) `tests/chat.test.ts` (9 tests, every `noticeForOutcome()` case including backward compatibility with messages saved before `outcome` existed). Adapter-mock — `tests/openai.test.ts` (+6) and new `tests/gemini.test.ts` (9 tests, intercepting the real SDK's `generateContentStreamInternal` network boundary — `geminiProvider.stream()` had no test at all before this fix). Route-level — new `tests/route.test.ts` (8 tests, calling the real `POST`/`GET` handlers with real `Request` objects — `route.ts` had no test at all before this fix). Module-level, against the real hook — `tests/use-conversations.test.ts` (+12, importing `settleRun()` directly, the same function `run()`'s three exit paths call). Real-browser — 6 scenarios, 9/9 checks, mocked chat, zero provider requests.
- **F4, now fixed — the request side of the contract is enforced too.** Normalization used to be proven only for *valid* requests: `POST /api/chat` cast its parsed body to a TypeScript type without a runtime object check and dereferenced message fields without null checks; a JSON body of `null`, a `messages` array containing `null`, or a provider id of `"constructor"`/`"__proto__"` (reachable because the provider registry was a plain object indexed without an own-property guard) each threw an unhandled exception rather than returning the app's own normalized `{code, detail, info}` error shape. Fixed: `isPlainRecord()` and `isValidWireMessage()` validate the body and every message entry as non-null objects with the right shape before anything is dereferenced; `registry.ts`'s lookup moved to a `Map`, immune to prototype-chain lookups entirely. Evidence: `tests/route.test.ts` (+6) — `null`/array/primitive bodies, a `null` message entry, wrong role/blank/non-string content, and `"__proto__"`/`"constructor"`/`"toString"`/`"hasOwnProperty"` provider ids all return the documented normalized error with zero adapter calls made.
- **Gap:** The shape deviation above (not a defect, needs an owner decision, not a fix).
- **Acceptance check:** Force an error on each provider and confirm both produce the same normalised code and copy (passes today). Additionally: seed a mocked stream that truncates, drops, or errors mid-answer, and confirm the message settles with an accurate outcome and notice, never silently as complete (passes as of the F2 fix). POST `null`, an array, `{messages:[null]}`, and `{provider:"constructor"}` — every one of these must return a normalized JSON error response, never an unhandled 500 (passes as of the F4 fix).

### R15 — Actual multi-provider operation

- **PDF:** p.1 §2 — *"when I switch between **GPT-4 and Gemini**"*; p.2 §4 — *"whether it's using **Gemini or GPT-4**"*.
- **Classification:** Requirement (two providers must really work).
- **Status: Complete — live-verified on both**
- **Code:** `registry.ts:25`; `gemini.ts:18` default `gemini-3.6-flash`; `openai.ts` default `gpt-5.6-luna`, `:45` `MAX_OUTPUT_TOKENS`, `:61` `REASONING_EFFORT`.
- **Does:** Two real adapters, each streaming, each cancellable, each mapping the full conversation.
- **On the PDF's "GPT-4" wording:** the brief says GPT-4. That model generation is not the current API surface, so the app ships **`gpt-5.6-luna`**, verified against the published model and pricing pages on 2026-09-21 as the cheapest current text tier. The selector names the vendor ("GPT") and prints the exact model id beside it; no UI text claims GPT-4. **The PDF did not explicitly approve this substitution.** It is a judgement call, disclosed here and in the README, and the owner should confirm it.
- **Evidence:** Adapter-mock — SSE parsing across chunk boundaries, delta normalisation, abort, and the full error map (401→INVALID_KEY, 429-billing→INSUFFICIENT_CREDIT non-retryable, 429-throttle→RATE_LIMIT with Retry-After, 503→MODEL_BUSY, 5xx→UPSTREAM, 400/404→BAD_REQUEST). **Recorded live** — four GPT answers (`"noted"`, `"41"`, `"Red"`, `"Perseus"`) and one Gemini answer in one conversation, each read from the rendered transcript, not from a status code. Real usage logged: `{ model: 'gpt-5.6-luna', input: 14, output: 5, reasoning: 0 }`.
- **[CORRECTED] F2 fixed this revision.** `gemini.ts` now imports the real `FinishReason` enum from `@google/genai` and checks `chunk.candidates?.[0]?.finishReason` on every streamed chunk via `classifyFinish()`: `STOP` is the only value treated as `"complete"`; `MAX_TOKENS` is reported truncated with `"reached the length limit"`; `SAFETY`/`BLOCKLIST`/`PROHIBITED_CONTENT` are each reported truncated with `"stopped by content filtering"`; `RECITATION`, `LANGUAGE` and `SPII` each get their own distinct, non-vendor-vocabulary wording; an unrecognised or future reason is truncated with no invented reason; a chunk with no `finishReason` at all is correctly read as still-in-progress (matching the SDK's own documented meaning), and the generator ending with no finish reason ever seen falls back to `"unknown"`. Evidence: new `tests/gemini.test.ts` (9 tests, mocking the SDK's own `generateContentStreamInternal` network boundary, confirmed by reading the installed package's compiled source) plus new `tests/route.test.ts` (8 tests) and the real-browser confirmation under R14 above.
- **[FIXED, F5]** The error banner and typing indicator used to be able to display the wrong provider's name after a failure followed by a manual switch, even though Retry itself always correctly targeted the provider that actually failed. Fixed: `useConversations()` now exposes `requestProviderId`; `ErrorRow`/`TypingIndicator` (`MessageList.tsx`) read it instead of the currently-selected provider. `SetupState`, separately hardcoded to say "Gemini is not configured" regardless of which provider was actually unconfigured, is now parameterized on the real selected provider via `providerKeyName()`. Real-browser confirmation, both viewports: a Gemini `INVALID_KEY` failure's banner still reads "Gemini rejected that API key" after switching the selector to GPT without retrying, and Retry's own request (read back from the mock) still targets `gemini`; both single-configured-key setup-screen scenarios show the correctly-attributed provider and key name.
- **Gap:** **Live error paths remain unproven.** `INVALID_KEY`, `INSUFFICIENT_CREDIT`, `RATE_LIMIT` and `MODEL_BUSY` are adapter-mock only; provoking them for real means damaging the account or waiting for an outage.
- **Acceptance check:** One prompt to each provider in the same conversation, two genuine replies, header model id matching what the adapter sent. Additionally: fail on Gemini, switch to GPT, confirm the error banner still names Gemini (not GPT) and Retry still targets Gemini (passes as of the F5 fix).

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
- **Gap:** **Both live keys were pasted into chat transcripts during setup.** Nothing is committed, but a key that has been pasted should be treated as disclosed. This remains a required operational step before handoff. (F1, formerly listed alongside this item, is fixed — see R10 in §1 and §5.)
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

### Output-limit path — inspected as asked, and fixed (F2)

**This section originally reported (2026-09-21, before the F2 fix): "a response truncated by the output cap is presented as an ordinary completed answer. It is not disclosed."** That finding is now fixed and is kept here, struck through in substance, as the record of what changed and why — not deleted, since the trace below is still an accurate map of the code path, just no longer of its behaviour.

The original trace:

1. `openai.ts:302` — `response.incomplete` (the documented signal that `max_output_tokens` was exhausted) returns from the generator cleanly, deliberately keeping the text already delivered.
2. `route.ts` — the `for await` ends normally, so it enqueued `{type:"done"}` with **no field distinguishing "finished early" from "finished normally"**.
3. `use-conversations.ts` — `done` unconditionally set the message `state: "complete"`.
4. `MessageList.tsx` — the *"Response interrupted."* line rendered only for `state === "interrupted"`, which a truncated answer never reached.

**Fixed as part of F2:** `openai.ts` now yields `{type:"outcome", outcome:"truncated", reason:"reached the length limit"}` on `response.incomplete` instead of returning bare; `route.ts` forwards `outcome`/`reason` on the `done` event; `use-conversations.ts`'s `settleRun()` only ever settles `"complete"` when the outcome is confirmed `"complete"`, and settles a truncated answer `interrupted` with that outcome recorded; `MessageList.tsx`'s `noticeForOutcome()` renders "Response was cut short — reached the length limit." beneath the (still fully Copy-able) partial text. See R14/R15 above for the full fix detail and evidence.

Gemini sets no output cap at all, so it cannot truncate the same way via a length limit — but its own `finishReason` is now also read (`classifyFinish()`), so any other non-STOP stop is disclosed too, not just OpenAI's.

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

### Verification performed for the F1 fix (this pass)

The table above is the earlier model-label-fix pass, left as its own historical record rather than overwritten. This pass's own checks, against the F1 fix specifically:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | **100/100** (85 previous + 15 new: `tests/storage.test.ts` 7 new, `tests/use-conversations.test.ts` 8 new) |
| `npm run build` | clean; same 3 routes |
| Real-browser F1 confirmation (mocked chat, zero provider requests) | **8/8** — corrupt data, future-version data, valid history at simulated capacity, and the ordinary happy path, each checked against the real running app |
| Provider / motion / persistence suite (`verify13`, unaffected regression check) | **25/25** |
| Glass, contrast, reduced motion, frame cost (`verify14`, unaffected regression check) | **8/8** |

**Provider requests made for this fix: zero.** Same guard pattern as before — the fetch stub is installed and its presence asserted before anything is sent.

A harness mistake surfaced during this verification and is disclosed rather than smoothed over: an initial browser test seeded corrupt data into an *already-running, healthy* page and then called `Page.reload()`. That page's own live `pagehide` listener — correctly unblocked for its own healthy session — fired during navigation and overwrote the externally-poked value before the new page loaded, which looked exactly like the F1 bug returning but was actually a test-design error, confirmed by (a) the identical result on a from-scratch production build, ruling out stale dev-mode caching, and (b) the same result with the write path fully re-verified as absent from any other code location via full-source grep. The corrected method seeds via `Page.addScriptToEvaluateOnNewDocument`, in place before the app's first-ever script runs, with no prior page instance ever in the picture — this is the version whose 8/8 result is reported above.

### Verification performed for the F2 fix (this pass)

This pass's own checks, against the F2 fix specifically — carrying a confirmed terminal outcome from provider adapter through the route, the client hook, storage, and back through a reload:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | **147/147** (100 previous + 47 new: `tests/openai.test.ts` +6, new `tests/gemini.test.ts` 9, new `tests/route.test.ts` 8, `tests/use-conversations.test.ts` +12, new `tests/chat.test.ts` 9, `tests/storage.test.ts` +3) |
| `npm run build` | clean; same 3 routes |
| Real-browser F2 confirmation (mocked chat, zero provider requests) | **9/9** across 6 scenarios — normal completion (no notice), OpenAI truncation with a specific reason, a bare unknown EOF, a mid-stream error after partial text (notice *and* error banner both), Stop (unchanged original wording), and outcome/reason surviving a real page reload |

**Provider requests made for this fix: zero.** Same guard pattern as before — the fetch stub is installed and its presence asserted before anything is sent.

**Two pre-existing test-coverage gaps were closed as a side effect of this fix, not as separate work items:** `geminiProvider.stream()` had no automated test of any kind before this pass (only `classifyGemini()`/`parseQuota()` were exercised); it now has `tests/gemini.test.ts`, mocking the real SDK's `Models.prototype.generateContentStreamInternal` — its actual network-boundary method, confirmed by reading the installed package's compiled source rather than assumed. `route.ts`'s `POST`/`GET` handlers had no automated test of any kind before this pass; they now have `tests/route.test.ts`, calling the real exported handlers with real `Request` objects and mocking only the OpenAI fetch endpoint.

A genuine regression was found and fixed during this verification, disclosed rather than smoothed over: an early version of the fix correctly stopped a message from staying stuck at `state:"streaming"` after a mid-stream failure, but in doing so it silently dropped the pre-existing top-level error banner and Retry button for the specific case of an error arriving *after* text had already streamed — a real usability regression versus pre-F2 behavior. This was not caught by any of the module-level `settleRun()` unit tests, which only proved the *decision* logic correct; it was caught by the real-browser check, which is exactly why that layer exists alongside the module tests. Fixed by extending the settlement result with optional error `code`/`info`, populated only when the failure happened after text had opened a message, and having the client apply `setError`/`setStatus("error")` in that case. Re-verified 9/9 after the fix.

### Verification performed for the F3–F9 fix (this pass)

This pass's own checks, against F3–F8 plus the small F2 finish-reason follow-up (see the revision note at the top of this document for what each covers):

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | **180/180** (147 previous + 33 new: new `tests/limits.test.ts` 12, `tests/chat.test.ts` +4, `tests/route.test.ts` +6, `tests/reveal.test.ts` +5, `tests/openai.test.ts` +5, `tests/gemini.test.ts` +1) |
| `npm run build` | clean; same 3 routes |
| Real-browser confirmation (mocked chat, zero provider requests) | **26/26 at 1366×768, 26/26 at 1680×1050 — 52/52 total.** F3 (oversized-draft refusal + recovery, conversation-cap notice + control), F5 (banner/typing-indicator/Retry attribution surviving a selector change, both single-configured-key setup scenarios), F6 (a long fenced code line visible mid-stream), F8 (Tab/Shift+Tab trap, backdrop shadowing, Escape, focus restoration), plus a light F1/F2 regression spot-check and a presence check of the approved glass panel and gold orbit |

**Provider requests made for this fix: zero.** Same guard pattern as before — the fetch stub is installed and its presence asserted before anything is sent. **[Corrected, Finding U3]** The real fail-closed guarantee is CDP `Fetch`-layer interception of this app's own `/api/chat*`, not merely blocking the provider domains at the browser's network layer (which cannot catch a request that only ever needed to reach this app's own same-origin dev server) — see `tests/browser/cdp.mjs`'s `API_CHAT_PATTERN` and the dedicated negative test, `tests/browser/verify-network-isolation.mjs`.

**F4 and F7 have no distinct browser-observable surface** — they are server-contract fixes (request validation) and a wire-parsing fix (SSE line endings) respectively, neither reachable from a click in the UI. Both are instead verified at the route/adapter level: `tests/route.test.ts` (+6, F4) and `tests/openai.test.ts` (+5, F7), calling the real handler/parser directly. This mirrors exactly how F4's *predecessor* concern (malformed-request resilience) was already handled in the original plan — "not directly exercisable from the UI... verified via the route-level tests instead."

**One test-harness bug was found and fixed during this verification, disclosed rather than smoothed over:** the first version of the browser harness's conversation-seeding helper wrote the seed state via `Runtime.evaluate` on an *already-running* page and then navigated again — which raced that page's own `pagehide` handler (correctly unblocked for its own healthy, empty session), which flushed its in-memory empty draft and overwrote the just-seeded 50-message payload with `{conversations:[]}` a moment before the reloaded page ever read it. This produced a real, reproducible false failure (the conversation-cap notice never appeared) that had nothing to do with the F3 fix itself. Corrected by seeding through `Page.addScriptToEvaluateOnNewDocument`, present before the app's first-ever script runs — the same fix pattern already used for the F1 milestone's own corrupt-storage seeding, for the identical underlying reason.

### Verification performed for the U1–U6 follow-up correction (this pass)

Against U1–U6 specifically — six real defects found by an independent review of this project's own `model-switcher-review-updated.zip`, plus one inaccurate claim in this document's own text:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (one genuine finding fixed along the way: `react-hooks/refs` correctly flagged a raw `.current` read during render in the first version of U5's portal-target plumbing — fixed by lifting the DOM node into state via a ref callback instead) |
| `npm test` | **188/188** (180 previous + 8 new: `tests/limits.test.ts` +6 for U1's `hasOversizedMessage()`/`historyTooLong`, `tests/reveal.test.ts` +2 for U4; `tests/chat.test.ts`'s 4 F3-era tests rewritten in place to assert the opposite, same count) |
| `npm run build` | clean; same 3 routes |
| Real-browser confirmation (mocked, zero provider requests) | **40/40 at 1366×768, 40/40 at 1680×1050.** New: U1.1–U1.4 (oversized-history notice, disabled send, "Start new conversation", and that `send()` itself refuses even with the button's `disabled` bypassed), U2.1–U2.3 (both questions survive a BAD_REQUEST, Retry targets the one that actually failed), U3 (zero real `/api/chat` network attempts observed on every page, asserted per test block). Strengthened: F8.3 (now asserts the real `shiftKey:true` event and the trap's own `preventDefault()`, not just the resulting focus), F8.4b (the sidebar's own "New conversation" button, outside the chat panel entirely, is also shadowed by the backdrop) |
| Dedicated negative test (`tests/browser/verify-network-isolation.mjs`, U3) | **4/4**, with NO mock installed at all: the app's own availability probe and a raw attempted POST to `/api/chat` are both caught and failed at the CDP network layer before ever reaching the real dev server |

**Two genuine issues were found and fixed during this verification pass itself, disclosed rather than smoothed over:** (1) the U1 real-browser test for an oversized historical message was first written assuming `nextBoundary`-style forward search would find the fact placed at the very end of the oversized reply; the fixture needed a message specifically longer than `MAX_CHARS` with the marker text within the surviving prefix to demonstrate the point cleanly — adjusted, not a defect in the fix itself. (2) the first version of U5's fix threaded a `RefObject` down to `ChatHeader` and read `.current` inside its render body, which `npm run lint` correctly flagged (`react-hooks/refs`, "Cannot access refs during render") — fixed by moving the DOM-node capture into `WorkspaceLayout`'s own state, set via a ref callback (`ref={setMainEl}`) rather than a `useRef`, so the value ChatHeader receives is an ordinary prop, not a ref read.

### Verification performed for the U5 second-pass correction (`model-switcher-final-verification.md`)

A second independent verification pass re-derived U1–U6 from source (all six held up), then flagged one further real defect the first U5 fix had not fully closed, with a source-based CSS-stacking-context argument but no browser reproduction of its own — the instruction for this pass was explicit: reproduce it for real before changing anything, using actual pointer input, not `.click()`.

| Check | Result |
| --- | --- |
| Reproduction, before any fix | `document.elementFromPoint()` over the center of either dialog button returned the backdrop `<div>`, not the button. A real dispatched pointer click (CDP `Input.dispatchMouseEvent`) at the "Switch model" button's coordinates closed the dialog **without switching the provider** — the backdrop's own `onClick` fired instead of the button's. Confirmed the report's suspicion exactly. |
| Fix | `ChatHeader.tsx`'s `SwitchDialog` now portals the dialog alongside the backdrop into `<main>`, as true DOM siblings, so their `z-40`/`z-50` compare directly in one stacking order instead of the dialog's `z-50` being scoped inside `section.optical-glass`'s own stacking context. The dialog's position is measured from its anchor via `getBoundingClientRect()` (recomputed on open and on window resize) rather than assumed from CSS `top-[42px] right-0`, since portaling forfeits that anchoring. |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (one genuine finding fixed along the way — see below) |
| `npm test` | **188/188**, unchanged — this fix has no pure-decision surface of its own to unit-test; it is DOM stacking/hit-testing behaviour, covered by the real-browser harness instead, the same reasoning already applied to F5/F8/U2/U3/U5's first pass |
| `npm run build` | clean; same 3 routes |
| Real-browser confirmation (mocked, zero provider requests) | `tests/browser/verify.mjs`: **46/46 at 1366×768, 46/46 at 1680×1050** (40 previous + new U5b.1–U5b.5: `elementFromPoint()` over each button now resolves to the button; a real pointer click on "Switch model" closes the dialog and performs exactly the one requested switch; a real pointer click on "Cancel" closes it without switching; a real pointer click outside the dialog dismisses it without activating the sidebar control underneath; Tab/Shift+Tab/Escape/focus-restoration re-confirmed unaffected). Dedicated `tests/browser/verify-dialog-hit-testing.mjs`, covering both approved glass modes explicitly (this project's own two, "classic" and "ultra" — not merely re-running the same check twice): **16/16** (8 per glass mode). |

**One genuine issue was found and fixed during this verification pass itself:** the first version of the fix returned `null` from `SwitchDialog` for the one render before its portaled position had been measured, to avoid a visible jump. That broke initial-focus behaviour: `confirmRef` had nothing to attach to on that first commit, and the sibling effect that calls `confirmRef.current?.focus()` fired against a stale/absent ref, silently leaving focus on `<body>` instead of "Switch model" — caught by re-running the existing F8.1 focus check, not by a new one. Fixed by always rendering the dialog (with a `{ top: 42, right: 0 }` fallback position for that one frame, corrected synchronously by `useLayoutEffect` before the browser paints, so the fallback is never actually visible) instead of conditionally rendering `null`.

---

## 5. Missing work, most important first

**Revised this pass. F1 through F8 are all fixed** — implementation, 15+47+33
new committed regression tests against the real modules, and real-browser
confirmations with zero provider requests for each. None of F1–F8 are in the
table below any longer; their detail lives in R1/R3/R7/R10/R14/R15 (§1) and
Milestones 1–7 of `docs/remaining-work-plan.md`, all marked done. Everything
remaining in this table is either a genuinely unproven live-only concern or
an owner decision that was never a code defect to begin with — key rotation
and the two §6 substitutions are no longer tracked here as open items; see
the revision note above.

| # | Item | Severity | Notes |
| --- | --- | --- | --- |
| 1 | **Live error paths unproven** | Medium | `INVALID_KEY`, `INSUFFICIENT_CREDIT`, `RATE_LIMIT`, `MODEL_BUSY` are adapter-mock only. Not treated as a blocker — proving them live means damaging the account. |
| 2 | **Live-provider evidence lives outside the repo** | Medium | The dev-server log and screenshots proving the *live* Gemini/GPT runs are in a session scratchpad, not `docs/`. Export deliberately if a reviewer wants them. (The *mocked* real-browser harness no longer has this problem — see item 8 below.) |
| 3 | **Normalization shape deviates from the PDF example** | Settled, not a defect | `role`/`content` + NDJSON vs `{author,text}`. Both reviews independently agree the PDF's own "Here are some tips" / "Example:" framing makes this illustrative, not mandatory — no rename is required, and the owner has confirmed this reading (§6). |
| 4 | **5 unused Next.js starter assets** | Low | `public/{file,globe,next,vercel,window}.svg`, referenced nowhere in `src/`. |
| 5 | **Gemini has no output cap** | Low | OpenAI caps at 1200 tokens; Gemini is uncapped. Gemini now correctly reports a truncated vs. complete answer either way (fixed by F2/F2-follow-up), but nothing stops an uncapped Gemini response from running arbitrarily long, which is a cost/latency concern independent of the outcome-reporting fix, and was never in scope for it. |
| 6 | **Mobile** | Out of scope | Owner decision: desktop only for this submission. The PDF itself never mentions mobile at all — this is not something the PDF deferred, it simply never came up. |
| 7 | ~~F8's mouse click-through is proven by DOM hit-testing, not a real OS-level click~~ **Resolved (U5 second-pass correction)** | Informational | `document.elementFromPoint()` was the original technique. The U5 second-pass correction went further and added real dispatched pointer clicks (CDP `Input.dispatchMouseEvent`, via `clickAt()` in `tests/browser/cdp.mjs`) — this is exactly what caught that fix's own stacking-context bug, since a synthetic DOM `.click()` cannot: it fires a target's handler directly and never asks the browser's real hit-testing pipeline which element is frontmost. See `tests/browser/verify.mjs`'s U5b checks and the dedicated `tests/browser/verify-dialog-hit-testing.mjs`. |
| 8 | **Real-browser evidence — improved, not fully resolved** | Informational | The mocked real-browser harness that produced this pass's F3/F5/F6/F8 evidence is now committed at `tests/browser/` (Finding F9), reproducible by anyone with this checkout. It is not part of `npm test`, and the F1/F2 milestone's own real-browser evidence (screenshots, per-check logs) still lives in a session scratchpad rather than the repository — closing that gap for F1/F2 specifically was not part of this pass's scope. |

---

## 6. Decisions needed from the owner / supervisor

1. ~~The GPT-4 substitution.~~ **Settled: accepted.** The PDF says "GPT-4"; the app ships `gpt-5.6-luna` and displays that id. The PDF never approved this, but the owner has since accepted the selected model — no further sign-off is pending, and no code change results.
2. ~~The normalization shape.~~ **Settled: accepted.** The PDF's example is `{"author":"assistant","text":"Hello!"}`; the app ships `role`/`content` with an NDJSON token stream because the interface streams. Both this document and the independent codex review read §6 as illustrative rather than mandatory — see §0 above — and the owner has confirmed that reading. No rename is needed.
3. **Truncation disclosure — now fixed, nothing left to decide.** F2's terminal-state fix (`remaining-work-plan.md` Milestone 2, now done) covers this: a truncated or dropped answer now shows a specific, accurate notice rather than looking identical to a complete one. No owner decision remains for this item.
4. **Live evidence** — should it be exported into the repository for the reviewer?
5. **Reference material** — `references/DESIGN.md`, `code.html`, `screen.png` are tracked (~1.4 MB). Ship them or strip them?
6. ~~Submission channel~~ **Settled: ZIP/email, no GitHub push.** See §7 — the PDF itself does not specify a channel, but the owner has since confirmed final delivery is a portable ZIP; no GitHub remote is to be created or pushed to.
7. **F1 is now fixed as: block silently, forever, with no recovery UI.** Corrupt/unreadable storage now blocks auto-save for the rest of the session and the app runs normally in memory — but there is currently no "start fresh" or manual-recovery control anywhere in the interface, so a user who hits this can only keep using that session in-memory or leave the old bytes in place indefinitely. Confirm this is the desired behaviour, or ask for a recovery control to be added as a follow-up (a UI change, intentionally not made as part of this fix).

---

## 7. Delivery checklist

### Does the PDF specify a submission method?

**No.** Both pages were read in full. There is **no** mention of a deadline, a ZIP, a repository to push to, an email address, a form, or deployment. The only occurrence of "GitHub" is in the security rule — *"If we see a key on GitHub, it's a security breach!"* — which implies a reviewer may look at a repository but does **not** state a required channel.

**Consequence: there is no requirement anywhere in the PDF to deploy a public website.** The owner has since settled this: final delivery is a portable ZIP, sent directly (ZIP/email) — no GitHub remote is to be created and nothing is to be pushed. See the "GitHub handoff" note below, kept for history now that the channel is decided.

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

**Review ZIP vs. company-facing package — these are not the same artefact.** Every `model-switcher-review*.zip` built during this project's audit passes (including the current one) is a *review* package: it deliberately includes this project's own internal audit trail — `docs/requirements-audit.md`, `final-inventory.md` (this file), `remaining-work-plan.md`, `model-switcher-codex-review.md`, `project-technical-guide.md`, `submission-checklist.md` — so that fixes and evidence are independently checkable. None of that is company-facing material, and it should not be assumed to belong in whatever package is actually handed to Numbase Group unless asked for. Building a company-facing package, if and when one is wanted, means the same source/tests/README but with that internal `docs/` audit trail (and this note) left out — a packaging decision for the owner to make, not one this pass makes unilaterally.

**If packaging a ZIP, build it from the current working tree**, not `git archive HEAD` alone — every fix pass so far (F1 through U5's second-pass correction) is still uncommitted, so `git archive HEAD` would silently omit all of it. `git ls-files` plus the specific untracked files intended for inclusion is the pattern used for every ZIP built so far; see `review-baseline-updated.txt` for the exact file list each time.

### GitHub handoff

- **No remote is configured** (`git remote -v` is empty). Nothing has ever been pushed.
- Branch `main`, 16 commits, clean history, **no secrets in any blob in any commit** (verified this pass).
- **Settled: not part of this delivery.** The owner has confirmed final delivery is a ZIP, not a GitHub push — no remote is to be created. This subsection is kept for history (it accurately described the state when written) rather than as a remaining step.

---

## 8. Submission-readiness verdict

**[REVISED AGAIN] All confirmed code defects — the original nine, U1–U6, and the U5 second-pass correction — are now fixed. What remains is a genuinely unproven live-only concern and a small number of owner decisions that were never code defects to begin with, all now settled.**

Four revisions of this document tracked four fix passes. The first found F1 (a reproducible persistence data-loss bug) and fixed it. The second fixed F2 (incomplete or broken streams settling into the wrong terminal state). The third fixed F3–F8 (see the revision note above) plus U1–U6 from an independent follow-up review. This revision fixes one further real defect from a second independent verification pass: the switch dialog's own buttons were not genuinely clickable in every case — the first U5 fix moved the backdrop out to `<main>` but left the dialog nested inside the chat panel's own stacking context, so a real pointer click on "Switch model" could still be intercepted by the backdrop and silently act as Cancel. See §1 (R1, R3, R7, R14, R15), `docs/requirements-audit.md` §C2 item 14, and the revision notes at the top of this document for the full fix detail.

What is genuinely done: all sixteen requirement rows are fully Complete. The build, lint and **188** tests are clean (unchanged this pass — the U5 second-pass fix is DOM stacking/hit-testing behaviour with no pure-decision surface to unit-test, covered by the real-browser harness instead). No secret appears in any tracked file, in the built client bundle, or in any commit in history. Every visible control does something — and, as of this pass, is confirmed via real dispatched pointer input to actually receive that click, not merely present. Nothing about the approved glass, backgrounds, motion, gold orbit, or reveal pacing changed to fix any of F1–F8, U1–U6, or the U5 second-pass correction; only status notices, validation behaviour, provider-attribution copy, SSE parsing, and dialog focus/stacking handling changed, each exactly where its own finding required it. A real-browser confirmation (mocked, zero provider requests, committed to the repository per Finding F9) passed 46/46 across both required viewports, plus a dedicated 4/4 network-isolation negative test (Finding U3) and a dedicated 16/16 dual-glass-mode dialog hit-testing regression (U5 second pass).

What holds it back:

1. **Live provider-error paths remain unproven**, and live evidence for the F1/F2/F3–F9 runs still lives outside the repository — both disclosed, neither treated as a blocker (§5 #1–2, #8).
2. **F1's fix has no recovery UI** (§6 #7). Corrupt/unreadable storage still blocks auto-save safely and permanently for that session, but nothing lets a user deliberately discard it and start fresh — that would be a UI addition, intentionally out of scope for every fix pass so far, including this one.

Key rotation and the two §6 substitutions are no longer listed here: the owner has settled all three (keys retained rather than rotated, model and normalization shape both accepted) — see the revision note above and §6. No completion percentage is offered. The requirement matrix above is the honest unit of measurement. §5's remaining items are a live-only concern and one decision item, not open code defects.
