import type { Terminal } from "@xterm/xterm";
import { HERDR_MOUSE_SCROLL_LINES, wheelSteps } from "./wheelSteps.ts";

/** Live settings/status read by the handler attached once for a terminal's lifetime. */
export interface TerminalWheelState {
  readonly speed: number;
  readonly omoQuestion: boolean;
}

interface WheelViewport {
  /** A selecting drag owns its wheel before any application routing. */
  readonly drag: (event: WheelEvent) => boolean;
  readonly adopted: () => boolean;
  readonly cellHeight: () => number;
  readonly scroll: (lines: number) => void;
}

/** herdr owns history; xterm owns encoding mouse reports for applications that use them. */
export function attachTerminalWheel(term: Terminal, state: { readonly current: TerminalWheelState }, viewport: WheelViewport): void {
  let pixels = 0;
  term.attachCustomWheelEventHandler((event) => {
    if (viewport.drag(event)) return false;
    // Observed/fixed grids pan in the browser instead of changing herdr's viewport.
    if (viewport.adopted()) return false;
    if (term.hasSelection()) term.clearSelection();
    // OmO consumes wheel reports without acting while a question captures mouse input.
    // Touch uses synthetic line-mode wheels, each representing herdr's three-line step.
    if (state.current.omoQuestion && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      const height = viewport.cellHeight();
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * height * HERDR_MOUSE_SCROLL_LINES
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * height * term.rows : event.deltaY;
      const { steps, rest } = wheelSteps(pixels + delta, height);
      pixels = rest;
      if (steps !== 0) viewport.scroll(-steps * state.current.speed);
      return false;
    }
    pixels = 0;
    const reporting = term.modes.mouseTrackingMode !== "none";
    // A program that does not report must not receive xterm's fallback arrow keys.
    // Trusted wheels replay at the chosen speed; touch/replays already supply their steps.
    // A trackpad pinch (Ctrl) keeps its original single-event path and all replayed modifiers.
    if (reporting && event.isTrusted && event.target && !event.ctrlKey) {
      for (let sent = 1; sent < state.current.speed; sent += 1) {
        event.target.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
          clientX: event.clientX, clientY: event.clientY,
          ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
        }));
      }
    }
    return reporting;
  });
}
