/**
 * Camera view alignment buttons.
 *
 * Provides buttons to snap the camera to standard orthographic-like
 * views: Top (XY), Front (XZ), Right (YZ), and their opposites.
 * Rendered as an HTML overlay on the viewport, not inside the Canvas.
 */

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
  return (
    <div className="view-align-buttons">
      {VIEWS.map((v) => (
        <button
          key={v.direction}
          className="view-align-btn"
          title={v.title}
          onClick={() => onAlign(v.direction)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
