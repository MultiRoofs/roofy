import { ActionIcon } from "../ActionIcon";
import type { PickMode, ToolMode } from "../../domain/selection/types";
import "./sceneControls.css";
export function SelectModeControl({
  mode,
  cityActive,
  onSetMode,
  onSetToolMode,
  drawActive = false,
  canDraw = false,
  onDraw,
  onPick,
}: {
  readonly mode: PickMode;
  readonly toolMode: ToolMode;
  readonly cityActive: boolean;
  readonly onSetMode: (mode: PickMode) => void;
  readonly onSetToolMode: (mode: ToolMode) => void;
  readonly drawActive?: boolean;
  readonly canDraw?: boolean;
  readonly onDraw?: () => void;
  readonly onPick?: () => void;
}) {
  return (
    <label className="map-mode-control">
      <span>Mode</span>
      <ActionIcon
        name={
          drawActive
            ? "draw"
            : mode === "surface" && cityActive
              ? "surface"
              : "feature"
        }
      />
      <select
        className="rule-select"
        aria-label="Mode"
        value={drawActive ? "draw" : !cityActive ? "object" : mode}
        title={
          canDraw
            ? "Choose Pick or Draw mode"
            : "Select a draw layer to enable Draw mode"
        }
        onChange={(event) => {
          if (event.target.value === "draw") {
            if (canDraw) onDraw?.();
            return;
          }
          onPick?.();
          onSetMode(event.target.value as PickMode);
          onSetToolMode("select");
        }}
      >
        <optgroup label="Pick mode">
          <option value="object">Pick feature</option>
          <option value="surface" disabled={!cityActive}>
            Pick surface
          </option>
        </optgroup>
        <optgroup label="Draw mode">
          <option value="draw" disabled={!canDraw}>
            Draw model
          </option>
        </optgroup>
      </select>
    </label>
  );
}
