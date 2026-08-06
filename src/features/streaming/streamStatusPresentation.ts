/**
 * How a `StreamStatus` is worded and toned for a human.
 *
 * Pure and UI-free so the two places that show streaming progress — the
 * status bar (the ACTIVE layer, one line at the bottom of the window) and the
 * layer panel (EVERY streaming layer, on its own row) — cannot drift into
 * telling the user two different stories about the same handle. `StatusBar`
 * owned this wording privately before the layer rows needed it.
 *
 * The `tone` exists because the four statuses are not four severities:
 * `"too-far"` is GUIDANCE ("zoom in and I will load"), not a failure, and
 * styling it like `"error"` would read as a broken layer to anyone who opened
 * a `.fcb` on a whole-globe camera — which is the very first thing that
 * happens to every streaming layer.
 */
import type { StreamStatus } from "./streamStore";

export type StreamStatusTone = "idle" | "busy" | "guidance" | "error";

export interface StreamStatusPresentation {
  readonly tone: StreamStatusTone;
  /** Short, user-facing, safe to render in a narrow row. */
  readonly label: string;
  /** The driver's own message, when it says something the label does not —
   *  the reason code behind a `"too-far"` (`"Zoom in (feature-budget)"`), or
   *  an error's detail. `null` when there is nothing to add. Belongs in a
   *  `title`, never in the row itself. */
  readonly detail: string | null;
}

export function presentStreamStatus(
  status: StreamStatus,
  message: string | null = null,
): StreamStatusPresentation {
  switch (status) {
    case "probing":
      return { tone: "busy", label: "Probing…", detail: message };
    case "fetching":
      return { tone: "busy", label: "Loading features…", detail: message };
    case "too-far":
      // Fixed, user-facing text — NOT the driver's internal reason-coded
      // message (e.g. "Zoom in (feature-budget)"), which is debug detail and
      // goes to `detail`.
      return {
        tone: "guidance",
        label: "Zoom in to load features",
        detail: message,
      };
    case "error":
      return {
        tone: "error",
        label: message ?? "Streaming error",
        detail: message,
      };
    case "idle":
      return { tone: "idle", label: "Streaming", detail: null };
  }
}

/** The status-bar dot class for a tone. Kept beside the wording so a new
 *  status cannot pick up a colour by accident. */
export function streamToneDotClass(tone: StreamStatusTone): string {
  switch (tone) {
    case "busy":
      return "dot-loading";
    case "guidance":
      return "dot-partial";
    case "error":
      return "dot-error";
    case "idle":
      return "dot-ready";
  }
}
