/** Re-export shim — the uniform-level and LoD-ladder policy moved to
 *  `@cityjson/navara-flatcitybuf` in M7.5. */
export {
  buildLadder,
  cellSize,
  chooseLevel,
  lodForCellSize,
} from "@cityjson/navara-flatcitybuf";
export type { LodSelection } from "@cityjson/navara-flatcitybuf";
