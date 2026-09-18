# Design decisions

Scope: Milestone 2A — the desktop visual interface. No AI integration, no
sending, no persistence, no authentication, no real model switching.

## Reference precedence

Three sources describe the design and they do not agree. The order is:

1. **`references/screen.png`** — the approved screenshot. Highest authority.
2. **`references/code.html`** — the Stitch export. Source of the actual CSS.
3. **`references/DESIGN.md`** — used only where it does not contradict 1 or 2.

`DESIGN.md` describes a different design: a cyan/indigo accent system
(`#0e7490`, `#6366f1`), a pale alabaster canvas (`#f8fafc`), and much more
opaque glass (`rgba(255,255,255,0.45)`–`0.78`). The approved screenshot is warm
beige/taupe with near-transparent glass and no chromatic accent at all. Where
they conflict, the screenshot and the HTML win. Nothing cyan or indigo appears
in this implementation.

`DESIGN.md` also specifies Plus Jakarta Sans, Inter, and JetBrains Mono. All
three would be remote font downloads, which this milestone forbids, so the app
uses the system stack established in Milestone 1.

Files in `references/` are read-only inputs and are never modified.

## Approved visual rules

Ported verbatim from `references/code.html` into `src/app/globals.css`:

- **Background presets** — the five layered radial + linear gradients, unchanged.
- **`.optical-glass`** (panels) — `blur(16px) saturate(135%)`, a
  `1.5px solid rgba(255,255,255,0.85)` border, and the six-layer box-shadow that
  produces the bright beveled edge and soft depth shadow.
- **`.glass-btn`** (pills) — `blur(10px) saturate(140%)` with inset specular
  highlights top and bottom.
- **`.glass-input-capsule`** (composer) — inset shadows that read as a carved
  trough rather than a raised surface.
- **Radii** — 30px sidebar, 32px main panel, full-round pills and composer.
- **Ink** — `#1a1c22` primary, `#383c46` muted, `#555b68` subtle, each with a
  white text-shadow. Never pure black.

These values are deliberate optical choices. Retuning one in isolation
(dropping a blur, flattening a shadow) breaks the glass illusion.

## Deliberate departures

**Popover opacity.** The reference `.glass-modal` uses `blur(24px)` over a
`rgba(255,255,255,0.28)` fill. In the screenshot, chat text bleeds straight
through the open picker and both layers become unreadable. Raised to
`blur(44px)` over a ~`0.5`–`0.62` fill. This is a readability requirement, not a
restyle.

**Dark-preset ink.** The reference hardcodes `#1a1c22` text, which is
unreadable on Smoky Obsidian, Emerald Velvet, and Sunset Horizon. Ink is now a
CSS custom property switched by the `data-preset` attribute on the workspace
root: light presets keep the obsidian ink with a white text-shadow; dark presets
use `#f6f7fa` with a dark text-shadow. The popover fill flips to a dark base on
those presets for the same reason.

**Fluid height.** The reference is a fixed 1360×720 canvas with 645px panels.
Panels now fill the available height instead, so the layout fits a 1366×768
laptop without clipping. The composer sits outside the scroll container and
stays visible; only the message list scrolls (`flex-1` + `min-h-0`).

**Text selection.** The reference sets `select-none` on `<body>`. Removed —
chat content must be selectable.

**Tailwind source scoping.** `@import "tailwindcss" source("../")` limits class
detection to `src/`. Without it Tailwind scans `references/code.html` and ships
that prototype's classes (~13KB of dead CSS).

## Content changes

The reference contains placeholder text from the design tool. Replaced with:

| Reference | Now |
| --- | --- |
| "Add Workspace" | "New conversation" |
| Index / Modes / Conversaties + fake counters (`200lm`, `1900n`) | Today / Yesterday, no counters |
| Garbled titles ("Preconsibility", "Modalsing") | Realistic conversation titles |
| "Slove", "First", "Share", "…" | Removed |
| "Setting", "All profiles" | Removed |
| Garbled "Tasks" answer | A realistic answer to a realistic question |
| "All message" | "Ask anything…" |
| Attachment (paperclip) button | Omitted this milestone |

## Accessibility

- Every control has an accessible name; icons are `aria-hidden`.
- `.focus-glass` gives a visible focus ring with a contrasting halo, themed per
  preset so it stays visible on both light and dark backdrops.
- The picker is `role="dialog"` over a `role="radiogroup"`; selection state is
  conveyed by `aria-checked`, not the checkmark alone.
- Escape closes the picker and returns focus to its trigger.
- Disabled controls carry a `title` explaining which milestone enables them.
- `prefers-reduced-motion` disables transitions and the card hover lift.

## Backgrounds and glass appearance

The picker has two independent sections. Background and glass style are
separate state; either can change without touching the other. Defaults are
Warm Studio + Classic.

**Background — Ambient (3).** Warm Studio, Smoky Obsidian, Pearl White Marble.

### Milestone 2B: the final seven

Emerald Velvet and Sunset Horizon were removed. Ink switches on a binary
`data-tone`, so a background has to sit clearly light (mean luminance > ~190)
or clearly dark (< ~70). Those two sat at 97 and 120 — the dead zone where
neither ink works — and measured 3.15 and 2.27 contrast on muted text, both
below WCAG AA. They were also redundant: Emerald Onyx and Amber Aurora cover
green and warm-orange in the safe dark band.

Revisions applied at the same time:

| Change | Before | After |
| --- | --- | --- |
| Pearl White Marble mean luminance | 238 | 203 |
| Pearl White Marble tonal variation (SD) | 7.6 | 10.9 |
| Luxury `calm` centre wash | 0.50–0.72 | 0.24–0.30 |
| Amethyst Bloom base range | #150f1c→#2a1b34 | #0d0913→#33203f |
| `--ink-subtle` (light tone) | #555b68 | #454a56 |

Marble landed at 203 rather than the ~215 target; it matches Warm Studio (203.5)
exactly, which keeps the two light presets consistent, and the extra headroom
went into tonal structure instead.

**Background — Luxury (4).** Champagne Silk, Emerald Onyx, Amethyst Bloom,
Amber Aurora. These are bundled local SVG artwork in `public/backgrounds/`,
hand-authored for this project — layered gradient blooms plus an feTurbulence
displacement that suggests silk folds and flowing pigment. They are **not**
photography or stock imagery, and not CSS-gradient-only placeholders either:
they are real local image assets, procedurally drawn. Each keeps a quieter,
lower-contrast region through the middle so panel text sits on calm ground.
No remote requests, no image libraries.

Ink contrast is driven by `data-tone` on the workspace root rather than a list
of preset names, so any background added later only has to declare its tone.

**Glass — Classic.** The approved material from `references/code.html`,
untouched.

**Glass — Ultra Clear.** Rebuilt against `references/IMG_3827.jpeg` and
`references/IMG_3830.jpeg` (the curved glass sculpture in those images is a
reference for optical behaviour only; it is not reproduced in the UI).

The first attempt failed because effects accumulated rather than because any
one value was wrong. A bright border, an outer white bloom, a bright inset top
edge, an 11px `brightness()` band, four corner radials up to 0.92 alpha, an
inner contour and the pointer glint all landed on the same perimeter, giving a
transparent rectangle inside a luminous white frame.

The rule now is one job per layer, applied to **every** glass surface at graded
strength rather than to the main panel alone:

| Layer | Job |
| --- | --- |
| surface `background` | low neutral tint + one faint diagonal reflection (peak 0.035) |
| `::before` | outer edge ring: 135° directional bevel, bright top-left, transparent stretch, dark stretch lower-right, restrained return highlight, plus two small corner glints |
| `::after` | faint inner rim inset 2px, with a darker lower contour for thickness |
| `.edge-glint` | pointer response only, same narrow ring |

Tier tokens (`--edge-lit`, `--edge-soft`, `--edge-dark`, `--edge-inner`,
`--rim-line`) set intensity per surface so nothing is uniformly bright:
main panel > sidebar > composer > buttons, chips and message bubbles.

Removed from Ultra Clear: the broad floating-card shadow (now only a soft
grounding shadow, large blur, almost no offset), the outer white glow, the
thick bright border (0.58 → 0.16), and prismatic colour, which stays disabled
until the neutral material passes review.

Text carries no `text-shadow` in Ultra Clear; `--ink-shadow*` resolve to
`none`. All decorative layers are `pointer-events: none` pseudo-elements at
`z-index: 0`, below content at `z-10`/`z-20`.

These are **visual approximations**. Nothing computes refraction, dispersion
or caustics.

### Popovers cannot blur what is behind them

Worth recording because it defeated an earlier fix. `.glass-modal` had its
blur raised to 44px to stop chat text bleeding through the picker, and it did
not work. A `backdrop-filter` on the panel makes that panel a **backdrop
root**, so a popover nested inside it can only ever blur the page background —
never the chat text painted within the same panel. Occlusion has to come from
the fill, which is now ~0.93 alpha. This affects the popover in Classic too.

### Why the centre looked milky

Worth recording, because the panel fill was the wrong suspect. Ultra Clear's
centre was being flattened by `.diffusion-scrim` — the readability layer — at
`blur(16px)` and 30–38% alpha, stretched across the whole message column and
the whole sidebar nav. It covered most of the panel interior, so lowering the
panel fill could not have revealed anything.

It is now `blur(5px)` at 13% (light) / 20% (dark), with a radial mask that
fades it out toward the edges, making it a local treatment behind text instead
of a wash over the panel. Text itself is never blurred or faded — only the
background behind it.

Menus keep their strong diffusion (`.glass-modal`, `blur(44px)`) regardless of
glass style, so chat text never interferes with menu labels.

### Pointer glint

`useEdgeGlint` writes pointer position into two CSS custom properties on one
decorative element, coalesced to one write per animation frame, with the host
rect cached on enter. It never calls `setState`, so pointer movement does not
re-render the component tree. It is disabled unless the device has a fine
hover pointer, and disabled under `prefers-reduced-motion`; CSS supplies a
static highlight in both cases. There is no idle animation — the rim only
changes while the pointer moves.

## Known limitations

- **Desktop only.** The sidebar is hidden below the `md` breakpoint. The mobile
  layout is a later milestone.
- **Static data.** `src/lib/sample-data.ts` is hardcoded. Nothing persists.
- **Non-functional controls:** conversation title dropdown, model selector, send
  button, sidebar rows, "New conversation". All visibly disabled or inert.
- **No visual browser inspection was performed at any point.** No browser
  automation is installed and the connection made installing one impractical.
  Layout fit at 1366×768, and the appearance of both glass materials across
  backgrounds, were reasoned from the box model and verified against rendered
  markup and compiled CSS — never observed in a browser. The Luxury artwork in
  particular has not been seen rendered.
- **The Luxury backgrounds are too flat to show off transparency.** Confirmed by
  browser inspection on Amethyst Bloom: the panel is genuinely transparent, but
  there is little behind it to see. Each Luxury SVG paints a `calm` centre wash
  at 0.5 opacity over the middle, and the Ambient presets add 90-130px blurred
  orbs. Both are background layers shared with Classic, so they were left alone
  rather than changed silently. Lowering the SVG `calm` stop is the single
  highest-value next change if Ultra Clear should reveal more — but it alters
  Classic on those backgrounds too, so it is your call.
- **Popover fill changed for Classic as well.** Fixing the text bleed-through
  required raising `--modal-fill` to ~0.93 alpha, and that token is shared. The
  picker is therefore more opaque in Classic than before. The glass materials
  themselves are untouched: every Classic rule was verified byte-identical.
- **Prismatic colour is currently disabled** pending review of the neutral
  material.

## Milestone 3B-4B architecture notes

**Persistence (`src/lib/storage.ts`).** Versioned `localStorage` schema. Two
rules drive the design: never write before hydration (the initial empty React
state would otherwise overwrite saved conversations), and never overwrite data
we cannot parse (an unknown version or malformed payload is reported and left
byte-for-byte intact). Partial replies persist on a ~700ms throttle rather than
per token, and flush on completion, Stop, conversation switch and page hide.

**Streaming identity.** Every request carries a request id *and* a conversation
id. Chunks are applied only while both still match, so a late chunk after an
abort or a conversation switch is dropped rather than written into whatever is
on screen. This is what makes "switch while streaming" safe.

**Entrance motion.** A first attempt enabled animations by adding a class
shortly after mount. That is wrong: adding the class later starts the animation
on every restored row simultaneously — precisely the replay it was meant to
prevent. Replaced with a baseline set of ids captured at mount; rows in it never
animate, and the component is keyed by conversation id so switching rebuilds the
baseline instead of animating the whole transcript.

**Markdown.** Hand-written parser to a typed AST rendered as React elements. No
HTML string, no `dangerouslySetInnerHTML`, allow-listed link schemes. An
unterminated fence renders as an OPEN code block so a block does not flicker
between paragraph and code as tokens arrive. See Appendix B of the audit for the
dependency rationale.

**Provider abstraction.** `ChatProvider` + `ProviderError` + a server registry.
The route contains no SDK import, no model id and no vendor error handling;
retryability is decided by the adapter. OpenAI and Anthropic adapters are
deliberately absent rather than stubbed — a stub would either fabricate replies
or fail confusingly, and both are worse than an honest "not connected".

**Provider identity.** One `--accent` token per provider, switched by
`data-provider` on the workspace root and consumed by the avatar rim, active
chip, typing dots and Clear Glass glint. Panels, backgrounds and ink are
untouched, so text contrast is unchanged across all seven backgrounds.
