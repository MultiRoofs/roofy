/**
 * TEMPORARY bridge between the geographic camera state (spec 4.2) and the
 * snapshot schema's two legacy 3-tuples (`ViewState.cameraPosition` /
 * `cameraTarget`, `ShareableViewState.cp` / `ct`), which still describe a
 * Three.js position + orbit target.
 *
 * Encoding: `position = [lng, lat, height]`, `target = [heading, pitch, roll]`.
 * The tuples are pure carriers here — nothing between capture and restore reads
 * them as coordinates, so no consumer is misled by the reuse.
 *
 * DELETE ME: this module exists only to keep `src/persistence/` compiling
 * during M7. Task C18 bumps the snapshot to v3 and stores
 * `{lng, lat, height, heading, pitch, roll}` directly; Task C20 rewires
 * capture/restore onto it and deletes this file together with its test. No new
 * caller should be added — extend the v3 schema instead.
 */
import type { GeographicCameraState } from "./geographicCamera";

export function cameraStateToTuples(state: GeographicCameraState): {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
} {
  return {
    position: [state.lng, state.lat, state.height],
    target: [state.heading, state.pitch, state.roll],
  };
}

export function cameraStateFromTuples(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): GeographicCameraState {
  return {
    lng: position[0],
    lat: position[1],
    height: position[2],
    heading: target[0],
    pitch: target[1],
    roll: target[2],
  };
}
