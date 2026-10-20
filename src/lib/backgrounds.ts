/**
 * Backgrounds: exactly TWO choices, by explicit later decision (UI-update
 * pass), reduced from the three the Settings pass had shipped -- itself
 * already a deliberate reduction from eight. See `docs/settings-and-
 * personalization.md` for the earlier record.
 *
 * - Pearl: the exact same treatment previously shipped as "Pearl White
 *   Marble" (id `marble`) -- the actual approved pearl-white glass
 *   appearance. Swatch, tone, and orbs are untouched by this pass.
 * - Aurora Colors: new in this pass, retuned darker and more purple since.
 *   A pure-CSS aurora -- violet and cyan along the top, purple and magenta
 *   sweeping the lower corners, over a near-black plum ground that stays
 *   quiet through the centre so conversation text keeps its contrast (the
 *   darker the ground, the more contrast the light ink has). No image request, no
 *   canvas, no per-frame JS: layered radial gradients plus the existing
 *   ambient-orb mechanism (three orbs, slow GPU-composited drift, off
 *   entirely under `prefers-reduced-motion`).
 *
 * Removed in this pass: `obsidian` (the dark-mode wallpaper) and
 * `champagne-luxury` (the luxury wallpaper), with their CSS, the luxury
 * artwork asset, and their per-preset glass tints all deleted rather than
 * left dormant. `migrateBackgroundId` keeps every saved id resolving to a
 * real current one.
 *
 * `id` matches the `data-preset` attribute that globals.css keys off.
 */

export type BackgroundId = "pearl" | "aurora";

export type BackgroundTone = "light" | "dark";

export type Background = {
  id: BackgroundId;
  name: string;
  description: string;
  collection: "Ambient";
  /** Drives the ink/contrast set applied to the whole workspace. */
  tone: BackgroundTone;
  /** Swatch shown on the picker card: a gradient, or the artwork itself. */
  swatch: string;
};

export const BACKGROUNDS: readonly Background[] = [
  {
    id: "pearl",
    name: "Pearl",
    description: "Cool veined silver and slate",
    collection: "Ambient",
    tone: "light",
    swatch: "linear-gradient(135deg, #f1f5f9, #cbd5e1)",
  },
  {
    id: "aurora",
    name: "Aurora Colors",
    description: "Violet and magenta over near-black plum",
    collection: "Ambient",
    tone: "dark",
    swatch:
      "linear-gradient(135deg, #06040e 0%, #22d3ee 18%, #6d28d9 48%, #a855f7 74%, #c026d3 100%)",
  },
] as const;

/**
 * Both remaining presets are Ambient (CSS-only lighting), so this is now a
 * single-entry list -- kept, rather than inlined away, because the picker
 * still groups by it and a later artwork preset would simply add its own
 * collection back.
 */
export const BACKGROUND_COLLECTIONS = ["Ambient"] as const;

export const DEFAULT_BACKGROUND: BackgroundId = "pearl";

/**
 * A saved id from any earlier set is migrated, never left blank or invalid.
 * Each removed id resolves to the nearest surviving treatment rather than
 * all collapsing onto the default, so a saved preference keeps as much of
 * its original character as the remaining two allow:
 *
 * - `marble` -> `pearl` (the same approved treatment, renamed earlier)
 * - `obsidian` -> `aurora` (the only remaining dark-tone wallpaper)
 * - `champagne-luxury`, `luxury-salon`, `champagne-silk` -> `pearl` (light)
 * - `emerald-onyx`, `amethyst-bloom`, `amber-aurora` -> `aurora` (dark,
 *   saturated -- what those three had in common)
 * - anything else unrecognised -> the default
 *
 * A valid current id passes through unchanged.
 */
const MIGRATED_BACKGROUND_IDS: Record<string, BackgroundId> = {
  marble: "pearl",
  warm: "pearl",
  "champagne-silk": "pearl",
  "champagne-luxury": "pearl",
  "luxury-salon": "pearl",
  obsidian: "aurora",
  "emerald-onyx": "aurora",
  "amethyst-bloom": "aurora",
  "amber-aurora": "aurora",
};

export function migrateBackgroundId(id: string | undefined | null): BackgroundId {
  if (BACKGROUNDS.some((b) => b.id === id)) return id as BackgroundId;
  // `Object.hasOwn`, never `in` -- see `migrateProviderId`'s own note: an
  // `in` check matches "__proto__" and returns an inherited value rather
  // than a BackgroundId. Pre-existing here; fixed alongside the identical
  // bug in the provider migration, since both read a persisted string.
  if (typeof id === "string" && Object.hasOwn(MIGRATED_BACKGROUND_IDS, id)) {
    return MIGRATED_BACKGROUND_IDS[id];
  }
  return DEFAULT_BACKGROUND;
}

export function backgroundTone(id: BackgroundId): BackgroundTone {
  return BACKGROUNDS.find((background) => background.id === id)?.tone ?? "light";
}

/* --- Glass appearance ----------------------------------------------------- */

/**
 * ONE glass style, by explicit request (UI-update pass): Clear Glass. The
 * second material this app used to offer -- "Glowy Glass", internal id
 * `classic` -- is gone from the type, the option list, the default, and the
 * stylesheet's own tuning for it.
 *
 * The id stays `ultra` and the `data-glass` attribute stays on the workspace
 * root: globals.css selects the whole Clear Glass material on
 * `[data-glass="ultra"]`, and those selectors are what give its rules their
 * specificity over the shared base surfaces they refine. Renaming the key to
 * match the label would be a pure-churn rewrite of ~20 selectors with real
 * cascade risk and no user-visible gain -- the label has deliberately never
 * tracked the key here (see `migrateGlassId` for how a saved `classic` is
 * resolved).
 */
export type GlassStyleId = "ultra";

export type GlassStyle = {
  id: GlassStyleId;
  name: string;
  description: string;
};

export const GLASS_STYLES: readonly GlassStyle[] = [
  {
    id: "ultra",
    name: "Clear Glass",
    description: "Open centre, lit edges",
  },
];

export const DEFAULT_GLASS: GlassStyleId = "ultra";

/**
 * Anything saved before Glowy Glass was removed -- including the literal
 * `"classic"` that used to be this app's default -- resolves to the one
 * remaining style instead of being treated as corrupt.
 */
export function migrateGlassId(id: string | undefined | null): GlassStyleId {
  return GLASS_STYLES.some((style) => style.id === id) ? (id as GlassStyleId) : DEFAULT_GLASS;
}

/* --- Ambient orbs ---------------------------------------------------------
   Both presets are CSS-lit, so both carry orbs -- Pearl's are unchanged
   from the approved set. Aurora's three also carry `aurora-orb` (slow
   drift, screen blending; see globals.css), which is what makes its colour
   transitions move rather than sit still.
-------------------------------------------------------------------------- */

export type AmbientOrb = {
  className: string;
  color: string;
  blur: string;
};

export const AMBIENT_ORBS: Record<BackgroundId, readonly AmbientOrb[]> = {
  pearl: [
    { className: "top-[5%] right-[10%] w-[580px] h-[580px]", color: "rgba(255, 255, 255, 0.3)", blur: "100px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(214, 223, 234, 0.34)", blur: "110px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(126, 142, 164, 0.42)", blur: "120px" },
    { className: "bottom-[18%] right-[16%] w-[420px] h-[420px]", color: "rgba(140, 156, 176, 0.32)", blur: "95px" },
  ],
  aurora: [
    {
      className: "aurora-orb aurora-orb-1 mix-blend-screen -top-[14%] left-[6%] w-[720px] h-[420px]",
      color: "rgba(124, 58, 237, 0.46)",
      blur: "120px",
    },
    {
      className: "aurora-orb aurora-orb-2 mix-blend-screen top-[6%] -right-[8%] w-[560px] h-[560px]",
      color: "rgba(192, 38, 211, 0.38)",
      blur: "130px",
    },
    {
      className: "aurora-orb aurora-orb-3 mix-blend-screen -bottom-[18%] left-[22%] w-[820px] h-[460px]",
      color: "rgba(34, 211, 238, 0.26)",
      blur: "140px",
    },
  ],
};
