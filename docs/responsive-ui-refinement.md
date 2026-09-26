# Responsive UI refinement — scope and acceptance record

**Starting commit:** `57f8116fbeb91f7d571c21423a3e0fdb8aea9e4f` (branch `main`).
**Working tree at start:** 38 changed/new paths, all pre-existing from earlier
passes this project (F1–F9, U1–U6, the header alignment refinement, the
switch-dialog pointer-interaction fix, and the Vercel deployment
configuration). None of that was reset, discarded, or committed as part of
this pass — see "What this pass did not touch" below.

This document is written before implementation and updated with actual
results (marked **Result:**) once work is verified.

## Why

The internship reviewer approved the visual design and asked for clearer
controls and responsive behavior across desktop, tablet, and mobile. Mobile
is now explicitly in scope — it was previously an explicit, disclosed
out-of-scope decision (the sidebar was `hidden` below `md`, with no
alternative way to reach it at all).

## Intended layout behavior

**Breakpoint choice.** Tailwind's `lg` (1024px) is the line between "sidebar
inline" and "sidebar as a drawer," not the previous `md` (768px). At 768px
wide (the tablet-portrait test case) a ~238px inline sidebar leaves too
little width for a comfortable chat column; at 1024px there is enough room.
`sm` (640px) is the line between the appearance picker's anchored popover
form and its mobile bottom-sheet form, for the same reason: below 640px the
popover's fixed width does not comfortably fit.

**Desktop (≥1024px).** Sidebar visible inline, as before. Provider selector
becomes a single dropdown trigger (was two chips). Appearance trigger renamed
to "Appearance" (icon + label). Header controls stay aligned in one row;
long conversation titles truncate instead of pushing controls off-screen
(already `truncate` on the title — confirmed unchanged).

**Tablet / compact windows (640–1023px).** Sidebar collapses behind a
menu-button-triggered drawer (same drawer implementation as mobile — see
below; a full accessible drawer is a strict improvement over a plain
collapse, not a regression). Chat column keeps a comfortable width. Header
controls remain reachable without crowding.

**Mobile (<640px).** Sidebar is a drawer: fixed overlay, backdrop, visible
close control, Escape closes it, focus is trapped inside while open and
restored to the trigger on close, selecting a conversation closes the
drawer. Rename/delete become always-reachable by touch (no longer
hover-only reveal). Appearance picker becomes a bottom sheet. Provider
dropdown's secondary model-id readout compacts/truncates, with the full id
still reachable inside the dropdown. Composer stays reachable above the
on-screen keyboard (uses the visual viewport, not just `100vh`).

**All sizes.** No horizontal page scrolling from primary layout (fenced code
blocks keep their own internal horizontal scroll, which is correct and
preserved). Primary controls (send/stop, header triggers, sidebar row
actions, dropdown options) target at least 44×44 CSS px. Copy buttons are
reachable without hover. Text selection, focus visibility, and
prefers-reduced-motion behavior are unchanged.

## Preserved (not touched by this pass)

- Both glass materials (Glowy Glass, Clear Glass), every background preset,
  the transparency/edge-light treatment, and the approved message entrance
  and reveal-pacing animations.
- Real Gemini/OpenAI integration, the normalized streaming/error contract,
  Stop, Retry, Copy, Markdown rendering, and localStorage conversation
  persistence.
- Per-message provider attribution and Retry's targeting of the provider a
  failed turn actually used, not whatever is now selected.
- Internal provider ids (`"gemini"`, `"gpt"`) — only the **displayed** OpenAI
  label changes, from "GPT" to "OpenAI", per this task's explicit
  instruction to use consistent user-facing names. The env var name
  (`OPENAI_API_KEY`), the internal id, and the adapter are unchanged.
- Existing secrets, model configuration (`GEMINI_MODEL`/`OPENAI_MODEL`), and
  the Vercel project/environment-variable configuration from the previous
  deployment pass. No deploy happens in this pass.
- The portal pattern already proven for the switch-confirmation dialog
  (backdrop + panel portaled together as DOM siblings into a
  `backdrop-filter`-free ancestor) — reused, not replaced, for every new
  overlay this pass adds (provider dropdown, mobile appearance sheet, sidebar
  drawer), for the same reason it was needed there: `.optical-glass`'s own
  `backdrop-filter` still creates a stacking context that can trap
  `position:fixed` descendants and intercept their pointer events.

## Acceptance checklist — results

- [x] Provider selector is one dropdown trigger; Gemini/OpenAI both listed,
      selected one indicated, unavailable one visibly disabled with a reason.
      *Verified: `tests/browser/verify.mjs` F5/F8/U5b blocks (46/46 at both
      1366×768 and 1680×1050), `tests/browser/verify-responsive.mjs` at all
      six required viewports.*
- [x] Configured model id shown as secondary text; compacts at narrow
      widths; full id still reachable inside the dropdown.
      *Verified: `verify-responsive.mjs`'s per-viewport option check reads
      the full model id from inside the open dropdown at every width.*
- [x] Switching behavior unchanged: immediate when empty, confirmed once a
      conversation has started, refused while a request is in flight.
      *Verified: `verify.mjs` F5.1–F5.4 (attribution survives a selector
      change), U5b.3–U5b.5 (confirm/cancel/outside-click), all unchanged
      from before this pass except the two-step open-then-select
      interaction the dropdown itself requires.*
- [x] Appearance trigger reads "Appearance"; icon+label on desktop,
      icon-only with an accessible name at narrow widths.
      *Verified: `verify-responsive.mjs`, `labelVisible` check at all six
      viewports.*
- [x] Both glass options and every background preset still reachable; open
      picker preserves current selection; fits the viewport; mobile variant
      is a bottom sheet.
      *Verified: `verify-dialog-hit-testing.mjs` (both glass modes),
      `test-interactions.mjs`'s mobile-sheet checks (real hit-test on a
      sheet option, `position:fixed` confirmed).*
- [x] Sidebar visible inline ≥1024px; drawer below that, with backdrop,
      close control, Escape, focus trap, focus restoration, and
      close-on-select.
      *Verified: `verify-responsive.mjs` (`asideVisible`/`hamburgerVisible`
      at all six viewports and across a live resize), `test-interactions.mjs`
      (real click opens it, backdrop shadows the composer, initial focus on
      the close button, selecting "New conversation" closes it).*
- [x] Rename/delete reachable by touch, not hover-only.
      *Changed from `opacity-0` hover-reveal to always-visible in
      ConversationSidebar.tsx's `Row`; not independently machine-verified
      beyond visual screenshot inspection (no existing harness pattern
      simulates real touch input specifically, as opposed to pointer clicks
      generally) — flagged below as needing your own iPhone check.*
- [x] No horizontal page overflow at any tested width; code blocks keep
      their own scroll.
      *Verified: `verify-responsive.mjs`, `scrollWidth <= clientWidth` at
      all six viewports, the 844×390 landscape case, and directly across a
      live resize; a long unbroken code line confirmed to scroll within its
      own `<pre>`, not the page.*
- [x] Primary controls ≥44×44 CSS px.
      *Verified: `verify-responsive.mjs` and `test-interactions.mjs` measure
      every primary control's actual rendered box (drawer trigger, Appearance
      trigger at every width including desktop, provider dropdown options,
      Send/Stop, Copy) and assert ≥44px on each.*
- [x] Real pointer clicks (not `.click()`) land on dropdown options,
      confirmation buttons, and are blocked by open overlays' backdrops.
      *Verified: every interaction in `test-interactions.mjs` and
      `verify-dialog-hit-testing.mjs` uses `clickAt()` (real CDP
      `Input.dispatchMouseEvent`), including `elementFromPoint()`
      hit-testing before each click.*
- [x] Full regression suite (unit + lint + typecheck + build + real-browser)
      passes; new behavior has focused regression coverage.
      *188/188 unit tests, lint clean, `tsc --noEmit` clean, production build
      clean; 46/46 + 46/46 (`verify.mjs`, both viewports), 16/16
      (`verify-dialog-hit-testing.mjs`), 4/4 (`verify-network-isolation.mjs`),
      47/47 (new `verify-responsive.mjs`) — see the final report for the
      complete, dated results.*

## Bugs found and fixed during this pass's own verification

Disclosed, not smoothed over — this is exactly what the verification step is
for:

1. **Provider dropdown could render off-screen to the left.** Anchored via
   CSS `right-0` (flush with the trigger's own right edge), which is correct
   when the trigger sits near the header's right edge (desktop) but pushed
   the panel off the left edge of the viewport entirely once the header
   wrapped the provider group onto its own left-aligned row (narrow widths,
   or a sufficiently long conversation title even at 768–1024px). Fixed with
   a measured collision check on open (`ChatHeader.tsx`'s `ProviderDropdown`)
   that flips to `left-0` when `right-0` would not leave enough room, rather
   than assuming either anchor is always safe.
2. **Appearance and provider triggers silently dropped back to a 30px touch
   target at `sm` and above.** An early version narrowed both triggers back
   to their original desktop height above the `sm` breakpoint, which
   contradicts this task's own "at least 44×44 CSS px... across all sizes"
   instruction (already correctly applied, without this mistake, to the
   Send/Stop buttons). Fixed by keeping both at 44px unconditionally.
3. **The mobile sidebar drawer used `.optical-glass` (deliberately
   transparent) instead of `.glass-modal` (deliberately near-opaque).**
   Visually, the chat panel's own header controls — sitting at the same
   physical screen coordinates as the drawer's own contents — remained
   faintly legible *through* the drawer even with a dimmed backdrop above
   them, which read as confusing rather than clearly inert. Fixed by
   switching the drawer to `.glass-modal`, the material this codebase
   already built for exactly this ("near-opaque on purpose... a popover
   CANNOT blur the chat text behind it," per its own comment in
   `globals.css`) — the same reason the switch-confirmation dialog and the
   appearance picker already use it.
4. **A `selectProvider()` test helper intermittently found no option at
   all**, because it opened the dropdown and searched for the option
   synchronously in one tick, racing React's own commit of the state update
   that mounts the option into the DOM. This produced a real crash and a
   cluster of unrelated-looking browser-test failures the first time the
   full suite ran after this pass's changes. Fixed by awaiting a real paint
   frame (`requestAnimationFrame`) between the two steps, in both
   `verify.mjs` and `verify-dialog-hit-testing.mjs`. Test-harness-only; no
   application code was involved.

## What still needs your own iPhone check

Everything above was verified with headless Chrome via the Chrome DevTools
Protocol, including real dispatched pointer events — this proves hit-testing
and layout correctness, but it is not the same browser engine as iOS Safari,
and it cannot exercise a real on-screen keyboard, real momentum scrolling, or
real `:hover`-absent touch input. Please specifically check on your own
iPhone:

- The on-screen keyboard does not visually cover the composer when it opens.
- The sidebar drawer and appearance bottom sheet feel right with real touch
  gestures (tap targets, swipe-to-dismiss expectations, momentum scroll
  inside the drawer's conversation list).
- Safe-area insets (notch / Dynamic Island / home indicator) look correct in
  both orientations — this used `env(safe-area-inset-*)` with
  `viewport-fit: cover`, which this environment cannot visually confirm on
  real hardware.
- Rename/delete row actions (always-visible now, not hover-only) are
  comfortable to tap without mis-hitting the row's own select action next to
  them.

---

## Second pass: control placement

A follow-up request, after reviewing the first pass above: move provider/
model selection into the message composer, move Appearance behind a sidebar
Settings entry point, and replace "hide the sidebar below a breakpoint"
(the first pass's own design, above) with a persistent compact rail at
narrow widths — conversation navigation should stay continuously visible in
some form at every width, never fully hidden behind a header toggle.

### What changed

- **Provider selection** left the header entirely. It now lives in a compact
  bottom toolbar inside the composer (`MessageComposer.tsx`), below the
  text-entry area, with Send/Stop at the opposite end — see
  `ProviderMenu.tsx`'s `ProviderSwitcher`. Same Gemini/OpenAI selector,
  same internal provider ids, same switching semantics (immediate when
  empty, confirmed once a conversation has started, refused in flight) —
  only the trigger's location and its popover's opening direction changed.
  Opening upward is the norm now: the trigger sits at the page's bottom
  edge, where there is rarely more room below it than above, and both the
  listbox and the switch-confirmation dialog re-measure while open (via
  `visualViewport` listeners, not just on open) so they reposition correctly
  if the on-screen keyboard changes the visible viewport.
- **Appearance** left the header too, renamed **Settings** (gear icon),
  reachable from three places that all share one lifted
  `settingsOpen`/`onSettingsOpenChange` state and one set of panel
  components (`SettingsPanel.tsx`): the full sidebar's own footer, the
  compact rail, and the mobile drawer's footer. Exactly the same two
  sections as before (Background, Glass appearance) — nothing added.
  Desktop renders a small anchored popover (no portal needed — see below);
  narrow widths render the existing portaled bottom sheet.
- **The sidebar's own breakpoint moved from `lg` (1024px) to `sm` (640px),
  and its narrow-width behavior changed from "hidden, reveal via a header
  drawer toggle" to "shrink to a persistent 60px rail."** The rail carries
  exactly three controls (open the full conversation list, start a new
  conversation, open Settings) and is itself an `<aside>`, like the full
  sidebar, so it inherits the same Ultra-Clear tier-2 glass treatment. At
  `>=640px` the full sidebar stays inline, at a fluid width
  (`clamp(180px, 20vw, 238px)`) rather than a fixed one, so it shrinks
  progressively rather than jumping between two hard states — a 768px-wide
  viewport, which the first pass above put in drawer mode, now keeps the
  full sidebar visible at a reduced width instead. Expanding the rail opens
  the same portaled drawer overlay the first pass already built; selecting
  a conversation still closes it. A header hamburger toggle is no longer
  needed anywhere: the rail is itself always visible below `sm`, and the
  full sidebar is itself always visible at `sm` and above, so there is no
  width left at which conversation navigation is not already on screen in
  one form or the other — see "What this pass did not do" below.
- **The header now holds only the conversation title.** `ChatHeader.tsx`
  dropped from roughly 600 lines of dropdown/dialog/picker logic to about
  20.

### Preserved (unchanged by this pass)

Everything the first pass's own "Preserved" list already covers, plus:
provider switching's exact rules (immediate/confirm/in-flight-lock),
context-sharing warning copy, per-message provider attribution, the two
glass materials and every background, and — the one behavior this
relocation put genuinely at risk — an unsent composer draft. Nothing in the
provider-switch path (`ProviderSwitcher`, `SwitchDialog`) reads or resets
`MessageComposer`'s own `value` state, so selecting, confirming, or
cancelling a switch leaves a draft exactly as typed; see `verify.mjs`'s
P1–P3 for the explicit regression coverage this pass added for it.

### What this pass did not do

The task's own instruction said to keep "the conversation title and sidebar
toggle where needed" in the header. The toggle specifically was **not**
kept — deliberately, not by oversight. Under the new rail-based design there
is no longer a width at which conversation navigation is fully hidden and a
toggle would be the only way to reach it (the whole point of the rail is
that navigation is now continuously visible, in full or compact form, at
every width) — so a second, redundant "open conversations" control sitting
in the header, doing the same job the rail's own leftmost icon already
does, would just be clutter. This is a considered deviation from a literal
reading of that instruction, made in service of its own stated goal
("continuous visible access to conversation navigation"); flagging it here
explicitly rather than presenting it as unchanged.

---

## Third pass: ChatGPT-style provider trigger

A follow-up request: make the provider switcher's own look match ChatGPT's
model picker. Scoped, on request, to visual style only — position (the
composer's own footer toolbar) and interaction (immediate/confirm/in-flight
rules, keyboard nav, upward-opening placement) are all unchanged from the
second pass above.

- **Trigger** (`ProviderMenu.tsx`'s `ProviderSwitcher`): the bordered pill
  with a stacked two-line label (provider name + model id) became a plain
  text button — provider name and a small chevron, no border or background
  chip, a quiet `hover:bg-white/10` highlight instead of a permanent
  outline. The model id no longer rides on the trigger at all; it was
  removed as dead weight, not hidden — `activeModel` is gone from
  `ProviderSwitcher`, `MessageComposer`, and `WorkspaceLayout`'s prop chain
  entirely, since nothing reads it anymore (the dropdown's own rows already
  source each provider's model directly from `availability`, independent of
  the trigger).
- **Options list**: the selected row's accent-colored badge (a filled
  circle with a rotated chevron) became a plain `CheckIcon`, and the
  selected row's own background became a neutral `bg-white/12` instead of
  the provider's accent color — both matching ChatGPT's own convention of a
  checkmark plus a quiet neutral highlight, not a colored chip. Each row
  still shows the exact, never-truncated model id beneath the provider
  name, unchanged.
- Two now-unused CSS rules (`.provider-model`, `.provider-chip-active`)
  were removed from `globals.css` rather than left as dead code — the
  former was already unused after the second pass above, the latter became
  unused by this one.

**Verification:** `npm test` 188/188, lint clean, `tsc --noEmit` clean,
production build clean. `verify.mjs` 54/54 at both 1366×768 and 1680×1050,
`verify-dialog-hit-testing.mjs` 16/16 (both glass modes),
`verify-responsive.mjs` 60/60 — all three needed their provider-text-reading
helpers simplified (the trigger's `textContent` is now just the label, with
no inner model span to extract around), but no check's actual *behavior*
assertion changed. `verify.mjs` was genuinely flaky in isolated single runs
during this pass (different, unrelated checks failing each time — the same
sequential-Chrome-launch resource contention already documented earlier in
this file), unrelated to the trigger restyle; repeated clean runs settled
at 54/54 both widths, and `verify-network-isolation.mjs` (4/4, untouched by
this pass) does not exercise this area at all.

### Bugs found and fixed during this pass's own verification

1. **The provider dropdown could render off-screen at 360px width, on
   either anchor.** The trigger's width was constrained by a percentage
   `max-w-[68%]` applied to the *button itself*, nested inside a
   `position:relative` wrapper with no width of its own — a circular
   sizing dependency (the wrapper's shrink-to-fit size depends on the
   button's rendered size, which depends on a percentage of the wrapper).
   The wrapper ended up measurably wider than the button actually painted,
   so a `right-0`-anchored popover measured against the wrapper's box, not
   the button's true right edge, and at 360px width neither `left-0` nor
   `right-0` fully fit regardless. Fixed by moving the width constraint to
   the wrapper (`max-w-[68%] min-w-0` on the wrapper, `w-full` on the
   button — no circularity, since the wrapper's own percentage resolves
   against the toolbar row, a properly defined flex container) and
   replacing the left/right CSS-class choice with a single clamped pixel
   offset (`Math.min(Math.max(triggerLeft, 12), innerWidth - panelWidth -
   12)`) — the same robust approach `SwitchDialog` already used, which
   guarantees the panel stays fully on screen regardless of where the
   trigger sits, rather than picking between two anchors that can each
   independently overflow.
2. A verification-script-only issue, not an application bug: this pass's
   own responsive test initially asserted the seeded long conversation
   title must always truncate (ellipsis-engage), at every width. At wide
   desktop widths (>=1366px) the header — now holding only the title, with
   no sibling controls competing for its row — has more than enough room
   for this specific 904px-wide seeded title, so it renders in full without
   needing to clip, which is correct behavior, not a truncation failure.
   Fixed by asserting truncation only where the header's own available
   width is actually less than the title's natural width, and asserting
   "renders in full, still no overflow" otherwise.

### Verification (this pass)

Re-run in full after the placement changes: `npm test` 188/188, lint clean,
`tsc --noEmit` clean, production build clean. Browser harness: `verify.mjs`
54/54 at both 1366×768 and 1680×1050 (7 new `P1`–`P7` checks added for
draft-preservation-across-a-switch and "the header genuinely no longer
holds these controls"), `verify-dialog-hit-testing.mjs` 16/16 (both glass
modes, including the Settings→Clear Glass path), `verify-network-isolation.mjs`
4/4 (unaffected — no header/sidebar changes touch it),
`verify-responsive.mjs` rewritten for the new breakpoint model and back to
60/60 across all six required viewports, live resize (now exercised at the
480px width that actually crosses the new 640px rail threshold, since
768px no longer does), and the 844×390 landscape case (which now correctly
expects the full sidebar, not the rail, since 844px is above 640px).

Everything above was real-browser CDP verification (real dispatched pointer
clicks, real hit-testing), the same limitation the first pass's own report
already disclosed: it is not iOS Safari, and cannot exercise a real
on-screen keyboard or real touch gestures. The same iPhone checklist above
still applies; add to it — confirm the composer's provider menu and the
Settings sheet both reposition sensibly when the real keyboard opens, since
that is the one new behavior this pass added that a headless browser cannot
fully prove.
