/** Re-export shim — the pure commit planner (footprint → probe → level →
 *  desired/missing → hysteresis, plus the two cache-commit paths) moved to
 *  `@cityjson/navara-flatcitybuf` in M7.5. Only the driver around it
 *  (`useTileStreaming.ts`) is still app-side. */
export {
  cellStatsFromGeometry,
  commitNormal,
  commitSwap,
  ladderEquals,
  lodSelectionEquals,
  lodToWireLabel,
  planCommit,
  resolveLod,
} from "@cityjson/navara-flatcitybuf";
export type {
  CommitPlan,
  FetchedCell,
  LodConfig,
  PlanCommitInput,
} from "@cityjson/navara-flatcitybuf";
