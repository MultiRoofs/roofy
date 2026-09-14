import { ActionIcon } from "../ActionIcon";
import { useProcessingStore } from "../../features/processing/processingStore";
import { useShellStore } from "../shell/shellStore";
import { revealTools } from "./revealTools";
import "./processing.css";

/**
 * Spec §4.1: the scene toolbar's entry point. The button REVEALS the Tools
 * tab — only a click while Tools is visibly showing closes the toolbox — so a
 * collapsed right panel is expanded rather than opened behind, a click while
 * the Details tab is up switches to Tools, and a click on an open-but-hidden
 * toolbox brings it back instead of closing something the user cannot see.
 *
 * The shell coupling lives in `revealTools`, not in `processingStore`: nothing
 * under `features/` may import from `ui/`, and the collapse is the shell's.
 */
export function ToolsButton() {
  const open = useProcessingStore((s) => s.open);
  const active = useProcessingStore((s) =>
    s.runs.some(
      (r) =>
        r.status === "queued" ||
        r.status === "running" ||
        r.status === "cancelling",
    ),
  );
  const unseenFailure = useProcessingStore((s) => s.unseenFailure);
  const tone = active ? "running" : unseenFailure ? "failed" : null;
  return (
    <button
      type="button"
      className="tools-button"
      aria-pressed={open}
      aria-label="Tools"
      title="Tools"
      onClick={() => {
        const processing = useProcessingStore.getState();
        if (!processing.open) {
          processing.setOpen(true);
          revealTools();
          return;
        }
        // Open already: reveal whatever is hiding the Tools tab, and only close
        // when nothing is — the collapse first, because a collapsed panel hides
        // both tabs and the user asked for this one.
        const collapsed = useShellStore.getState().rightCollapsed;
        if (collapsed || processing.activeTab !== "tools") {
          processing.setTab("tools");
          revealTools();
          return;
        }
        processing.setOpen(false);
      }}
    >
      <ActionIcon name="tools" />
      <span className="tools-button__label">Tools</span>
      {tone !== null && (
        <span
          className="tools-button__dot"
          data-tone={tone}
          data-testid="tools-activity"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
