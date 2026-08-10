/**
 * The map scale bar.
 *
 * Bottom-LEFT, above the attribution strip: the bottom-right is the compass and
 * the map-control cluster, the top-right the panels that open over the scene,
 * and the bottom centre the pick tooltip. It is also the
 * corner every web map puts a scale in.
 *
 * Subscribes to `cameraPose.ts` itself rather than taking the pose as a prop —
 * the same arrangement `CameraControls` uses, and for the same reason: a
 * camera in motion must re-render these hundred pixels, not the viewport.
 * There is deliberately NO new engine subscription behind it; the pose
 * publisher was widened to carry the latitude and the zoom this reads.
 *
 * The maths lives in `scene/mapScale.ts` (pure, unit-tested); this file only
 * decides how many pixels of room the bar may use and what to do when there is
 * no scale to draw — which is to draw nothing, rather than a bar that lies.
 */
import { useCameraPose } from "../../scene/cameraPose";
import { metresPerPixel, pickScaleBar } from "../../scene/mapScale";

/** The widest the bar may be. Wide enough to be read as a measurement, narrow
 *  enough to sit clear of the legend above it on a small viewport. */
const MAX_SCALE_BAR_PX = 120;

export function ScaleBar() {
  const pose = useCameraPose();
  // No camera, or a camera the engine has not given a zoom yet (it is computed
  // from the ellipsoid height, the FOV and the viewport, none of which exist
  // before the first rendered frame).
  if (pose === null || pose.zoom === undefined) return null;

  const bar = pickScaleBar(
    metresPerPixel(pose.lat, pose.zoom),
    MAX_SCALE_BAR_PX,
  );
  if (bar === null) return null;

  return (
    <div
      className="scale-bar"
      // A tilted 3D view has no single scale — the ground at the top of the
      // frame is further away, and therefore more compressed, than the ground
      // at the bottom. Say which one this is.
      title="Approximate scale at the centre of the view"
    >
      <span className="scale-bar-label">{bar.label}</span>
      <span
        className="scale-bar-track"
        style={{ width: `${bar.widthPx.toFixed(1)}px` }}
        aria-hidden="true"
      />
    </div>
  );
}
