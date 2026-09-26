# Interaction refinement — implementation record

**Starting commit:** `57f8116fbeb91f7d571c21423a3e0fdb8aea9e4f` (branch `main`).
**Working tree at start:** 48 changed/new paths — every previous pass's
uncommitted work (responsive layout, the two provider-picker relocations,
the ChatGPT-style restyle). None of it was reset, discarded, or committed
as part of this task; see git status for the exact list.

This document is written incrementally as each stage completes, following
the same "record as you go" convention as `docs/responsive-ui-refinement.md`.
The full architecture rationale lives in the approved plan
(`modular-tinkering-toucan`); this file tracks what was actually built,
what was verified, and any limitation found along the way.

## Stages

- [x] Stage 1 — Composer, New chat, Sidebar
- [x] Stage 2 — Search saved conversations
- [x] Stage 3 — Message actions (Copy, Retry, Regenerate, Read aloud, Edit/resend)
- [x] Stage 4 — Real attachments
- [x] Stage 5 — Responsiveness and regression verification

Each section below is filled in as its stage completes.

---

## Stage 1 — Composer, New chat, Sidebar

- **Provider picker** (`MessageComposer.tsx`, `ProviderMenu.tsx`) moved to
  the right of the composer toolbar, grouped with Send/Stop behind a real
  `gap-3` (~12px) so a mis-tap can't land on both. The trigger's wrapper
  width constraint changed from a percentage (`max-w-[68%]`, which only
  made sense as the row's sole flex item) to a fixed `max-w-[130px]` — no
  behavior change, just removes a latent circular-sizing footgun now that
  the trigger shares its row with Send/Stop.
- **New chat**: per an explicit mid-task correction, this lives in the
  sidebar (its existing button, above the list, relabelled from "New
  conversation" to "New chat"), not duplicated in the header. It reuses
  the existing `newConversation()`
  action unchanged — its own "reuse an empty draft" and
  `abortActiveRun()`-first behavior already satisfy "no duplicate empty
  conversations" and "stop the previous conversation's generation" with
  zero new logic.
- **Sidebar**: reverted to closed-by-default below `lg` (1024px — mobile
  *and* narrow tablet), opened by a single header toggle button
  (`ChatHeader.tsx`) that does double duty: below `lg` it opens/closes the
  existing portaled drawer (`MobileDrawer`, unchanged internals — focus
  trap, backdrop, portal, close-on-select); at `>=lg` it collapses/expands
  the inline sidebar via a new `desktopSidebarCollapsed` boolean
  (`WorkspaceLayout.tsx`, plain `useState(false)`, no hydration-mismatch
  risk since its default agrees with the server render). The always-visible
  compact rail from the previous pass is deleted outright, not kept
  alongside.

**Bug found and fixed during this stage's own verification:** the header
toggle's aria-label briefly (confirmed: within ~600ms of hydration, never
longer, in a real browser check) shows the wrong state on a narrow
viewport, because `useMediaQuery`'s documented server-snapshot-`false`
convention was previously only ever consumed by things invisible until a
user opened them — this is the first consumer visible from first paint.
The sidebar's own actual open/closed *state* is unaffected throughout
(pure CSS, not gated on this hook); only the button's label/aria-expanded
briefly lags. Documented directly in `use-media-query.ts`'s own comment
rather than engineered around, since fixing it would mean abandoning the
pure-CSS-visibility approach for a sub-second, non-visual edge case.

**Verified:** desktop open/collapsed, phone closed-by-default + drawer
open (New chat button, Settings footer, focus on close button), 768px
tablet now correctly in drawer mode (superseding the previous pass's
"full sidebar at 768px" — confirmed via real-browser check, not assumed).

---

## Stage 2 — Search saved conversations

New pure module `src/lib/search.ts` (`searchConversations`), matching
titles and message text case-insensitively (`.toLowerCase()`, correct for
Arabic with no special-casing since Arabic has no case distinction).
Recomputed fresh on every keystroke from the live conversation list — no
cached index to go stale after a rename/delete/new message. Wired into
`SidebarBody` (`ConversationSidebar.tsx`) as an input above New chat,
replacing the grouped conversation list with a flat, snippet-highlighted
results list while a query is active; Up/Down + Enter navigate and select,
Escape clears the query first (a second Escape, or one with an empty
query, is left to bubble to the drawer's own close handler). Selecting a
message result scrolls to and briefly flashes it in `MessageList.tsx` (a
`.search-flash` CSS pulse, deliberately independent of the entrance-
animation/`fresh`/baseline system, so it can never replay a message's
original arrival) and closes the drawer on mobile.

**Real bugs found and fixed during this stage's own verification:**

1. **Duplicate DOM ids.** The full sidebar and the mobile drawer both
   render the same `SidebarBody`, and the inactive one stays mounted
   (just CSS-hidden), so a literal `id="search-results-listbox"` collided
   with the other instance's — invalid HTML, and a real
   `aria-activedescendant` correctness bug for actual assistive tech, not
   only a test-query nuisance. Fixed with `useId()` to namespace both the
   listbox id and each option id per `SidebarBody` instance.
2. A user-message flash never appeared: `data-message-id` had been placed
   on `UserMessage`'s outer alignment wrapper, while the conditional
   `search-flash` class was applied to a *different*, inner element — the
   scroll-target query and the CSS class were never actually on the same
   node. Fixed by moving both onto the same element.

**Verified:** English and Arabic queries find title and message matches
with correctly highlighted snippets; empty-results state; Escape-clears;
arrow-key navigation moves `aria-activedescendant`; selecting a result
switches conversation, flashes the right message, and clears the query;
on mobile, selecting a result closes the drawer. All real-browser, mocked
provider responses only.

---

## Stage 3 — Message actions

**A. Copy** — already correct (always-visible, `min-h-11`). One real gap
found: the code-block Copy button (`Markdown.tsx`) lacked the `min-h-11`
touch target its message-level sibling already had — added.

**B. Retry** — unchanged; confirmed still pinned to the provider a failed
turn actually targeted and still never duplicates the question.

**C. Regenerate** — the substantial new piece, built by extending `run()`
(`use-conversations.ts`) rather than forking it: an optional 4th
`regenerate` argument reuses the target message's own id, so the new
answer streams live in place of the old one (a single extra branch in the
existing delta handler, shared by both a normal send and a regeneration).
Before starting, the target's current content/state/outcome/provider is
snapshotted; `applySettlement()`/`fail()` branch on that snapshot's
presence: a genuinely complete (or truncated/unknown-but-real) answer is
committed as a new, selected entry in the message's `versions` array
(`ChatMessage.versions`/`selectedVersionId`, new optional fields,
`storage.ts`'s `isMessage()` extended the same way `outcome`/`provider`
were — no version bump); anything else (a user Stop, a mid-stream
failure, an empty reply) rolls back to the snapshot instead, so "preserve
the previous answer" covers a Stop during regeneration too, not only an
outright error. `abortActiveRun()` (the Stop-button/conversation-switch
path, which nulls its own ref before `run()`'s own catch ever observes
the abort) needed the identical rollback logic added separately — see its
own comment for why one code path was not enough. Top-level `content`/
`provider`/etc. always mirror the selected version, so `toWire()`,
`noticeForOutcome()`, and every existing display path needed zero
changes; only the new compact `< 2/2 >` selector reads `versions`
directly, and both it and the Regenerate button itself only render/are
interactive on the conversation's *latest* message — the explicit,
documented fallback for "disable changing versions once later turns
depend on it," rather than a real branching model.

**D. Read aloud** — `window.speechSynthesis`, new `src/lib/use-speech.ts`
(one "currently speaking" slot, cancels any prior utterance before
starting a new one, stops on unmount via a cleanup effect — since
`MessageList` is keyed by conversation id, a conversation switch is an
unmount) and `src/lib/speech-text.ts` (strips an answer to speakable text
by walking the same Markdown AST `Markdown.tsx` already renders from,
rather than a second regex parser; code blocks are omitted rather than
read character-by-character — a deliberate scope limit). Language
(English/Arabic) detected from the text's own Unicode range, best-effort
voice match, never blocking on one being found. **Play + Stop only, no
pause/resume** — cross-browser `speechSynthesis.pause()/resume()`
support is inconsistent in ways that are not reliably feature-detectable,
and the task's own instruction was to add it "only if supported
reliably," so the honest call was to skip it. The button itself is
feature-detected via a `useMediaQuery`-style server-snapshot-`false` hook
(`useSpeechSupported`), hidden entirely (not shown disabled) when
unsupported.

**E. Edit and resend** — `editAndResend()` (`use-conversations.ts`), a
near-literal sibling of `send()`: only offered on the conversation's
latest user turn, truncates history to *before* the edited message
(dropping it and its old reply), validates via the exact same
`validateDraft()` `send()` calls, and on success mints a fresh user
message and calls `run()` exactly as `send()` does — reusing its
validation/streaming/error/provider-switch behavior directly rather than
a parallel path. Inline editing in the transcript (the message's own
display swaps for a textarea + Save & resend/Cancel), using the
currently-selected provider (not pinned to the original answer's
provider, since editing and resending is "send a new message," not
"regenerate").

**Verified (real browser, mocked provider responses):** Regenerate
success creates version 2/2 and keeps the original provider with no
duplicate question; the version selector correctly switches back to
1/2; Regenerate failure rolls back to the original answer with the error
banner shown and no version added; Edit-and-resend replaces both the
question and its old reply with exactly one user turn; the Read Aloud
button appears and toggles to Stop when `speechSynthesis` is present.

---

## Stage 4 — Real attachments

**Research first, per the task's own instruction.** Fetched Vercel's
current documented request-body limit for a Node.js function
(`https://vercel.com/docs/functions/limitations`): **4.5 MB, fixed across
every plan (Hobby/Pro/Enterprise), not configurable** — this is the real
ceiling the deployed request path runs under, not an assumption. The
installed SDKs were read directly (not inferred from provider name) to
confirm genuine support before building anything: `@google/genai@2.23.0`'s
own `.d.ts` confirms `Part.inlineData: {mimeType, data}` for real image
and PDF vision input; `openai.ts` has **no SDK dependency at all** — it
hand-rolls `fetch` against the Responses API, whose `content` array form
(`input_text`/`input_image`/`input_file`) is the documented way to send
images/PDFs there. The shipped scope (JPEG/PNG/WebP images, PDF, plus a
small explicit text/code extension allowlist) is the intersection of what
both providers actually support.

**Derived limits** (`src/lib/limits.ts`), shown with their reasoning in a
comment there: 4.5 MB platform ceiling − 0.3 MB safety margin − 1.0 MB
reserved for conversation text ÷ base64's ~4/3 inflation ≈ 2.3 MB of real
headroom for attachment bytes. Shipped comfortably under that, not against
it: **≤3 files per message, ≤1,000,000 bytes per file, ≤2,200,000 bytes
combined (raw, pre-base64), extracted text/code capped at 6,000
characters per file.**

**Provider-neutral wire shape** — `WireAttachment` (`src/lib/chat.ts`):
`{kind:"image"|"pdf", mimeType, name, data /* base64 */}` or
`{kind:"text", mimeType, name, text /* extracted, capped */}`. Each
adapter's own message-mapping step translates it: `gemini.ts` adds an
`inlineData` Part per image/PDF (and a labelled text Part for text/code);
`openai.ts` switches a message's `content` from today's plain string to
the array form only when that message actually carries attachments — the
common no-attachment case is byte-for-byte unchanged. `ProviderCapabilities`
gained a real `attachments` field (`true` on both adapters) — genuine
infrastructure, even though the shipped scope needs no per-provider
compatibility branch in the UI, since both configured providers support it.

**Client validation and staging** (`src/lib/attachments.ts`): classifies
each file by declared MIME type, falling back to a name-extension check
for text/code (browsers frequently misreport or omit MIME type for these,
especially on Windows) — then independently verifies the *content*, never
trusting either: real magic-byte signature checks for PNG/JPEG/WebP/PDF,
and a UTF-8-decodability heuristic for text (no NUL bytes, low
replacement-character ratio). `src/server/attachments.ts` repeats every
one of these checks again, independently, server-side, against the
*decoded* bytes — never the client's claimed size or type — before a
request is ever built.

**Composer UX** (`MessageComposer.tsx`, new `AttachmentTray.tsx`): a
paperclip button on the **left** of the toolbar opens a file picker;
dropping files onto the composer capsule and pasting an image/file onto
the textarea both feed the same staging path. Each staged file becomes a
chip immediately — a real `URL.createObjectURL` thumbnail for images,
filename/size otherwise — with its own remove control; a rejected file
still gets a chip explaining why (wrong type, too large, batch over
budget) rather than vanishing silently, and Send is blocked while any
chip is in that error state. Chips are cleared together with the draft
text on a successful send and preserved together on a rejected one, same
as the text draft always has been.

**Persistence** — genuinely new infrastructure; grep confirmed zero
existing IndexedDB usage anywhere in the repo before this. New, hand-rolled
`src/lib/attachment-storage.ts` (no dependency) stores raw bytes keyed by
attachment id; `ChatMessage.attachments` (new optional field,
`storage.ts`'s `isMessage()` extended the same optional-field way as
every earlier addition — no `STORAGE_VERSION` bump) persists metadata
only (id/name/mimeType/kind/size) in the existing localStorage schema —
**never raw bytes in localStorage**, which base64 image/PDF data would
make trivial to exhaust. Retry/Regenerate/a provider switch all re-read
the same stored bytes and re-encode them into the new request every time,
through `buildWireAttachments()` — the app never claims a provider
"remembers" a file from an earlier turn. Deleting a conversation deletes
its attachments' IndexedDB entries too; removing a still-staged draft
chip does the same immediately.

**Disclosed, deliberate scope limits** (not oversights):

1. **Attachments are only resolved and sent for the newest message in a
   request's history**, never re-sent for an earlier attachment-bearing
   turn further back in the same conversation. This keeps a long
   conversation's request body bounded under Vercel's fixed 4.5 MB
   ceiling regardless of how many earlier turns had attachments — the
   alternative (resending every historical attachment on every later
   turn) would grow unboundedly and eventually fail outright.
2. **Edit-and-resend drops the edited message's attachments** rather than
   carrying them into the new message — disclosed to the user inline
   ("Its attachments will not be included in the resend.") when editing a
   message that has any, rather than silently losing them.
3. **A sent message whose attachment bytes later go missing** (storage
   pressure, manually clearing site data) shows an explicit "Unavailable
   in this browser" state with a real remove control
   (`removeAttachment()`, `use-conversations.ts`) that drops the dead
   reference from the persisted message. There is deliberately **no
   "reattach"** counterpart: the message was already sent, so there is no
   draft to add a file back into, and silently letting a *different* file
   stand in for the original attachment's identity would misrepresent
   what the model actually saw.
4. A draft with staged, `"ready"` attachments that is abandoned (never
   sent — conversation switched, tab closed) leaves those already-saved
   IndexedDB bytes orphaned rather than cleaning them up proactively; only
   an explicit remove, a send, or deleting the conversation cleans up
   attachment bytes today.
5. Uploaded code is never executed and never silently truncated beyond
   the disclosed, explicit character cap; content past the cap is simply
   not included, not cut off mid-token without saying so.

**Verified — real browser, mocked provider responses, two dedicated
scripts (13 checks, all passing):**

- Staging: a valid image gets a genuine `URL.createObjectURL` thumbnail; a
  valid text/code file stages with a file icon; an unsupported type
  (`virus.exe`) gets an explicit "Unsupported file type." chip rather than
  being silently dropped or accepted.
- Send is blocked while any chip is in an error state, and re-enabled
  immediately once that chip is removed.
- **The actual outgoing wire payload** (`window.__mock.sent`, not just
  chip presence in the DOM) carries real base64 image data and real
  extracted text content for the attachments that were staged — proving
  the adapter request structure itself, not only the UI.
- The sent user message displays its attachment chips in the transcript.
- Drag-and-drop onto the composer and pasting a file onto the textarea
  both stage correctly.
- **Persistence across a real reload**: an attachment's thumbnail is
  rebuilt from real IndexedDB bytes after a full page reload, not from
  anything held in memory.
- **Missing bytes**: deleting an attachment's IndexedDB entry directly
  (simulating storage pressure) and reloading produces the explicit
  "Unavailable in this browser" state with a working remove control;
  clicking it actually updates persisted `localStorage` (confirmed by
  re-reading it, not just the DOM) to drop the dead reference.

No real bugs were found in the implementation during this pass; one test
script itself needed a longer wait before reading `localStorage` back
(the existing `PERSIST_THROTTLE_MS = 700ms` write throttle, already
documented in `use-conversations.ts` from an earlier pass) — a test-timing
artifact, not an application defect, consistent with this project's
established practice of distinguishing the two rather than "fixing" the
app to work around a test's own race.

---

## Stage 5 — Responsiveness and regression verification

**Harness updates** (real-browser, mocked provider responses throughout;
Chrome additionally blocks provider domains and intercepts `/api/chat` at
the network layer as a fail-closed backstop — see `cdp.mjs`):

- `mock.mjs` gained `STAGE_FILE()` (stages a real `File`, with real bytes,
  through the composer's actual hidden `<input type="file">` — the same
  DOM path a real picker selection takes) and `PNG_BYTES`, so any script in
  this harness can now exercise a genuine attachment round-trip.
- `verify-responsive.mjs` was substantially rewritten. Its own previous
  version tested the second pass's now-deleted "always-visible compact
  rail below 640px" design; Stage 1 deleted that `Rail` component outright
  and replaced it with a closed-by-default drawer below `lg` (1024px) plus
  an independently collapsible full sidebar at `>=lg`. The rewritten
  `sidebarMode()` helper, every per-viewport assertion, the live-resize
  check, and the phone-landscape check were all updated to the new
  threshold and shape — including a **new, explicit assertion that 844px
  landscape phone now gets the closed-by-default drawer**, a real,
  confirmed behavior change from the previous pass (844px was previously
  above the old 640px rail threshold; it is below the new 1024px one). A
  new `checkResizeClosesStaleDrawer()` check confirms a drawer opened while
  compact does not stay stuck open once a live resize crosses back above
  the threshold underneath it (two redundant "Conversations" surfaces are
  never both visible at once). Every viewport the task requires is covered:
  360×800, 390×844, 768×1024 (now drawer, not full sidebar — the previous
  pass's own assumption at this width no longer holds), 1024×768, 1366×768,
  1680×1050, and 844×390 landscape.
- `verify.mjs` gained 11 new focused checks (`I1`–`I11`): New chat's
  duplicate-draft guard (repeated clicks grow the saved list by exactly
  one, not by the number of clicks), Regenerate (offered correctly, targets
  the *original* answer's own provider rather than the conversation's
  currently-selected one, never duplicates the question, records a real
  version on success, rolls back cleanly and records no version on
  failure), Edit-and-resend (drops both the old question and old reply,
  sends exactly the edited text), and a real attachment round-trip
  asserting the actual outgoing `sent[].messages.at(-1).attachments`
  payload shape (base64 image data), not just DOM chip presence.
- New `verify-search.mjs` (16 checks): English and Arabic query matching
  against both titles and message text, case-insensitivity, highlighted
  snippets, the empty-results state, Escape-clears, the Clear button and
  focus-return, keyboard navigation (`aria-activedescendant`/
  `aria-selected`), and that selecting a message result switches
  conversation, scrolls to and flashes exactly that message, clears the
  query, the flash **expires on its own**, and never replays the message's
  original entrance animation. Zero real requests are asserted for the
  entire flow (search is purely local).

**Two real regressions found and fixed during this stage's own
verification** (both confirmed via a failing real-browser check first,
then fixed in the app, then re-verified green):

1. **The search-result flash never expired.** `MessageList.tsx`'s
   highlight effect called `onHighlightHandled()` — which resets the
   *parent's* `highlightMessageId` back to `null` — from inside an effect
   that also listed `highlightMessageId` as its own dependency. That reset
   flowed back down as a changed prop, re-triggering the very effect that
   owned the flash's 2-second timer; the effect's own cleanup cancelled
   that timer before it could ever fire, and the re-entered effect bailed
   out immediately (the id was already `null`), so `flashedId` was never
   reset. The flash appeared correctly but then **stayed on indefinitely**
   instead of clearing after ~2 seconds. Fixed by splitting the expiry
   timer into its own effect, keyed only on `flashedId` (which does not
   change again until the timer itself clears it) — resetting
   `highlightMessageId` no longer touches it. `WorkspaceLayout.tsx`'s
   `onHighlightHandled` prop was also stabilized with `useCallback`
   (previously a fresh inline closure every render), a related but
   independent correctness improvement.
2. **Two stale test references to "New conversation"** (`verify.mjs`,
   `verify-dialog-hit-testing.mjs`) — Stage 1 renamed that sidebar button to
   "New chat," and one of the two references (`U5b.5`) crashed the entire
   `verify.mjs` run outright (a `TypeError` on an element that could no
   longer be found), silently preventing every check after it — including,
   on the first attempt, this stage's own new `I1`–`I11` checks — from ever
   running at all. Fixed by updating both references; all previously-
   passing checks in both files were re-confirmed green afterward, not
   just the newly-added ones.

**Full local gate, run after every fix above, all green:**

| Check | Result |
| --- | --- |
| `npm run lint` | 0 errors, 0 warnings |
| `npx tsc --noEmit` | 0 errors |
| `npm test` (node:test unit suite) | 188 passed, 0 failed |
| `npm run build` (production build) | succeeds |
| `verify.mjs` (1366×768) | 65 passed, 0 failed |
| `verify-responsive.mjs` (7 viewports + long-content + resize + landscape) | 94 passed, 0 failed |
| `verify-search.mjs` (new) | 16 passed, 0 failed |
| `verify-dialog-hit-testing.mjs` (classic + ultra glass) | 16 passed, 0 failed |
| `verify-network-isolation.mjs` | 4 passed, 0 failed |

195 real-browser checks total, all against the actual compiled app, all
provider traffic mocked with a network-layer fail-closed backstop — zero
real requests to a provider at any point in this stage.

**Screenshots** (committed under `tests/browser/*.png`, per this
project's established "reproducible evidence, not a one-off artefact"
convention): `responsive-1366x768.png` and `responsive-1680x1050.png`
(desktop), `responsive-360x800.png` / `responsive-390x844.png` /
`responsive-768x1024.png` (mobile/tablet, closed-by-default sidebar),
`responsive-844x390-landscape.png` (phone landscape), and
`search-results.png` (a live search-driven conversation switch, including
the Arabic-titled seeded conversation rendering correctly in the sidebar
list).
