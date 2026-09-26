/**
 * Conversation text size (Settings > Appearance). Applied only to message
 * text via the `--text-scale` CSS variable (`globals.css`'s
 * `[data-text-size]` rules, read by `MessageList.tsx`/`Markdown.tsx`) --
 * never to navigation chrome, buttons, or labels.
 */
export type TextSizeId = "small" | "default" | "large";

export type TextSizeOption = {
  id: TextSizeId;
  name: string;
};

export const TEXT_SIZES: readonly TextSizeOption[] = [
  { id: "small", name: "Small" },
  { id: "default", name: "Default" },
  { id: "large", name: "Large" },
];

export const DEFAULT_TEXT_SIZE: TextSizeId = "default";

export function isTextSizeId(v: unknown): v is TextSizeId {
  return v === "small" || v === "default" || v === "large";
}
