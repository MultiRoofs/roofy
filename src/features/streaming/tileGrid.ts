import type { Vec3 } from "../../domain/citymodel/types";

/** The rotated origin delta for a cell mesh — see sceneTransform for why
 *  this is (d.x, d.z, −d.y) and not `d` componentwise. */
export function meshOffset(cellCentre: Vec3, sceneOrigin: Vec3): Vec3 {
  const dx = cellCentre[0] - sceneOrigin[0];
  const dy = cellCentre[1] - sceneOrigin[1];
  const dz = cellCentre[2] - sceneOrigin[2];
  return [dx, dz, -dy];
}
