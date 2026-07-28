/** Every streaming tunable. All distances are metres. Provisional — tune
 *  against delft.fcb and one large real dataset before treating as settled. */
export const SETTLE_MS = 350;
export const MOVE_FRAC = 0.2;
export const SCALE_FACTOR = 1.3;
export const T_MAX_M = 5000;
export const MAX_FOOTPRINT_SPAN_M = 8000;
export const VIEWPORT_FEATURE_BUDGET = 20000;
export const RESIDENT_TRIANGLE_BUDGET = 4_000_000;
export const RESIDENT_BYTE_BUDGET = 512 * 1024 * 1024;
export const MIN_COVER_CELLS = 9;
export const MAX_COVER_CELLS = 64;
export const LEVEL_SWAP_TIMEOUT_MS = 1500;
export const MIN_CELL_M = 50;
export const BASE_CELL_M = 100;
