# Remaining work plan — Numbase Model-Switcher

**Written:** 2026-09-21, following the independent code review at `docs/model-switcher-codex-review.md`.
**Baseline commit reviewed:** `5ee5f23edc99dbaf99757d3a3d4f41db7c53f824` (packaged and independently re-reviewed as `model-switcher-review.zip`).
**Scope of this document:** inspection and planning only. No application code was changed to produce it. Every finding below was independently re-verified against the actual current source in this pass — by executing the real, unmodified module where that was possible without installing a new dependency, and by deterministic source/logic trace where it was not. All nine of the independent review's findings held up; none were found incorrect.

This plan does not touch, and no milestone below should touch, the approved glass materials, backgrounds, message entrance motion, gold orbit, or progressive answer reveal *pacing* (F6 is a bug in code-block reveal *logic*, not a request to change the approved prose timings).

---

## 1. Every confirmed remaining issue

| ID | Title | Severity | Where |
| --- | --- | --- | --- |
| ~~F1~~ | ~~Persistence data loss on corrupt/quota-blocked read~~ — **Fixed** | ~~High~~ | `src/lib/use-conversations.ts`, `src/lib/storage.ts` |
| ~~F2~~ | ~~Incomplete/broken streams get the wrong terminal state~~ — **Fixed** | ~~Medium~~ | `src/server/providers/openai.ts`, `gemini.ts`, `src/app/api/chat/route.ts`, `src/lib/use-conversations.ts` |
| ~~F3~~ | ~~Oversized message can permanently poison a conversation~~ — **Fixed** | ~~Medium~~ | `src/lib/limits.ts` (new), `src/components/workspace/MessageComposer.tsx`, `src/lib/use-conversations.ts`, `src/lib/chat.ts` |
| ~~F4~~ | ~~Malformed requests escape the normalized error contract~~ — **Fixed** | ~~Medium~~ | `src/app/api/chat/route.ts`, `src/server/providers/registry.ts` |
| ~~F5~~ | ~~Error/typing labels and setup screen can name the wrong provider~~ — **Fixed** | ~~Medium~~ | `src/lib/use-conversations.ts`, `src/components/workspace/WorkspaceLayout.tsx`, `MessageList.tsx` |
| ~~F6~~ | ~~Code-block reveal can stall until the whole stream ends~~ — **Fixed** | ~~Medium~~ | `src/lib/reveal.ts` |
| ~~F7~~ | ~~OpenAI SSE parser only accepts LF event delimiters~~ — **Fixed** | ~~Low~~ | `src/server/providers/openai.ts` |
| ~~F8~~ | ~~Switch-confirmation dialog does not trap keyboard focus~~ — **Fixed** | ~~Low~~ | `src/components/workspace/ChatHeader.tsx` |
| T1 | Test-coverage gap: misleading test names in `tests/provider.test.ts` (exercise a local fixture, not either real adapter) | Medium (process) | `tests/provider.test.ts` — **Fixed, this pass**: renamed to "the ChatProvider contract: a fixture adapter …" |
| ~~T2~~ | ~~No Gemini adapter test~~ — **Fixed, closed by the F2 fix** | ~~Medium (process)~~ | `tests/gemini.test.ts` (new) |
| ~~T3~~ | ~~No orchestration/route test~~ — **Fixed, closed by the F2 fix** | ~~Medium (process)~~ | `tests/route.test.ts` (new) |
| — | ~~Key rotation~~ — **Settled: owner has decided to keep the current keys** | ~~Blocker (operational, not code)~~ | `.env.local` (not in repo); excluded from every deliverable, verified by the secret scan each ZIP is built with |

**A small follow-up correction to the F2 fix was also made in this pass** (found while re-inspecting `classifyFinish()` for F6's neighbouring work): Gemini's `FINISH_REASON_UNSPECIFIED` value, and any value the switch does not name at all, were reported `outcome:"truncated"` — the same bucket as `OTHER`. Unlike `OTHER` (the SDK's own documented catch-all, a confirmed non-STOP stop), those two cases do not actually confirm a truncation occurred at all; they now report `outcome:"unknown"` instead, matching the honest fallback a bare EOF already gets. See `docs/requirements-audit.md` R15 for the fix detail and `tests/gemini.test.ts` for the regression test.

Each is detailed with location, reproduction, impact and correction in §3.

---

## 2. Findings already fixed, or no longer applicable

**F1 is fixed.** Implementation in `src/lib/storage.ts` (`getStorage()`, `canAutoPersist()`, a probe-free `loadConversations()`, a guarded `saveConversations()`) and `src/lib/use-conversations.ts` (`autoPersistBlockedRef`, `persistIfAllowed()`, wired into the hydration effect and `flush()`). 15 new regression tests (`tests/storage.test.ts` +7, new `tests/use-conversations.test.ts` +8) against the real, unmodified modules, plus a real-browser confirmation (8/8, mocked chat, zero provider requests). Full detail in Milestone 1 below, marked done, and in `docs/requirements-audit.md` R10 / `docs/final-inventory.md` R10 and §4.

**F2 is fixed.** Each provider adapter (`openai.ts`, `gemini.ts`) now yields an explicit `{type:"outcome", outcome, reason?}` chunk as the last thing it produces on any non-throwing end; `route.ts` forwards it as the `done` event's `outcome`/`reason`; `use-conversations.ts`'s `settleRun()`/`applySettlement()` turn that into an accurate message state and notice, applied immediately, not only on the next reload; `storage.ts` persists and validates the new `outcome`/`outcomeReason` fields. 47 regression tests (`tests/openai.test.ts` +6, new `tests/gemini.test.ts` 9, new `tests/route.test.ts` 8, `tests/use-conversations.test.ts` +12, new `tests/chat.test.ts` 9, `tests/storage.test.ts` +3) against the real, unmodified modules, plus a real-browser confirmation (9/9 across 6 scenarios, mocked chat, zero provider requests). This also closed **T2** and **T3** below as a side effect — `geminiProvider.stream()` and the API route now have real automated tests where before this pass they had none. A small follow-up correction was made during the F3–F9 pass: `classifyFinish()` mapped `FINISH_REASON_UNSPECIFIED` and any unrecognised value to `"truncated"`, alongside `OTHER`; only `OTHER` actually confirms a real, named non-STOP stop, so the other two now report `"unknown"` instead. Full detail in Milestone 2 below, marked done, and in `docs/requirements-audit.md` R14/R15 / `docs/final-inventory.md` R14/R15 and §4.

**F3–F8 are also fixed, in this pass.** F3 (input/conversation limits): a new `src/lib/limits.ts` exports `validateDraft()`, shared by the composer and `send()`, refusing an over-limit or conversation-full draft before it ever touches history. **[Superseded by Finding U1, an independent follow-up review — see the addendum at the end of this document]** the first version of this fix additionally had `toWire()` cap any already-stored oversized message for the wire only; that is now removed, replaced with an outright, honest refusal to send at all. F4 (normalized validation): `route.ts` validates the parsed body and every message as non-null objects before dereferencing them, and the provider registry moved to a `Map` immune to prototype-chain lookups. F5 (provider attribution): `useConversations()` now exposes `requestProviderId`, used by `ErrorRow`/`TypingIndicator` instead of the currently-selected provider; `SetupState` is parameterized on the actual provider instead of hardcoded to Gemini. F6 (code reveal): `reveal.ts`'s `nextBoundary()` now searches forward for a fenced code line's own newline instead of repeatedly snapping back to zero progress. F7 (SSE parsing): `openai.ts`'s `parseSse()` was rewritten around a proper CR/LF/CRLF line splitter that correctly resolves a chunk-boundary-split delimiter, and combines multi-line `data:` fields per spec. F8 (dialog focus trap): `ChatHeader.tsx`'s `SwitchDialog` now traps Tab/Shift+Tab, restores focus to the triggering chip on close, uses a full-viewport backdrop to prevent click-through to a background control, and rechecks the in-flight guard at confirm time. Full detail in Milestones 3–7 below, all now marked done, and in `docs/requirements-audit.md` §C2 / `docs/final-inventory.md`.

T1 (misleading test names in `tests/provider.test.ts`) is also fixed this pass — see the table above.

Two further adjustments to *prior* audit findings, for continuity with `docs/requirements-audit.md`:

- **Superseded, not wrong:** this document's own earlier finding "a truncated OpenAI answer presents as complete" was folded into and superseded by the broader **F2**, which covered the same defect plus two more terminal-state gaps (bare EOF, Gemini's unread `finishReason`) that the earlier finding did not. F2 (in its broader form) is now fixed; see above.
- **Corroborated, not new:** this document's own earlier finding "the switch dialog does not trap focus" is the same defect as **F8**, independently reached by both reviews. Tracked once, under F8, still open.

---

## 3. Milestones, in priority order, with acceptance criteria

Each milestone is scoped to be independently committable and testable. Milestones 1–2 are the only ones that touch data users can lose; everything after is correctness/robustness that cannot destroy existing conversations.

### Milestone 1 — Fix persistence data loss (F1) — ✅ DONE

**Why first:** the only finding that can silently destroy a user's existing work with no action on their part beyond an ordinary page load.

**Status: fixed and verified.** All four required corrections below are implemented; every acceptance criterion below is met, evidenced by 15 new tests against the real modules plus a real-browser confirmation. See `docs/requirements-audit.md` R10 and `docs/final-inventory.md` R10/§4 for the full evidence trail. What follows is kept as the original plan, for the record.

**Root cause.** `src/lib/storage.ts`'s `loadConversations()` correctly reports `corrupt`/`unavailable` without writing anything on that call. But `src/lib/use-conversations.ts`'s hydration effect treats *any* non-`ok` load identically to "nothing saved yet" — it creates an empty draft — and the ordinary throttled-persist effect (`schedulePersist` → `flush` → `saveConversations`) then runs unconditionally about 700ms later, because nothing anywhere checks `storageStatus` before writing. On a corrupt/future-version payload this overwrites the unreadable-but-potentially-recoverable bytes. On a storage-capacity probe false negative (the probe adds a temporary key, which needs strictly more headroom than replacing the existing key with something smaller) it can overwrite *still-valid, still-readable* history that was never actually re-read.

**Required correction — status of each:**
1. ✅ **Done.** `loadConversations()` no longer consults any write-capacity probe at all; it reads with a plain `getItem()`. `hasStorage()` (the old probe) is removed entirely.
2. ✅ **Done, with one deliberate deviation from the original plan.** The automatic persist effect is blocked whenever the *initial* hydration load was `corrupt`/`unavailable`, via `canAutoPersist()` (in `storage.ts`) and `autoPersistBlockedRef` (in `use-conversations.ts`), enforced inside `flush()` — the one function every trigger point calls. **What was not built:** the "ignore existing data and start fresh" recovery control this plan originally sketched. That would be a new, visible UI element, and the fix instructions for this pass explicitly said to keep the approved interface unchanged — so the block is currently permanent for the session, with no in-app way to clear it. This is recorded as an open decision in `docs/final-inventory.md` §6 item 7, not silently dropped.
3. ✅ **Done.** `getStorage()` in `storage.ts` wraps the `window.localStorage` property access itself in try/catch, used by both `loadConversations()` and `saveConversations()`.
4. ✅ **Done.** No repair or partial parsing was added; a corrupt/unrecognised payload's bytes are left exactly as found.

**Acceptance criteria — status of each:**
- ✅ Corrupt JSON: bytes verified byte-identical past the persist throttle, after a real `visibilitychange` dispatch, and (at the module level) after simulating all four real trigger points in sequence.
- ✅ Future schema version: same protection, same evidence.
- ✅ Valid history at simulated capacity: restored and shown, not replaced — verified both at the module level and in a real browser with `Storage.prototype.setItem` patched to always throw.
- ✅ A property-access `SecurityError` getter: caught without crashing, for both load and save, at the module level.
- ✅ All 9 original `tests/storage.test.ts` tests still pass unmodified (now 16 total, 7 new).
- ✅ New regression tests drive the real hook module: `tests/use-conversations.test.ts` (new, 8 tests) imports `persistIfAllowed()` directly from `@/lib/use-conversations` — the exact function `flush()` calls, not a reimplementation. Full React-tree mounting was not attempted; this project's test suite has no renderer/DOM available, and adding one was judged out of scope for this fix. That gap is disclosed, not hidden — see the real-browser confirmation below, which covers the one thing the module-level tests can't: the hook actually mounted by React.
- ✅ **Additional, beyond the original acceptance list:** a real-browser confirmation (Chrome via CDP, mocked chat, zero provider requests) exercised the actual compiled app, not just its source modules — 8/8 checks passed, covering corrupt data, an unrecognised version, valid history at capacity, and the unaffected happy path.

### Milestone 2 — Correct terminal states for complete, partial, interrupted and failed streams (F2) — ✅ DONE

**Status: fixed and verified.** All six required corrections below are implemented; every acceptance criterion below is met, evidenced by 47 new tests against the real modules plus a real-browser confirmation. See `docs/requirements-audit.md` R14/R15 and `docs/final-inventory.md` R14/R15/§4 for the full evidence trail. What follows is kept as the original plan, for the record.

**Root cause.** The client (`use-conversations.ts`) infers "the answer is complete" purely from the HTTP response body closing (`reader.read()` returning `done: true`), never from an explicit, meaningful terminal signal. On the server side, `route.ts` always emits `{type:"done"}` after its `for await` loop ends, regardless of *why* the adapter's generator returned — normal completion, OpenAI's `response.incomplete` (token cap), or a bare EOF with no terminal SSE event of any kind, all produce the identical `done`. Separately, `gemini.ts` never reads the SDK's finish-reason field, so a Gemini answer truncated by the model's own internal limit or by safety filtering behaves the same way. Independently, a mid-stream `error` event correctly stops delivery and shows the error banner, but leaves the partial message's own `state` field stuck at `"streaming"` (never advanced to `"interrupted"`) until a reload's normalisation step fixes it — so the per-message "Response interrupted." notice does not appear even though the request has genuinely failed.

**Required correction — status of each:**
1. ✅ **Done.** `ProviderChunk` (`src/server/providers/types.ts`) is the explicit contract: each adapter yields `{type:"delta",...}` chunks then a final `{type:"outcome",outcome,reason?}` with `outcome` one of `"complete"|"truncated"|"unknown"`. The route forwards it as the `done` event's `outcome`/`reason`; the client's `settleRun()` maps it to one of `complete`/`interrupted` (with `outcome` `truncated`/`unknown`/`failed`/`stopped`)/`emptyReply`/`fail`/`noop`. Not collapsed into a single `done` at any layer.
2. ✅ **Done.** `openai.ts` yields `{type:"outcome",outcome:"truncated",reason:incompleteReason(response)}` on `response.incomplete`, with a specific, non-vendor-vocabulary reason (`"reached the length limit"` for `max_output_tokens`, `"stopped by content filtering"` for `content_filter`).
3. ✅ **Done.** `gemini.ts` imports the real `FinishReason` enum and checks `chunk.candidates?.[0]?.finishReason` on every streamed chunk via `classifyFinish()`; `STOP` is the only value treated as `"complete"`, every other defined value maps to a specific `"truncated"` reason, and an unrecognised/future value is truncated with no invented reason.
4. ✅ **Done.** A bare EOF with no terminal event (OpenAI SSE closing early, or the Gemini generator ending with no chunk ever carrying a finish reason) yields `outcome:"unknown"`, never `"complete"`.
5. ✅ **Done.** `applySettlement()` in `use-conversations.ts` patches the message's `state`/`outcome`/`outcomeReason` immediately on any of the three `run()` exit paths (loop end, mid-stream error, abort) — not deferred to the next reload — so both the on-screen notice and the very next throttled `localStorage` save are correct without requiring normalisation.
6. ✅ **Done.** Already-received text is never discarded or replaced in any outcome; only the trailing status notice changes.

**Acceptance criteria — status of each:**
- ✅ Fixture: OpenAI stream ends with `response.completed` → message ends `complete`, no notice. (`tests/openai.test.ts`, `tests/route.test.ts`, real-browser scenario 1.)
- ✅ Fixture: OpenAI stream ends with `response.incomplete` after partial text → message ends `interrupted` with `outcome:"truncated"` and a specific reason, not `complete`; the received text is intact; Copy returns exactly that text. (`tests/openai.test.ts`, `tests/route.test.ts`, real-browser scenario 2.)
- ✅ Fixture: OpenAI SSE stream simply closes (EOF) after one or more `delta` events with no `response.completed`/`response.incomplete`/`error` event at all → message does **not** silently become `complete`; settles `interrupted` with `outcome:"unknown"`. (`tests/openai.test.ts`, `tests/use-conversations.test.ts`, real-browser scenario 3.)
- ✅ Fixture: Gemini stream fixture whose SDK response reports a `MAX_TOKENS` (or equivalent) finish reason → same distinct truncated treatment as the OpenAI case. (`tests/gemini.test.ts`, all `FinishReason` values covered individually.)
- ✅ Fixture: a mid-stream `error` NDJSON event arrives after partial text → the message's `state` becomes `interrupted` **immediately**, the "Response stopped after an error." notice renders without requiring a reload, and the error banner still shows (ties into F5, still open — the banner's *provider name* can still be wrong after a manual switch, unchanged by this fix). (`tests/use-conversations.test.ts`, real-browser scenario 4, including the regression found and fixed during that check — see `docs/final-inventory.md` §4.)
- ✅ Fixture: an explicit user Stop still behaves exactly as it does today — byte-identical "Response interrupted." wording (no regression). (`tests/use-conversations.test.ts`, real-browser scenario 5.)
- ✅ All of the above re-checked after a reload: outcome and reason both survive `storage.ts`'s persist/restore round trip and a real page reload. (`tests/storage.test.ts`, real-browser scenario 6.)

### Milestone 3 — Input and conversation-length limits (F3) — ✅ DONE

**Status: fixed and verified.** All three required corrections below are implemented; every acceptance criterion below is met, evidenced by 16 new tests against the real modules plus a real-browser confirmation. See `docs/requirements-audit.md` §C2 item 1 and R15 for the full evidence trail. What follows is kept as the original plan, for the record.

**Root cause.** `MessageComposer.tsx` has no length guard on the textarea. `use-conversations.ts`'s `send()` appends the draft to conversation history *before* the server's per-message (16,000 char) or per-conversation (50 message) limits are checked. A message the server rejects as `BAD_REQUEST` stays in history (only an *empty* assistant placeholder is ever removed by the failure handler), so every subsequent send — including a brand-new, short, unrelated message — fails identically, with generic "Try rephrasing it" copy that gives no route back to a working conversation.

**Required correction — status of each:**
1. ✅ **Done.** `validateDraft()` (new `src/lib/limits.ts`, exporting `MAX_CHARS`/`MAX_MESSAGES`) is imported by both `MessageComposer.tsx` and `use-conversations.ts`'s `send()` — one shared source of truth, not two numbers kept in sync by hand. `send()` calls it before the draft ever becomes a `ChatMessage`; on rejection it returns the rejection instead of appending anything.
2. ✅ **Done.** A rejected draft's specific reason (`draftRejectionMessage()`) is shown inline in the composer, with the draft left exactly as typed; at the conversation cap, a "Start new conversation" control is offered alongside the notice. As a defensive fallback beyond the plan's own ask, `run()`'s `fail()` now also strips a just-added user message from history on a `BAD_REQUEST` with no text received, so even an unanticipated path back into this failure mode cannot repeat itself on the next send.
3. ✅ **Done, decided as (revised by Finding U1 — see the addendum at the end of this document):** the first version of this decision had `toWire()` cap an oversized stored message at `MAX_CHARS` for the wire payload only, appending a visible `[…truncated for length…]` marker. An independent follow-up review found this let a fact near the end of such a message quietly never reach the provider, with no indication anywhere in the UI. Superseded: `toWire()` is a pure passthrough again, and `validateDraft()`/`hasOversizedMessage()` now refuse to send at all — the same "no partial fix, only a clean stop with a path to a new conversation" treatment the message-count cap already got — whenever history contains a message over `MAX_CHARS`.

**Acceptance criteria — status of each:**
- ✅ Attempt to send a message over the character limit: refused client-side with a specific, correct message before any request is made, and the draft remains in the composer for editing. (`tests/limits.test.ts`, real-browser scenario F3.1–F3.3.)
- ✅ After such a refusal, a short, unrelated follow-up message sends and succeeds normally. (Real-browser scenario F3.4.)
- ✅ Reaching the 50-message conversation cap surfaces the actual limit and offers a working path to continue. (`tests/limits.test.ts`, real-browser scenario F3.5–F3.7.)
- ✅ The existing "context survives three earlier messages" test/acceptance check (R11) continues to pass unmodified — `tests/openai.test.ts`'s history-mapping test is untouched by this fix.

### Milestone 4 — Normalized validation and error contract (F4) — ✅ DONE

**Status: fixed and verified.** All four required corrections below are implemented; every acceptance criterion below is met, evidenced by 6 new route-level tests against the real handler. See `docs/requirements-audit.md` R15's F4 write-up for the full evidence trail. What follows is kept as the original plan, for the record.

**Root cause.** `POST /api/chat`'s handler casts `request.json()`'s result to a TypeScript type without a runtime object check, and dereferences message fields without null checks; the provider registry is a plain object literal indexed by a user-controlled string without an own-property guard. Confirmed by deterministic language semantics: a JSON body of `null`, a `messages` array containing `null`, or a provider id of `"constructor"`/`"__proto__"` each throw an unhandled exception rather than returning the app's own normalized `{code, detail, info}` JSON error shape.

**Required correction — status of each:**
1. ✅ **Done.** `isPlainRecord()` validates the parsed body is a non-null, non-array object before any field is touched.
2. ✅ **Done.** `isValidWireMessage()` validates each message entry the same way, plus an allowed `role` and a non-empty string `content` within `MAX_CHARS`, before it is dereferenced.
3. ✅ **Done, as a `Map`.** `registry.ts`'s `REGISTRY` is now a `Map<ProviderId, ChatProvider>`; `.get()` is never subject to prototype-chain lookups, so `"__proto__"`/`"constructor"` simply miss like any other unregistered id.
4. ✅ **Done.** Every invalid-input case returns a deliberate, normalized response through the existing `errorResponse()` helper — confirmed by test, not just by inspection.

**Acceptance criteria — status of each:**
- ✅ POST a JSON body of `null` (and, beyond the plan's own list: an array, a string, a number, a boolean) → normalized `BAD_REQUEST`, not an unhandled exception. (`tests/route.test.ts`.)
- ✅ POST `{provider:"gpt", messages:[null]}` → normalized `BAD_REQUEST`, zero adapter calls made. (`tests/route.test.ts`, plus wrong-role/blank-content/non-string-content variants.)
- ✅ POST `{provider:"constructor"}` and `{provider:"__proto__"}` (and, beyond the plan's own list: `"toString"`, `"hasOwnProperty"`, and non-string provider values) → normalized `PROVIDER_DISABLED`, zero adapter calls made. (`tests/route.test.ts`.)
- ✅ Every existing valid-request test continues to pass unmodified — all pre-existing `tests/route.test.ts`/`tests/openai.test.ts` tests pass with no changes to their own assertions.

### Milestone 5 — Correct provider attribution after switching (F5) — ✅ DONE

**Status: fixed and verified.** Both required corrections below are implemented; every acceptance criterion below is met, evidenced by a real-browser confirmation (this finding has no pure decision function to unit-test — see `docs/requirements-audit.md` §C2 item 12 for why). What follows is kept as the original plan, for the record.

**Root cause.** `failedProviderRef` in `use-conversations.ts` correctly targets Retry at the provider a failed turn actually used — that mechanism is not broken and needs no change. But that value is never exposed in the hook's returned object, so `ErrorRow` and `TypingIndicator` (in `MessageList.tsx`) both fall back to the *currently selected* provider (`active.providerId`), which the user is free to change after any failure, since nothing locks the selector once `status` leaves `"streaming"`. Separately, `SetupState` in `MessageList.tsx` is entirely hardcoded to say "Gemini is not configured" / `GEMINI_API_KEY=your-key-here`, regardless of which provider is actually unconfigured and regardless of which provider is currently selected.

**Required correction — status of each:**
1. ✅ **Done.** `useConversations()` now exposes `requestProviderId`, set at the start of every `run()` alongside the existing `failedProviderRef` Retry already pinned to, and read by `ErrorRow`/`TypingIndicator` in `MessageList.tsx` instead of `active.providerId`.
2. ✅ **Done.** `SetupState` is parameterized on the selected `provider` prop, reusing `providerKeyName()`/`getProviderMeta()` — the exact pattern `errorCopy()` already used — rather than a second hardcoded string.
3. ✅ **Done, unchanged.** Retry's destination-pinning (`failedProviderRef.current ?? conv.providerId`) was not touched.

**Acceptance criteria — status of each:**
- ✅ Fail a turn on Gemini, switch the selector to GPT without retrying: the banner still reads "Gemini rejected that API key," and Retry still sends to Gemini (confirmed from the mock's own recorded request body, `provider: "gemini"`) — with the typing indicator during that retry also still naming Gemini. (Real-browser scenario F5.1–F5.4.)
- ✅ Both single-configured-key setup-screen scenarios: selecting the configured GPT chip with only `OPENAI_API_KEY` set clears the (Gemini-default) setup screen entirely; a conversation whose active provider is GPT (the realistic way an unconfigured provider becomes "selected" — restored state, since the chip UI itself never allows choosing an unconfigured provider) with only `GEMINI_API_KEY` set shows the setup screen correctly naming GPT and `OPENAI_API_KEY`, not Gemini. (Real-browser scenario F5.5–F5.7.)
- ✅ The typing indicator during an in-flight request names the provider that request actually targets — proven for exactly the case that matters (Retry after a selector change), since the selector is locked during an ordinary in-flight request. (Real-browser scenario F5.3.)

### Milestone 6 — Code-block reveal behavior (F6) — ✅ DONE

**Status: fixed and verified.** The required correction below is implemented; every acceptance criterion below is met, evidenced by 5 new tests against the real `reveal.ts` module plus a real-browser confirmation. See `docs/requirements-audit.md` §C2 item 4 for the full evidence trail. What follows is kept as the original plan, for the record.

**Root cause.** In `reveal.ts`'s `nextBoundary()`, for a fenced code line longer than the pacing budget (3–4 words per tick), the word-boundary walk lands mid-line. The subsequent "snap back to a line start" correction (intended, per its own comment, to make code arrive a full line at a time) searches backward for the nearest newline — which, when the walk never got past the *current* line, is the same position the reveal already started this tick from. The result is a boundary equal to `from`: zero progress. `use-reveal.ts`'s `step()` treats "no progress" while still streaming as "wait for more text," and reschedules — but more text arriving later doesn't help, because the *same* line is still too long relative to the word budget, so this repeats indefinitely until the entire stream ends (`complete` becomes true), not merely until the rest of that one code line has arrived.

**Required correction, implemented exactly as planned:** for a fenced code block, when the word-budget walk cannot reach a newline within the current buffered text, `nextBoundary()` now searches *forward* (not only backward) for the next available complete line boundary and reveals through it in one step if one exists in the already-buffered content, regardless of word count. It waits (reschedules without progress) only when the current line genuinely has not finished arriving yet. The approved prose pacing (3 words / 350ms baseline, the 4-word backlog relief, the 900ms fade) is untouched — the fix is local to the fenced-code branch only, exactly as planned.

**Acceptance criteria — status of each:**
- ✅ A single fenced code line with more than 4 space-separated tokens, fully present in the buffered content while `streaming` is still `true`, becomes visible in one step on the very next scheduled tick after it becomes available. (`tests/reveal.test.ts`, real-browser scenario F6.1.)
- ✅ Subsequent code lines continue to arrive in order, each intact, with no dropped or reordered characters. (`tests/reveal.test.ts`.)
- ✅ A code line that has only partially arrived (no trailing newline yet) is correctly withheld until it completes. (`tests/reveal.test.ts`.)
- ✅ Copy still returns the full, exact, canonical received text regardless of reveal progress — unaffected by this fix, since Copy always reads `message.content`, never the reveal state.
- ✅ The existing prose-reveal tests in `tests/reveal.test.ts` continue to pass unmodified (all 21 pre-existing tests pass, byte-identical assertions), and the approved prose timings are unchanged (no edit touched `pace()`).

### Milestone 7 — SSE parsing and accessibility cleanup (F7, F8) — ✅ DONE

**Status: fixed and verified.** Both required corrections below are implemented; every acceptance criterion below is met. See `docs/requirements-audit.md` §C2 items 5–6 for the full evidence trail. What follows is kept as the original plan, for the record.

Grouped together as small, low-severity, independent fixes suitable for one pass:

- ✅ **F7, done.** `parseSse()` in `openai.ts` was rewritten around `splitLines()`, a proper LF/CR/CRLF line splitter that correctly defers (and later resolves) a chunk-boundary-split delimiter, and every `data:` line within one event is now joined with `"\n"` into a single payload before `JSON.parse`, per the SSE specification. Comment lines (`:`) and other named fields (`event:`, `id:`, `retry:`) are explicitly recognised and ignored.
- ✅ **F8, done.** The switch-confirmation dialog in `ChatHeader.tsx` now traps Tab/Shift+Tab between its own two controls, restores focus to the chip that opened it on Cancel/Escape/Confirm, and uses a full-viewport backdrop (rendered behind the dialog in z-order, above everything else) in place of `inert`, which the plan itself allowed as "an equivalent focus trap" — this also fixed a related, previously-undocumented defect found while implementing it: the old pointerdown-closes-the-dialog listener let the same click that dismissed the dialog also reach whatever background control was under the pointer. The dialog's visible design is unchanged.

**Acceptance criteria — status of each:**
- ✅ A CRLF-delimited SSE fixture and a fixture with the delimiter split across two chunk reads both yield the correct parsed events. (`tests/openai.test.ts`, +5, including a bare-CR fixture and a multi-line `data:`-combination fixture beyond the plan's own two.)
- ✅ Existing LF-delimited fixtures continue to pass unmodified (all pre-existing `tests/openai.test.ts` SSE tests pass, byte-identical assertions).
- ✅ With the dialog open, repeated Tab presses never move focus to a provider chip or any other control behind the dialog; Escape and outside-click continue to work exactly as today. (Real-browser scenario F8.1–F8.6, both viewports: focus trap, backdrop shadowing confirmed via `elementFromPoint`, Escape + focus restoration.)

### Milestone 8 — Update reports and inventories

Once Milestones 1–7 are implemented and tested:

1. ✅ **Done.** Re-run the full test suite, lint and build; capture actual pass/fail counts. Final: **188/188 tests, lint clean, build clean** (188 after the U1–U6 follow-up correction, addendum below; 180 at the close of this pass originally — see `docs/final-inventory.md` §4 for the full breakdown).
2. ✅ **Done.** `docs/requirements-audit.md` and `docs/final-inventory.md` updated to reflect the fixed state — every `[CORRECTED]` marker from the F1/F2 pass resolved into a plain "Complete"/"Fixed" status now that F3–F8 are also demonstrably fixed against their own acceptance criteria.
3. ✅ **Done.** All new regression tests (33 across `tests/limits.test.ts` (new), `tests/chat.test.ts`, `tests/route.test.ts`, `tests/reveal.test.ts`, `tests/openai.test.ts`, `tests/gemini.test.ts`) are in the permanent, committed suite — none left in a scratchpad. The real-browser harness (`tests/browser/`) is likewise committed, not scratchpad-only (Finding F9).
4. ✅ **Done, via the current audit rather than a new addendum file.** `docs/model-switcher-codex-review.md` itself is untouched — the original independent review's own text is preserved exactly as written. Resolution status for every one of its nine findings is recorded in `docs/requirements-audit.md` §C2 (each struck through with a "Fixed" note and a pointer to the relevant R-row's evidence), which already served as that review's companion document before this pass.
5. **Deliberately not done in this pass**, per this task's own explicit instruction ("do not commit, push, publish... or prepare the final submission ZIP yet"): rebuilding the submission ZIP and recording its hash in `docs/submission-checklist.md`. `git status` at the end of this pass is reported in the final report instead; nothing has been committed.

---

## 4. Number of implementation milestones remaining

**None.** All seven implementation milestones (1–7) are now done, plus the documentation/packaging milestone (8) above, except its final ZIP-rebuild step (deliberately deferred, not part of this pass's scope — see item 5 above). Key rotation is not tracked here as a remaining step: the owner has since decided to keep the current keys rather than rotate them (see §11's second-pass addendum).

Milestones 3–7 were independent of one another and were implemented in one continuous pass rather than being parallelised or reordered, since nothing about the finding set actually required sequencing them.

---

## 5. Required tests and documentation updates

**New tests to add to the committed suite** (not just ad hoc fixtures), one file per milestone is a reasonable split:

- ~~Milestone 1~~: ✅ done — `tests/storage.test.ts` (+7) and new `tests/use-conversations.test.ts` (+8), driving the real modules through corrupt, future-version, and quota-blocked-with-valid-existing-data scenarios, plus a real-browser confirmation. See Milestone 1 above for the exact scope of what is and isn't covered (no React-tree mount).
- ~~Milestone 2~~: ✅ done — `tests/openai.test.ts` (+6), new `tests/gemini.test.ts` (9, adapter-mock against the real SDK's network boundary), new `tests/route.test.ts` (8, against the real route handlers), `tests/use-conversations.test.ts` (+12, against the real `settleRun()`), new `tests/chat.test.ts` (9, against `noticeForOutcome()`), `tests/storage.test.ts` (+3), plus a real-browser confirmation (9/9). This closed T2 and T3 below as a side effect. See Milestone 2 above for the exact scope of what is and isn't covered.
- ~~Milestone 3~~: ✅ done — new `tests/limits.test.ts` (18 tests, +6 since Finding U1, against the real `validateDraft()`/`hasOversizedMessage()`) and `tests/chat.test.ts` (13 tests, rewritten for U1 to assert `toWire()` never shortens anything), plus a real-browser confirmation of the oversized-draft refusal, the conversation-cap notice/control, and (Finding U1) the oversized-history-message block.
- ~~Milestone 4~~: ✅ done — `tests/route.test.ts` (+6), posting `null`, an array/primitive body, `{messages:[null]}`, wrong-role/blank/non-string content, and inherited-property provider ids, asserting normalized error responses and zero adapter invocations in every case.
- ~~Milestone 5~~: ✅ done, via a real-browser confirmation rather than a unit test — provider attribution is a matter of which prop a component reads, not a pure decision function with its own inputs/outputs to assert on in isolation. `tests/browser/verify.mjs` asserts the exposed request provider survives a provider-selector change (banner + typing indicator + Retry's actual request all agree), and both single-configured-key scenarios show the correct provider/key name.
- ~~Milestone 6~~: ✅ done — `tests/reveal.test.ts` (+5), including a long single-line fenced-code fixture proving one-step reveal while still streaming, plus a real-browser confirmation.
- ~~Milestone 7~~: ✅ done — `tests/openai.test.ts` (+5, CRLF/bare-CR/split-boundary/multi-line-combine/comment fixtures for F7); F8's keyboard-focus test required a browser-level check, since no DOM testing library was added (an unrelated dependency change, out of this pass's scope) — done via `tests/browser/verify.mjs` instead, both viewports.

**Closed this pass: the one remaining test-coverage gap already present before this revision** (T1 in §1 — T2 and T3 were closed by the Milestone 2 fix above):
- ✅ Renamed the three "adapters …" tests in `tests/provider.test.ts` that actually exercise the local `mockProvider` fixture to "the ChatProvider contract: a fixture adapter …", with a header comment explaining the distinction from real-adapter coverage.

**Documentation updates**, beyond the milestone-8 refresh above:
- ✅ `README.md`: corrected "7 backgrounds" to "8" in the architecture tree (a factual count error found this pass, unrelated to any of F1–F8), and tightened "mobile is deferred" to "mobile is out of scope for this submission" to match the owner's actual current instruction rather than implying future work is planned.
- ✅ New `tests/browser/README.md`: documents the committed real-browser harness (Finding F9), what it covers, and how to run it.

---

## 6. Final desktop verification steps

Performed after Milestones 1–7 were implemented and their own tests passed; mocked/offline fixtures throughout, on a disposable browser profile (fresh temp `--user-data-dir` per launch, discarded on close) so the owner's real saved conversations were never touched, at both **1366×768** and **1680×1050** — **26/26 checks passed at each size, 52/52 total.**

1. ✅ Persistence: seeded corrupt storage, confirmed no data loss in the real browser (not just the fixture) at both sizes — the F1/F2 regression spot-check in `tests/browser/verify.mjs`. (The quota-blocked-with-valid-data case was exhaustively covered in the F1 milestone's own real-browser pass and was not re-run here, since F3–F9 touch none of that code path.)
2. ✅ Streams: the F2 regression spot-check confirms a truncated answer still renders its specific, honest notice with full Copy-able text; F1/F2's own milestone already covered the full truncated/`MAX_TOKENS`/bare-EOF/mid-stream-error matrix and was not re-run exhaustively here.
3. ✅ Input limits: attempted an oversized send, confirmed refusal and recovery; seeded a conversation at the 50-message cap, confirmed the real limit is shown with a working path forward. (F3.1–F3.7.)
4. ✅ Malformed-request resilience: not directly exercisable from the UI (these are server-contract fixes), verified via the route-level tests from Milestone 4 instead — as planned.
5. ✅ Provider attribution: failed on Gemini, switched selector, confirmed banner/typing-indicator/Retry destination all still agree on Gemini; tested both single-configured-key setup-screen scenarios. (F5.1–F5.7.)
6. ✅ Code reveal: a mocked answer containing one long fenced code line, confirmed it appears promptly rather than stalling, screenshotted mid-stream. (F6.1.)
7. ✅ F8, added to this checklist beyond its original scope: the switch dialog's Tab/Shift+Tab trap, Escape, focus restoration, and backdrop click-shadowing, all confirmed. (F8.1–F8.6.)
8. Regression check of everything the two prior audits already verified and this plan does not touch: the F1/F2 milestone's own real-browser pass already exhaustively covered approved glass/background combinations, user entrance motion, gold orbit, prose reveal pacing, Stop, Retry, rename/delete, welcome state and model-name readout at both sizes; **not re-run exhaustively in this pass**, since nothing in F3–F9 touches backgrounds, glass materials, entrance motion or prose pacing (F6's fix is explicitly scoped to the fenced-code branch only, proven not to touch `pace()` by the unmodified prose tests). A lighter spot-check (the optical glass panel and the gold orbit both render on a fresh message) was re-confirmed as part of the regression block instead — a proportionate check, not a claim of having re-audited all 8×2 background/glass combinations again.
9. ✅ `npm run lint`, `npm test` (180/180), `npm run build` all clean.

---

## 7. ZIP and GitHub preparation steps

1. Confirm `git status` is clean on the fix commit(s) (or on a single squashed commit, per the owner's preference) with no unintended changes.
2. Re-run the full secret scan (tracked files, full git history, built client bundle) exactly as performed for `model-switcher-review.zip`, and confirm zero findings again.
3. Rebuild the archive with `git archive --format=zip -9 -o model-switcher-review.zip HEAD` from the new commit; verify the archive's file list matches `git ls-tree -r --name-only HEAD` exactly (no more, no less).
4. Confirm the archive excludes: `.env.local` and any other real environment file, `node_modules`, `.next`, `.git`, logs, browser profiles, personal chat data, and every temporary scratchpad artefact created during review (this plan's own fixture scripts included — none belong in the deliverable).
5. Record the new archive's size and SHA-256 in `docs/submission-checklist.md`.
6. ~~Only after the above, and only if the owner has separately rotated both API keys: create the GitHub remote, push, and re-run the secret scan.~~ **Settled: not applicable.** The owner has confirmed final delivery is a ZIP, sent directly — no GitHub remote is to be created and nothing is to be pushed. Kept here for history.

---

## 8. Mobile is out of scope for this submission

This is an explicit owner decision, not something the PDF requested or deferred — the PDF (both pages, read in full for this pass) **never mentions mobile, responsive layout, or any device other than the implicit desktop browser the whole brief is written for.** No milestone in this plan touches layout below the existing `md` breakpoint, and none should.

## 9. GitHub, ZIP and email are our delivery choices, not explicit PDF requirements

Quoting the PDF's only reference to any delivery channel, p.2 §6 Step 3: *"Never put your API keys in your code. Use a `.env` file. **If we see a key on GitHub, it's a security breach!**"* — this is a security warning conditioned on a repository existing, not an instruction to create one. The PDF contains **no** mention of ZIP, email, a deadline, or public deployment anywhere on either page. GitHub plus a ZIP is the owner's own chosen delivery method for this project, and nothing in this plan should be read as the PDF mandating it.

---

## 10. Summary table

| Milestone | Finding(s) | Severity | Touches saved user data | Touches approved visuals | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | F1 | High | **Yes — fixed the data loss** | No | ✅ **Done** |
| 2 | F2 | Medium | No | No | ✅ **Done** |
| 3 | F3 | Medium | No | No | ✅ **Done** |
| 4 | F4 | Medium | No | No | ✅ **Done** |
| 5 | F5 | Medium | No | No | ✅ **Done** |
| 6 | F6 | Medium | No | No (reveal *logic* only, not approved timings) | ✅ **Done** |
| 7 | F7, F8 | Low | No | No | ✅ **Done** |
| 8 | Documentation | — | No | No | ✅ **Done, except the ZIP rebuild step (deliberately deferred, out of this pass's scope)** |

**All seven implementation milestones are done.** 188/188 tests pass, `npm run lint` is clean, `npm run build` is clean. Key rotation and the GitHub-push option in §7 above are both settled, not remaining work — see §11's second-pass addendum and `docs/requirements-audit.md` §C for the current state of each.

---

## 11. Addendum: U1–U6, found by an independent follow-up review of this pass's own archive

After this document's own milestones were all marked done and packaged as `model-switcher-review-updated.zip`, an independent follow-up review of that exact archive found six further real, confirmed defects (**U1–U6**) — five introduced or left by this pass's own fixes, one a packaging defect — plus one inaccurate claim in `docs/requirements-audit.md`/`docs/final-inventory.md`'s own text. **All six are now fixed.**

| ID | Title | Severity | Root cause | Fix |
| --- | --- | --- | --- | --- |
| ~~U1~~ | ~~Oversized historical message silently shortened on the wire~~ — **Fixed** | Medium | Milestone 3's own fix had `toWire()` cap such a message for the wire only, so a fact near its end could quietly never reach the provider, with no UI indication. | `toWire()` is a pure passthrough again; `validateDraft()`/`hasOversizedMessage()` (`src/lib/limits.ts`) refuse to send at all, honestly, whenever history contains a message over `MAX_CHARS`. |
| ~~U2~~ | ~~BAD_REQUEST deleted the user's question; Retry resent the wrong one~~ — **Fixed** | Medium | Milestone 3's defensive safety net (`use-conversations.ts`'s `fail()`) deleted the just-sent user message on a BAD_REQUEST with no text received — discarding it entirely, and leaving `retry()` resend the *previous* successful question instead. | The deletion is removed; a failed send stays in history like any other failure, so Retry (which resends the *last* user message) correctly targets it. |
| ~~U3~~ | ~~Browser harness's "fail-closed" claim was inaccurate~~ — **Fixed** | Medium | `tests/browser/cdp.mjs` blocked provider domains at the browser's network layer, but this app's browser side never talks to a provider directly — it POSTs to its own same-origin `/api/chat`, which the Next.js server then relays. Blocking provider domains does nothing to stop that server-side hop if the JS mock failed. | Every request matching `/api/chat*` is now intercepted and failed at the CDP `Fetch` layer, outside the page's JS entirely — proven by a new dedicated negative test, `tests/browser/verify-network-isolation.mjs`. |
| ~~U4~~ | ~~Fenced code could still be cut mid-line once the stream completed~~ — **Fixed** | Medium | Milestone 6's own fix gated its line-boundary logic on `!complete`, so once the provider's stream fully finished but the reveal was still draining a backlog, the plain word-budget walk could cut a code line mid-line again. | The `!complete` gate is removed; the line-boundary logic now runs either way, with only its final fallback (no newline left at all) needing to tell "wait" apart from "release the rest, nothing more is coming." |
| ~~U5~~ | ~~Reverse-focus test never actually sent Shift; backdrop did not reach the sidebar~~ — **Fixed** | Low | (a) `Input.dispatchKeyEvent` has no `shiftKey` field (modifiers are a bit field); the harness's `pressKey()` sent one anyway, so it was silently ignored, and the old test happened to pass by coincidence (two focusable elements, forward and reverse land on the same one). (b) Milestone 7's backdrop was rendered inside the chat panel's own `backdrop-filter` element, which CSS makes a containing block for `position:fixed` — the backdrop never actually reached the sidebar, a sibling panel. | (a) `pressKey()` now sends the correct `modifiers` bit field; the F8.3 check now captures and asserts the real `shiftKey:true` event and the trap's own `preventDefault()`. (b) The backdrop is portaled (`createPortal`) into `<main>`, the lowest common ancestor of both glass panels, which sets neither `backdrop-filter` nor `transform`. |
| ~~U6~~ | ~~Packaged ZIP used Windows backslash paths, breaking cross-platform extraction~~ — **Fixed** | Low (packaging) | The archive was built with PowerShell's `Compress-Archive`, which writes backslash-separated entry names — a real ZIP-format violation. | Rebuilt with Python's stdlib `zipfile`, which always writes forward-slash `arcname`s; verified after building that no entry name contains a backslash and the entry list matches the intended manifest exactly. |

**Evidence:** 8 new regression tests (`tests/limits.test.ts` +6, `tests/reveal.test.ts` +2; `tests/chat.test.ts` rewritten in place to assert the opposite of its original claims, same count) — 188/188 total. A real-browser confirmation, 40/40 at each of 1366×768 and 1680×1050 (up from 26/26, with new U1/U2/U3 checks and a strengthened F8.3/F8.4b), plus the dedicated 4/4 negative test for U3. `npm run lint` caught one genuine issue during the fix itself (a raw `.current` read during render in the first version of U5's portal plumbing — `react-hooks/refs`), fixed by lifting the DOM node into `WorkspaceLayout` state via a ref callback instead of a `useRef`. Full detail: `docs/requirements-audit.md` §C2 item 14, `docs/final-inventory.md`'s own U1–U6 revision note.

None of U1–U6 required touching the approved visual design, glass materials, backgrounds, entrance motion, prose reveal pacing or gold-orbit effect. No application behaviour beyond the six fixes themselves changed; no keys, models, or configuration were touched; zero live provider requests were made producing this addendum.

### 11b. Second-pass addendum: U5's dialog was still not genuinely clickable, and stale documentation reconciled

A second independent verification pass (`model-switcher-final-verification.md`) re-derived U1–U6 from source — all six held up — and flagged one further real defect: U5's fix (above) portaled the *backdrop* to `<main>`, correctly fixing sidebar coverage, but left the *dialog itself* nested inside `section.optical-glass`'s own stacking context. A stacking context is painted as one unit at its parent's level, so the dialog's `z-50` never actually competed against the backdrop's `z-40` sibling directly — it only ever competed against elements *inside* that same section. A real dispatched pointer click (CDP `Input.dispatchMouseEvent`, not a synthetic DOM `.click()`, which bypasses hit-testing and cannot detect this) confirmed the consequence: clicking "Switch model" silently closed the dialog without switching providers, the backdrop's own click handler firing instead of the button's.

**Fixed:** the dialog is now portaled alongside the backdrop, as a true DOM sibling under `<main>`, so their `z-40`/`z-50` compare directly in one stacking order. Its position (previously plain CSS `top-[42px] right-0`, resolved against its old DOM parent) is measured from its anchor element via `getBoundingClientRect()`, recomputed on open and on window resize.

**Evidence:** `tests/browser/verify.mjs` U5b.1–U5b.5, both viewports (46/46 total, up from 40/40): `elementFromPoint()` over each button resolves to the button itself; a real pointer click on "Switch model" closes the dialog and performs exactly the one requested switch; a real pointer click on "Cancel" closes it without switching; a real pointer click outside the dialog dismisses it without activating the sidebar control underneath; Tab/Shift+Tab/Escape/focus-restoration re-confirmed unaffected by the DOM restructuring. A new dedicated file, `tests/browser/verify-dialog-hit-testing.mjs`, repeats the same sequence across both approved glass modes explicitly (16/16, 8 per mode) — the first pass's F8 checks never varied glass mode. One genuine issue surfaced during the fix itself: an early version skipped rendering the dialog for one frame while its measured position was still pending, which left `confirmRef` unattached when the sibling focus effect ran and silently broke initial-focus behaviour (focus landed on `<body>`); fixed by always rendering with a safe fallback position instead.

**Documentation reconciled this same pass**, per the owner's settled decisions rather than new findings: key rotation is no longer tracked as an operational blocker (owner has decided to keep the current keys, verified excluded from every deliverable by the secret scan); the model substitution and normalization-shape items are marked accepted rather than pending the owner's blessing; the GitHub-push option in §7 is marked not applicable — final delivery is a ZIP. See `docs/requirements-audit.md` and `docs/final-inventory.md`'s own revision notes for the corresponding corrections.
