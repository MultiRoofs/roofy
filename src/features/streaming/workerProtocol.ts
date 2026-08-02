/** Re-export shim — the FCB worker's message shapes and the cell-geometry
 *  length invariants moved to `@cityjson/navara-flatcitybuf` in M7.5. */
export {
  assertCellGeometry,
  emptyCellGeometry,
} from "@cityjson/navara-flatcitybuf";
export type {
  CellGeometry,
  ResidentObjectRecord,
  WorkerRequest,
  WorkerResponse,
} from "@cityjson/navara-flatcitybuf";
