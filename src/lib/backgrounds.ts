/**
 * Backgrounds: exactly THREE choices, by explicit later decision (Settings
 * pass), reduced from the eight this app shipped with earlier. This is a
 * deliberate reduction, not a regression -- see `docs/settings-and-
 * personalization.md` for the full record.
 *
 * - Pearl: the exact same treatment previously shipped as "Pearl White
 *   Marble" (id `marble`) -- the actual approved pearl-white glass
 *   appearance, not a new look merely because its name contains "Pearl".
 *   Only its `id` changed (`marble` -> `pearl`); swatch, tone, and orbs are
 *   untouched.
 * - Obsidian: the exact same treatment previously shipped as "Smoky
 *   Obsidian" -- id, swatch, tone, and orbs all untouched.
 * - Champagne Luxury: a new, original local SVG (`/public/backgrounds/
 *   champagne-luxury.svg`) -- elegant flowing gold line work concentrated
 *   near the outer edges, a deliberately quiet centre for text
 *   readability. No remote image dependency, no copied stock asset.
 *
 * `id` matches the `data-preset` attribute that globals.css keys off.
 */

export type BackgroundId = "pearl" | "obsidian" | "champagne-luxury";

export type BackgroundTone = "light" | "dark";

export type Background = {
  id: BackgroundId;
  name: string;
  description: string;
  collection: "Ambient" | "Luxury";
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
    id: "obsidian",
    name: "Obsidian",
    description: "Dark luxury moody glow",
    collection: "Ambient",
    tone: "dark",
    swatch: "linear-gradient(135deg, #1e2433, #0d1117)",
  },
  {
    id: "champagne-luxury",
    name: "Champagne Luxury",
    description: "Cream and gold, quiet at the centre",
    collection: "Luxury",
    tone: "light",
    swatch: "url('/backgrounds/champagne-luxury.svg') center/cover",
  },
] as const;

export const BACKGROUND_COLLECTIONS = ["Ambient", "Luxury"] as const;

export const DEFAULT_BACKGROUND: BackgroundId = "pearl";

/**
 * A saved id from before the reduction to three (`warm`, `marble`,
 * `champagne-silk`, `emerald-onyx`, `amethyst-bloom`, `amber-aurora`,
 * `luxury-salon`) is migrated, never left blank or invalid: `marble`
 * becomes `pearl` (the same approved treatment, renamed); every other
 * removed id falls back to the new default. A valid current id passes
 * through unchanged.
 */
export function migrateBackgroundId(id: string | undefined | null): BackgroundId {
  if (id === "marble") return "pearl";
  if (BACKGROUNDS.some((b) => b.id === id)) return id as BackgroundId;
  return DEFAULT_BACKGROUND;
}

export function backgroundTone(id: BackgroundId): BackgroundTone {
  return BACKGROUNDS.find((background) => background.id === id)?.tone ?? "light";
}

/* --- Glass appearance ----------------------------------------------------- */

export type GlassStyleId = "classic" | "ultra";

export type GlassStyle = {
  id: GlassStyleId;
  name: string;
  description: string;
};

/*
 * `id` is the internal key that globals.css selects on via data-glass, and it
 * deliberately does NOT track the display name: renaming a label must never
 * change which material renders. "classic" is Glowy Glass, "ultra" is Clear
 * Glass.
 */
export const GLASS_STYLES: readonly GlassStyle[] = [
  {
    id: "classic",
    name: "Glowy Glass",
    description: "Approved frosted panel",
  },
  {
    id: "ultra",
    name: "Clear Glass",
    description: "Open centre, lit edges",
  },
];

export const DEFAULT_GLASS: GlassStyleId = "classic";

/* --- Ambient orbs ---------------------------------------------------------
   Only the two Ambient presets get orbs; Champagne Luxury carries its own
   lighting (the SVG's own gold glow/line work), so layering orbs on top
   would muddy it, matching the same rule the previous Luxury artworks
   always followed.
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
  obsidian: [
    { className: "top-[5%] right-[10%] w-[600px] h-[600px]", color: "rgba(59, 130, 246, 0.2)", blur: "130px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(30, 41, 59, 0.4)", blur: "120px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(15, 23, 42, 0.5)", blur: "110px" },
  ],
  "champagne-luxury": [],
};
