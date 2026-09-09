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
