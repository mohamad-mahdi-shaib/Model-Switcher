/**
 * The five ambient presets from references/code.html. `id` matches the
 * `data-preset` attribute that globals.css keys its gradients off.
 */

export type BackgroundId =
  | "warm"
  | "obsidian"
  | "marble"
  | "emerald"
  | "sunset";

export type Background = {
  id: BackgroundId;
  name: string;
  description: string;
  /** Swatch gradient shown on the picker card. */
  swatch: string;
  /** Dark presets flip the workspace ink to a light colour. */
  tone: "light" | "dark";
};

export const BACKGROUNDS: readonly Background[] = [
  {
    id: "warm",
    name: "Warm Studio",
    description: "Taupe architectural light",
    swatch: "linear-gradient(135deg, #ad9f92, #7d7065)",
    tone: "light",
  },
  {
    id: "obsidian",
    name: "Smoky Obsidian",
    description: "Dark luxury moody glow",
    swatch: "linear-gradient(135deg, #1e2433, #0d1117)",
    tone: "dark",
  },
  {
    id: "marble",
    name: "Pearl White Marble",
    description: "Bright veined minimal silver",
    swatch: "linear-gradient(135deg, #f1f5f9, #cbd5e1)",
    tone: "light",
  },
  {
    id: "emerald",
    name: "Emerald Velvet",
    description: "Rich jewel forest ambiance",
    swatch: "linear-gradient(135deg, #047857, #062820)",
    tone: "dark",
  },
  {
    id: "sunset",
    name: "Sunset Horizon",
    description: "Warm rose gold luminance",
    swatch: "linear-gradient(135deg, #fb923c, #701a4f)",
    tone: "dark",
  },
] as const;

export const DEFAULT_BACKGROUND: BackgroundId = "warm";

/** Ambient blur orbs layered behind the panels, per preset. */
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
};
