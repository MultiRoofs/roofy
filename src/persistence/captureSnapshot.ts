/**
 * Capture current viewer state into a ProjectSnapshot.
 *
 * Accepts all state values as parameters — no direct store imports.
 * The caller (app shell) reads from stores and passes values in.
 */

import type { PickMode } from "../domain/selection/types";
import type {
  GeoLayerSnapshot,
  GeographicCamera,
  LayerSnapshot,
  ProjectSnapshot,
  ViewState,
} from "./types";
import { SNAPSHOT_VERSION } from "./types";
import type { ViewMode } from "../features/viewMode/viewModeStore";

export interface CaptureInput {
  readonly label: string;
  readonly layers: ReadonlyArray<LayerSnapshot>;
  /** The geospatial layers, already stripped of anything unpersistable by
   *  `geoLayerSnapshot`. Written only when there is at least one — an optional
   *  field means "none", exactly as `viewMode` means "the default". */
  readonly geoLayers?: ReadonlyArray<GeoLayerSnapshot>;
  /** The viewport's own `getCameraState()` result — geographic since v3. */
  readonly camera: GeographicCamera;
  readonly datetime: Date;
  readonly pickMode: PickMode;
  /** The camera policy in force. Written only when it is not the default —
   *  see {@link ViewState.viewMode}. */
  readonly viewMode?: ViewMode;
}

export function captureSnapshot(input: CaptureInput): ProjectSnapshot {
  const viewState: ViewState = {
    camera: input.camera,
    datetime: input.datetime.toISOString(),
    // Absent for the default mode: an optional field means "the default", so
    // a 3D workspace writes nothing rather than writing the default down.
    ...(input.viewMode !== undefined && input.viewMode !== "3d"
      ? { viewMode: input.viewMode }
      : {}),
  };

  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    label: input.label,
    layers: input.layers,
    ...(input.geoLayers !== undefined && input.geoLayers.length > 0
      ? { geoLayers: input.geoLayers }
      : {}),
    viewState,
    pickMode: input.pickMode,
  };
}
