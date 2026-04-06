/**
 * Pure geometry computations for roof surface analysis.
 *
 * All functions operate on CityJSON coordinates:
 *   X = easting, Y = northing, Z = height
 *   "Up" vector is (0, 0, 1).
 *
 * No Three.js dependency — these are pure domain functions.
 */

import type { Vec3 } from "../citymodel/types";
import type { Surface } from "../citymodel/types";
import type { RoofMetrics } from "./types";

// ---------------------------------------------------------------------------
// Surface normal via Newell's method
// ---------------------------------------------------------------------------

/**
 * Compute the (unnormalized) surface normal of a 3D polygon using
 * Newell's method: sum of cross products of consecutive edge pairs.
 * The magnitude of the result equals twice the polygon area.
 */
function newellNormal(ring: ReadonlyArray<Vec3>): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;

  for (let i = 0; i < ring.length; i++) {
    const curr = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;

    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }

  return [nx, ny, nz];
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the area of a 3D polygon.
 * Uses Newell's method — half the magnitude of the summed cross products.
 */
export function computeArea(ring: ReadonlyArray<Vec3>): number {
  if (ring.length < 3) return 0;
  return magnitude(newellNormal(ring)) / 2;
}

/**
 * Compute the inclination (tilt) of a surface from horizontal.
 * Returns degrees: 0° = flat horizontal, 90° = vertical wall.
 */
export function computeInclination(ring: ReadonlyArray<Vec3>): number {
  if (ring.length < 3) return 0;

  const normal = newellNormal(ring);
  const mag = magnitude(normal);
  if (mag === 0) return 0;

  // acos(|nz| / mag) gives 0° for flat roof (normal == up), 90° for vertical wall
  const cosAngle = Math.min(1, Math.max(-1, Math.abs(normal[2]) / mag));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

/**
 * Compute the compass azimuth a surface faces.
 * Returns degrees: 0°=North, 90°=East, 180°=South, 270°=West.
 *
 * For flat surfaces (inclination < 0.1°), returns 0 by convention
 * since the horizontal direction is undefined.
 */
export function computeAzimuth(ring: ReadonlyArray<Vec3>): number {
  if (ring.length < 3) return 0;

  const normal = newellNormal(ring);
  const mag = magnitude(normal);
  if (mag === 0) return 0;

  // Ensure normal points outward (upward Z component).
  // CW-wound polygons produce a downward normal — flip the projection.
  const sign = normal[2] < 0 ? -1 : 1;
  const hx = sign * normal[0]; // easting component
  const hy = sign * normal[1]; // northing component
  const hMag = Math.sqrt(hx * hx + hy * hy);

  // If the surface is nearly flat, azimuth is undefined
  if (hMag < 1e-6 * mag) return 0;

  // atan2(easting, northing) gives geographic azimuth (0=N, 90=E)
  let azimuth = Math.atan2(hx, hy) * (180 / Math.PI);

  // Normalize to [0, 360)
  if (azimuth < 0) azimuth += 360;

  return azimuth;
}

/**
 * Compute all roof metrics for a surface from its exterior ring.
 */
export function computeRoofMetrics(surface: Surface): RoofMetrics {
  const ring = surface.rings[0];
  if (!ring || ring.length < 3) {
    return { areaSqM: 0, inclinationDeg: 0, azimuthDeg: 0 };
  }

  return {
    areaSqM: computeArea(ring),
    inclinationDeg: computeInclination(ring),
    azimuthDeg: computeAzimuth(ring),
  };
}
