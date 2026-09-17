/**
 * Backgrounds come in two collections:
 *
 * - Ambient: the five CSS-gradient presets from references/code.html.
 * - Luxury:  four bundled local SVG artworks in /public/backgrounds.
 *
 * `id` matches the `data-preset` attribute that globals.css keys off.
 */

export type BackgroundId =
  | "warm"
  | "obsidian"
  | "marble"
  | "emerald"
  | "sunset"
  | "champagne-silk"
  | "emerald-onyx"
  | "amethyst-bloom"
  | "amber-aurora";

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
    id: "warm",
    name: "Warm Studio",
    description: "Taupe architectural light",
    collection: "Ambient",
    tone: "light",
    swatch: "linear-gradient(135deg, #ad9f92, #7d7065)",
  },
  {
    id: "obsidian",
    name: "Smoky Obsidian",
    description: "Dark luxury moody glow",
    collection: "Ambient",
    tone: "dark",
    swatch: "linear-gradient(135deg, #1e2433, #0d1117)",
  },
  {
    id: "marble",
    name: "Pearl White Marble",
    description: "Bright veined minimal silver",
    collection: "Ambient",
    tone: "light",
    swatch: "linear-gradient(135deg, #f1f5f9, #cbd5e1)",
  },
  {
    id: "emerald",
    name: "Emerald Velvet",
    description: "Rich jewel forest ambiance",
    collection: "Ambient",
    tone: "dark",
    swatch: "linear-gradient(135deg, #047857, #062820)",
  },
  {
    id: "sunset",
    name: "Sunset Horizon",
    description: "Warm rose gold luminance",
    collection: "Ambient",
    tone: "dark",
    swatch: "linear-gradient(135deg, #fb923c, #701a4f)",
  },
  {
    id: "champagne-silk",
    name: "Champagne Silk",
    description: "Ivory folds with restrained gold",
    collection: "Luxury",
    tone: "light",
    swatch: "url('/backgrounds/champagne-silk.svg') center/cover",
  },
  {
    id: "emerald-onyx",
    name: "Emerald Onyx",
    description: "Deep emerald over charcoal",
    collection: "Luxury",
    tone: "dark",
    swatch: "url('/backgrounds/emerald-onyx.svg') center/cover",
  },
  {
    id: "amethyst-bloom",
    name: "Amethyst Bloom",
    description: "Smoky plum with soft rose",
    collection: "Luxury",
    tone: "dark",
    swatch: "url('/backgrounds/amethyst-bloom.svg') center/cover",
  },
  {
    id: "amber-aurora",
    name: "Amber Aurora",
    description: "Terracotta, amber and burgundy",
    collection: "Luxury",
    tone: "dark",
    swatch: "url('/backgrounds/amber-aurora.svg') center/cover",
  },
] as const;

export const BACKGROUND_COLLECTIONS = ["Ambient", "Luxury"] as const;

export const DEFAULT_BACKGROUND: BackgroundId = "warm";

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

export const GLASS_STYLES: readonly GlassStyle[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Approved frosted panel",
  },
  {
    id: "ultra",
    name: "Ultra Clear",
    description: "Open centre, lit edges",
  },
];

export const DEFAULT_GLASS: GlassStyleId = "classic";

/* --- Ambient orbs ---------------------------------------------------------
   Only the gradient presets get orbs; the Luxury artworks carry their own
   lighting, so layering orbs on top would muddy them.
-------------------------------------------------------------------------- */

export type AmbientOrb = {
  className: string;
  color: string;
  blur: string;
};

export const AMBIENT_ORBS: Record<BackgroundId, readonly AmbientOrb[]> = {
  warm: [
    { className: "top-[5%] right-[10%] w-[580px] h-[580px]", color: "rgba(250, 237, 216, 0.45)", blur: "100px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(235, 220, 208, 0.5)", blur: "110px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(82, 68, 58, 0.35)", blur: "120px" },
    { className: "bottom-[22%] right-[18%] w-[420px] h-[420px]", color: "rgba(244, 231, 216, 0.4)", blur: "90px" },
  ],
  obsidian: [
    { className: "top-[5%] right-[10%] w-[600px] h-[600px]", color: "rgba(59, 130, 246, 0.2)", blur: "130px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(30, 41, 59, 0.4)", blur: "120px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(15, 23, 42, 0.5)", blur: "110px" },
  ],
  marble: [
    { className: "top-[5%] right-[10%] w-[580px] h-[580px]", color: "rgba(255, 255, 255, 0.6)", blur: "100px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(226, 232, 240, 0.6)", blur: "110px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(148, 163, 184, 0.3)", blur: "120px" },
  ],
  emerald: [
    { className: "top-[5%] right-[10%] w-[580px] h-[580px]", color: "rgba(16, 185, 129, 0.25)", blur: "110px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(4, 120, 87, 0.3)", blur: "120px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(2, 44, 34, 0.5)", blur: "110px" },
  ],
  sunset: [
    { className: "top-[5%] right-[10%] w-[580px] h-[580px]", color: "rgba(251, 146, 60, 0.4)", blur: "100px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(244, 63, 94, 0.35)", blur: "120px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(112, 26, 79, 0.4)", blur: "110px" },
  ],
  "champagne-silk": [],
  "emerald-onyx": [],
  "amethyst-bloom": [],
  "amber-aurora": [],
};
