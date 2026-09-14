/**
 * The one place the toolbox's "reveal" couples to the shell's collapse.
 *
 * `processingStore` cannot do this itself: nothing under `features/` may import
 * from `ui/`, and the right panel's collapse is the shell's state. So opening a
 * tool view or a log goes through here — otherwise a Log button on a card would
 * set the view behind a collapsed panel and look like it did nothing.
 */
import { useProcessingStore } from "../../features/processing/processingStore";
import type { ToolId } from "../../features/processing/types";
import { useShellStore } from "../shell/shellStore";

/** Bring the right panel back if it is collapsed. */
export function revealTools(): void {
  useShellStore.getState().setRightCollapsed(false);
}

export function openToolView(toolId: ToolId): void {
  useProcessingStore.getState().openTool(toolId);
  revealTools();
}

export function openRunLog(runId: string): void {
  useProcessingStore.getState().openLog(runId);
  revealTools();
}
