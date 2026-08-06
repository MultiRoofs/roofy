/**
 * Camera view alignment buttons.
 *
 * Provides buttons to snap the camera to standard orthographic-like
 * views: Top (XY), Front (XZ), Right (YZ), and their opposites.
 * Rendered as an HTML overlay on the viewport, not inside the Canvas.
 *
 * Reads `viewModeStore` on its own — like `CameraControls` reads the camera
 * pose — because a 2D plan view has no front or left to look from: those
 * alignments would fly straight out of the mode the user just chose, so they
 * are disabled with a title that says why rather than silently breaking it.
 */
import { useViewModeStore } from "../features/viewMode/viewModeStore";
import {
  isAlignDirectionAllowed,
  VIEW_MODE_LOCK_TITLE,
} from "./viewModePolicy";

export type ViewDirection =
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "right"
  | "left";

interface ViewAlignButtonsProps {
  readonly onAlign: (direction: ViewDirection) => void;
}

const VIEWS: { direction: ViewDirection; label: string; title: string }[] = [
  { direction: "top", label: "T", title: "Top view (XY plane)" },
  { direction: "front", label: "F", title: "Front view (XZ plane)" },
  { direction: "right", label: "R", title: "Right view (YZ plane)" },
  { direction: "bottom", label: "Bo", title: "Bottom view" },
  { direction: "back", label: "Bk", title: "Back view" },
  { direction: "left", label: "L", title: "Left view" },
];

export function ViewAlignButtons({ onAlign }: ViewAlignButtonsProps) {
  const mode = useViewModeStore((s) => s.mode);
  return (
    <div className="view-align-buttons">
      {VIEWS.map((v) => {
        const allowed = isAlignDirectionAllowed(mode, v.direction);
        return (
          <button
            key={v.direction}
            className="view-align-btn"
            title={allowed ? v.title : VIEW_MODE_LOCK_TITLE.align}
            disabled={!allowed}
            onClick={() => onAlign(v.direction)}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
