/**
 * Single source of truth for surface type → color mapping.
 *
 * Raw hex values live here. Both Three.js Color instances (scene layer)
 * and CSS hex strings (UI layer) are derived from this map.
 */

import type { BuildingSurfaceType } from "../domain/citymodel/types";

export const SURFACE_COLOR_VALUES: Record<BuildingSurfaceType, number> = {
  RoofSurface: 0xcc4444,
  WallSurface: 0xcccccc,
  GroundSurface: 0x886644,
  ClosureSurface: 0x999999,
  OuterCeilingSurface: 0xaaaaaa,
  OuterFloorSurface: 0x998877,
  Window: 0x6699cc,
  Door: 0x996633,
  unknown: 0x888888,
};

/** CSS hex string for use in UI (inspector dots, legends). */
export const SURFACE_COLOR_HEX: Record<BuildingSurfaceType, string> =
  Object.fromEntries(
    Object.entries(SURFACE_COLOR_VALUES).map(([k, v]) => [
      k,
      "#" + v.toString(16).padStart(6, "0"),
    ]),
  ) as Record<BuildingSurfaceType, string>;
