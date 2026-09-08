import type { PickMode, ToolMode } from "../../domain/selection/types";
import "./sceneControls.css";

export function SelectModeControl({
  mode,
  toolMode,
  cityActive,
  onSetMode,
  onSetToolMode,
}: {
  readonly mode: PickMode;
  readonly toolMode: ToolMode;
  readonly cityActive: boolean;
  readonly onSetMode: (mode: PickMode) => void;
  readonly onSetToolMode: (mode: ToolMode) => void;
}) {
  const select = (next: PickMode) => {
    onSetMode(next);
    onSetToolMode("select");
  };
  const surfaceTitle = cityActive
    ? "Select roof surfaces"
    : "Surface picking is not available for planning areas";
  return (
    <div className="select-mode-control" aria-label="Select mode">
      <span className="select-mode-label">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1v14M1 8h14M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
        </svg>
        Select
      </span>
      <div className="select-mode-segment">
        <button
          type="button"
          aria-pressed={toolMode === "select" && mode === "object"}
          onClick={() => select("object")}
        >
          Feature
        </button>
        <button
          type="button"
          aria-pressed={toolMode === "select" && mode === "surface"}
          disabled={!cityActive}
          title={surfaceTitle}
          aria-label={surfaceTitle}
          onClick={() => select("surface")}
        >
          Surface
        </button>
      </div>
    </div>
  );
}
