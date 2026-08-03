/**
 * Derived geometry computations for CityObjects:
 * footprint area, total roof area, approximate volume, and solar score.
 */

import type { CityObject, Vec3 } from "../citymodel/types";
import { computeArea } from "@cityjson/navara-core";

/**
 * Compute total roof area across all RoofSurface surfaces.
 */
export function computeTotalRoofArea(obj: CityObject): number {
  return obj.surfaces
    .filter((s) => s.type === "RoofSurface")
    .reduce((sum, s) => sum + computeArea(s.rings[0] ?? []), 0);
}

/**
 * Compute approximate volume using the divergence theorem (signed tetrahedra).
 * Works best for watertight meshes but gives an approximation for open ones.
 */
export function computeVolume(obj: CityObject): number {
  let volume = 0;
  for (const surface of obj.surfaces) {
    const ring = surface.rings[0];
    if (!ring || ring.length < 3) continue;
    const v0 = ring[0]!;
    for (let i = 1; i < ring.length - 1; i++) {
      const v1 = ring[i]!;
      const v2 = ring[i + 1]!;
      // Signed volume of tetrahedron formed with origin
      volume +=
        (v0[0] * (v1[1] * v2[2] - v2[1] * v1[2]) -
          v1[0] * (v0[1] * v2[2] - v2[1] * v0[2]) +
          v2[0] * (v0[1] * v1[2] - v1[1] * v0[2])) /
        6;
    }
  }
  return Math.abs(volume);
}

/**
 * Compute solar score: cos(angle) between surface normal and sun direction.
 * Returns 0-1 (1 = surface directly facing sun).
 *
 * Both vectors are in CityJSON/ENU Z-up space — since the Navara migration
 * there is no Y-up scene space left to convert from.
 */
export function computeSolarScore(
  surfaceNormal: Vec3,
  sunDirectionEnu: readonly [number, number, number],
): number {
  const dot =
    surfaceNormal[0] * sunDirectionEnu[0] +
    surfaceNormal[1] * sunDirectionEnu[1] +
    surfaceNormal[2] * sunDirectionEnu[2];
  return Math.max(0, dot);
}
