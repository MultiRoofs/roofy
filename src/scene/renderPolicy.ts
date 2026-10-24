/**
 * When the engine must draw every frame rather than on demand.
 *
 * The engine draws a frame when something it owns changes (the camera, a tile
 * arriving, a layer or effect update) or when it is asked to. Two things the
 * app shows change on their own with nothing to ask for each frame: the sun
 * the solar clock moves, the volumetric clouds, which drift with time, and
 * the rain or snow, whose particles fall in the mesh's own `preRender`.
 * Everything else asks for its frame (`view.forceUpdate()`, or a mesh
 * descriptor's `requestUpdate`).
 */
export function wantsContinuousRendering(state: {
  readonly timeAnimating: boolean;
  readonly cloudsShown: boolean;
  readonly precipitationShown: boolean;
}): boolean {
  return state.timeAnimating || state.cloudsShown || state.precipitationShown;
}
