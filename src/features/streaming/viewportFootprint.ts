/**
 * The ground area a perspective camera can actually see, as a source-CRS AABB.
 *
 * A tilted camera's far corners run toward the horizon, so each corner ray is
 * clamped to T_MAX_M. camera.far is 50-200km and is NOT a fetch radius.
 */
import { Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import type { Vec3 } from "../../domain/citymodel/types";
import { sceneToSource } from "./sceneTransform";
import { MAX_FOOTPRINT_SPAN_M, T_MAX_M } from "./constants";

const EPS = 1e-6;
const NDC_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export interface Footprint {
  readonly bbox: [number, number, number, number];
  readonly span: number;
  readonly centre: [number, number];
}

export function viewportFootprint(
  camera: PerspectiveCamera,
  groundY: number,
  origin: Vec3,
): Footprint | null {
  const eye = camera.position;
  const pts: Array<[number, number]> = [];

  for (const [nx, ny] of NDC_CORNERS) {
    const dir = new Vector3(nx, ny, 0.5).unproject(camera).sub(eye).normalize();
    let t = T_MAX_M;
    // Only intersect when the ray actually descends toward the plane.
    if (dir.y < -EPS || (dir.y > EPS && groundY > eye.y)) {
      const tHit = (groundY - eye.y) / dir.y;
      if (tHit > 0 && tHit <= T_MAX_M) t = tHit;
    }
    const world: Vec3 = [
      eye.x + dir.x * t,
      eye.y + dir.y * t,
      eye.z + dir.z * t,
    ];
    const src = sceneToSource(world, origin, [0, 0, 0]);
    if (!Number.isFinite(src[0]) || !Number.isFinite(src[1])) return null;
    pts.push([src[0], src[1]]);
  }

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bbox: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  if (!Number.isFinite(span) || span > MAX_FOOTPRINT_SPAN_M) return null;

  return {
    bbox,
    span,
    centre: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
  };
}
