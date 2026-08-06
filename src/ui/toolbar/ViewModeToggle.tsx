/**
 * The 2D / 2.5D / 3D segmented control, in the toolbar.
 *
 * Reads and writes `viewModeStore` directly rather than taking props, like
 * `SolarMenu` beside it: the mode is global camera state, and threading it
 * through the toolbar's prop list would put it in the way of every other
 * toolbar feature. What each mode DOES is `scene/viewModePolicy.ts`; this file
 * only names them.
 */
import {
  useViewModeStore,
  VIEW_MODES,
  type ViewMode,
} from "../../features/viewMode/viewModeStore";

/** Label and tooltip per mode. "2.5D" is meaningless on its own, so every
 *  segment says what it locks. */
const LABELS: Record<ViewMode, { label: string; title: string }> = {
  "2d": {
    label: "2D",
    title:
      "2D — plan view from straight above, facing north; rotation and tilt locked",
  },
  "2.5d": {
    label: "2.5D",
    title: "2.5D — fixed 60° tilt; rotate freely, tilt locked",
  },
  "3d": { label: "3D", title: "3D — free camera" },
};

export function ViewModeToggle() {
  const mode = useViewModeStore((s) => s.mode);
  const setViewMode = useViewModeStore((s) => s.setViewMode);

  return (
    <div className="view-mode-toggle" role="group" aria-label="View mode">
      {VIEW_MODES.map((candidate) => {
        const { label, title } = LABELS[candidate];
        return (
          <button
            key={candidate}
            type="button"
            className={`view-mode-btn${mode === candidate ? " view-mode-btn-active" : ""}`}
            title={title}
            aria-pressed={mode === candidate}
            onClick={() => setViewMode(candidate)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
