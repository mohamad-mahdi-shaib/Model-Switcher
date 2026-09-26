import { parseMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown";

/**
 * Strips an assistant answer down to text worth actually speaking aloud.
 * Reused from the same AST `Markdown.tsx` already renders from, rather than
 * a second regex-based parser -- heading hashes, emphasis markers, list
 * bullets and link syntax would otherwise be read character-for-character
 * by most speech synthesis engines ("asterisk asterisk bold asterisk
 * asterisk").
 */

function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value;
        case "code":
          return node.value;
        case "strong":
        case "em":
        case "link":
          return inlineToText(node.children);
      }
    })
    .join("");
}

/**
 * Code blocks are omitted entirely rather than read character-by-character
 * (raw source is not "readable text" once spoken) -- a deliberate scope
 * limit, not an oversight; see docs/interaction-refinement.md.
 */
function blockToText(node: BlockNode): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "quote":
      return inlineToText(node.children);
    case "list":
      return node.items.map((item) => inlineToText(item)).join(". ");
    case "code":
    case "hr":
      return "";
  }
}

export function markdownToSpeechText(content: string): string {
  return parseMarkdown(content)
    .map(blockToText)
    .filter((text) => text.trim().length > 0)
    .join(". ");
}

/** Arabic Unicode block -- used to pick a language for speech synthesis. */
const ARABIC_RE = /[؀-ۿ]/;

export function detectSpeechLang(text: string): "ar" | "en" {
  return ARABIC_RE.test(text) ? "ar" : "en";
}
