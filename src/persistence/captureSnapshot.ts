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
import type { SceneTheme } from "../features/sceneTheme/sceneThemeStore";

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
  /** The scene theme in force. Written only when it is not the default — see
   *  {@link ViewState.sceneTheme}. */
  readonly sceneTheme?: SceneTheme;
  /**
   * Where the active layer sits in the two lists above — see
   * {@link ProjectSnapshot.activeLayer}.
   *
   * `undefined` when the workspace has no active layer, or when its id
   * resolves to neither list; the field is then omitted rather than written
   * as a placeholder index, and a restore falls back to the first layer.
   */
  readonly activeLayer?: ProjectSnapshot["activeLayer"];
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
    // Same rule for the theme: photoreal is "no theme", so it writes nothing.
    ...(input.sceneTheme !== undefined && input.sceneTheme !== "photoreal"
      ? { sceneTheme: input.sceneTheme }
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
    // Absent means "the first layer in unified order", exactly as an absent
    // `viewMode` means the default — so nothing active writes nothing.
    ...(input.activeLayer === undefined
      ? {}
      : { activeLayer: input.activeLayer }),
  };
}
