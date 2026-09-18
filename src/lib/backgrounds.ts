/**
 * Backgrounds come in two collections:
 *
 * - Ambient: three CSS-gradient presets derived from references/code.html.
 * - Luxury:  four bundled local SVG artworks in /public/backgrounds.
 *
 * Emerald Velvet and Sunset Horizon were removed in Milestone 2B: both sat at
 * mid luminance, which the binary light/dark ink system cannot serve, and both
 * failed WCAG AA on muted text.
 *
 * `id` matches the `data-preset` attribute that globals.css keys off.
 */

export type BackgroundId =
  | "warm"
  | "obsidian"
  | "marble"
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
    description: "Cool veined silver and slate",
    collection: "Ambient",
    tone: "light",
    swatch: "linear-gradient(135deg, #f1f5f9, #cbd5e1)",
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
  // 2B: white orbs dialled back and the slate orb strengthened, so the preset
  // keeps its airy feel without washing out to near-white.
  marble: [
    { className: "top-[5%] right-[10%] w-[580px] h-[580px]", color: "rgba(255, 255, 255, 0.3)", blur: "100px" },
    { className: "-bottom-[12%] left-[22%] w-[880px] h-[480px]", color: "rgba(214, 223, 234, 0.34)", blur: "110px" },
    { className: "top-[22%] left-[6%] w-[480px] h-[680px]", color: "rgba(126, 142, 164, 0.42)", blur: "120px" },
    { className: "bottom-[18%] right-[16%] w-[420px] h-[420px]", color: "rgba(140, 156, 176, 0.32)", blur: "95px" },
  ],
  "champagne-silk": [],
  "emerald-onyx": [],
  "amethyst-bloom": [],
  "amber-aurora": [],
};
