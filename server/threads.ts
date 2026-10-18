/**
 * Pi threads: the registry and transcript reads behind the chat's thread sheet.
 *
 * The pi `threads` extension (pi-plugins/threads) stores each conversation's
 * threads beside its session file, and runs a thread in a branched session of
 * its own:
 *
 *   <sessionDir>/<session-name>/threads/registry.json
 *   <sessionDir>/<session-name>/threads/<thread>.jsonl
 *
 * `GET /api/pane/threads?pane_id=` lists a pi pane's threads from that
 * registry. `GET /api/pane/thread?pane_id=&id=` returns one thread's turns,
 * read from its session file after the anchor entry (the branch carries the
 * parent conversation; only what follows the anchor is the thread).
 *
 * Both answer `{ threads: [] }` / `404 thread_not_found` for panes and threads
 * that are not there: an uninstalled extension or a non-pi pane is not an
 * error, the sheet simply has nothing to show.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { piTranscriptPath } from "./pi.ts";
import type { ConversationTurn } from "../shared/protocol.ts";

/** The registry the pi threads extension writes; unknown fields are ignored. */
interface ThreadRecord {
  id: string;
  title: string;
  question: string;
  sessionFile: string;
  anchor: { entryId: string; quote: string };
  status: "running" | "done" | "error";
  createdAt: number;
  lastActivityAt: number;
  turns: number;
}

interface ThreadRegistry {
  version: 1;
  threads: ThreadRecord[];
}

export interface ThreadSummary {
  id: string;
  title: string;
  question: string;
  quote: string;
  status: "running" | "done" | "error";
  turns: number;
  created_at: string;
}

const threadsDir = (sessionFile: string): string =>
  join(dirname(sessionFile), basename(sessionFile, ".jsonl"), "threads");

/** The pane's session file when it is a pi session the extension could have threaded; null otherwise. */
async function piSessionFile(paneId: string): Promise<string | null> {
  const resolved = await piTranscriptPath(paneId).catch(() => null);
  if (!resolved || !("path" in resolved)) return null;
  return resolved.path;
}

function readRegistry(sessionFile: string): ThreadRegistry {
  try {
    const parsed = JSON.parse(readFileSync(join(threadsDir(sessionFile), "registry.json"), "utf-8")) as ThreadRegistry;
    if (parsed && Array.isArray(parsed.threads)) return parsed;
  } catch {
    // absent (the common case: no threads yet) or unreadable — nothing to list
  }
  return { version: 1, threads: [] };
}

/** Threads for a pane, newest first, with live status read from each thread's session; an empty list covers every non-threaded pane. */
export async function paneThreads(paneId: string): Promise<ThreadSummary[]> {
  const sessionFile = await piSessionFile(paneId);
  if (sessionFile === null) return [];
  const registry = readRegistry(sessionFile);
  return registry.threads
    .filter((thread) => typeof thread?.id === "string" && thread?.anchor && typeof thread.anchor.quote === "string")
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map((thread) => {
      const live = typeof thread.sessionFile === "string" ? readThreadSession(thread.sessionFile, thread.anchor.entryId) : null;
      return {
        id: thread.id,
        title: typeof thread.title === "string" ? thread.title : thread.id,
        question: typeof thread.question === "string" ? thread.question : "",
        quote: thread.anchor.quote,
        status: live?.status ?? "running",
        turns: live?.turnCount ?? 0,
        created_at: new Date(typeof thread.createdAt === "number" ? thread.createdAt : Date.now()).toISOString(),
      };
    });
}

/**
 * One thread's turns and live state: the entries after its anchor in the thread's
 * session file. Thread sessions are small and append-only, so a single bounded read
 * answers; a torn last line (the writer is mid-append) is skipped, not fatal.
 *
 * Status is computed here, not read from the registry: the extension refreshes the
 * registry only when a `/threads` runs in the pane, and the web UI — the registry's
 * primary reader — must see a finished thread without anyone typing.
 */
interface ThreadLive { turns: ConversationTurn[]; status: "running" | "done" | "error"; turnCount: number }

function readThreadSession(sessionFile: string, anchorEntryId: string): ThreadLive | null {
  let text: string;
  try {
    text = readFileSync(sessionFile, "utf-8");
  } catch {
    return null; // not written yet: the branch exists, the child has not started
  }

  const turns: ConversationTurn[] = [];
  let replies = 0;
  let status: ThreadLive["status"] = "running";
  let pastAnchor = false;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let entry: { id?: unknown; type?: unknown; message?: { role?: unknown; content?: unknown; stopReason?: unknown } | null };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue; // a torn tail line: the writer is mid-append
    }
    if (typeof entry.id === "string" && entry.id === anchorEntryId) {
      pastAnchor = true;
      continue; // the anchor entry itself belongs to the parent conversation
    }
    if (!pastAnchor || entry.type !== "message" || !entry.message) continue;
    const role = entry.message.role === "assistant" ? "assistant" : entry.message.role === "user" ? "user" : null;
    if (role === null) continue;
    const content = entry.message.content;
    const parts = typeof content === "string"
      ? [{ kind: "text" as const, text: content }]
      : Array.isArray(content)
        ? (content as Array<{ type?: string; text?: string }>)
            .filter((block) => block?.type === "text" && typeof block.text === "string")
            .map((block) => ({ kind: "text" as const, text: block.text as string }))
        : [];
    if (parts.length === 0) continue;
    turns.push({ role, ts: null, parts });
    if (role === "assistant") {
      replies += 1;
      const stopReason = entry.message.stopReason;
      if (stopReason === "error") status = "error";
      else if (stopReason && stopReason !== "pending") status = "done";
    }
  }
  // one turn per assistant reply, the extension's count (its refreshThreadStatus)
  return { turns, status, turnCount: replies };
}

export async function paneThread(paneId: string, threadId: string): Promise<ConversationTurn[] | null> {
  const sessionFile = await piSessionFile(paneId);
  if (sessionFile === null) return null;
  const registry = readRegistry(sessionFile);
  const thread = registry.threads.find((entry) => entry.id === threadId);
  if (!thread || typeof thread.sessionFile !== "string") return null;
  return readThreadSession(thread.sessionFile, thread.anchor.entryId)?.turns ?? null;
}
