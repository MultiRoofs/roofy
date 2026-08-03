/**
 * Capture current viewer state into a ProjectSnapshot.
 *
 * Accepts all state values as parameters — no direct store imports.
 * The caller (app shell) reads from stores and passes values in.
 */

import type { PickMode } from "../domain/selection/types";
import type {
  GeographicCamera,
  LayerSnapshot,
  ProjectSnapshot,
  ViewState,
} from "./types";
import { SNAPSHOT_VERSION } from "./types";

export interface CaptureInput {
  readonly label: string;
  readonly layers: ReadonlyArray<LayerSnapshot>;
  /** The viewport's own `getCameraState()` result — geographic since v3. */
  readonly camera: GeographicCamera;
  readonly datetime: Date;
  readonly pickMode: PickMode;
}

export function captureSnapshot(input: CaptureInput): ProjectSnapshot {
  const viewState: ViewState = {
    camera: input.camera,
    datetime: input.datetime.toISOString(),
  };

  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    label: input.label,
    layers: input.layers,
    viewState,
    pickMode: input.pickMode,
  };
}
