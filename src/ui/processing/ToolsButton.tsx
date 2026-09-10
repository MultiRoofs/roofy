import { ActionIcon } from "../ActionIcon";
import { useProcessingStore } from "../../features/processing/processingStore";
import "./processing.css";

/** Spec §4.1: the scene toolbar's entry point. */
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
      onClick={() => useProcessingStore.getState().toggle()}
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
