import type { Conversation } from "@/lib/storage";

/**
 * Derives a title from the first user message. Purely local string work -- it
 * must never cost an API request.
 */
export function deriveTitle(firstUserMessage: string): string {
  const flat = firstUserMessage.replace(/\s+/g, " ").trim();
  if (!flat) return "New conversation";

  // Prefer a natural clause boundary so titles read as phrases, not truncations.
  const clause = flat.split(/(?<=[.!?])\s|[\n·—–]/)[0] ?? flat;
  const base = clause.length >= 12 && clause.length <= 48 ? clause : flat;

  if (base.length <= 48) return base.replace(/[.?!,;:]+$/, "");

  const cut = base.slice(0, 48);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 24 ? cut.slice(0, lastSpace) : cut).replace(/[.?!,;:]+$/, "")}…`;
}

export type ConversationGroup = {
  label: string;
  conversations: Conversation[];
};

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Groups by recency: Today, Yesterday, Previous. Newest first throughout. */
export function groupByRecency(
  conversations: readonly Conversation[],
  now: number = Date.now(),
): ConversationGroup[] {
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;

  const buckets: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    Previous: [],
  };

  for (const c of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const day = startOfDay(c.updatedAt);
    if (day >= today) buckets.Today.push(c);
    else if (day >= yesterday) buckets.Yesterday.push(c);
    else buckets.Previous.push(c);
  }

  return (["Today", "Yesterday", "Previous"] as const)
    .map((label) => ({ label, conversations: buckets[label] }))
    .filter((g) => g.conversations.length > 0);
}

/** A conversation is only persisted once it holds real content. */
export function isDraft(c: Conversation): boolean {
  return c.messages.length === 0;
}

export function savedOnly(conversations: readonly Conversation[]): Conversation[] {
  return conversations.filter((c) => !isDraft(c));
}
