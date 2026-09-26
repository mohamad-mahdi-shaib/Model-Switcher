import type { Conversation } from "@/lib/storage";

/**
 * Local, in-memory search over saved conversations -- titles and saved
 * message text. Pure function, no network, recomputed fresh from whatever
 * `conversations` currently is on every call: there is no separate cached
 * index to go stale after a rename, delete, or new message, which is what
 * keeps results correct after all three without any invalidation logic.
 *
 * Case-insensitive matching via `.toLowerCase()` on both sides is correct
 * for Arabic text too, with no special-casing: Arabic has no case
 * distinction, so `.toLowerCase()` is a no-op on it and the substring
 * check behaves exactly like a plain (already case-insensitive by
 * nature) comparison.
 */

export type SearchResult = {
  /** Stable id for this one match (react key / aria-activedescendant). */
  id: string;
  conversationId: string;
  conversationTitle: string;
  /** null for a title-only match -- there is no specific message to jump to. */
  messageId: string | null;
  snippet: string;
  /** Offsets into `snippet`, for highlighting the matched substring. */
  matchStart: number;
  matchLength: number;
  matchedInTitle: boolean;
};

const SNIPPET_RADIUS = 42;

function buildSnippet(
  content: string,
  matchIndex: number,
  matchLength: number,
): { snippet: string; matchStart: number; matchLength: number } {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  const windowed = content.slice(start, end).replace(/\s+/g, " ");
  return {
    snippet: `${prefix}${windowed}${suffix}`,
    matchStart: prefix.length + (matchIndex - start),
    matchLength,
  };
}

export function searchConversations(
  conversations: readonly Conversation[],
  query: string,
): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();

  const results: SearchResult[] = [];
  for (const conv of conversations) {
    const titleIdx = conv.title.toLowerCase().indexOf(needle);
    if (titleIdx !== -1) {
      const { snippet, matchStart, matchLength } = buildSnippet(conv.title, titleIdx, needle.length);
      results.push({
        id: `${conv.id}:title`,
        conversationId: conv.id,
        conversationTitle: conv.title,
        messageId: null,
        snippet,
        matchStart,
        matchLength,
        matchedInTitle: true,
      });
    }
    for (const message of conv.messages) {
      const idx = message.content.toLowerCase().indexOf(needle);
      if (idx === -1) continue;
      const { snippet, matchStart, matchLength } = buildSnippet(message.content, idx, needle.length);
      results.push({
        id: message.id,
        conversationId: conv.id,
        conversationTitle: conv.title,
        messageId: message.id,
        snippet,
        matchStart,
        matchLength,
        matchedInTitle: false,
      });
    }
  }

  // Title matches first, then newest conversation first -- mirrors
  // groupByRecency()'s own recency-first convention (conversations.ts).
  const updatedAtById = new Map(conversations.map((c) => [c.id, c.updatedAt]));
  results.sort((a, b) => {
    if (a.matchedInTitle !== b.matchedInTitle) return a.matchedInTitle ? -1 : 1;
    return (updatedAtById.get(b.conversationId) ?? 0) - (updatedAtById.get(a.conversationId) ?? 0);
  });
  return results;
}
