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

**Background — Ambient (5).** The original CSS-gradient presets, unchanged.

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

**Glass — Ultra Clear.** Refined against
`references/IMG_3830_files/IMG_3830.jpeg` (the lower of the two renders; the
phone chrome, video overlay and glass sculpture are out of scope):

- Panel fill is a rim-weighted radial bottoming out at ~0.008 alpha through
  the centre, so there is no milky fill.
- Backdrop blur 3px, down from Classic's 16px, so background shapes stay
  identifiable rather than smeared.
- Bevel from narrow contours: a bright 1px top edge, a darker lower edge, and
  a faint inner rim reading as glass thickness.
- `::before` carries **uneven** specular — brightest at top-right, strong at
  bottom-right, softer on the left — masked to a `--rim`-thick ring.
- `::after` carries prismatic hints confined to two short rim segments by
  narrow gradient stops. Never a full rainbow border or a panel-wide tint.
- Both pseudo-elements are `pointer-events: none` and rim-masked, so they
  cannot intercept clicks or cover focus rings.

These are **visual approximations**. Nothing here computes refraction,
dispersion or caustics.

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
- **Two background layers still flatten the panel centre**, and both are shared
  with Classic so they were left alone: the ambient orbs (90–130px blur) on the
  gradient presets, and the `calm` centre wash inside each Luxury SVG. If Ultra
  Clear should reveal more detail, reducing the SVG `calm` stop opacity is the
  next lever — but it changes how Classic looks on those backgrounds too, so it
  is a deliberate decision rather than a tweak.
