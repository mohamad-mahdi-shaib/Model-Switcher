# Settings: bug fix, and Appearance/Personalizations/Read aloud/Conversations

## 1. The reported bug: "Clicking Settings makes the workspace disappear, but no settings interface appears"

**Reproduced with a real dispatched pointer click** (`Input.dispatchMouseEvent`
via CDP, not a synthetic `.click()`) at 900×700 — a width inside the range
the bug actually lived in — before any code was touched, per the explicit
instruction to establish the real cause first.

**Root cause.** Settings previously existed as two separate React
components (`SettingsDesktopPopover`, `SettingsMobileSheet`), each gated by
its own `useMediaQuery("(max-width: 639px)")` check, independent of the
sidebar/drawer's own compact threshold (`useMediaQuery("(max-width:
1023px)")` in `WorkspaceLayout.tsx`). The desktop popover was also nested
*inside* `SidebarBody`'s own footer — the same component both the full
`<aside>` and the mobile drawer render.

At any width in the 640–1023px range:

- The sidebar itself is in **drawer mode** (below 1024px), so the only
  reachable Settings *trigger* is inside the drawer.
- Clicking it flips the app's single `activeOverlay` slot from `"sidebar"`
  to `"settings"` — which, by design, closes the drawer (this part was
  correct and intentional: two overlapping overlay surfaces should never
  both be open).
- `SettingsMobileSheet`'s own guard (`isMobileSheet`, the 639px check) was
  `false` at this width, so it never activated.
- `SettingsDesktopPopover`'s guard *was* `true` at this width — but its
  only mount point was inside `SidebarBody`, and the only currently-open
  copy of `SidebarBody` was the drawer's, which had just closed. The
  *other* copy (inside the full `<aside>`) does exist in the DOM at this
  width, but that `<aside>` itself is `display:none` (`hidden lg:flex`,
  and `lg` = 1024px) — so its own copy of the popover rendered into the
  DOM but was never visible either.

Net effect: the drawer closed (matching "the workspace disappears") and
**neither** Settings surface could actually display (matching "no settings
interface appears") — confirmed exactly this way via the real-browser
probe before any fix was written.

**The fix is architectural, not a threshold tweak.** `SettingsPanel.tsx`
now exports one component, `SettingsOverlay`, mounted exactly once — in
`WorkspaceLayout.tsx`, as a sibling of the sidebar and chat panel, entirely
decoupled from the sidebar/drawer's own mount lifecycle. The
dialog-vs-sheet layout switch (centered dialog on desktop, a bottom sheet
on mobile) is done with plain CSS (`sm:` responsive classes, the browser's
own 640px breakpoint) *inside that single mount*, not with two
independently-computed `useMediaQuery` hooks that can disagree with each
other or with a third breakpoint elsewhere. `SidebarBody`'s Settings button
now only ever *opens* the overlay (sets `activeOverlay = "settings"`); it
no longer owns any part of the overlay itself, so closing the drawer that
contained the trigger can never again take the overlay down with it.

Verified (`tests/browser/verify-settings.mjs`, real pointer clicks): the
dialog opens and is visible/clickable at 390px, 900px (the exact reported
range), and 1366px; closes via the × button, Escape, and a backdrop click;
survives a live resize while open (900→390→1366); and the composer's draft
text and conversation history are untouched throughout every open/close
cycle.

---

## 2. Appearance

- **Exactly three backgrounds** (`src/lib/backgrounds.ts`), down from
  eight: **Pearl** (the exact former "Pearl White Marble" gradient,
  byte-for-byte unchanged, only its `id` renamed `marble` → `pearl`),
  **Obsidian** (unchanged), and **Champagne Luxury** (new — an original
  local SVG, `public/backgrounds/champagne-luxury.svg`: a cream/champagne
  gradient base, fine flowing gold line work concentrated near the outer
  edges/corners, and a deliberately quiet, low-contrast centre so text laid
  over the panel stays readable). No remote image dependency, no copied
  stock preview.
- **Migration**: `migrateBackgroundId()` maps a saved `marble` id straight
  to `pearl` (the same approved look, renamed); every other removed id
  (`warm`, `champagne-silk`, `emerald-onyx`, `amethyst-bloom`,
  `amber-aurora`, `luxury-salon`) falls back to the new default (`pearl`).
  A background id is never left blank or invalid. Verified against real
  saved `warm` and `marble` values.
- **Both glass modes preserved** — Glowy Glass and Clear Glass are
  unchanged, still independent of background choice. The now-dead CSS that
  only ever applied to the removed `warm`/`luxury-salon` presets under
  Clear Glass (an entire "Pearl Studio glass realism" experiment block) was
  removed from `globals.css` along with the removed background rules
  themselves, rather than left as unreachable dead code.
- **Text size** — Small / Default / Large (`src/lib/text-size.ts`), a
  `--text-scale` CSS custom property (0.88 / 1 / 1.18) applied only to
  conversation text: the assistant's rendered Markdown (paragraphs,
  headings, list/quote text, and code blocks — headings and inline/block
  code were converted from fixed px sizes to `em`-relative ones so they
  scale proportionally instead of staying fixed) and the user's own sent
  message text. Navigation chrome, buttons, timestamps, and action labels
  all keep their existing fixed sizes untouched.
- **Persisted locally** (`src/lib/app-settings-storage.ts`) — background,
  glass, and text size (along with Personalizations and Read-aloud choices,
  see below) are saved to one versioned `localStorage` key
  (`model-switcher:settings`), read back once after mount (the same
  hydration-effect pattern this app already uses for conversations, to
  avoid a server/client hydration mismatch), and re-saved on every
  subsequent change. **This is also new infrastructure** — Appearance had
  no persistence at all before this pass; every reload previously reset to
  the hardcoded defaults.

---

## 3. Personalizations

Exact section title "Personalizations." Two fields — **Preferred name**
(≤80 characters) and **Custom instructions** (≤1,500 characters) — with
**Save changes** and **Reset to defaults** (clears both fields and saves
the empty state immediately; scoped only to this section, never touches
Appearance or anything else). An inline note explains: *"These preferences
are saved in this browser and sent to the selected AI provider with future
requests. This is not an account or login feature."*

**Wire contract** — a new, optional top-level `preferences` field on the
existing `POST /api/chat` body (`{provider, messages, preferences?}`),
never attached to a message. Included only when at least one field is
actually non-empty (`hasPreferences()`); a request with nothing saved is
byte-for-byte the same request as before this feature existed.

**Server-side validation** (`src/lib/preferences.ts`, shared by client and
server): re-checked independently on the server against what actually
arrived — never trusting the client's own check alone — with the exact
same length limits; a malformed or oversized `preferences` field rejects
the whole request as `BAD_REQUEST` rather than silently truncating it.

**Provider mapping** (`src/server/preferences.ts`'s
`buildSystemInstructionText()`, one shared builder, not duplicated per
adapter):
- **Gemini** — passed as `config.systemInstruction` (confirmed against the
  installed `@google/genai` SDK's own `.d.ts`, and empirically confirmed
  via a real mocked call — see `tests/gemini.test.ts` — that a plain string
  lands there correctly).
- **OpenAI** — the `instructions` top-level Responses-API field could not
  be reliably re-confirmed live during this pass (a documentation fetch
  returned conflicting results); instead, this uses the mechanism that
  *was* directly confirmed against current docs: a `developer`-role
  message prepended to the `input` array, which the docs state "takes
  precedence over instructions given with the user role." Functionally
  equivalent, and verified end-to-end with a real mocked adapter call
  (`tests/openai.test.ts`, `tests/route.test.ts`).

The preferred name is **named as data** ("The user's preferred name is
\"Alex\"..."), never concatenated as a bare instruction, and the model is
explicitly told to use it "naturally... without forcing it into every
reply" — verified by asserting that exact phrase is present in the built
instruction text.

**Applies to future requests only** — `use-conversations.ts` reads
whatever is *currently* saved at the moment each request is actually sent
(via a ref, not a value captured once), so Retry, Regenerate, and
Edit-and-resend all automatically use the latest saved preferences, the
same as a fresh send. There is deliberately no "preferences as they were
when this turn was first sent" concept, and no prior message, saved
answer, or already-in-flight request is ever altered retroactively.

Verified: Save persists across a real reload; Reset clears the saved value
immediately; the actual outgoing wire payload was asserted to carry the
saved values; server-side rejection of an oversized/malformed field was
asserted with zero adapter calls; the "no preferences saved" case was
asserted to produce a request identical to one with the feature absent
entirely, on both adapters.

---

## 4. Read aloud

Existing Read Aloud/Stop behavior is unchanged. Added:

- **Voice selection** (`src/lib/use-speech.ts`'s `useVoiceOptions()`) —
  the real voices this browser/device's `speechSynthesis.getVoices()`
  reports, loaded asynchronously (`voiceschanged`, since Chrome notably
  populates the real list only after that event, not on the first
  synchronous call) plus an "Automatic" option that keeps the existing
  language-detected best-match behavior. A saved voice id that no longer
  matches any currently-available voice (a different device, a removed
  voice pack) is not an error — `speak()` silently falls back to the same
  automatic matching "Automatic" itself uses.
- **Reading speed** — a slider, 0.5×–2×, default 1×
  (`MIN_SPEECH_RATE`/`MAX_SPEECH_RATE`/`DEFAULT_SPEECH_RATE`), applied via
  `SpeechSynthesisUtterance.rate`.
- **Honest unavailable state** — when `speechSynthesis` doesn't exist at
  all, the Read Aloud settings section shows a plain explanatory message
  instead of a picker with nothing to pick from.
- No paid service, and the panel explicitly says voice availability
  (including for Arabic) varies by device and speech is not guaranteed to
  work fully offline.
- Changing conversations or clicking Stop still cancels speech cleanly —
  unchanged, and re-verified.

---

## 5. Conversations

- **Export** — downloads a readable, versioned **PDF**
  (`model-switcher-export-v1-<timestamp>.pdf`), rendered entirely
  client-side with `jspdf` (MIT-licensed, no network call, no paid
  service, no server-side rendering — a new, small dependency, the only
  one this pass added). Revised from the original per-request follow-up:
  it originally produced a JSON file; the exact same underlying data
  (`src/lib/conversation-export.ts`'s `buildExportPayload()` is unchanged
  and still the one source of truth for *what* is exported) is now
  rendered as formatted text — conversation title, provider, dates, each
  message with its role and content, version notes, and attachment
  metadata — by `src/lib/conversation-pdf.ts`'s `buildConversationsPdf()`,
  with automatic pagination. The disclosure paragraph (attachment binary
  contents are not included; no import path exists for this file) is
  printed directly on the PDF's first page, not hidden in metadata. No
  credentials appear anywhere in the document.
  Verified by fetching the real downloaded blob's raw bytes in a
  real-browser test and confirming: the file starts with the real `%PDF-`
  header, is a non-trivial size, and its raw content stream contains both
  the real saved conversation text and the disclosure text (jsPDF's
  default output is not stream-compressed, so this is a genuine content
  check, not just a magic-byte check) — and separately confirmed by
  rendering an exported file and reading it directly.
- **Delete all conversations** — a two-step confirm (Delete all / Cancel),
  matching the existing per-conversation delete pattern. Confirming stops
  any in-flight request, deletes every conversation's attachment bytes from
  IndexedDB, and replaces the list with one fresh empty draft (the welcome
  state); Cancel leaves everything untouched. Appearance and
  Personalization preferences are never touched by this action. Read Aloud
  speech and the transcript's reveal pacing are stopped as a natural
  consequence of `MessageList` remounting when the active conversation
  changes (it is already keyed by conversation id) — no separate signal
  needed. The existing single-conversation delete flow (with its own
  inline confirm) is unchanged. Both Cancel-preserves and Confirm-clears
  were verified against real conversation state, not just UI state.

---

## 6. Explicitly not added (preserved as-is)

No Enter-key/send behavior setting, no Reduce Motion setting, no Response
Display setting. Enter-to-send, the approved message motion/reveal
pacing, the gold orbit, and automatic respect for the OS's
`prefers-reduced-motion` are all unchanged — confirmed by the full existing
`verify.mjs`/`verify-responsive.mjs` suites still passing unmodified.

---

## 7. Tests (all mocked, zero live provider requests)

| Check | Result |
| --- | --- |
| `npm run lint` | 0 errors, 0 warnings |
| `npx tsc --noEmit` | 0 errors |
| `npm test` (node:test unit/adapter/route suite) | **199 passed**, 0 failed |
| `npm run build` (production build) | succeeds |
| `verify-settings.mjs` (new) | **54 passed**, 0 failed |
| `verify.mjs` | 65 passed, 0 failed (regression-checked, unmodified) |
| `verify-responsive.mjs` | 94 passed, 0 failed (regression-checked) |
| `verify-search.mjs` | 16 passed, 0 failed (regression-checked) |
| `verify-dialog-hit-testing.mjs` | 16 passed, 0 failed (regression-checked) |
| `verify-network-isolation.mjs` | 4 passed, 0 failed (regression-checked) |

**Real bugs found and fixed during this pass's own verification** (each
confirmed with a failing real-browser check first, fixed, then
re-verified):

1. The Settings bug itself (Section 1 above).
2. A separate CSS specificity bug introduced earlier in this session while
   restyling the sidebar drawer's material: `.optical-glass` sets `position:
   relative`, and that rule was winning the cascade over Tailwind's
   `.fixed` utility on the same element, silently demoting the drawer from
   a viewport-anchored overlay to a normal in-flow flex item (it rendered
   beside the chat panel instead of floating over it). Fixed with a more
   specific `.optical-glass.fixed { position: fixed; }` rule in
   `globals.css`.

**Two test-script-only bugs**, found and fixed in the test scripts
themselves, not the app (both explicitly called out per the instruction to
distinguish real findings from test artifacts):

1. `verify-settings.mjs`'s own "persists across a reload" checks initially
   launched a *brand-new* Chrome profile (via `launch()`) to simulate a
   reload, which has its own empty `localStorage` entirely separate from
   the page that had just saved something — not a real reload. Fixed by
   navigating the *same* page/profile instead.
2. The Export test tried to `fetch()` the downloaded blob's content from a
   separate, later call, after the app's own `exportConversations()` had
   already synchronously revoked the object URL (right after `click()`, in
   the same tick). Fixed by starting the content fetch inside the same
   synchronous interception, before the revoke runs.

## 8. What to review manually (not verified here)

- Real-device speech: voice quality/availability (especially Arabic) and
  the rate slider's actual audible effect on a real phone/desktop screen
  reader stack.
- Real mobile keyboard behavior with the Personalizations text
  input/textarea (the automated checks use synthetic value-setting, not a
  real on-screen keyboard).
- Live model behavior actually honoring a saved preferred name / custom
  instructions against a real Gemini or OpenAI account (this pass proves
  the request each adapter *sends* is correct; it cannot prove how either
  model chooses to respond to it).
- Visual taste-check of the new Champagne Luxury background against the
  approved Pearl/Obsidian pair in a real, non-headless browser window.

---

## 9. Follow-up: readability, and Export as PDF

Two rounds of direct user feedback after the above landed, addressed in
order.

**Round 1 — "the letters in the workspace are not very readable."**
Diagnosed with real screenshots (not assumed) across all three
backgrounds × both glass modes, comparing an active vs. an inactive
conversation row side by side. Confirmed: `--ink-muted`/`--ink-subtle`
(the sidebar's inactive-row text, section labels, and the search
placeholder — and, since the same tokens back `glass-text-muted`
app-wide, the assistant's own reply body text too) were tuned for the
sidebar drawer's *previous*, near-opaque material. Once the drawer became
see-through (an earlier, deliberate change so it would visually match the
chosen background), those lighter inks read as genuinely washed out on
the light-toned presets (Pearl, Champagne Luxury) — worst on Champagne
Luxury under Clear Glass, the busiest background under the most
transparent material. Dark tone (Obsidian) was unaffected.

Fixed in `globals.css`: `--ink-muted` `#383c46` → `#21232b`, `--ink-subtle`
`#454a56` → `#2c2f38`, for light tone only. `--ink` itself (already
strong) untouched.

**Round 2 — a follow-up: still "the font and the contrast of the color is
not very strong," specifically calling out conversation ("chat") names.**
The color fix alone left a secondary factor: inactive conversation-row
titles used `font-normal` while the active row used `font-medium` — a
real, independent contributor to perceived legibility distinct from
color. Fixed in `ConversationSidebar.tsx`: inactive rows now use
`font-medium` too, matching the active row's weight; the active/inactive
distinction is carried entirely by ink color and the active row's
highlighted background now, not partly by a lighter font weight on top of
that.

Both rounds re-verified visually (fresh screenshots across all
background/glass combinations) and via the full automated gate
(unchanged pass counts on every suite; a CSS/JSX-only change touches no
test-asserted behavior).

**Export format changed from JSON to PDF**, per explicit request (the
`.json` file that a first attempt at Export produced was not what was
wanted). `src/lib/conversation-export.ts`'s `buildExportPayload()` — the
data shape — is unchanged; a new `src/lib/conversation-pdf.ts`
(`buildConversationsPdf()`) renders that same payload as a paginated,
readable PDF via `jspdf` (this pass's one new dependency: MIT-licensed,
purely client-side, no network call, no paid tier). `use-conversations.ts`'s
`exportConversations()` now calls `doc.save(...)` (jsPDF's own download
trigger) instead of building a JSON Blob. The Settings > Conversations
copy was updated to say "PDF" rather than "JSON file." See Section 3
above (now updated) for what the PDF contains and how it was verified,
including a real downloaded-and-rendered example checked directly, not
only via automated byte-content assertions.

**A genuine environmental finding, not an app bug:** while chasing
intermittent real-browser test flakiness during this follow-up round,
found **1,084 leftover temporary Chrome profile directories**
(`%TEMP%\model-switcher-cdp-*`) accumulated over this session's full
history of real-browser test runs — `cdp.mjs`'s own cleanup
(`rmSync(profile, ...)` in `close()`) is best-effort and is skipped
whenever a script exits before calling `close()` (a thrown error, a
diagnostic script cut short). With over a thousand sibling directories in
one temp folder, new profile creation (`mkdtempSync`) and Chrome startup
measurably slow down, which is consistent with the specific pattern of
flakiness observed (delays around dialog-open timing, inconsistent across
different viewports and different runs, never reproducible in an
isolated single-script run). Cleaned up (1,084 → 0); the harness's own
`cdp.mjs` was not changed, since the cleanup logic there is already
correct for the normal case, and the fix here is disposing of session
debris, not a code defect.

---

## 10. Second follow-up: the drawer-position bug recurred under Clear Glass, and the PDF made minimal

**"When I use the clear glass the workspace still appears on the right"** —
a real regression, confirmed and root-caused before touching anything.
The earlier drawer-position fix (`.optical-glass.fixed { position: fixed;
}`, added when the drawer was first made see-through) works under Glowy
Glass, but Clear Glass has its own "Tier 1: main chat panel" rule,
`.workspace-root[data-glass="ultra"] .optical-glass { position: relative;
... }`, which is *three* class-level selectors deep against the fix's
*two* — so under Clear Glass specifically, this rule out-specifies the
fix and silently wins the cascade again, reproducing the exact original
bug (the drawer back in normal flex flow, beside the chat panel, instead
of floating over it). Confirmed by computed-style inspection
(`position: relative` where `fixed` was expected, only when
`data-glass="ultra"`) before writing the fix, not guessed.

Fixed with a same-shape, more-specific rule immediately after Tier 1's own
declaration:
```css
.workspace-root[data-glass="ultra"] .optical-glass.fixed { position: fixed; }
```
Verified directly: computed `position: fixed`, correct `x: 12` (left
edge) rect, and a real screenshot under Clear Glass, at the exact
viewport width the original bug lived at.

**Export PDF made minimal, per explicit request.** The first PDF version
included a title-page header, export date/version, a disclosure
paragraph, and a per-conversation provider/created/updated line — all
removed. `src/lib/conversation-pdf.ts` now renders literally just `Q:`
(the user's message) and `A:` (the assistant's reply) for every turn, in
order, with a thin rule between separate saved conversations and nothing
else — no timestamps, no provider names, no version notes, no attachment
metadata. Settings' own description text was updated to match. Re-verified
with a real generated PDF, read directly, and with updated automated
checks confirming both the real question/answer text is present *and*
the old metadata strings are genuinely absent.

Both fixes re-verified against the full gate: lint, typecheck, 199 unit
tests, production build, and all 6 real-browser suites (251 checks)
green. Also fixed, while chasing residual test flakiness in this round:
three of the harness's own hydration waits (`verify.mjs`,
`verify-network-isolation.mjs`, `verify-settings.mjs`) were tightened
originally around 1000-1200ms, which this very long session's cumulative
load had made unreliable; bumped to 1600ms and confirmed stable across
repeated back-to-back runs. Not an app change.

---

## 11. Third follow-up: an even cleaner PDF, and the workspace panel's own colour finally following the background

**"Make the PDF... more clean"** — the `Q:`/`A:` labels themselves came
out. `conversation-pdf.ts` now prints a question as a bold line and its
answer as a plain paragraph directly beneath it, with no label of any
kind; the alternating bold/plain rhythm is what tells the two apart, the
same way a chat bubble's side or a name tag would, without printing
either. Between two different saved conversations there is now only
whitespace -- the thin rule line from the previous round is gone too.
Re-verified by generating and reading a real two-conversation export
directly: reads as a plain, clean transcript, not a form.

**"Match the colour of the workspace with the colour of the chosen
background"** — asked a third time, so this pass went further than
ink/font contrast (Section 10's territory) into the actual PANEL colour
itself. Root cause: `.optical-glass`'s own background tint (the frosted
fill behind the sidebar, drawer, and chat panel, in both glass modes) was
a single hardcoded white-based gradient, identical regardless of which of
the three backgrounds was active. White reads as roughly neutral on Pearl
and Obsidian, but Champagne Luxury is a genuinely warm gold/cream
palette, and a flat white overlay on top of it looked like a slightly
cool, disconnected layer rather than glass belonging to that background.

Fixed with two new, narrowly-targeted rules (one per glass mode, each
matching its corresponding base rule's exact gradient shape and alpha
values, only the tint colour changed from white to a warm champagne gold
drawn from the background artwork's own line-work colour) gated on
`[data-preset="champagne-luxury"]` specifically -- Pearl and Obsidian's
existing, already-approved tint is completely untouched. Verified with
side-by-side screenshots of the chat panel and sidebar together, across
all three backgrounds in both glass modes: Champagne Luxury now reads as
one warm, coherent surface; Pearl and Obsidian are pixel-for-pixel the
same as before this round.

Re-verified against the full gate: lint, 199 unit tests, production
build, and all 6 real-browser suites (251 checks) green (one single,
non-reproducing flake in an unrelated pre-existing check, gone on
immediate re-run -- consistent with the session-load pattern already
described in Section 10, not a regression from a CSS-only and PDF-content
-- only change).

---

## 12. Fourth follow-up: choosing which conversations to export, a real Arabic-text bug in the PDF, and a voice tone preference

**Choosing which conversations to export.** Settings > Conversations now
lists every saved conversation with a checkbox (all checked by default --
the previous "always export everything" behavior, now just the default
rather than the only option), plus Select all/Clear. The Export button's
own label reflects the current selection ("Export all conversations" /
"Export 3 conversations") and disables when nothing is checked.
`use-conversations.ts`'s `exportConversations()` now takes the selected
conversation ids and filters to exactly those before building the PDF.

**A real, reported bug: Arabic text in the exported PDF rendered as
"symbols I don't know."** Root cause, confirmed by reading jsPDF's own
source before writing any fix: `doc.text()` draws using jsPDF's 14
built-in standard PDF fonts (Helvetica, etc.), which only cover Latin
script under WinAnsiEncoding. Arabic code points are not rejected or
substituted with a placeholder -- they are silently mapped onto whatever
unrelated glyph that encoding happens to have at the same numeric
position, which is exactly "a different language / symbols I don't
recognise," not a crash or an obviously-missing-font warning. Correctly
shaping and bidi-reordering Arabic from scratch (contextual letter forms,
right-to-left layout, embedding a real Arabic-capable font file) is a
large, error-prone undertaking on its own.

Fixed by changing HOW the PDF is produced, not by trying to hand-roll
Arabic text shaping: `conversation-pdf.ts` now builds the conversation
content as a real, temporary, off-screen DOM tree (each message its own
`<p dir="auto">`, the exact same bidi-handling attribute already used
elsewhere in this app, e.g. search-result snippets), rasterises it with
`html2canvas` (this pass's second new dependency, MIT-licensed, purely
client-side, no network call), and embeds the result into the PDF as a
paginated series of full-page images via jsPDF, rather than drawing text
directly. This reuses the browser's OWN Arabic text layout -- already
proven correct, since the app's live chat UI already displays Arabic
correctly on screen -- instead of reimplementing it. Page breaks are
computed from each message's real DOM position (never a fixed pixel
offset), so a break never lands in the middle of a line.

**Trade-off, disclosed plainly:** the exported PDF's text is no longer
selectable or searchable -- it is now an image of text, not text objects,
in exchange for actually being readable in every language the app
supports, not only English. Judged the right trade for what "readable
document" means here.

Verified two ways: (1) automated, by intercepting the off-screen render
container itself (not the final image, which cannot be substring-checked)
to confirm the exact right conversations/messages are present, that an
unchecked conversation's content is genuinely absent, and that the Arabic
paragraph carries `dir="auto"`; (2) directly, by generating a real export
containing an Arabic conversation and a mixed Arabic/English sentence and
reading the actual PDF pages -- both render with correctly shaped,
correctly-ordered Arabic script, including the mixed-language sentence
rendering both scripts correctly in the same line.

**Voice tone (male/female) for Read aloud.** The Web Speech API has no
standardised gender field on a voice at all, so this is a disclosed
best-effort: `use-speech.ts`'s new `guessVoiceGender()` checks each
voice's own name (the literal words "female"/"male", plus a short list of
common voice names used across Windows/macOS/Chrome TTS packs) and
returns "female"/"male"/"unknown". A new "Voice tone" control (Any /
Female / Male) in Settings applies only while "Automatic" is selected
(picking one specific named voice already fixes its own tone, so the
preference has nothing left to apply to -- the control disables itself
in that case); when active, `speak()` tries a same-language voice
matching the preferred tone first, falling back to language-only
matching (the previous, unchanged behavior) if this device has no voice
it can confidently identify as that gender for the detected language --
never silently failing to speak just because a preferred tone could not
be honoured. Persisted alongside the other Read Aloud choices.

**A genuine test-script bug found and fixed while verifying the Arabic
fix:** the first version of the updated export test ran two full exports
back-to-back in one page to save time, and reproducibly crashed the
headless Chrome renderer ("Inspected target navigated or closed") --
each export now rasterises a real, fairly large region via html2canvas at
2x scale (confirmed: ~1.9-3MB per resulting PDF), and two of those in
quick succession, this deep into an already long, heavily-loaded session,
was more than the renderer could sustain. Not an application bug (the
live app was never seen to fail this way, only the test harness doing
this twice in immediate succession); fixed by splitting the two scenarios
into two separate, independent page instances. A second, smaller
test-script bug in the same area was also found and fixed: the
interception helpers did not restore their monkey-patched globals
(`document.createElement`, `Element.prototype.appendChild`,
`URL.createObjectURL`) until a slow-path timeout, so a second export
attempted soon after a fast-resolving first one found them still
patched -- fixed by restoring immediately once all expected data had been
captured.

Re-verified against the full gate: lint, typecheck, 199 unit tests,
production build, and all 6 real-browser suites (257 checks, up from 251
with the new coverage) green.
