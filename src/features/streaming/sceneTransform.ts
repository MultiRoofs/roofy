/**
 * The ONLY place the source-CRS ↔ scene sign convention is written.
 *
 * Vertex data is source-CRS minus an origin; each city mesh carries
 * rotation.x = -π/2, and Three composes matrixWorld = T(P)·R, so the mesh
 * position is applied AFTER the rotation, in world space.
 *
 *   world = P + R·v ,  R·v = (v.x, v.z, −v.y)
 *
 * Duplicating this at a call site is the defect this module exists to prevent.
 */
import type { Vec3 } from "../../domain/citymodel/types";

export function sourceToScene(src: Vec3, origin: Vec3, offset: Vec3): Vec3 {
  const vx = src[0] - origin[0];
  const vy = src[1] - origin[1];
  const vz = src[2] - origin[2];
  return [offset[0] + vx, offset[1] + vz, offset[2] - vy];
}

export function sceneToSource(world: Vec3, origin: Vec3, offset: Vec3): Vec3 {
  const vx = world[0] - offset[0];
  const vz = world[1] - offset[1];
  const vy = -(world[2] - offset[2]);
  return [vx + origin[0], vy + origin[1], vz + origin[2]];
}
