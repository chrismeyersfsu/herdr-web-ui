/**
 * The thread sheet: a Slack-style side conversation over the chat.
 *
 * Opened with a selected passage (the anchor quote), it submits
 * `/thread --quote "…" <question>` through the pane's composer — the pi
 * threads extension branches the session and runs the deep-dive in the
 * background — then polls the registry and the thread's transcript to show
 * the answer as it lands. Existing threads list below; the main conversation
 * is never switched.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { X } from "lucide-react";

import { useT } from "../lib/i18n.ts";
import { fetchPaneThread, fetchPaneThreads, threadCommand, type ThreadSummary } from "../lib/threads.ts";
import type { ConversationTurn } from "../../shared/protocol.ts";

export interface ThreadSheetProps {
  paneId: string;
  /** the passage the sheet was opened on; null reopens without a new-thread composer */
  quote: string | null;
  onClose: () => void;
  /** the pane composer's submit: typed into the pane like any chat message */
  submit: (text: string) => void;
}

const QUICK_QUESTIONS = ["Why does this happen?", "Show the exact chain", "What's the safest fix?"];

export function ThreadSheet({ paneId, quote, onClose, submit }: ThreadSheetProps) {
  const t = useT();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null);
  const [question, setQuestion] = useState("");
  const [sent, setSent] = useState(false);
  const sentQuestion = useRef<string | null>(null);

  // the registry: refresh while the sheet is open (a background thread finishes)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const list = await fetchPaneThreads(paneId);
      if (!cancelled) setThreads(list);
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [paneId]);

  // a fresh submit: follow the thread it starts (match by question, else the newest)
  useEffect(() => {
    if (!sent || sentQuestion.current === null) return;
    const started = threads.find((thread) => thread.question === sentQuestion.current) ?? threads[0];
    if (started && started.id !== activeId) setActiveId(started.id);
  }, [threads, sent, activeId]);

  // the active thread's transcript: refresh while it runs
  useEffect(() => {
    if (activeId === null) {
      setTurns(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const list = await fetchPaneThread(paneId, activeId);
      if (!cancelled) setTurns(list);
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [paneId, activeId]);

  const ask = useCallback((text: string) => {
    if (quote === null || text.trim().length === 0) return;
    sentQuestion.current = text.trim();
    submit(threadCommand(quote, text));
    setSent(true);
    setQuestion("");
  }, [quote, submit]);

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  return (
    <div className="thread-sheet" role="dialog" aria-label={t("Thread")}>
      <div className="thread-sheet-scrim" onClick={onClose} />
      <section className="thread-sheet-panel">
        <header className="thread-sheet-head">
          <span className="thread-sheet-mark" aria-hidden="true">🧵</span>
          <div className="thread-sheet-titles">
            <p className="thread-sheet-title">{active ? active.title : t("Learn more about this")}</p>
            <p className="thread-sheet-sub">
              {active
                ? (active.status === "running" ? t("Running in the background…") : t("Done"))
                : t("A side conversation — the chat stays put")}
            </p>
          </div>
          <button type="button" className="thread-sheet-close" onClick={onClose} aria-label={t("Close")}>
            <X />
          </button>
        </header>

        {quote !== null && !sent && (
          <>
            <div className="thread-sheet-anchor">
              <p className="thread-sheet-anchor-label">{t("Discussing this selection")}</p>
              <p className="thread-sheet-anchor-quote">{quote.length > 280 ? `${quote.slice(0, 279)}…` : quote}</p>
            </div>
            <div className="thread-sheet-quick">
              {QUICK_QUESTIONS.map((chip) => (
                <button key={chip} type="button" className="thread-chip" onClick={() => ask(chip)}>{chip}</button>
              ))}
            </div>
            <form
              className="thread-sheet-composer"
              onSubmit={(event) => {
                event.preventDefault();
                ask(question);
              }}
            >
              <input
                className="thread-sheet-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={t("Ask about this selection…")}
                autoFocus
              />
              <button type="submit" className="thread-sheet-send" disabled={question.trim().length === 0}>↑</button>
            </form>
          </>
        )}

        {activeId !== null && (
          <div className="thread-sheet-turns">
            {turns === null || turns.length === 0
              ? <p className="thread-sheet-empty">{t("Waiting for the thread to start…")}</p>
              : turns.map((turn, index) => (
                <article key={index} className={`thread-turn thread-turn-${turn.role}`}>
                  {turn.parts
                    .filter((part) => part.kind === "text")
                    .map((part, partIndex) => <p key={partIndex}>{part.kind === "text" ? part.text : ""}</p>)}
                </article>
              ))}
          </div>
        )}

        {threads.length > 0 && (
          <div className="thread-sheet-list">
            <p className="thread-sheet-list-label">{t("Threads")}</p>
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`thread-row${thread.id === activeId ? " is-active" : ""}`}
                onClick={() => {
                  setActiveId(thread.id);
                  setSent(false);
                  sentQuestion.current = null;
                }}
              >
                <span className="thread-row-status" data-status={thread.status} aria-hidden="true" />
                <span className="thread-row-body">
                  <span className="thread-row-title">{thread.title}</span>
                  <span className="thread-row-meta">
                    {thread.status === "running" ? t("running") : thread.status === "error" ? t("error") : t("done")}
                    {" · "}
                    {t("{n} turns", { n: thread.turns })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
