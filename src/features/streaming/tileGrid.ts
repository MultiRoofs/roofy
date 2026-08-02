/**
 * Re-export shim — the tile-grid arithmetic moved to
 * `@cityjson/navara-flatcitybuf` in M7.5.
 *
 * `meshOffset` did NOT move: it is the R3F scene's rotated origin delta
 * (see `sceneTransform.ts` for why it is (d.x, d.z, −d.y) and not `d`
 * componentwise), which is meaningless under Navara's ECEF placement and
 * dies with that scene rather than migrating into the package.
 */
import type { Vec3 } from "../../domain/citymodel/types";

export {
  cellBBox,
  cellCentre,
  cellSize,
  keysCovering,
  makeGrid,
  ownerKey,
} from "@cityjson/navara-flatcitybuf";
export type { CellKey, Grid } from "@cityjson/navara-flatcitybuf";

/** The rotated origin delta for a cell mesh — see sceneTransform for why
 *  this is (d.x, d.z, −d.y) and not `d` componentwise. */
export function meshOffset(cellCentre: Vec3, sceneOrigin: Vec3): Vec3 {
  const dx = cellCentre[0] - sceneOrigin[0];
  const dy = cellCentre[1] - sceneOrigin[1];
  const dz = cellCentre[2] - sceneOrigin[2];
  return [dx, dz, -dy];
}
