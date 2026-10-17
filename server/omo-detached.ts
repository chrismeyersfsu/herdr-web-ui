export interface OmoDetachedCell {
  readonly id: string;
  readonly at: number;
}

/** Detached cells outlive an assistant's stop; only their own runtime notice settles them. */
export function omoDetachedAfter(open: readonly OmoDetachedCell[], entry: unknown): readonly OmoDetachedCell[] {
  if (typeof entry !== "object" || entry === null || !("type" in entry)) return open;
  if (entry.type === "custom_message" && "customType" in entry && entry.customType === "senpi-codemode:notification"
    && "content" in entry && typeof entry.content === "string") {
    const id = entry.content.match(/^<system-reminder>Detached eval cell (\S+) \((?:js|py)\) (?:completed|failed|cancelled|was killed[^\n]*)\./)?.[1];
    return id ? open.filter((cell) => cell.id !== id) : open;
  }
  if (entry.type !== "message" || !("message" in entry) || typeof entry.message !== "object" || entry.message === null) return open;
  const message = entry.message;
  if (!("role" in message) || message.role !== "toolResult" || !("toolName" in message) || message.toolName !== "eval"
    || !("content" in message) || !Array.isArray(message.content)) return open;
  const at = "timestamp" in entry && typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(at)) return open;
  let cells = open;
  for (const part of message.content) {
    if (typeof part !== "object" || part === null || !("type" in part) || part.type !== "text" || !("text" in part) || typeof part.text !== "string") continue;
    const id = part.text.match(/^Eval cell (\S+) (?:detached and is (?:still )?running in the (?:js|py) kernel|is queued behind \S+ in the (?:js|py) kernel and detached)/)?.[1];
    if (id && !cells.some((cell) => cell.id === id)) cells = [...cells, { id, at }];
  }
  return cells;
}
