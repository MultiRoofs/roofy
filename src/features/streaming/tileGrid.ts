/**
 * Re-export shim — the tile-grid arithmetic moved to
 * `@cityjson/navara-flatcitybuf` in M7.5.
 */

export {
  cellBBox,
  cellCentre,
  cellSize,
  keysCovering,
  makeGrid,
  ownerKey,
} from "@cityjson/navara-flatcitybuf";
export type { CellKey, Grid } from "@cityjson/navara-flatcitybuf";
