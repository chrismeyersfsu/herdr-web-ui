/**
 * The thread sheet's API client: the pi threads extension's registry and
 * transcripts, read through the server (GET /api/pane/threads, GET
 * /api/pane/thread). Creating a thread is not an API call: the sheet submits
 * `/thread --quote "…" <question>` through the pane's composer, exactly like a
 * typed message, and the extension does the branching and the background run.
 */
import type { ConversationTurn, ThreadSummary } from "../../shared/protocol.ts";

export type { ThreadSummary };

export async function fetchPaneThreads(paneId: string): Promise<ThreadSummary[]> {
  const response = await fetch(`/api/pane/threads?pane_id=${encodeURIComponent(paneId)}`, { cache: "no-store" });
  if (!response.ok) return [];
  const payload = (await response.json()) as { threads?: ThreadSummary[] };
  return Array.isArray(payload.threads) ? payload.threads : [];
}

export async function fetchPaneThread(paneId: string, threadId: string): Promise<ConversationTurn[] | null> {
  const response = await fetch(
    `/api/pane/thread?pane_id=${encodeURIComponent(paneId)}&id=${encodeURIComponent(threadId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as { turns?: ConversationTurn[] };
  return Array.isArray(payload.turns) ? payload.turns : [];
}

/** The command the extension runs; the quote is collapsed so one line reaches the pane. */
export function threadCommand(quote: string, question: string): string {
  const collapsed = quote.replace(/\s+/g, " ").trim();
  return `/thread --quote "${collapsed.replace(/"/g, "'")}" ${question.trim()}`;
}
