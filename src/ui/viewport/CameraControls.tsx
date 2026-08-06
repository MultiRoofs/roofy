/**
 * The viewport's compass and map-control cluster.
 *
 * Two controls, one overlay, because they are one thing to the eye: the dial
 * says where the camera is pointing and the buttons under it change where it
 * points. Placed BOTTOM-RIGHT, above the attribution strip — the top-right is
 * taken by `ViewAlignButtons` and by every panel that opens over them
 * (Advanced Settings, the attribute panel), the bottom-left by the legend and
 * the sun scrubber, and the bottom centre by the pick tooltip. It is also where
 * a map's zoom cluster is expected to be.
 *
 * The camera state arrives through `cameraPose.ts`, which this component
 * subscribes to on its own — deliberately NOT as a prop, so a moving camera
 * re-renders these forty pixels rather than the whole viewport (see that
 * module's doc comment). Everything it can do is a callback the viewport hands
 * in: this file knows no engine, and the maths it displays is
 * `scene/cameraControls.ts`.
 */
import { useCameraPose } from "../../scene/cameraPose";
import {
  cardinalFor,
  compassRotationDeg,
  formatBearing,
  formatTilt,
} from "../../scene/cameraControls";
import { useViewModeStore } from "../../features/viewMode/viewModeStore";
import {
  VIEW_MODE_LOCK_TITLE,
  viewModePolicy,
} from "../../scene/viewModePolicy";

export interface CameraControlsProps {
  /** Point the camera north, keeping what it is looking at. */
  readonly onResetNorth: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  /** Tilt towards the horizon. */
  readonly onTiltUp: () => void;
  /** Tilt towards a plan view. */
  readonly onTiltDown: () => void;
}

export function CameraControls({
  onResetNorth,
  onZoomIn,
  onZoomOut,
  onTiltUp,
  onTiltDown,
}: CameraControlsProps) {
  const pose = useCameraPose();
  // No camera yet (the engine has not rendered its first frame) or none any
  // more (it was torn down): the cluster stays in place, reads zero and refuses
  // to act, rather than disappearing from under the cursor.
  const live = pose !== null;
  // The view mode, through the same policy table the viewport applies: 2D has
  // nothing left for a tilt button to do, so it is disabled and says why. 2.5D
  // KEEPS them — with the clamp pinned they snap a drifted pitch back onto the
  // mode's exact angle, which is a real (if quiet) effect.
  const mode = useViewModeStore((s) => s.mode);
  const tiltEnabled = live && viewModePolicy(mode).tiltButtons;
  const tiltUpTitle = tiltEnabled
    ? "Tilt towards the horizon"
    : VIEW_MODE_LOCK_TITLE.tilt;
  const tiltDownTitle = tiltEnabled
    ? "Tilt towards a plan view"
    : VIEW_MODE_LOCK_TITLE.tilt;
  const heading = pose?.heading ?? 0;
  const pitch = pose?.pitch ?? 0;
  const bearing = formatBearing(heading);
  const cardinal = cardinalFor(heading);

  return (
    <div className={`camera-controls${live ? "" : " is-idle"}`}>
      <button
        type="button"
        className="camera-compass"
        onClick={onResetNorth}
        disabled={!live}
        title={`Facing ${cardinal} ${bearing} — click to face north`}
        aria-label={`Camera heading ${bearing} ${cardinal}. Reset heading to north.`}
      >
        <svg
          className="camera-compass-dial"
          viewBox="0 0 40 40"
          width="34"
          height="34"
          aria-hidden="true"
          // The whole dial turns with the camera; the ring and the crosshair
          // below stay put, so the needle reads against a fixed frame.
          style={{ transform: `rotate(${compassRotationDeg(heading)}deg)` }}
        >
          {/* North half: the one thing that has to be findable at a glance. */}
          <polygon
            className="camera-compass-north"
            points="20,4 24.5,20 20,17"
          />
          <polygon
            className="camera-compass-north"
            points="20,4 15.5,20 20,17"
          />
          {/* South half, muted, so the needle cannot be read upside down. */}
          <polygon
            className="camera-compass-south"
            points="20,36 24.5,20 20,23"
          />
          <polygon
            className="camera-compass-south"
            points="20,36 15.5,20 20,23"
          />
        </svg>
        <span className="camera-compass-ring" aria-hidden="true" />
        <span className="camera-compass-readout">
          <span className="camera-compass-cardinal">{cardinal}</span>
          <span className="camera-compass-bearing">{bearing}</span>
        </span>
      </button>

      <div className="camera-controls-cluster">
        <button
          type="button"
          className="camera-ctl-btn"
          onClick={onZoomIn}
          disabled={!live}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="camera-ctl-btn"
          onClick={onZoomOut}
          disabled={!live}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="camera-ctl-btn"
          onClick={onTiltUp}
          disabled={!tiltEnabled}
          title={tiltUpTitle}
          aria-label="Tilt towards the horizon"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>
        <button
          type="button"
          className="camera-ctl-btn"
          onClick={onTiltDown}
          disabled={!tiltEnabled}
          title={tiltDownTitle}
          aria-label="Tilt towards a plan view"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {/* Which of the two tilt buttons to press, without guessing. */}
        <span className="camera-ctl-readout" title="Tilt below the horizon">
          {formatTilt(pitch)}
        </span>
      </div>
    </div>
  );
}
