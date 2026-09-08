import {
  useViewModeStore,
  type ViewMode,
} from "../../features/viewMode/viewModeStore";
import "./sceneControls.css";

export interface CameraClusterProps {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetNorth: () => void;
  readonly onFit: () => void;
  readonly fitDisabled?: boolean;
  readonly fitTitle: string;
  readonly onFitSelection: () => void;
  readonly selectionPresent: boolean;
  readonly selectionDisabled?: boolean;
  readonly selectionTitle: string;
}

function Icon({
  name,
}: {
  readonly name:
    | "zoom-in"
    | "zoom-out"
    | "compass"
    | "fit"
    | "target"
    | "topdown"
    | "angled"
    | "free3d";
}) {
  const paths = {
    "zoom-in": (
      <>
        <circle cx="7" cy="7" r="4" />
        <path d="M10 10l4 4M7 5v4M5 7h4" />
      </>
    ),
    "zoom-out": (
      <>
        <circle cx="7" cy="7" r="4" />
        <path d="M10 10l4 4M5 7h4" />
      </>
    ),
    compass: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M10.5 5.5 9 9l-3.5 1.5L7 7l3.5-1.5Z" />
      </>
    ),
    fit: <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M5 5l6 6" />,
    target: (
      <>
        <circle cx="8" cy="8" r="4" />
        <circle cx="8" cy="8" r="1" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
      </>
    ),
    topdown: (
      <>
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M5 6h6M5 9h6" />
      </>
    ),
    angled: (
      <>
        <path d="m2 11 6-7 6 7-6 3-6-3Z" />
        <path d="M8 4v7" />
      </>
    ),
    free3d: (
      <>
        <path d="m8 2 5 3v6l-5 3-5-3V5l5-3Z" />
        <path d="m3 5 5 3 5-3M8 8v6" />
      </>
    ),
  }[name];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {paths}
    </svg>
  );
}

const modes: ReadonlyArray<
  readonly [ViewMode, string, "topdown" | "angled" | "free3d"]
> = [
  ["2d", "Top-down", "topdown"],
  ["2.5d", "Angled", "angled"],
  ["3d", "Free 3D", "free3d"],
];

export function CameraCluster({
  onZoomIn,
  onZoomOut,
  onResetNorth,
  onFit,
  fitDisabled = false,
  fitTitle,
  onFitSelection,
  selectionPresent,
  selectionDisabled = false,
  selectionTitle,
}: CameraClusterProps) {
  const mode = useViewModeStore((s) => s.mode);
  const setViewMode = useViewModeStore((s) => s.setViewMode);
  return (
    <div className="camera-cluster" aria-label="Camera controls">
      <div className="camera-cluster__zoom">
        <button
          type="button"
          onClick={onZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Icon name="zoom-in" />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Icon name="zoom-out" />
        </button>
      </div>
      <button
        type="button"
        className="camera-cluster__north"
        onClick={onResetNorth}
        title="Face north"
        aria-label="Reset rotation to north"
      >
        <Icon name="compass" />
      </button>
      <button
        type="button"
        className="camera-cluster__action"
        onClick={onFit}
        disabled={fitDisabled}
        title={fitTitle}
      >
        <Icon name="fit" />
        <span>Fit</span>
      </button>
      {selectionPresent && (
        <button
          type="button"
          className="camera-cluster__action"
          onClick={onFitSelection}
          disabled={selectionDisabled}
          title={selectionTitle}
        >
          <Icon name="target" />
          <span>Zoom to selection</span>
        </button>
      )}
      <div className="camera-cluster__modes" aria-label="Camera view">
        {modes.map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setViewMode(value)}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
