/**
 * Derived geometry computations for CityObjects:
 * footprint area, total roof area, approximate volume, and solar score.
 */

import type { CityObject, Vec3 } from "../citymodel/types";
import { computeArea } from "../roofMetrics/metrics";

/** Re-export shim — moved to `@cityjson/navara-core` in M7.2 (the FCB worker
 *  needs it); the remaining functions in this file stay app-side. */
export { computeFootprintArea } from "@cityjson/navara-core";

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
 * @param surfaceNormal Unit normal in CityJSON Z-up space
 * @param sunDirectionThreeJs Sun direction in Three.js Y-up space
 */
export function computeSolarScore(
  surfaceNormal: Vec3,
  sunDirectionThreeJs: readonly [number, number, number],
): number {
  // Convert Three.js Y-up to CityJSON Z-up:
  // threeX = cjX, threeY = cjZ, threeZ = -cjY
  // So: cjX = threeX, cjY = -threeZ, cjZ = threeY
  const sunCJ: Vec3 = [
    sunDirectionThreeJs[0],
    -sunDirectionThreeJs[2],
    sunDirectionThreeJs[1],
  ];

  const dot =
    surfaceNormal[0] * sunCJ[0] +
    surfaceNormal[1] * sunCJ[1] +
    surfaceNormal[2] * sunCJ[2];
  return Math.max(0, dot);
}
