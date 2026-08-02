/**
 * Re-export shim — every streaming tunable now lives in
 * `@cityjson/navara-flatcitybuf` (M7.5), because the modules that read them
 * (tile grid, level policy, hysteresis gate) moved into that package.
 */
export {
  BASE_CELL_M,
  LEVEL_SWAP_TIMEOUT_MS,
  MAX_COVER_CELLS,
  MAX_FOOTPRINT_SPAN_M,
  MIN_CELL_M,
  MIN_COVER_CELLS,
  MOVE_FRAC,
  RESIDENT_BYTE_BUDGET,
  RESIDENT_TRIANGLE_BUDGET,
  SCALE_FACTOR,
  SETTLE_MS,
  T_MAX_M,
  VIEWPORT_FEATURE_BUDGET,
} from "@cityjson/navara-flatcitybuf";
